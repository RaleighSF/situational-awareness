#!/bin/bash
# Setup script for deploying VSS API Gateway on the EC2 instance.
# Run this on the EC2 instance after cloning the repo.
#
# Prerequisites:
#   - Cosmos API already running on port 8000
#   - Python 3.11+ installed
#   - Cloudflare tunnel already configured
#
# Usage:
#   ssh -i ~/Downloads/nvidia_vlm.pem ubuntu@ec2-52-54-144-247.compute-1.amazonaws.com
#   cd /home/ubuntu
#   git clone <repo> vss
#   cd vss
#   bash deploy/setup-ec2.sh

set -euo pipefail

echo "================================================"
echo "  VSS API Gateway — EC2 Setup"
echo "================================================"

# 1. Create Python virtual environment
echo "[1/6] Setting up Python virtual environment..."
cd /home/ubuntu/vss/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 2. Create .env file if it doesn't exist
echo "[2/6] Checking .env file..."
if [ ! -f /home/ubuntu/vss/.env ]; then
    cp /home/ubuntu/vss/.env.example /home/ubuntu/vss/.env
    echo "IMPORTANT: Edit /home/ubuntu/vss/.env and add your GEMINI_API_KEY"
fi

# 3. Initialize databases
echo "[3/6] Initializing databases..."
python -c "
import asyncio
from db.sqlite import init_db
from db.chroma import get_chroma_collection
asyncio.run(init_db('./vss_metadata.db'))
get_chroma_collection('./chroma_data')
print('Databases initialized.')
"

# 4. Install systemd service
echo "[4/6] Installing systemd service..."
sudo cp /home/ubuntu/vss/deploy/vss-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vss-api

# 5. Update Cloudflare tunnel config
echo "[5/6] Updating Cloudflare tunnel..."
# Check if the vss-api hostname is already in the config
if grep -q "vss-api.agentdemos.com" /etc/cloudflared/config.yml; then
    echo "  vss-api.agentdemos.com already in Cloudflare config."
else
    echo "  Adding vss-api.agentdemos.com to Cloudflare config..."
    # Insert before the catch-all 404 rule
    sudo sed -i '/- service: http_status:404/i\    - hostname: vss-api.agentdemos.com\n      service: http://localhost:8200' /etc/cloudflared/config.yml
    echo "  Restarting cloudflared..."
    sudo systemctl restart cloudflared
fi

# 6. Start the service
echo "[6/6] Starting VSS API Gateway..."
sudo systemctl start vss-api
sleep 2

# Verify
if systemctl is-active --quiet vss-api; then
    echo ""
    echo "================================================"
    echo "  VSS API Gateway is RUNNING on port 8200"
    echo "================================================"
    echo ""
    echo "  Health check: curl http://localhost:8200/api/health"
    echo "  External:     https://vss-api.agentdemos.com/api/health"
    echo ""
    echo "  Next steps:"
    echo "  1. Edit /home/ubuntu/vss/.env and add GEMINI_API_KEY"
    echo "  2. Restart: sudo systemctl restart vss-api"
    echo "  3. Run seeding: cd /home/ubuntu/vss && python scripts/seed_demo_data.py"
    echo "  4. Add CNAME record: vss-api.agentdemos.com -> tunnel.cfargotunnel.com"
    echo ""
else
    echo ""
    echo "ERROR: VSS API Gateway failed to start!"
    echo "Check logs: journalctl -u vss-api -f"
    exit 1
fi
