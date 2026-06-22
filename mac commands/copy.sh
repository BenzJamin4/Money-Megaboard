#!/bin/bash
cd "/Users/ben/Documents/projects/Money Megaboard/Antigravity"
cp -a "Current Project/versions/v4.0.4" "Current Project/versions/v4.0.5"
curl -sS https://cdn.jsdelivr.net/npm/chart.js > "Current Project/versions/v4.0.5/static/chart.js"
echo "Success! The files have been copied and chart.js downloaded."
