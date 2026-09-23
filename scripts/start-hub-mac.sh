#!/usr/bin/env bash
# ==============================================================================
# Mostla Showroom — Hub Server & ngrok / Cloudflare Tunnel Runner for macOS
# ==============================================================================

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
CONFIG_FILE="$SCRIPT_DIR/hub-config.json"
LOG_DIR="$HOME/Library/Logs"
mkdir -p "$LOG_DIR"
SERVER_LOG="$LOG_DIR/mostla-server.log"
TUNNEL_LOG="$LOG_DIR/mostla-tunnel.log"

PORT=3002
ADMIN_PASSWORD=""
TUNNEL_PROVIDER="ngrok" # 'ngrok' (default for permanent static URL) or 'cloudflare'
NGROK_DOMAIN="tremor-tacky-dandelion.ngrok-free.dev"
NGROK_TOKEN=""
CLOUDFLARE_TOKEN=""
NO_TUNNEL=false
RESET_CONFIG=false

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
        --ngrok-domain|-d) NGROK_DOMAIN="$2"; TUNNEL_PROVIDER="ngrok"; shift ;;
        --ngrok-token) NGROK_TOKEN="$2"; TUNNEL_PROVIDER="ngrok"; shift ;;
        --cloudflare) TUNNEL_PROVIDER="cloudflare" ;;
        --token|-t) CLOUDFLARE_TOKEN="$2"; TUNNEL_PROVIDER="cloudflare"; shift ;;
        --no-tunnel) NO_TUNNEL=true ;;
        --reset|-r) RESET_CONFIG=true ;;
        *) echo "Unknown option: $1" ;;
    esac
    shift
done

