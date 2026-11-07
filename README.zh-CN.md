# Super Agent Connector

[English](README.md) | 简体中文

[super-agent.team](https://super-agent.team) 本地守护进程 `crewbot` 的源码。

它把你电脑上的编程 agent（支持 [Claude Code](https://claude.com/claude-code)、[Codex](https://github.com/openai/codex) 和 [Grok](https://docs.x.ai/build/overview)）连接到你的 Super Agent 工作区：每个项目配一个 bot，在任何浏览器里——笔记本、手机、任何地方——都能和它对话。agent 运行在**你自己的**电脑上、**你自己的**项目目录里，super-agent.team 只负责中转对话。

公开这个仓库，是为了让你清楚地看到在自己机器上运行的是什么代码，也可以选择自己编译。npm 上发布的 [`crewbot`](https://www.npmjs.com/package/crewbot) 包就是用这份代码构建的。

## 从 npm 安装

一般用这种方式安装 CrewBot。下面的步骤覆盖 macOS、Linux 和 Windows。命令都在终端里执行：macOS 上是「终端」App，Windows 上是 PowerShell（在开始菜单里搜索 "PowerShell"）。

### 1. 安装 Node.js 22 或更高版本

先看看电脑上有没有：

```bash
node --version
```

如果输出 `v22` 或更高的版本，直接跳到第 2 步（Windows 上仍要执行一次下面的 `Set-ExecutionPolicy` 命令）。

**macOS / Linux**：用 [nvm](https://github.com/nvm-sh/nvm) 安装 Node.js。nvm 装在你自己的用户目录下，之后执行 `npm install -g` 不需要 `sudo`：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
```

关掉终端，重新打开一个，然后执行：

```bash
nvm install --lts
node --version    # 应该输出 v22 或更高的版本
```

遇到问题时：

- 提示 `curl: command not found`（部分 Linux 系统）：先安装 curl，比如 Debian/Ubuntu 上执行 `sudo apt install curl`。
- macOS 上提示 `nvm: command not found`：执行 `touch ~/.zshrc`，再运行一次上面的 nvm 安装命令，然后重新打开终端。
- 下载 Node.js 很慢：先执行 `export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node`，再执行 `nvm install --lts`。
- 用 Homebrew（`brew install node`）或 [nodejs.org](https://nodejs.org) 安装包装的 Node.js 也可以，只要版本是 22 或更高。如果之后 `npm install -g` 报 `EACCES` 权限错误，不要用 `sudo`，改用上面的 nvm 安装 Node.js。

**Windows**：用 winget 安装 LTS 版本，或者从 [nodejs.org](https://nodejs.org) 下载 LTS 安装包：

```powershell
winget install OpenJS.NodeJS.LTS
```

关掉 PowerShell，重新打开一个，然后执行：

```powershell
node --version    # 应该输出 v22 或更高的版本
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Windows 默认不允许 PowerShell 运行脚本，`npm` 和 `crewbot` 会报"在此系统上禁止运行脚本"（running scripts is disabled on this system）。`Set-ExecutionPolicy` 只对你自己的账户放开这个限制，问你是否更改时输入 `Y`。这一步只需要做一次。

### 2. 安装 agent 并登录

CrewBot 不自带 agent，它驱动的是你电脑上已有的那一份，沿用它自己的设置（模型、key、权限模式）。至少装一个并登录，按它的官方说明操作：

| Agent | 命令 | 安装和登录说明 |
| --- | --- | --- |
| Claude Code | `claude` | [code.claude.com/docs/en/setup](https://code.claude.com/docs/en/setup) |
| Codex | `codex` | [github.com/openai/codex](https://github.com/openai/codex) |
| Grok | `grok` | [docs.x.ai/build/overview](https://docs.x.ai/build/overview) |

装好后**重新打开一个终端**，这样才能找到它的命令；第 3 步会检查 CrewBot 能不能找到它。如果你是在 shell 配置文件（比如 `~/.zshrc`）里给 agent 配的 API key，CrewBot 也能用上：在 macOS 和 Linux 上，它在检测和启动 agent 之前会先读取登录 shell 的环境变量。

**Windows**：Claude Code 的安装脚本把 `claude.exe` 装在 `%USERPROFILE%\.local\bin`，但不会把这个目录加进 PATH，所以 PowerShell 找不到 `claude`，`crewbot status` 也显示 `✗ not installed`。执行一次下面的命令把它加进去，然后重新打开 PowerShell：

```powershell
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.local\bin", 'User')
```

### 3. 安装 CrewBot

```bash
npm install -g crewbot
crewbot status
```

`crewbot status` 会列出检测到的 agent，至少要有一个显示 `✓ ready`：

```
Agents
  Claude Code 2.1.306  ✓ ready
  Codex 0.166.0  ✓ ready
  Grok  ✗ not installed
```

显示 `✗ not logged in` 表示 agent 已经装了但还没登录，回到第 2 步登录。Windows 上如果报"在此系统上禁止运行脚本"，说明第 1 步的 `Set-ExecutionPolicy` 还没执行。

只想先试试？`npx crewbot start` 不用安装就能运行，但之后每个命令都要加 `npx` 前缀（`npx crewbot status`、`npx crewbot stop` 等）。

### 4. 关联这台电脑

```bash
crewbot start
```

第一次运行时会显示一个短码并打开浏览器（没有自动打开的话，打开终端里显示的链接）。登录 super-agent.team，确认短码一致后点击 **Connect**。终端显示 `✓ CrewBot is running in the background` 就完成了。关掉终端后 CrewBot 也会在后台继续运行。

电脑重启后 CrewBot 不会自动启动，需要重新执行一次 `crewbot start`。这台电脑已经关联过了，第二次不用再确认短码。

### 5. 创建 bot 并对话

打开 [super-agent.team/crew](https://super-agent.team/crew)，点击 **Bots** 旁边的 **+**，选择这台电脑、agent 和项目目录，然后发出第一条消息。

agent 需要修改文件或执行需要授权的命令时，请求会出现在浏览器里，由你选择允许或拒绝。

CrewBot 启动之后才安装或登录 agent 的？在新终端里执行 `crewbot restart`，让它重新检测。

### 升级

```bash
npm install -g crewbot@latest
crewbot restart
```

一定要执行 `restart`：已经在运行的 daemon 要重启后才会用上新版本。如果你的 npm 用的是镜像（比如 npmmirror），而镜像还没同步到最新版，可以改从官方源安装：`npm install -g crewbot@latest --registry https://registry.npmjs.org/`。

## 从源码安装

用这个仓库的代码自己编译 CrewBot，用自己编译的版本代替 npm 包。

### 1. 准备环境

- **Node.js 22 或更高版本**和**一个 agent**：按[从 npm 安装](#从-npm-安装)的第 1、2 步准备。
- **Git**：用 `git --version` 检查。没有的话，macOS 上执行 `xcode-select --install`，Debian/Ubuntu 上执行 `sudo apt install git`，Windows 上执行 `winget install Git.Git`（装好后重新打开 PowerShell）。
- **pnpm**：
  - macOS / Linux：打开 Node.js 自带的 Corepack：

    ```bash
    corepack enable
    ```

    第一次在这个仓库里运行 `pnpm` 时，Corepack 会下载 `package.json` 里锁定的 pnpm 版本，问你要不要下载时输入 `Y`。如果提示 `corepack: command not found`，先执行 `npm install -g corepack`。

  - Windows：那里的 `corepack enable` 需要管理员权限的 PowerShell，所以改用 npm 安装 pnpm：

    ```powershell
    npm install -g pnpm@10
    ```

### 2. 获取代码并编译

```bash
git clone https://github.com/nifengxiaofei/crewbot-connector.git
cd crewbot-connector
pnpm install
pnpm build        # 产物为 daemon/dist/index.mjs
```

还可以执行 `pnpm typecheck` 做类型检查（可选）。

### 3. 把编译的版本安装成 `crewbot` 命令

如果之前从 npm 装的 CrewBot 正在运行，先执行 `crewbot stop` 停掉。然后在 `crewbot-connector` 目录里执行：

```bash
npm install -g ./daemon
crewbot status
```

这一步会替换掉从 npm 安装的 `crewbot`，并把命令链接到这个目录：以后 `git pull` 再 `pnpm build`，执行 `crewbot restart` 就会用上新编译的版本。

如果想安装一份独立的副本，先打包：

```bash
# macOS / Linux
cd daemon && pnpm pack        # 生成 crewbot-<版本号>.tgz
npm install -g ./crewbot-*.tgz
```

```powershell
# Windows：文件名用 pnpm pack 输出的那个
cd daemon
pnpm pack
npm install -g .\crewbot-0.2.3.tgz
```

### 4. 关联这台电脑并开始对话

和[从 npm 安装](#从-npm-安装)的第 4、5 步一样：执行 `crewbot start`，在浏览器里确认短码，然后在 [super-agent.team/crew](https://super-agent.team/crew) 创建 bot。已经关联过的电脑不用再关联。

以后想换回 npm 包，执行 `npm install -g crewbot`，再执行 `crewbot restart`。

### 开发模式

用 `tsx` 直接运行 TypeScript 源码，无需编译。请加 `--foreground`——后台模式会重新启动编译后的文件，从源码运行时不可用：

```bash
pnpm dev start --foreground
pnpm dev status
```

daemon 默认连接 `https://super-agent.team`，可以用 `CREWBOT_SERVER` 指定其他服务器：

```bash
# macOS / Linux
CREWBOT_SERVER=http://localhost:3000 pnpm dev start --foreground
```

```powershell
# Windows
$env:CREWBOT_SERVER = "http://localhost:3000"; pnpm dev start --foreground
```

> 源码编译版、npm 包和开发模式共用同一个配置目录（`~/.config/crewbot/`），同一时间只能运行一个 daemon。切换前先执行 `crewbot stop`，或者把 `XDG_CONFIG_HOME` 设成别的目录把它们隔开。

## 命令

| 命令 | 作用 |
| --- | --- |
| `crewbot start` | 首次运行时关联这台电脑，然后在后台运行 CrewBot |
| `crewbot start --foreground` | 改为前台运行（用于调试，或在 systemd 等环境下运行） |
| `crewbot stop` | 停止后台 daemon 及所有正在运行的 agent |
| `crewbot restart` | 重启（例如升级之后） |
| `crewbot status` | 查看是否在运行、是否已连接，以及检测到哪些 agent |
| `crewbot logs [-f]` | 查看 daemon 日志；`-f` 持续跟踪 |
| `crewbot logout` | 停止 CrewBot、解除这台电脑的关联并删除它上面的 bot（会先确认；`--yes` 跳过确认） |

## 目录结构

```
.
├── daemon/               # `crewbot` 命令行和后台守护进程（以 `crewbot` 发布到 npm）
│   ├── src/
│   │   ├── index.ts      # 命令行入口：start / stop / restart / status / logs / logout
│   │   ├── commands.ts   # 各命令的实现、后台进程管理
│   │   ├── login.ts      # 设备配对（OAuth 2.0 设备授权流程）
│   │   ├── daemon.ts     # 与服务器的 WebSocket 连接、断线重连、事件补传
│   │   ├── agent.ts      # 每个 bot 对应一个 agent 进程和一个 ACP 会话
│   │   ├── adapters.ts   # 首次使用时安装 Claude Code / Codex 的 ACP 适配器
│   │   ├── agents.ts     # 检测本机已安装的 agent（claude、codex、grok）及登录状态
│   │   ├── shell-env.ts  # 检测或启动 agent 前，读取登录 shell 的环境变量
│   │   ├── workspaces.ts # 新建 bot 时没指定目录用的默认工作目录
│   │   └── ...
│   └── spike/acp.ts      # 独立的 ACP 验证脚本（prompt / steering / 审批 / 恢复会话）
└── packages/protocol/    # daemon 与服务器共用的消息类型（构建时打包进产物）
```

agent 通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com) 驱动，Claude Code 使用 [`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp)，Codex 使用 [`@agentclientprotocol/codex-acp`](https://www.npmjs.com/package/@agentclientprotocol/codex-acp)，Grok 原生支持 ACP。

## 工作原理

- **配对**：使用 OAuth 2.0 设备授权流程（RFC 8628）。daemon 申请短码，你在浏览器中确认，daemon 拿到设备凭据并保存在 `~/.config/crewbot/credentials.json`（权限 600）。
- **连接**：daemon 只向服务器建立一条出站 WebSocket 连接，从不监听端口，因此在路由器、防火墙后面也能用。每 15 秒发一次心跳，断线后按指数退避重连（最长 30 秒）。
- **输出不丢**：daemon 产生的每个事件都按 bot 编号，并保留到服务器确认收到为止；重连后会补发服务器还没收到的事件。
- **agent**：给 bot 发消息时，daemon 在该 bot 的目录里启动 agent 并恢复它的会话。一轮还在执行时发来的消息，agent 支持的话会插入当前这一轮（steering），否则排队。空闲 15 分钟的 agent 会被关闭，下次来消息时再恢复。
- **适配器**：首次使用时，daemon 会用 `npm install` 把 agent 的适配器（`@agentclientprotocol/claude-agent-acp` 或 `@agentclientprotocol/codex-acp`）安装到 `~/.config/crewbot/agents/`（跳过它自带的 agent 二进制），并让它使用你自己的 `claude` / `codex`。Grok 不需要适配器。

## 本地文件

所有文件都在 `~/.config/crewbot/`（或 `$XDG_CONFIG_HOME/crewbot/`）下，Windows 上是 `%USERPROFILE%\.config\crewbot\`：

| 路径 | 内容 |
| --- | --- |
| `credentials.json` | 这台电脑与你账号的关联凭据（仅你本人可读） |
| `daemon.pid`、`state.json` | 运行中 daemon 的 pid 和状态，供 `crewbot status` 读取 |
| `logs/` | `daemon.log`，以及每个 bot 的 agent 日志 |
| `agents/` | 首次使用时从 npm 安装的 agent 适配器 |
| `workspaces/` | 新建 bot 时没指定工作目录用的默认目录，每个 bot 一个。随 bot 一起删除；你自己选的目录从不改动 |

## 卸载

```bash
# macOS / Linux
crewbot logout          # 停止 CrewBot、解除这台电脑与账号的关联并删除它上面的 bot
npm uninstall -g crewbot
rm -rf ~/.config/crewbot
```

```powershell
# Windows
crewbot logout
npm uninstall -g crewbot
Remove-Item -Recurse -Force "$env:USERPROFILE\.config\crewbot"
```

从源码安装的版本也是同样的卸载方法。

## 许可证

[MIT](LICENSE)。第三方依赖由 npm 安装，各自遵循其许可证。
