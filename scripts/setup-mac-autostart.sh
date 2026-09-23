#!/usr/bin/env bash
# ==============================================================================
# Mostla Showroom — macOS LaunchAgent Setup (Auto-start on Boot / Login)
# ==============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
SERVICE_NAME="com.mostla.showroom.hub"
PLIST_FILE="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
LOG_DIR="$HOME/Library/Logs"
STDOUT_LOG="$LOG_DIR/mostla-showroom.log"
STDERR_LOG="$LOG_DIR/mostla-showroom.err.log"
RUNNER_SCRIPT="$SCRIPT_DIR/start-hub-mac.sh"

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET_COLOR="\033[0m"

ACTION="${1:-install}"

case "$ACTION" in
    install)
        echo -e "${CYAN}${BOLD}Configuring Mostla Showroom Hub Auto-start for macOS...${RESET_COLOR}"
        
        # Ensure runner script is executable
        chmod +x "$RUNNER_SCRIPT"

        # Ensure LaunchAgents and Logs directories exist
        mkdir -p "$HOME/Library/LaunchAgents"
        mkdir -p "$LOG_DIR"

        # If hub-config.json doesn't exist, create default or prompt
        CONFIG_FILE="$SCRIPT_DIR/hub-config.json"
        if [ ! -f "$CONFIG_FILE" ]; then
            echo -e "${YELLOW}Notice: $CONFIG_FILE not found. Creating default configuration...${RESET_COLOR}"
            cat <<EOF > "$CONFIG_FILE"
{
  "port": 3000,
  "adminPassword": "admin123",
  "cloudflareToken": "",
  "configuredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
            echo -e "${GREEN}[OK]${RESET_COLOR} Created default config ($CONFIG_FILE). You can edit it anytime."
        fi

        # Unload existing service if already loaded
        if launchctl list | grep -q "$SERVICE_NAME"; then
            echo "Unloading previous service instance..."
            launchctl unload "$PLIST_FILE" 2>/dev/null || true
        fi

        # Generate plist definition
        cat <<EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${RUNNER_SCRIPT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${STDOUT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${STDERR_LOG}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

        # Load the service into launchctl
        launchctl load -w "$PLIST_FILE"

        echo -e "${GREEN}${BOLD}[SUCCESS] Hub service installed and active!${RESET_COLOR}"
        echo ""
        echo "The server and Cloudflare tunnel will now start automatically when you log into this Mac."
        echo ""
        echo -e "Logs location:"
        echo -e "  Output: ${CYAN}${STDOUT_LOG}${RESET_COLOR}"
        echo -e "  Errors: ${CYAN}${STDERR_LOG}${RESET_COLOR}"
        echo ""
        echo "Useful commands:"
        echo -e "  View live logs:   ${BOLD}tail -f ~/Library/Logs/mostla-showroom.log${RESET_COLOR}"
        echo -e "  Check status:     ${BOLD}./scripts/setup-mac-autostart.sh status${RESET_COLOR}"
        echo -e "  Uninstall:        ${BOLD}./scripts/setup-mac-autostart.sh uninstall${RESET_COLOR}"
        ;;

    uninstall)
        echo -e "${YELLOW}Uninstalling Mostla Showroom Hub Auto-start...${RESET_COLOR}"
        if [ -f "$PLIST_FILE" ]; then
            launchctl unload "$PLIST_FILE" 2>/dev/null || true
            rm -f "$PLIST_FILE"
            echo -e "${GREEN}[OK]${RESET_COLOR} Removed $PLIST_FILE"
        fi
        echo -e "${GREEN}[SUCCESS] Auto-start service uninstalled.${RESET_COLOR}"
        ;;

    status)
        echo -e "${CYAN}${BOLD}Mostla Showroom Hub Service Status:${RESET_COLOR}"
        if launchctl list | grep -q "$SERVICE_NAME"; then
            echo -e "Launchctl status: ${GREEN}RUNNING / LOADED${RESET_COLOR}"
            launchctl list | grep "$SERVICE_NAME"
        else
            echo -e "Launchctl status: ${RED}NOT RUNNING${RESET_COLOR}"
        fi

        echo ""
        echo "Recent log output:"
        if [ -f "$STDOUT_LOG" ]; then
            tail -n 15 "$STDOUT_LOG"
        else
            echo "No log file found yet at $STDOUT_LOG"
        fi
        ;;

    *)
        echo "Usage: $0 {install|uninstall|status}"
        exit 1
        ;;
esac
