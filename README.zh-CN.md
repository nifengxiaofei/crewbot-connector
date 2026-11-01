# CrewBot Connector

[English](README.md) | 简体中文

[crewbot.me](https://crewbot.me) 本地守护进程 `crewbot` 的源码。

它把你电脑上的编程 agent（目前支持 [Claude Code](https://claude.com/claude-code)）连接到你的 CrewBot 工作区：每个项目配一个 bot，在任何浏览器里——笔记本、手机、任何地方——都能和它对话。agent 运行在**你自己的**电脑上、**你自己的**项目目录里，crewbot.me 只负责中转对话。

公开这个仓库，是为了让你清楚地看到在自己机器上运行的是什么代码，也可以选择自己编译。npm 上发布的 [`crewbot`](https://www.npmjs.com/package/crewbot) 包就是用这份代码构建的。

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
│   │   ├── adapters.ts   # 首次使用时安装 Claude Code 的 ACP 适配器
│   │   ├── agents.ts     # 检测本机已安装的 agent（claude）及登录状态
│   │   └── ...
│   └── spike/acp.ts      # 独立的 ACP 验证脚本（prompt / steering / 审批 / 恢复会话）
└── packages/protocol/    # daemon 与服务器共用的消息类型（构建时打包进产物）
```

agent 通过 [Agent Client Protocol（ACP）](https://agentclientprotocol.com) 驱动，使用 [`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp)。

## 环境要求

- Node.js 22 或更高版本
- pnpm 10（执行 `corepack enable` 会自动使用 `package.json` 里锁定的版本）
- 已安装并登录 [Claude Code](https://claude.com/claude-code)（先运行一次 `claude`）。CrewBot 使用你电脑上已有的 `claude`。

## 从源码编译

```bash
git clone <本仓库地址> crewbot-connector
cd crewbot-connector
corepack enable
pnpm install
pnpm build        # 产物为 daemon/dist/index.mjs
pnpm typecheck    # 可选，类型检查
```

直接运行编译产物：

```bash
node daemon/dist/index.mjs start
node daemon/dist/index.mjs status
```

或者把自己编译的版本安装成全局 `crewbot` 命令。这种方式是链接到仓库目录，之后重新 `pnpm build`，再执行 `crewbot restart` 就会生效：

```bash
npm install -g ./daemon
crewbot start
```

如果想安装一份独立的副本，先打包：

```bash
cd daemon && pnpm pack        # 生成 crewbot-<版本号>.tgz
npm install -g ./crewbot-*.tgz
```

### 开发模式

用 `tsx` 直接运行 TypeScript 源码，无需编译。请加 `--foreground`——后台模式会重新启动编译后的文件，从源码运行时不可用：

```bash
pnpm dev start --foreground
pnpm dev status
```

daemon 默认连接 `https://crewbot.me`，可以用 `CREWBOT_SERVER` 指定其他服务器：

```bash
CREWBOT_SERVER=http://localhost:3000 pnpm dev start --foreground
```

> 源码编译版、npm 包和开发模式共用同一个配置目录（`~/.config/crewbot/`），同一时间只能运行一个 daemon。切换前先执行 `crewbot stop`，或者把 `XDG_CONFIG_HOME` 设成别的目录把它们隔开。

## 使用方法

### 1. 关联这台电脑

```bash
crewbot start
```

第一次运行时会显示一个短码并打开浏览器。登录 crewbot.me，确认短码一致后点击 **Connect**。之后 CrewBot 会在后台持续运行。

### 2. 创建 bot 并对话

打开 [crewbot.me/crew](https://crewbot.me/crew)，点击 **Bots** 旁边的 **+**，选择这台电脑、agent 和项目目录，然后发出第一条消息。

agent 需要修改文件或执行需要授权的命令时，请求会出现在浏览器里，由你选择允许或拒绝。

### 命令

| 命令 | 作用 |
| --- | --- |
| `crewbot start` | 首次运行时关联这台电脑，然后在后台运行 CrewBot |
| `crewbot start --foreground` | 改为前台运行（用于调试，或在 systemd 等环境下运行） |
| `crewbot stop` | 停止后台 daemon 及所有正在运行的 agent |
| `crewbot restart` | 重启（例如升级之后） |
| `crewbot status` | 查看是否在运行、是否已连接，以及检测到哪些 agent |
| `crewbot logs [-f]` | 查看 daemon 日志；`-f` 持续跟踪 |
| `crewbot logout` | 停止 CrewBot 并解除这台电脑的关联 |

## 工作原理

- **配对**：使用 OAuth 2.0 设备授权流程（RFC 8628）。daemon 申请短码，你在浏览器中确认，daemon 拿到设备凭据并保存在 `~/.config/crewbot/credentials.json`（权限 600）。
- **连接**：daemon 只向服务器建立一条出站 WebSocket 连接，从不监听端口，因此在路由器、防火墙后面也能用。每 30 秒发一次心跳，断线后按指数退避重连（最长 30 秒）。
- **输出不丢**：daemon 产生的每个事件都按 bot 编号，并保留到服务器确认收到为止；重连后会补发服务器还没收到的事件。
- **agent**：给 bot 发消息时，daemon 在该 bot 的目录里启动 agent 并恢复它的会话。一轮还在执行时发来的消息，agent 支持的话会插入当前这一轮（steering），否则排队。空闲 15 分钟的 agent 会被关闭，下次来消息时再恢复。
- **适配器**：首次使用时，daemon 会执行 `npm install @agentclientprotocol/claude-agent-acp`，安装到 `~/.config/crewbot/agents/`（跳过它自带的 Claude 二进制），并让它使用你自己的 `claude`。

## 本地文件

所有文件都在 `~/.config/crewbot/`（或 `$XDG_CONFIG_HOME/crewbot/`）下：

| 路径 | 内容 |
| --- | --- |
| `credentials.json` | 这台电脑与你账号的关联凭据（仅你本人可读） |
| `daemon.pid`、`state.json` | 运行中 daemon 的 pid 和状态，供 `crewbot status` 读取 |
| `logs/` | `daemon.log`，以及每个 bot 的 agent 日志 |
| `agents/` | 首次使用时从 npm 安装的 agent 适配器 |

## 卸载

```bash
crewbot logout          # 停止 CrewBot 并解除这台电脑与账号的关联
npm uninstall -g crewbot
rm -rf ~/.config/crewbot
```

## 许可证

[MIT](LICENSE)。第三方依赖由 npm 安装，各自遵循其许可证。
