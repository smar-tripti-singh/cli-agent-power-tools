# SmartBridge Relay Server

Central relay server for SmartBridge. Receives Slack events via Socket Mode and routes them to each user's local machine. Users process requests locally with their own credentials — no credentials stored on the server.

## How it works

```
Slack ──Socket Mode──▶ Relay Server ──WebSocket──▶ User's machine
                            │                           │
                            │◀──── result ─────────────│
                            │
                            ▼
                        Slack (posts result to thread)
```

## Prerequisites

- Node.js 18+
- A server that stays on (EC2, VPS, or any always-on machine)
- Slack app with Socket Mode enabled (see `../client/manifests/slack-app-manifest.json`)

## Setup

```bash
cd bridge/slack/server
./setup.sh
```

The script will ask for:

| Input | Where to find it |
|---|---|
| App-Level Token (`xapp-...`) | api.slack.com/apps → SmartBridge → Basic Information → App-Level Tokens |
| Bot Token (`xoxb-...`) | api.slack.com/apps → SmartBridge → OAuth & Permissions |
| Registration code | Make it up — share this with your team |
| Port | Default: 8443 |

Then choose how to start:
- **pm2** — recommended for production (auto-restarts, survives reboots)
- **node** — for local testing (stops when terminal closes)

## After setup

Share with your team:
```
Server URL:        wss://your-server-ip:8443   (production)
                   ws://localhost:8443          (local testing)
Registration code: the-code-you-set
```

Each user then runs in `bridge/slack/client/`:
```bash
npm run relay:register   # enter server URL + registration code
npm run start:relay
```

## Admin commands

```bash
# pm2 (production)
pm2 logs smartbridge-relay      View live logs
pm2 status                      Check if running
pm2 restart smartbridge-relay   Restart server
pm2 stop smartbridge-relay      Stop server
pm2 startup                     Enable auto-start on system boot

# Health check
curl http://localhost:8443/health
curl http://localhost:8443/status

# Revoke a user's access
curl -X POST http://localhost:8443/api/revoke \
  -H "Content-Type: application/json" \
  -d '{"userId": "U0123456789"}'
```

## Directory structure

```
server/
├── src/
│   ├── index.js           Entry point
│   ├── config.js          Environment variable configuration
│   ├── logger.js          Structured JSON logger
│   ├── auth.js            JWT issue/verify/hash
│   ├── registry.js        User registry + offline queue + persistence
│   ├── ws-server.js       WebSocket server + HTTP admin API
│   ├── slack-socket.js    Socket Mode connection to Slack
│   ├── slack-poster.js    Posts results/status to Slack
│   └── router.js          Routes events to correct user
├── data/
│   └── state.json         Persisted registry (auto-created)
├── setup.sh               Interactive setup script
└── .env.example           Environment variable reference
```

## Persistence

User registrations and offline queues are saved to `data/state.json` every 60 seconds. On restart, all registered users remain valid — no re-registration needed.

## Security

- No Smartsheet credentials or Claude API keys stored on server
- Users authenticate via JWT (30-day expiry, auto-refresh)
- Registration requires a shared code — prevents open registration
- All WebSocket connections use WSS (TLS) in production

## License

MIT
