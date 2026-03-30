#!/bin/bash
# Double-click this file in Finder to stop the Money Megaboard server.
cd "$(dirname "$0")"/..

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Money Megaboard — Stopping Server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

KILLED=$(lsof -ti:5050 | xargs kill -9 2>/dev/null && echo "yes" || echo "no")

if [ "$KILLED" = "yes" ]; then
    echo "✅ Server stopped."
else
    echo "ℹ️  No server was running on port 5050."
fi

# Quit Google Chrome if it's running
if pgrep -x "Google Chrome" > /dev/null; then
    osascript -e 'tell application "Google Chrome" to quit'
    echo "✅ Google Chrome closed."
fi

echo ""
echo "You can close this window."
sleep 3
