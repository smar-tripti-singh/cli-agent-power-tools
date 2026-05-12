#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
MANIFEST_FILE="$SCRIPT_DIR/manifests/slack-app-manifest.json"

echo ""
echo -e "${BOLD}SmartBridge Relay Server Setup${RESET}"
echo -e "${DIM}Self-hosted relay for Slack + Power Tools${RESET}"
echo ""

# ── Prerequisites ─────────────────────────────────────────────

detect_os() {
  if [[ "$OSTYPE" == "darwin"* ]]; then echo "mac"
  elif [[ -f /etc/debian_version ]]; then echo "debian"
  elif [[ -f /etc/redhat-release ]]; then echo "redhat"
  else echo "unknown"
  fi
}

if ! command -v node &>/dev/null; then
  OS=$(detect_os)
  echo -e "${RED}Node.js is not installed.${RESET}"
  echo ""
  case $OS in
    mac)    echo -e "  ${BOLD}brew install node${RESET}" ;;
    debian) echo -e "  ${BOLD}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -${RESET}"
            echo -e "  ${BOLD}sudo apt-get install -y nodejs${RESET}" ;;
    redhat) echo -e "  ${BOLD}curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -${RESET}"
            echo -e "  ${BOLD}sudo yum install -y nodejs${RESET}" ;;
    *)      echo -e "  Install from: ${BLUE}https://nodejs.org${RESET}" ;;
  esac
  echo ""
  echo -e "${DIM}After installing, re-run this script.${RESET}"
  exit 1
fi

NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ required. You have v$(node -v).${RESET}"
  echo -e "Update Node.js and re-run this script."
  exit 1
fi

# ── Check existing .env ───────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  echo -e "${GREEN}Existing configuration found.${RESET}"
  read -r -p "Reconfigure? (y/n) [n]: " RECONFIG
  if [[ "$RECONFIG" != "y" ]]; then
    echo ""
    echo -e "Run ${BLUE}npm start${RESET} (local) or ${BLUE}pm2 start src/index.js --name smartbridge-relay${RESET} (production)."
    echo ""
    exit 0
  fi
  echo ""
fi

# ── Step 1: Slack App ─────────────────────────────────────────

echo -e "${BOLD}Step 1: Slack App${RESET}"
echo -e "${DIM}The SmartBridge bot needs to be created in your Slack workspace once.${RESET}"
echo ""
echo -e "  Check if ${BOLD}@SmartBridge${RESET} already exists — search for it in your Slack sidebar."
echo ""

read -r -p "Does SmartBridge already exist in your workspace? (y/n): " APP_EXISTS

if [[ "$APP_EXISTS" != "y" ]]; then
  echo ""
  echo -e "${BOLD}Create the Slack app using the manifest:${RESET}"
  echo ""
  echo -e "  Since you are on a server, open this URL on your ${BOLD}local machine's browser${RESET}:"
  echo ""

  # Generate manifest URL
  MANIFEST_JSON=$(node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('$MANIFEST_FILE', 'utf8'));
    console.log(encodeURIComponent(JSON.stringify(m)));
  ")
  echo -e "  ${BLUE}https://api.slack.com/apps?new_app=1&manifest_json=${MANIFEST_JSON}${RESET}"
  echo ""
  echo -e "  In the browser, follow these steps:"
  echo -e "  ${BOLD}1.${RESET} Select your workspace from the dropdown"
  echo -e "  ${BOLD}2.${RESET} Review the app configuration and click ${BOLD}Create${RESET}"
  echo -e "  ${BOLD}3.${RESET} Go to ${BOLD}Install App${RESET} in the left sidebar"
  echo -e "  ${BOLD}4.${RESET} Click ${BOLD}Install to Workspace${RESET} → click ${BOLD}Allow${RESET}"
  echo -e "  ${BOLD}5.${RESET} Go to ${BOLD}Basic Information${RESET} → scroll to ${BOLD}App-Level Tokens${RESET}"
  echo -e "  ${BOLD}6.${RESET} Click ${BOLD}Generate Token and Scopes${RESET}"
  echo -e "       Name it anything (e.g. ${DIM}socket${RESET})"
  echo -e "       Add scope: ${BOLD}connections:write${RESET}"
  echo -e "       Click ${BOLD}Generate${RESET} and copy the token (starts with ${BOLD}xapp-${RESET})"
  echo ""
  read -r -p "Press Enter once the app is created and installed..."
  echo ""
else
  echo ""
  echo -e "${GREEN}Great.${RESET} Retrieve your tokens:"
  echo ""
  echo -e "  ${BOLD}Bot Token (xoxb-):${RESET}"
  echo -e "  ${DIM}→ api.slack.com/apps → SmartBridge → OAuth & Permissions → Bot User OAuth Token${RESET}"
  echo ""
  echo -e "  ${BOLD}App-Level Token (xapp-):${RESET}"
  echo -e "  ${DIM}→ api.slack.com/apps → SmartBridge → Basic Information → App-Level Tokens${RESET}"
  echo -e "  ${DIM}  If no token exists: Generate Token and Scopes → add scope: connections:write → Generate${RESET}"
  echo ""
fi

# ── Step 2: Slack Tokens ──────────────────────────────────────

echo -e "${BOLD}Step 2: Slack Tokens${RESET}"
echo ""

read -r -p "App-Level Token (xapp-...): " SLACK_APP_TOKEN
if [[ "$SLACK_APP_TOKEN" != xapp-* ]]; then
  echo -e "${RED}Must start with xapp-${RESET}"; exit 1
