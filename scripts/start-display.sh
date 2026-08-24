#!/usr/bin/env bash
# Bash script to launch Fullscreen Navigator for Linux/macOS Signage Displays

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONFIG_FILE="$SCRIPT_DIR/display-config.json"
RESET=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --reset|-r) RESET=true ;;
        *) echo "Unknown option: $1" ;;
    esac
    shift
done

if [ "$RESET" = true ] || [ ! -f "$CONFIG_FILE" ]; then
    echo "============================================="
    echo "    SIGNAGE DISPLAY INITIAL SETUP            "
    echo "============================================="
    read -p "Enter Display Name (e.g. screen1, entrance): " DISPLAY_NAME
    DISPLAY_NAME=${DISPLAY_NAME:-screen1}

    read -p "Enter Hub Server URL [http://localhost:3000]: " SERVER_URL
    SERVER_URL=${SERVER_URL:-http://localhost:3000}

    # Ensure http prefix
    if [[ ! "$SERVER_URL" =~ ^https?:// ]]; then
        SERVER_URL="http://$SERVER_URL"
    fi
    SERVER_URL="${SERVER_URL%/}"

    cat <<EOF > "$CONFIG_FILE"
{
  "displayName": "$DISPLAY_NAME",
  "serverUrl": "$SERVER_URL",
  "configuredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
    echo "Saved config to $CONFIG_FILE"
fi

DISPLAY_NAME=$(grep -o '"displayName": "[^"]*' "$CONFIG_FILE" | grep -o '[^"]*$')
SERVER_URL=$(grep -o '"serverUrl": "[^"]*' "$CONFIG_FILE" | grep -o '[^"]*$')

TARGET_URL="$SERVER_URL/display.html?displayId=$DISPLAY_NAME&screen=$DISPLAY_NAME"
echo "Starting Signage Display ($DISPLAY_NAME) pointing to $TARGET_URL..."

if [ "$(uname)" == "Darwin" ]; then
    echo "Launching Safari on macOS in Fullscreen mode..."
    open -a Safari "$TARGET_URL"
    sleep 1
    osascript -e '
    tell application "Safari"
        activate
        delay 0.5
        tell application "System Events"
            keystroke "f" using {command down, control down}
        end tell
    end tell
    '
    exit 0
fi

# Linux browser discovery (Chromium / Firefox)
CHROME_BIN=""
if command -v chromium-browser &> /dev/null; then
    CHROME_BIN="chromium-browser"
elif command -v google-chrome &> /dev/null; then
    CHROME_BIN="google-chrome"
elif command -v chrome &> /dev/null; then
    CHROME_BIN="chrome"
fi

if [ -n "$CHROME_BIN" ]; then
    echo "Launching fullscreen browser: $CHROME_BIN"
    "$CHROME_BIN" --kiosk "$TARGET_URL" --noerrdialogs --disable-infobars --no-first-run --autoplay-policy=no-user-gesture-required
elif command -v firefox &> /dev/null; then
    echo "Launching fullscreen Firefox..."
    firefox --kiosk "$TARGET_URL"
else
    echo "Opening with xdg-open..."
    if command -v xdg-open &> /dev/null; then
        xdg-open "$TARGET_URL"
    fi
fi
