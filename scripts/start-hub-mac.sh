#!/usr/bin/env bash
# ==============================================================================
# Mostla Showroom — Hub Server & Cloudflare Tunnel Runner for macOS
# ==============================================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
CONFIG_FILE="$SCRIPT_DIR/hub-config.json"
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$LOG_DIR"
TUNNEL_LOG="$LOG_DIR/mostla-cloudflared.log"

PORT=3000
ADMIN_PASSWORD=""
CLOUDFLARE_TOKEN=""
NO_TUNNEL=false
RESET_CONFIG=false
CLOUDFLARE_PROTOCOL="http2"  # 'http2' prevents Error 1033 by bypassing UDP/QUIC firewalls

# Helper colors for terminal output
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET_COLOR="\033[0m"

# Parse CLI flags
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --port|-p) PORT="$2"; shift ;;
        --token|-t) CLOUDFLARE_TOKEN="$2"; shift ;;
        --protocol) CLOUDFLARE_PROTOCOL="$2"; shift ;;
        --no-tunnel) NO_TUNNEL=true ;;
        --reset|-r) RESET_CONFIG=true ;;
        *) echo "Unknown option: $1" ;;
    esac
    shift
done

echo -e "${CYAN}${BOLD}=====================================================${RESET_COLOR}"
echo -e "${CYAN}${BOLD}       MOSTLA SHOWROOM — HUB SERVER (macOS)         ${RESET_COLOR}"
echo -e "${CYAN}${BOLD}=====================================================${RESET_COLOR}"

# Ensure Homebrew and standard macOS paths are available in PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$PATH"

# 1. Locate Node.js
NODE_BIN=""
if command -v node &>/dev/null; then
    NODE_BIN="$(command -v node)"
