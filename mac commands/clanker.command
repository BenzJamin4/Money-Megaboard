#!/bin/bash
LOG_FILE="$(dirname "$0")/clanker_cleanup.log"
exec > "$LOG_FILE" 2>&1
set -x

echo "Running clanker cleanup..."

cd "/Users/ben/Documents/projects/Money Megaboard/Antigravity" || exit 1

# Find and delete all temporary scratch and test scripts in the versions directory
find "Current Project/versions" -type f \( -name "test_*.py" -o -name "scratch_*.py" \) -delete

echo "Junk files successfully deleted!"