echo -e "${CYAN}${BOLD}=====================================================${RESET_COLOR}"
echo -e "${CYAN}${BOLD}  MOSTLA SHOWROOM — HUB SERVER (PORT ${PORT} + ${TUNNEL_PROVIDER^^})  ${RESET_COLOR}"
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
        echo -e "${YELLOW}--- Hub Configuration ---${RESET_COLOR}"
        read -p "Enter ADMIN_PASSWORD [admin123]: " INPUT_PW
        ADMIN_PASSWORD=${INPUT_PW:-admin123}

        echo ""
        echo -e "${YELLOW}--- ngrok Permanent Domain Configuration ---${RESET_COLOR}"
        echo "Tip: You can use your free permanent ngrok domain (e.g. tremor-tacky-dandelion.ngrok-free.dev)"
        read -p "ngrok Static Domain [${NGROK_DOMAIN}]: " INPUT_DOMAIN
        NGROK_DOMAIN=${INPUT_DOMAIN:-$NGROK_DOMAIN}

        read -p "ngrok Authtoken (leave empty if already configured via 'ngrok config add-authtoken'): " INPUT_NGROK_TOKEN
        NGROK_TOKEN=${INPUT_NGROK_TOKEN:-}

        cat <<EOF > "$CONFIG_FILE"
{
  "port": $PORT,
  "adminPassword": "$ADMIN_PASSWORD",
  "tunnelProvider": "$TUNNEL_PROVIDER",
  "ngrokDomain": "$NGROK_DOMAIN",
  "ngrokToken": "$NGROK_TOKEN",
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
  "tunnelProvider": "$TUNNEL_PROVIDER",
  "ngrokDomain": "$NGROK_DOMAIN",
  "ngrokToken": "$NGROK_TOKEN",
  "cloudflareToken": "$CLOUDFLARE_TOKEN",
  "configuredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
    fi
else
    # Read saved config
    if [ -f "$CONFIG_FILE" ]; then
        CONFIG_PW=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').adminPassword || 'admin123') } catch(e) { console.log('admin123') }")
        CONFIG_PROVIDER=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').tunnelProvider || 'ngrok') } catch(e) { console.log('ngrok') }")
        CONFIG_DOMAIN=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').ngrokDomain || '') } catch(e) { console.log('') }")
        CONFIG_NGROK_TOKEN=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').ngrokToken || '') } catch(e) { console.log('') }")
        CONFIG_CF_TOKEN=$("$NODE_BIN" -e "try { console.log(require('$CONFIG_FILE').cloudflareToken || '') } catch(e) { console.log('') }")

        ADMIN_PASSWORD=${ADMIN_PASSWORD:-$CONFIG_PW}
        if [ "$TUNNEL_PROVIDER" = "ngrok" ] && [ -n "$CONFIG_PROVIDER" ]; then
            TUNNEL_PROVIDER="$CONFIG_PROVIDER"
        fi
        if [ -n "$CONFIG_DOMAIN" ] && [ "$NGROK_DOMAIN" = "tremor-tacky-dandelion.ngrok-free.dev" ]; then
            NGROK_DOMAIN="$CONFIG_DOMAIN"
        fi
        NGROK_TOKEN=${NGROK_TOKEN:-$CONFIG_NGROK_TOKEN}
        CLOUDFLARE_TOKEN=${CLOUDFLARE_TOKEN:-$CONFIG_CF_TOKEN}

        # Update port in config file to 3002
        "$NODE_BIN" -e "try { const fs=require('fs'); const cfg=require('$CONFIG_FILE'); cfg.port=$PORT; fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2)); } catch(e){}"
    fi
fi

# Ensure node dependencies are installed
if [ ! -d "$REPO_DIR/node_modules" ]; then
    echo -e "${YELLOW}[!] node_modules not found. Installing dependencies...${RESET_COLOR}"
    (cd "$REPO_DIR" && npm install)
fi

# 3. Locate Tunnel CLI (ngrok or cloudflared)
TUNNEL_BIN=""
if [ "$NO_TUNNEL" = false ]; then
    if [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
        if command -v ngrok &>/dev/null; then
            TUNNEL_BIN="$(command -v ngrok)"
        elif [ -x "/opt/homebrew/bin/ngrok" ]; then
            TUNNEL_BIN="/opt/homebrew/bin/ngrok"
        elif [ -x "/usr/local/bin/ngrok" ]; then
            TUNNEL_BIN="/usr/local/bin/ngrok"
        fi

        if [ -z "$TUNNEL_BIN" ]; then
            echo -e "${YELLOW}[WARNING] 'ngrok' CLI was not found on your system.${RESET_COLOR}"
            echo "To install ngrok on macOS, run:"
            echo -e "    ${CYAN}brew install ngrok/ngrok/ngrok${RESET_COLOR}"
            echo "Starting local server only without tunnel..."
            NO_TUNNEL=true
        else
            echo -e "${GREEN}[OK]${RESET_COLOR} ngrok CLI found at: ${TUNNEL_BIN}"
            # Configure authtoken if provided
            if [ -n "$NGROK_TOKEN" ]; then
                "$TUNNEL_BIN" config add-authtoken "$NGROK_TOKEN" 2>/dev/null || true
            fi
        fi
    else
        # Cloudflare fallback
        if command -v cloudflared &>/dev/null; then
            TUNNEL_BIN="$(command -v cloudflared)"
        elif [ -x "/opt/homebrew/bin/cloudflared" ]; then
            TUNNEL_BIN="/opt/homebrew/bin/cloudflared"
        elif [ -x "/usr/local/bin/cloudflared" ]; then
            TUNNEL_BIN="/usr/local/bin/cloudflared"
        fi

        if [ -z "$TUNNEL_BIN" ]; then
            echo -e "${YELLOW}[WARNING] 'cloudflared' CLI was not found on your system.${RESET_COLOR}"
            echo "To install Cloudflare Tunnel on macOS, run:"
            echo -e "    ${CYAN}brew install cloudflare/cloudflare/cloudflared${RESET_COLOR}"
            echo "Starting local server only without tunnel..."
            NO_TUNNEL=true
        fi
    fi
fi

# 4. Check for lingering process occupying port 3002 and clean it up
OCCUPYING_PID=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -n "$OCCUPYING_PID" ]; then
    echo -e "${YELLOW}[!] Port $PORT is currently occupied by PID $OCCUPYING_PID. Cleaning up stale process...${RESET_COLOR}"
    kill -9 $OCCUPYING_PID 2>/dev/null || true
    sleep 1
fi

# Process cleanup handler
SERVER_PID=""
TUNNEL_PID=""

cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping services...${RESET_COLOR}"
    if [ -n "$TUNNEL_PID" ] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
        echo "Terminating Tunnel (PID: $TUNNEL_PID)..."
        kill -SIGINT "$TUNNEL_PID" 2>/dev/null || true
    fi
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Terminating Hub Server (PID: $SERVER_PID)..."
        kill -SIGINT "$SERVER_PID" 2>/dev/null || true
    fi
    echo -e "${GREEN}All services stopped cleanly.${RESET_COLOR}"
    exit 0
}

# Trap termination signals (INT and TERM)
trap cleanup INT TERM

# 5. Start Hub Server
echo ""
echo -e "${BOLD}Starting Mostla Showroom Hub Server on port $PORT...${RESET_COLOR}"
cd "$REPO_DIR"

> "$SERVER_LOG"
HOST="0.0.0.0" PORT="$PORT" ADMIN_PASSWORD="$ADMIN_PASSWORD" "$NODE_BIN" server.js >> "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Wait for server to become responsive on IPv4 127.0.0.1
echo -n "Waiting for server to become ready on http://127.0.0.1:$PORT"
READY=false
for i in {1..30}; do
    if curl -s "http://127.0.0.1:$PORT/api/auth-check" &>/dev/null; then
        READY=true
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        break
    fi
    echo -n "."
    sleep 0.5
done
echo ""

if [ "$READY" = false ]; then
    echo -e "${RED}[ERROR] Hub server failed to start or crashed on http://127.0.0.1:$PORT${RESET_COLOR}"
    echo -e "${YELLOW}Last entries from server log ($SERVER_LOG):${RESET_COLOR}"
    if [ -f "$SERVER_LOG" ]; then
        tail -n 25 "$SERVER_LOG"
    fi
    cleanup
    exit 1
fi

