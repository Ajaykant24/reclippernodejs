#!/bin/bash
# ── Reclipper backend deploy script ──
# Run this ON THE CONTABO SERVER (as root):  bash deploy.sh
# It pulls the latest code, installs dependencies, restarts the service,
# and health-checks the result — with a clear ✓/✗ at every step.
# After this deploy, future updates can be done from the Admin panel's
# "Update Server" button — no SSH needed.

set -u
REPO_DIR="/root/reclippernodejs"
cd "$REPO_DIR" || { echo "✗ Repo not found at $REPO_DIR"; exit 1; }

echo "→ Pulling latest code…"
if ! git pull origin main; then
  echo "✗ git pull failed. If it mentions 'divergent branches' or local changes, run:"
  echo "    git fetch origin main && git reset --hard origin/main"
  echo "  then run this script again."
  exit 1
fi
echo "✓ Code updated to: $(git log -1 --format='%h %s')"

echo "→ Installing backend dependencies…"
if ! npm --prefix backend install --omit=dev; then
  echo "✗ npm install failed — check the error above."
  exit 1
fi
echo "✓ Dependencies ready"

echo "→ Restarting the reclipper service…"
systemctl restart reclipper || { echo "✗ Service restart failed"; exit 1; }
sleep 3

echo "→ Health check…"
if curl -sk --max-time 10 https://api.clippar.online/health | grep -q '"ok"'; then
  echo "✓ Backend is UP and healthy at https://api.clippar.online"
  echo "✓ Deploy complete. Future updates: Admin panel → Update Server."
else
  echo "✗ Health check failed. Recent logs:"
  journalctl -u reclipper -n 20 --no-pager
  exit 1
fi
