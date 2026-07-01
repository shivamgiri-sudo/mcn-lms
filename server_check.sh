#!/bin/bash
echo "=== Server Info ==="
hostname
whoami
echo ""
echo "=== Directory Listing ==="
ls -la /home/masadmin/
echo ""
echo "=== Nginx Sites ==="
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || echo "No nginx sites"
echo ""
echo "=== Process List ==="
ps aux | grep -E 'node|npm|nginx' | grep -v grep
echo ""
echo "=== Disk ==="
df -h / | tail -1
echo ""
echo "=== Memory ==="
free -h | head -2
