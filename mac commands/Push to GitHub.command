#!/bin/bash
# Move to the project root directory
cd "$(dirname "$0")/.."

echo "Pushing commits to GitHub..."
git push origin main

echo ""
echo "Push complete!"
read -p "Press Enter to close this window..."
