#!/bin/bash
export PATH=/home/shuvam/Desktop/node-v24.15.0-linux-x64/bin:$PATH
cd "$(dirname "$0")/backend"
echo "Starting LMS Platform..."
node src/server.js
