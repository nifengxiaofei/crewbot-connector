# Super Agent Connector

English | [简体中文](README.zh-CN.md)

The source code of `crewbot`, the local daemon for [super-agent.team](https://super-agent.team).

It connects the coding agents on your computer (currently [Claude Code](https://claude.com/claude-code)) to your Super Agent workspace, so you can give each project its own bot and talk to it from any browser — your laptop, your phone, anywhere. The agents run on **your** computer, in **your** project folders; super-agent.team only relays the conversation.

This repository is published so you can read exactly what runs on your machine, and build it yourself if you prefer. The published npm package [`crewbot`](https://www.npmjs.com/package/crewbot) is built from this code.

## Repository layout

```
.
├── daemon/               # the `crewbot` CLI and background daemon (published to npm as `crewbot`)
│   ├── src/
│   │   ├── index.ts      # CLI entry: start / stop / restart / status / logs / logout
│   │   ├── commands.ts   # command implementations, background process management
│   │   ├── login.ts      # device pairing (OAuth 2.0 device authorization flow)
│   │   ├── daemon.ts     # WebSocket connection to the server, reconnect, event resend
│   │   ├── agent.ts      # one agent process + one ACP session per bot
│   │   ├── adapters.ts   # installs the Claude Code ACP adapter on first use
│   │   ├── agents.ts     # detects installed agents (claude) and their login status
│   │   └── ...
│   └── spike/acp.ts      # standalone ACP test script (prompt / steering / permissions / resume)
└── packages/protocol/    # message types shared by the daemon and the server (bundled into the build)
```

Agents are driven through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) using [`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp).

## Requirements

- Node.js 22 or newer
- pnpm 10 (`corepack enable` sets up the version pinned in `package.json`)
- [Claude Code](https://claude.com/claude-code) installed and signed in (run `claude` once). CrewBot uses the `claude` already on your computer.

## Build from source

```bash
git clone <this repository> crewbot-connector
cd crewbot-connector
corepack enable
pnpm install
pnpm build        # outputs daemon/dist/index.mjs
pnpm typecheck    # optional
```

Run the build directly:

```bash
node daemon/dist/index.mjs start
node daemon/dist/index.mjs status
```

Or install your build as the global `crewbot` command. This links to the repository, so later `pnpm build`s take effect after `crewbot restart`:

```bash
npm install -g ./daemon
crewbot start
```

To install a standalone copy instead, pack it first:

```bash
cd daemon && pnpm pack        # creates crewbot-<version>.tgz
npm install -g ./crewbot-*.tgz
```

### Development mode

Run the TypeScript source with `tsx`, without building. Use `--foreground` — the background mode re-launches the built file and doesn't work from source:

```bash
pnpm dev start --foreground
pnpm dev status
```

The daemon talks to `https://super-agent.team` by default. Set `CREWBOT_SERVER` to point it elsewhere:

```bash
CREWBOT_SERVER=http://localhost:3000 pnpm dev start --foreground
```

> Builds from source, the npm package and dev mode all share the same config directory (`~/.config/crewbot/`) and only one daemon can run at a time. Run `crewbot stop` before switching between them, or set `XDG_CONFIG_HOME` to a different directory to keep them apart.

## Usage

### 1. Link this computer

```bash
crewbot start
```

The first time, it shows a short code and opens your browser. Sign in to super-agent.team, check the code matches, and click **Connect**. CrewBot then keeps running in the background.

### 2. Create a bot and chat

Open [super-agent.team/crew](https://super-agent.team/crew), click **+** next to **Bots**, pick this computer, an agent and a project folder, and send your first message.

When the agent wants to edit files or run a command that needs permission, the request shows up in your browser for you to allow or reject.

### Commands

| Command | What it does |
| --- | --- |
| `crewbot start` | Links this computer the first time, then runs CrewBot in the background |
| `crewbot start --foreground` | Runs in the foreground instead (for debugging, or under systemd and similar) |
| `crewbot stop` | Stops the background daemon and any running agents |
| `crewbot restart` | Restarts it (for example after upgrading) |
| `crewbot status` | Shows whether it's running and connected, and which agents it found |
| `crewbot logs [-f]` | Shows the daemon log; `-f` keeps following it |
| `crewbot logout` | Stops CrewBot and unlinks this computer |

## How it works

- **Pairing** uses the OAuth 2.0 device authorization flow (RFC 8628): the daemon requests a short code, you confirm it in the browser, and the daemon receives a device token stored in `~/.config/crewbot/credentials.json` (mode 600).
- **Connection**: the daemon opens one outgoing WebSocket to the server. It never listens on a port, so it works behind routers and firewalls. It sends a heartbeat every 30 seconds and reconnects with exponential backoff (up to 30 s).
- **No lost output**: every event the daemon produces is numbered per bot and kept until the server acknowledges it; after a reconnect, anything the server hasn't received is sent again.
- **Agents**: when you message a bot, the daemon starts that bot's agent in the bot's folder and resumes its session. Messages sent while a turn is running are injected into it (steering) when the agent supports it, otherwise queued. Agents idle for 15 minutes are shut down and resumed on the next message.
- **Adapter**: on first use the daemon runs `npm install @agentclientprotocol/claude-agent-acp` into `~/.config/crewbot/agents/` (skipping its bundled Claude binary) and points it at your own `claude`.

## Files

Everything lives in `~/.config/crewbot/` (or `$XDG_CONFIG_HOME/crewbot/`):

| Path | Contents |
| --- | --- |
| `credentials.json` | This computer's link to your account (readable only by you) |
| `daemon.pid`, `state.json` | The running daemon's pid and status, used by `crewbot status` |
| `logs/` | `daemon.log`, plus one log per bot's agent |
| `agents/` | Agent adapters, installed from npm on first use |

## Uninstall

```bash
crewbot logout          # stops CrewBot and unlinks this computer from your account
npm uninstall -g crewbot
rm -rf ~/.config/crewbot
```

## License

[MIT](LICENSE). Third-party packages are installed by npm with their own licenses.
