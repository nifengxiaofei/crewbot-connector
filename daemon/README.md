# crewbot

The local daemon for [super-agent.team](https://super-agent.team). It connects the coding agents on your computer to your Super Agent workspace, so you can give each project its own bot and talk to it from any browser — your laptop, your phone, anywhere.

The agents run on **your** computer, in **your** project folders. super-agent.team only relays the conversation.

## Quick start

```bash
npx crewbot start
```

The first time, it shows a short code and opens your browser. Sign in to super-agent.team, check the code matches, and click **Connect**. CrewBot then keeps running in the background.

Open [super-agent.team/crew](https://super-agent.team/crew), click **+** next to **Bots**, pick this computer, an agent and a project folder, and send your first message.

## Install

**Try it without installing:**

```bash
npx crewbot start
```

`npx` downloads the `crewbot` package into its cache the first time and reuses it afterwards, but it checks npm for a newer version on every run and needs the `npx` prefix for every command (`npx crewbot status`, `npx crewbot stop`, …).

**For everyday use, install it globally** — CrewBot is a background service, so you'll want the `crewbot` command at hand and control over when it updates:

```bash
npm install -g crewbot
crewbot start
```

## Upgrade

```bash
npm install -g crewbot@latest
crewbot restart
```

`restart` matters: the daemon that is already running keeps using the old version until it's restarted.

If your npm uses a mirror (for example npmmirror) that hasn't picked up the latest release yet, install from the official registry:

```bash
npm install -g crewbot@latest --registry https://registry.npmjs.org/
```

## Requirements

- Node.js 22 or newer
- [Claude Code](https://claude.com/claude-code) installed and signed in (run `claude` once). CrewBot uses the `claude` already on your computer.

## Commands

| Command | What it does |
| --- | --- |
| `crewbot start` | Links this computer the first time, then runs CrewBot in the background |
| `crewbot stop` | Stops the background daemon and any running agents |
| `crewbot restart` | Restarts it (for example after upgrading CrewBot) |
| `crewbot status` | Shows whether it's running and connected, and which agents it found |
| `crewbot logs [-f]` | Shows the daemon log; `-f` keeps following it |
| `crewbot logout` | Stops CrewBot and unlinks this computer |

`crewbot start --foreground` runs it in the foreground instead — handy for debugging, or for running it under systemd or similar.

## How it works

- CrewBot opens one outgoing connection to super-agent.team. It never listens on a port, so it works behind routers and firewalls.
- When you message a bot, CrewBot starts that bot's agent in the bot's folder and resumes its session. Agents that sit idle for 15 minutes are shut down and resumed on the next message.
- When an agent wants to edit files or run a command that needs permission, the request shows up in your browser for you to allow or reject.

## Files

Everything lives in `~/.config/crewbot/` (or `$XDG_CONFIG_HOME/crewbot/`):

| Path | Contents |
| --- | --- |
| `credentials.json` | This computer's link to your account (readable only by you) |
| `logs/` | `daemon.log`, plus one log per bot's agent |
| `agents/` | Agent adapters, installed from npm on first use |

On first use CrewBot installs the Claude Code adapter ([`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp)) into `agents/` with `npm install`. This takes a few seconds once.

## Uninstall

```bash
crewbot logout          # stops CrewBot and unlinks this computer from your account
npm uninstall -g crewbot
rm -rf ~/.config/crewbot
```

## License

MIT. Third-party packages CrewBot depends on are installed by npm with their own licenses.
