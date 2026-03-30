#!/bin/bash
# run.sh — Launch the Money Megaboard version switcher server.
# When a version switch happens, the server exits cleanly and this script restarts it.
cd "$(dirname "$0")"

while true; do
    shared/venv/bin/python server.py
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 42 ]; then
        # Exit code 42 = "please restart me with a new version"
        # Any other exit = actual shutdown
        echo "Server stopped (exit code $EXIT_CODE)."
        break
    fi
    echo "♻️  Restarting with new version..."
    sleep 0.5
done
