# Super Agent Connector

English | [简体中文](README.zh-CN.md)

The source code of `crewbot`, the local daemon for [super-agent.team](https://super-agent.team).

It connects the coding agents on your computer ([Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex) and [Grok](https://docs.x.ai/build/overview)) to your Super Agent workspace, so you can give each project its own bot and talk to it from any browser — your laptop, your phone, anywhere. The agents run on **your** computer, in **your** project folders; super-agent.team only relays the conversation.

This repository is published so you can read exactly what runs on your machine, and build it yourself if you prefer. The published npm package [`crewbot`](https://www.npmjs.com/package/crewbot) is built from this code.

## Install from npm

This is the usual way to install CrewBot. The steps cover macOS, Linux and Windows. Run the commands in a terminal: the Terminal app on macOS, PowerShell on Windows (search for "PowerShell" in the Start menu).

### 1. Install Node.js 22 or newer

Check whether you already have it:

```bash
node --version
```

If it prints `v22` or higher, go to step 2 (on Windows, still run the `Set-ExecutionPolicy` command below once).

**macOS / Linux**: install Node.js with [nvm](https://github.com/nvm-sh/nvm). It installs into your home folder, so `npm install -g` works later without `sudo`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

Close the terminal, open a new one, then:

```bash
nvm install --lts
node --version    # should print v22 or newer
```

If something goes wrong:

- `curl: command not found` (some Linux systems): install curl first, for example `sudo apt install curl` on Debian/Ubuntu.
- `nvm: command not found` on macOS: run `touch ~/.zshrc`, run the nvm install command again, and open a new terminal.
- Downloading Node.js is slow: run `export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node` before `nvm install --lts`.
- Node.js from Homebrew (`brew install node`) or the [nodejs.org](https://nodejs.org) installer works too, as long as it's 22 or newer. If `npm install -g` then fails with `EACCES`, don't use `sudo`; install Node.js with nvm instead.

**Windows**: install the LTS version with winget, or download the LTS installer from [nodejs.org](https://nodejs.org):

```powershell
winget install OpenJS.NodeJS.LTS
```

Close PowerShell, open a new one, then:

```powershell
node --version    # should print v22 or newer
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Windows doesn't let PowerShell run scripts by default, which stops `npm` and `crewbot` with "running scripts is disabled on this system". `Set-ExecutionPolicy` allows them for your user only; answer `Y` if it asks. You only need to do this once.

### 2. Install an agent and sign in

CrewBot doesn't come with an agent of its own: it drives the one already on your computer, with that agent's own settings (model, key, permission mode). Install at least one and sign in, following its official guide:

| Agent | Command | Install and sign in |
| --- | --- | --- |
| Claude Code | `claude` | [code.claude.com/docs/en/setup](https://code.claude.com/docs/en/setup) |
| Codex | `codex` | [github.com/openai/codex](https://github.com/openai/codex) |
| Grok | `grok` | [docs.x.ai/build/overview](https://docs.x.ai/build/overview) |

Then **open a new terminal** so the command is found; step 3 checks that CrewBot sees it. If you set an agent up with an API key in your shell profile (such as `~/.zshrc`), CrewBot picks it up too: on macOS and Linux it reads your login shell's environment before checking or starting an agent.

**Windows**: Claude Code's installer puts `claude.exe` in `%USERPROFILE%\.local\bin` but doesn't add that folder to PATH, so PowerShell can't find `claude` and `crewbot status` shows `✗ not installed`. Add it once, then open a new PowerShell:

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin", 'User')
```

### 3. Install CrewBot

```bash
npm install -g crewbot
crewbot status
```

`crewbot status` lists the agents it found. At least one should show `✓ ready`:

```
Agents
  Claude Code 2.1.306  ✓ ready
  Codex 0.166.0  ✓ ready
  Grok  ✗ not installed
```

`✗ not logged in` means the agent is installed but not signed in yet: go back to step 2. On Windows, "running scripts is disabled on this system" means the `Set-ExecutionPolicy` command from step 1 hasn't been run yet.

Just want to try it? `npx crewbot start` runs CrewBot without installing it, but then every command needs the `npx` prefix (`npx crewbot status`, `npx crewbot stop`, …).

### 4. Link this computer

```bash
crewbot start
```

The first time, it shows a short code and opens your browser (if it doesn't, open the link printed in the terminal). Sign in to super-agent.team, check the code matches, and click **Connect**. Once the terminal shows `✓ CrewBot is running in the background`, you're done. CrewBot keeps running after you close the terminal.

CrewBot doesn't start by itself when your computer restarts: run `crewbot start` again after a reboot. The computer stays linked, so there's no code to confirm the second time.

### 5. Create a bot and chat

Open [super-agent.team/crew](https://super-agent.team/crew), click **+** next to **Bots**, pick this computer, an agent and a project folder, and send your first message.

When the agent wants to edit files or run a command that needs permission, the request shows up in your browser for you to allow or reject.

Installed or signed in to an agent after CrewBot started? Run `crewbot restart` in a new terminal so it picks it up.

### Upgrade

```bash
npm install -g crewbot@latest
crewbot restart
```

`restart` matters: the daemon that is already running keeps using the old version until it's restarted. If your npm uses a mirror (such as npmmirror) that hasn't picked up the latest release yet, install from the official registry with `npm install -g crewbot@latest --registry https://registry.npmjs.org/`.

## Install from source

Build CrewBot from this repository and use your build instead of the npm package.

### 1. Prepare the environment

- **Node.js 22 or newer** and **an agent**: follow steps 1 and 2 of [Install from npm](#install-from-npm).
- **Git**: check with `git --version`. If it's missing, run `xcode-select --install` on macOS, `sudo apt install git` on Debian/Ubuntu, or `winget install Git.Git` on Windows (then open a new PowerShell).
- **pnpm**:
  - macOS / Linux: turn on Corepack, which comes with Node.js:

    ```bash
    corepack enable
    ```

    The first time you run `pnpm` in this repository, Corepack downloads the pnpm version pinned in `package.json`; answer `Y` if it asks. If it says `corepack: command not found`, run `npm install -g corepack` first.

  - Windows: `corepack enable` needs an administrator PowerShell there, so install pnpm with npm instead:

    ```powershell
    npm install -g pnpm@10
    ```

### 2. Get the code and build it

```bash
git clone https://github.com/nifengxiaofei/crewbot-connector.git
cd crewbot-connector
pnpm install
pnpm build        # outputs daemon/dist/index.mjs
```

`pnpm typecheck` checks the types as well (optional).

### 3. Install your build as the `crewbot` command

If CrewBot from npm is running, stop it first with `crewbot stop`. Then, in the `crewbot-connector` folder:

```bash
npm install -g ./daemon
crewbot status
```

This replaces a `crewbot` installed from npm and links the command to this folder: after a `git pull` and `pnpm build`, `crewbot restart` runs the new build.

To install a standalone copy instead, pack it first:

```bash
# macOS / Linux
cd daemon && pnpm pack        # creates crewbot-<version>.tgz
npm install -g ./crewbot-*.tgz
```

```powershell
# Windows: use the file name pnpm pack printed
cd daemon
pnpm pack
npm install -g .\crewbot-0.2.3.tgz
```

### 4. Link this computer and chat

Same as steps 4 and 5 of [Install from npm](#install-from-npm): run `crewbot start`, confirm the code in the browser, then create a bot at [super-agent.team/crew](https://super-agent.team/crew). A computer that was already linked stays linked.

To go back to the npm package later, run `npm install -g crewbot`, then `crewbot restart`.

### Development mode

Run the TypeScript source with `tsx`, without building. Use `--foreground` — the background mode re-launches the built file and doesn't work from source:

```bash
pnpm dev start --foreground
pnpm dev status
```

The daemon talks to `https://super-agent.team` by default. Set `CREWBOT_SERVER` to point it elsewhere:

```bash
# macOS / Linux
CREWBOT_SERVER=http://localhost:3000 pnpm dev start --foreground
```

```powershell
# Windows
$env:CREWBOT_SERVER = "http://localhost:3000"; pnpm dev start --foreground
```

> Builds from source, the npm package and dev mode all share the same config directory (`~/.config/crewbot/`) and only one daemon can run at a time. Run `crewbot stop` before switching between them, or set `XDG_CONFIG_HOME` to a different directory to keep them apart.

## Commands

| Command | What it does |
| --- | --- |
| `crewbot start` | Links this computer the first time, then runs CrewBot in the background |
| `crewbot start --foreground` | Runs in the foreground instead (for debugging, or under systemd and similar) |
| `crewbot stop` | Stops the background daemon and any running agents |
| `crewbot restart` | Restarts it (for example after upgrading) |
| `crewbot status` | Shows whether it's running and connected, and which agents it found |
| `crewbot logs [-f]` | Shows the daemon log; `-f` keeps following it |
| `crewbot logout` | Stops CrewBot, unlinks this computer and deletes its bots (asks first; `--yes` skips) |

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
│   │   ├── adapters.ts   # installs the Claude Code / Codex ACP adapters on first use
│   │   ├── agents.ts     # detects installed agents (claude, codex, grok) and their login status
│   │   ├── shell-env.ts  # reads your login shell's environment before checking or starting an agent
│   │   ├── workspaces.ts # default folders for bots created without one
│   │   └── ...
│   └── spike/acp.ts      # standalone ACP test script (prompt / steering / permissions / resume)
└── packages/protocol/    # message types shared by the daemon and the server (bundled into the build)
```

Agents are driven through the [Agent Client Protocol (ACP)](https://agentclientprotocol.com) using [`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) for Claude Code and [`@agentclientprotocol/codex-acp`](https://www.npmjs.com/package/@agentclientprotocol/codex-acp) for Codex. Grok speaks ACP natively.

## How it works

- **Pairing** uses the OAuth 2.0 device authorization flow (RFC 8628): the daemon requests a short code, you confirm it in the browser, and the daemon receives a device token stored in `~/.config/crewbot/credentials.json` (mode 600).
- **Connection**: the daemon opens one outgoing WebSocket to the server. It never listens on a port, so it works behind routers and firewalls. It sends a heartbeat every 15 seconds and reconnects with exponential backoff (up to 30 s).
- **No lost output**: every event the daemon produces is numbered per bot and kept until the server acknowledges it; after a reconnect, anything the server hasn't received is sent again.
- **Agents**: when you message a bot, the daemon starts that bot's agent in the bot's folder and resumes its session. Messages sent while a turn is running are injected into it (steering) when the agent supports it, otherwise queued. Agents idle for 15 minutes are shut down and resumed on the next message.
- **Adapters**: on first use the daemon runs `npm install` for the agent's adapter (`@agentclientprotocol/claude-agent-acp` or `@agentclientprotocol/codex-acp`) into `~/.config/crewbot/agents/`, skipping the agent binary it bundles, and points it at your own `claude` / `codex`. Grok needs no adapter.

## Files

Everything lives in `~/.config/crewbot/` (or `$XDG_CONFIG_HOME/crewbot/`); on Windows that's `%USERPROFILE%\.config\crewbot\`:

| Path | Contents |
| --- | --- |
| `credentials.json` | This computer's link to your account (readable only by you) |
| `daemon.pid`, `state.json` | The running daemon's pid and status, used by `crewbot status` |
| `logs/` | `daemon.log`, plus one log per bot's agent |
| `agents/` | Agent adapters, installed from npm on first use |
| `workspaces/` | Default folders for bots created without a working directory, one per bot. Deleted with the bot; folders you chose yourself are never touched |

## Uninstall

```bash
# macOS / Linux
crewbot logout          # stops CrewBot, unlinks this computer from your account and deletes its bots
npm uninstall -g crewbot
rm -rf ~/.config/crewbot
```

```powershell
# Windows
crewbot logout
npm uninstall -g crewbot
Remove-Item -Recurse -Force "$env:USERPROFILE\.config\crewbot"
```

This works the same for a build installed from source.

## License

[MIT](LICENSE). Third-party packages are installed by npm with their own licenses.
