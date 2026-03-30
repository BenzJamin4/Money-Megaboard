#!/bin/bash
# Double-click this file in Finder to start the Money Megaboard server.
cd "$(dirname "$0")"/..

# Kill any existing server on port 5050
lsof -ti:5050 | xargs kill -9 2>/dev/null
sleep 0.5

# Start the server in the background (detached from this terminal)
nohup bash run.sh > server.log 2>&1 &

# Wait a moment then open Chrome
sleep 2
open -a "Google Chrome" http://127.0.0.1:5050
