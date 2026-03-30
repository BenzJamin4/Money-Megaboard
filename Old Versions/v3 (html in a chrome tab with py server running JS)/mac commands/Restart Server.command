#!/bin/bash
# Double-click this file in Finder to restart the Money Megaboard server.
cd "$(dirname "$0")"/..

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Money Megaboard — Restarting Server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Stop the server on port 5050
KILLED=$(lsof -ti:5050 | xargs kill -9 2>/dev/null && echo "yes" || echo "no")

# Give the OS a moment to completely free the port
sleep 1

if [ "$KILLED" = "yes" ]; then
    echo "✅ Server stopped."
else
    echo "ℹ️  No server was running on port 5050."
fi

# 2. Quit Google Chrome if it's running
if pgrep -x "Google Chrome" > /dev/null; then
    osascript -e 'tell application "Google Chrome" to quit'
    echo "✅ Google Chrome closed."
fi
sleep 1

echo ""
echo "Starting server..."

# 3. Start the server in the background
nohup bash run.sh > server.log 2>&1 &
echo "✅ Server started."

# 4. Wait a moment then open Chrome
sleep 3
echo "Opening Chrome..."
open -a "Google Chrome" http://127.0.0.1:5050

echo "✅ Chrome opened."
echo ""
echo "Done! Closing window in 2 seconds..."
sleep 2

# 5. Close the terminal window
osascript -e 'tell application "Terminal" to close front window' > /dev/null 2>&1 &
exit 0