echo -e "${GREEN}[OK]${RESET_COLOR} Server running at: ${BOLD}http://localhost:$PORT${RESET_COLOR}"
echo -e "     Admin panel:    ${BOLD}http://localhost:$PORT/admin.html${RESET_COLOR}"

# 6. Start Tunnel
if [ "$NO_TUNNEL" = false ] && [ -n "$TUNNEL_BIN" ]; then
    echo ""
    > "$TUNNEL_LOG"

    if [ "$TUNNEL_PROVIDER" = "ngrok" ]; then
        echo -e "${BOLD}Starting ngrok Tunnel with fixed domain: ${CYAN}${NGROK_DOMAIN}${RESET_COLOR} ...${RESET_COLOR}"
        
        # Strip https:// if user passed full URL
        CLEAN_DOMAIN=$(echo "$NGROK_DOMAIN" | sed -e 's|^https://||' -e 's|^http://||' -e 's|/$||')
        
        if [ -n "$CLEAN_DOMAIN" ]; then
            "$TUNNEL_BIN" http --url="$CLEAN_DOMAIN" "$PORT" >> "$TUNNEL_LOG" 2>&1 &
            TUNNEL_PID=$!
        else
            "$TUNNEL_BIN" http "$PORT" >> "$TUNNEL_LOG" 2>&1 &
            TUNNEL_PID=$!
        fi

        # Wait for ngrok local inspector API to verify active tunnel
        echo -n "Connecting to ngrok edge"
        PUBLIC_URL=""
        for i in {1..40}; do
            if curl -s http://127.0.0.1:4040/api/tunnels &>/dev/null; then
                PUBLIC_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o 'https://[^"]*' | head -n 1 || true)
                if [ -n "$PUBLIC_URL" ]; then
                    break
                fi
            fi
            if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
                echo ""
                echo -e "${RED}[ERROR] ngrok exited unexpectedly!${RESET_COLOR}"
                echo -e "${YELLOW}ngrok log details:${RESET_COLOR}"
                tail -n 20 "$TUNNEL_LOG"
                cleanup
                exit 1
            fi
            echo -n "."
            sleep 0.5
        done
        echo ""

        if [ -z "$PUBLIC_URL" ] && [ -n "$CLEAN_DOMAIN" ]; then
            PUBLIC_URL="https://$CLEAN_DOMAIN"
        fi

        if [ -n "$PUBLIC_URL" ]; then
            echo -e "${GREEN}${BOLD}=====================================================${RESET_COLOR}"
            echo -e "${GREEN}${BOLD} FIXED PUBLIC NGROK URL ACTIVE:${RESET_COLOR}"
            echo -e "   ${BOLD}${PUBLIC_URL}${RESET_COLOR}"
            echo -e "   Admin:   ${BOLD}${PUBLIC_URL}/admin.html${RESET_COLOR}"
            echo -e "   Display: ${BOLD}${PUBLIC_URL}/display.html?screen=screen1${RESET_COLOR}"
            echo -e "${GREEN}${BOLD}=====================================================${RESET_COLOR}"
        fi

    else
        # Cloudflare Tunnel Mode
        echo -e "${BOLD}Starting Cloudflare Tunnel (protocol: http2)...${RESET_COLOR}"
        if [ -n "$CLOUDFLARE_TOKEN" ]; then
            "$TUNNEL_BIN" tunnel --protocol http2 run --token "$CLOUDFLARE_TOKEN" >> "$TUNNEL_LOG" 2>&1 &
            TUNNEL_PID=$!
        else
            "$TUNNEL_BIN" tunnel --protocol http2 --url "http://127.0.0.1:$PORT" >> "$TUNNEL_LOG" 2>&1 &
            TUNNEL_PID=$!
        fi
        sleep 2
    fi
fi

echo ""
echo -e "${GREEN}Hub is running on port $PORT.${RESET_COLOR} Press ${BOLD}Ctrl+C${RESET_COLOR} to stop gracefully."
echo -e "Server logs: ${CYAN}${SERVER_LOG}${RESET_COLOR}"
echo -e "Tunnel logs: ${CYAN}${TUNNEL_LOG}${RESET_COLOR}"
echo ""

# Supervisor loop: monitors both server and tunnel processes
while true; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "${RED}[ERROR] Node.js hub server stopped unexpectedly!${RESET_COLOR}"
        echo -e "${YELLOW}Server log (${SERVER_LOG}):${RESET_COLOR}"
        if [ -f "$SERVER_LOG" ]; then
            tail -n 25 "$SERVER_LOG"
        fi
        cleanup
        exit 1
    fi
    if [ "$NO_TUNNEL" = false ] && [ -n "$TUNNEL_PID" ]; then
        if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
            echo -e "${RED}[ERROR] Tunnel process ($TUNNEL_PROVIDER) stopped unexpectedly!${RESET_COLOR}"
            echo -e "${YELLOW}Tunnel log (${TUNNEL_LOG}):${RESET_COLOR}"
            if [ -f "$TUNNEL_LOG" ]; then
                tail -n 20 "$TUNNEL_LOG"
            fi
            cleanup
            exit 1
        fi
    fi
    sleep 3
done