fi

read -r -p "Bot Token (xoxb-...): " SLACK_BOT_TOKEN
if [[ "$SLACK_BOT_TOKEN" != xoxb-* ]]; then
  echo -e "${RED}Must start with xoxb-${RESET}"; exit 1
fi

# ── Step 3: Registration Code ─────────────────────────────────

echo ""
echo -e "${BOLD}Step 3: Registration Code${RESET}"
echo -e "${DIM}Each user will enter this code once when registering their machine.${RESET}"
echo -e "${DIM}Make it memorable but not easily guessable (e.g. acme-team-2026).${RESET}"
echo ""

read -r -p "Registration code: " RELAY_REGISTRATION_CODE
if [ -z "$RELAY_REGISTRATION_CODE" ]; then
  echo -e "${RED}Registration code cannot be empty.${RESET}"; exit 1
fi

# ── Step 4: Port ──────────────────────────────────────────────

echo ""
echo -e "${BOLD}Step 4: Port${RESET}"
echo -e "${DIM}Port the relay server will listen on.${RESET}"
echo -e "${DIM}Make sure this port is open in your firewall/security group.${RESET}"
echo ""

read -r -p "Port [8443]: " RELAY_PORT
RELAY_PORT="${RELAY_PORT:-8443}"

# Auto-generate JWT secret
RELAY_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# ── Write .env ────────────────────────────────────────────────

cat > "$ENV_FILE" <<EOF
SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
RELAY_JWT_SECRET=${RELAY_JWT_SECRET}
RELAY_REGISTRATION_CODE=${RELAY_REGISTRATION_CODE}
RELAY_PORT=${RELAY_PORT}
LOG_LEVEL=info
EOF

echo ""
echo -e "${GREEN}.env written.${RESET}"

# ── Install dependencies ──────────────────────────────────────

echo ""
echo -e "${DIM}Installing dependencies...${RESET}"
cd "$SCRIPT_DIR" && npm install --silent
echo -e "${GREEN}Dependencies installed.${RESET}"

# ── Step 5: Start server ──────────────────────────────────────

echo ""
echo -e "${BOLD}Step 5: Start server${RESET}"
echo ""
echo -e "  1) pm2  ${DIM}(recommended for production — auto-restarts, survives reboots)${RESET}"
echo -e "  2) node ${DIM}(for local testing — stops when terminal closes)${RESET}"
echo -e "  3) Skip ${DIM}(I'll start it manually later)${RESET}"
echo ""
read -r -p "Choose [1]: " START_CHOICE
START_CHOICE="${START_CHOICE:-1}"

if [[ "$START_CHOICE" == "1" ]]; then
  if ! command -v pm2 &>/dev/null; then
    echo ""
    echo -e "${DIM}Installing pm2...${RESET}"
    npm install -g pm2 --silent
    echo -e "${GREEN}pm2 installed.${RESET}"
  fi

  pm2 delete smartbridge-relay &>/dev/null || true
  pm2 start "$SCRIPT_DIR/src/index.js" --name smartbridge-relay
  pm2 save

  echo ""
  echo -e "${DIM}To auto-start on system boot:${RESET}"
  echo -e "  ${BOLD}pm2 startup${RESET}  ${DIM}(then run the command it prints)${RESET}"

elif [[ "$START_CHOICE" == "2" ]]; then
  echo ""
  echo -e "${BOLD}Starting server...${RESET}"
  echo -e "${DIM}Press Ctrl+C to stop.${RESET}"
  echo ""
  cd "$SCRIPT_DIR" && npm start
  exit 0
fi

# ── Health check ──────────────────────────────────────────────

if [[ "$START_CHOICE" == "1" ]]; then
  sleep 2
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${RELAY_PORT}/health" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}${BOLD}Server is running!${RESET}"
  else
    echo -e "${YELLOW}Health check returned: ${STATUS}${RESET}"
    echo -e "${DIM}Check logs: pm2 logs smartbridge-relay${RESET}"
  fi
fi

# ── Summary ───────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}${BOLD}Setup complete!${RESET}"
echo ""
echo -e "${BOLD}Share with your team:${RESET}"
echo ""
echo -e "  Server URL:        ${BLUE}wss://your-server-ip:${RELAY_PORT}${RESET}"
echo -e "  ${DIM}Replace 'your-server-ip' with your server's public IP or domain.${RESET}"
echo -e "  ${DIM}For local testing use: ws://localhost:${RELAY_PORT}${RESET}"
echo ""
echo -e "  Registration code: ${BLUE}${RELAY_REGISTRATION_CODE}${RESET}"
echo ""
echo -e "${BOLD}Each user runs (in bridge/slack/client/):${RESET}"
echo -e "  ${BOLD}npm run relay:register${RESET}  ${DIM}→ enter server URL + registration code${RESET}"
echo -e "  ${BOLD}npm start${RESET}"
echo ""
echo -e "${BOLD}Useful commands:${RESET}"
echo -e "  ${BOLD}pm2 logs smartbridge-relay${RESET}          View live logs"
echo -e "  ${BOLD}pm2 status${RESET}                          Check status"
echo -e "  ${BOLD}pm2 restart smartbridge-relay${RESET}       Restart server"
echo -e "  ${BOLD}pm2 stop smartbridge-relay${RESET}          Stop server"
echo -e "  ${BOLD}curl http://localhost:${RELAY_PORT}/status${RESET}   Check connected users"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
