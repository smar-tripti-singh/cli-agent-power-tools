# SmartBridge

Connect Smartsheet Power Tools to messaging platforms. Ask questions in your chat tool, Power Tools run locally on your machine, results appear in the channel.

## How it works

```
You in Slack: "@SmartBridge what's at risk?"
  → SmartBridge picks up your message
  → Spawns Claude Code with the right Power Tool agent
  → Agent reads Smartsheet data via MCP
  → Result posted back to the thread
```

Each user runs SmartBridge on their own machine with their own Smartsheet credentials. No shared server required for basic setup.

## Prerequisites

- [Claude Code](https://docs.claude.ai/en/docs/claude-code/overview) installed
- Smartsheet MCP configured (run `../smartsheet_mcp_setup.sh`)
- Node.js 18+

## Supported platforms

| Platform | Status | Setup |
|---|---|---|
| Slack | ✅ Available | [slack/README.md](slack/README.md) |

More platforms coming. See `CONTRIBUTING.md` to add one.

## Directory structure

```
bridge/
├── slack/               ← Slack integration
│   ├── client/          ← runs on each user's machine
│   ├── server/          ← relay server (optional, org-hosted)
│   └── README.md        ← Slack setup guide
└── README.md            ← this file
```

## License

MIT