elif [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
    echo -e "${RED}[ERROR] Node.js could not be found!${RESET_COLOR}"
    echo "Please install Node.js via Homebrew (brew install node) or from https://nodejs.org"
    exit 1
fi
echo -e "${GREEN}[OK]${RESET_COLOR} Node.js found at: ${NODE_BIN} ($("$NODE_BIN" -v))"

# 2. Check / Prompt Configuration
if [ "$RESET_CONFIG" = true ] || [ ! -f "$CONFIG_FILE" ]; then
    if [ -t 0 ]; then
        # Interactive mode
        echo ""
        echo -e "${YELLOW}--- Initial Hub Configuration ---${RESET_COLOR}"
        read -p "Enter server PORT [3000]: " INPUT_PORT
        PORT=${INPUT_PORT:-$PORT}

        read -p "Enter ADMIN_PASSWORD [admin123]: " INPUT_PW
        ADMIN_PASSWORD=${INPUT_PW:-admin123}

        echo ""
        echo "Cloudflare Tunnel mode:"
        echo "  - Leave blank to use free ad-hoc TryCloudflare (subdomain *.trycloudflare.com)"
        echo "  - Or enter your Cloudflare Zero Trust Tunnel Token for a fixed domain"
        read -p "Cloudflare Tunnel Token (optional): " INPUT_TOKEN
        CLOUDFLARE_TOKEN="${INPUT_TOKEN:-}"

        cat <<EOF > "$CONFIG_FILE"
{
  "port": $PORT,
  "adminPassword": "$ADMIN_PASSWORD",
  "cloudflareToken": "$CLOUDFLARE_TOKEN",
  "configuredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
        echo -e "${GREEN}[OK]${RESET_COLOR} Configuration saved to: $CONFIG_FILE"
    else
        # Non-interactive fallback
        cat <<EOF > "$CONFIG_FILE"
{
  "port": $PORT,
  "adminPassword": "${ADMIN_PASSWORD:-admin123}",
  "cloudflareToken": "$CLOUDFLARE_TOKEN",
  "configuredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
    fi
else
    # Read saved config
    if [ -f "$CONFIG_FILE" ]; then
        CONFIG_PORT=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').port || 3000) } catch(e) { console.log(3000) }")
        CONFIG_PW=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').adminPassword || 'admin123') } catch(e) { console.log('admin123') }")
        CONFIG_TOKEN=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').cloudflareToken || '') } catch(e) { console.log('') }")

        PORT=${PORT:-$CONFIG_PORT}
        ADMIN_PASSWORD=${ADMIN_PASSWORD:-$CONFIG_PW}
        if [ -z "$CLOUDFLARE_TOKEN" ]; then
            CLOUDFLARE_TOKEN="$CONFIG_TOKEN"
        fi
    fi
fi

# Ensure node dependencies are installed
if [ ! -d "$REPO_DIR/node_modules" ]; then
    echo -e "${YELLOW}[!] node_modules not found. Installing dependencies...${RESET_COLOR}"
    (cd "$REPO_DIR" && npm install)
fi

# 3. Locate or check cloudflared
CLOUDFLARED_BIN=""
if command -v cloudflared &>/dev/null; then
    CLOUDFLARED_BIN="$(command -v cloudflared)"
elif [ -x "/opt/homebrew/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/opt/homebrew/bin/cloudflared"
elif [ -x "/usr/local/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/usr/local/bin/cloudflared"
fi

if [ "$NO_TUNNEL" = false ] && [ -z "$CLOUDFLARED_BIN" ]; then
    echo -e "${YELLOW}[WARNING] 'cloudflared' CLI was not found on your system.${RESET_COLOR}"
    echo "To install Cloudflare Tunnel on macOS, run:"
    echo -e "    ${CYAN}brew install cloudflare/cloudflare/cloudflared${RESET_COLOR}"
    echo "Starting local server only without tunnel..."
    NO_TUNNEL=true
fi

# Process cleanup handler
SERVER_PID=""
TUNNEL_PID=""

cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping services...${RESET_COLOR}"
    if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
        echo "Terminating Cloudflare Tunnel (PID: $TUNNEL_PID)..."
        kill -SIGINT "$TUNNEL_PID" 2>/dev/null || true
    fi
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Terminating Hub Server (PID: $SERVER_PID)..."
        kill -SIGINT "$SERVER_PID" 2>/dev/null || true
    fi
    echo -e "${GREEN}All services stopped cleanly.${RESET_COLOR}"
    exit 0
}

# Trap only termination signals (INT and TERM). Do NOT trap generic EXIT.
trap cleanup INT TERM

# 4. Start Hub Server
echo ""
echo -e "${BOLD}Starting Mostla Showroom Hub Server...${RESET_COLOR}"
cd "$REPO_DIR"

HOST="0.0.0.0" PORT="$PORT" ADMIN_PASSWORD="$ADMIN_PASSWORD" "$NODE_BIN" server.js &
SERVER_PID=$!

# Wait for server to become responsive on IPv4 127.0.0.1
echo -n "Waiting for server to become ready on http://127.0.0.1:$PORT"
READY=false
for i in {1..30}; do
    if curl -s "http://127.0.0.1:$PORT/api/auth-check" &>/dev/null; then
        READY=true
        break
    fi
    echo -n "."
    sleep 0.5
done
echo ""

if [ "$READY" = false ]; then
    echo -e "${RED}[ERROR] Hub server failed to respond on http://127.0.0.1:$PORT${RESET_COLOR}"
    cleanup
    exit 1
fi

echo -e "${GREEN}[OK]${RESET_COLOR} Server running at: ${BOLD}http://localhost:$PORT${RESET_COLOR} (http://127.0.0.1:$PORT)"
echo -e "     Admin panel:    ${BOLD}http://localhost:$PORT/admin.html${RESET_COLOR}"

# 5. Start Cloudflare Tunnel
if [ "$NO_TUNNEL" = false ] && [ -n "$CLOUDFLARED_BIN" ]; then
    echo ""
    echo -e "${BOLD}Starting Cloudflare Tunnel (protocol: ${CLOUDFLARE_PROTOCOL})...${RESET_COLOR}"

    # Clear previous tunnel log
    > "$TUNNEL_LOG"

    if [ -n "$CLOUDFLARE_TOKEN" ]; then
        echo -e "${CYAN}Running persistent tunnel with Cloudflare Zero Trust token...${RESET_COLOR}"
        echo -e "${YELLOW}Note: In Cloudflare Zero Trust Dashboard, set Service to: HTTP -> 127.0.0.1:${PORT}${RESET_COLOR}"
        "$CLOUDFLARED_BIN" tunnel --protocol "$CLOUDFLARE_PROTOCOL" run --token "$CLOUDFLARE_TOKEN" >> "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!

        sleep 2
        if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
            echo -e "${RED}[ERROR] Cloudflare tunnel exited immediately! (Error 1033 cause)${RESET_COLOR}"
            echo -e "${YELLOW}Tunnel error output:${RESET_COLOR}"
            tail -n 15 "$TUNNEL_LOG"
            cleanup
            exit 1
        fi
        echo -e "${GREEN}[OK]${RESET_COLOR} Tunnel connected! Logs: $TUNNEL_LOG"
    else
        echo -e "${CYAN}Running TryCloudflare ad-hoc tunnel pointing to http://127.0.0.1:$PORT ...${RESET_COLOR}"
        
        "$CLOUDFLARED_BIN" tunnel --protocol "$CLOUDFLARE_PROTOCOL" --url "http://127.0.0.1:$PORT" >> "$TUNNEL_LOG" 2>&1 &
        TUNNEL_PID=$!

        # Monitor tunnel log for generated trycloudflare URL
        echo -n "Acquiring public HTTPS URL"
        PUBLIC_URL=""
        for i in {1..50}; do
            if [ -f "$TUNNEL_LOG" ]; then
                PUBLIC_URL=$(grep -o 'https://[-a-zA-Z0-9@:%._\+~#=]\+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)
                if [ -n "$PUBLIC_URL" ]; then
                    break
                fi
            fi
            if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
                echo ""
                echo -e "${RED}[ERROR] Cloudflare tunnel process exited unexpectedly!${RESET_COLOR}"
                echo -e "${YELLOW}Log details:${RESET_COLOR}"
                tail -n 15 "$TUNNEL_LOG"
                cleanup
                exit 1
            fi
            echo -n "."
            sleep 0.5
        done
        echo ""

        if [ -n "$PUBLIC_URL" ]; then
            echo -e "${GREEN}${BOLD}=====================================================${RESET_COLOR}"
            echo -e "${GREEN}${BOLD} PUBLIC CLOUDFLARE URL ACTIVE:${RESET_COLOR}"
            echo -e "   ${BOLD}${PUBLIC_URL}${RESET_COLOR}"
            echo -e "   Admin:   ${BOLD}${PUBLIC_URL}/admin.html${RESET_COLOR}"
            echo -e "   Display: ${BOLD}${PUBLIC_URL}/display.html?screen=screen1${RESET_COLOR}"
            echo -e "${GREEN}${BOLD}=====================================================${RESET_COLOR}"
        else
            echo -e "${YELLOW}[WARNING] Could not parse TryCloudflare URL yet. Check logs: ${TUNNEL_LOG}${RESET_COLOR}"
        fi
    fi
fi

echo ""
echo -e "${GREEN}Hub is running.${RESET_COLOR} Press ${BOLD}Ctrl+C${RESET_COLOR} to stop gracefully."
echo -e "Tunnel logs: ${CYAN}${TUNNEL_LOG}${RESET_COLOR}"
echo ""

# Process supervisor loop: monitors both server and tunnel
while true; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "${RED}[ERROR] Node.js hub server stopped unexpectedly!${RESET_COLOR}"
        cleanup
        exit 1
    fi
    if [ "$NO_TUNNEL" = false ] && [ -n "$TUNNEL_PID" ]; then
        if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
            echo -e "${RED}[ERROR] Cloudflare tunnel stopped! (This triggers Cloudflare Error 1033)${RESET_COLOR}"
            echo -e "${YELLOW}Last 20 lines of tunnel log (${TUNNEL_LOG}):${RESET_COLOR}"
            tail -n 20 "$TUNNEL_LOG"
            cleanup
            exit 1
        fi
    fi
    sleep 3
done
