import { exec, execFile } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentInfo } from '@crewbot/protocol';

import { CLAUDE_ACP, CODEX_ACP, ensureAdapter } from './adapters';
import { shellEnv } from './shell-env';

const run = promisify(execFile);
const runInShell = promisify(exec);
const TIMEOUT_MS = 10_000;

/**
 * 执行 agent 的命令行。windowsHide：后台 daemon 没有控制台，不加的话 Windows 上每次
 * 都会弹出一个控制台窗口。.cmd / .bat（npm 在 Windows 上装的命令）Node 不能直接执行，
 * 交给 cmd.exe；参数都是写死的，不用转义
 */
const runAgent = (bin: string, args: string[], env: NodeJS.ProcessEnv) => {
  const options = { timeout: TIMEOUT_MS, env, windowsHide: true };
  return /\.(cmd|bat)$/i.test(bin)
    ? runInShell(`"${bin}" ${args.join(' ')}`, options)
    : run(bin, args, options);
};

/** 退出码不是 0 也照样拿 stdout */
const runAnyway = (bin: string, args: string[], env: NodeJS.ProcessEnv) =>
  runAgent(bin, args, env).catch((err: { stdout?: string }) => ({
    stdout: err.stdout ?? '',
  }));

/** 拉起 agent 进程（ACP over stdio）的命令 */
export type AgentLaunch = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * 支持的 agent。都用设备上用户自己装的 CLI，配置（模型、key、审批模式）由 agent 自己读，
 * daemon 不传
 */
type AgentDef = {
  name: string;
  bin: string;
  /** 从 `--version` 的输出里取版本号 */
  version: (stdout: string) => string | undefined;
  /** 登录了（或配好了 key）才能用 */
  loggedIn: (bin: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
  launch: (bin: string) => Promise<AgentLaunch>;
};

const AGENTS: Record<string, AgentDef> = {
  'claude-code': {
    name: 'Claude Code',
    bin: 'claude',
    version: (out) => out.split(' ')[0], // "2.1.306 (Claude Code)"
    // 没登录时退出码是 1，但 stdout 里照样是 JSON
    loggedIn: async (bin, env) =>
      JSON.parse(
        (await runAnyway(bin, ['auth', 'status', '--json'], env)).stdout
      ).loggedIn === true,
    launch: async (bin) => ({
      command: process.execPath,
      args: [await ensureAdapter(CLAUDE_ACP)],
      env: { CLAUDE_CODE_EXECUTABLE: bin },
    }),
  },
  codex: {
    name: 'Codex',
    bin: 'codex',
    version: (out) => out.split(' ').at(-1), // "codex-cli 0.166.0"
    // 没登录时退出码是 1
    loggedIn: (bin, env) =>
      runAgent(bin, ['login', 'status'], env).then(
        () => true,
        () => false
      ),
    launch: async (bin) => ({
      command: process.execPath,
      args: [await ensureAdapter(CODEX_ACP)],
      env: { CODEX_PATH: bin },
    }),
  },
  grok: {
    name: 'Grok',
    bin: 'grok',
    version: (out) => out.split(' ')[1], // "grok 1.0.70 (f50904eaee6c)"
    // 没有查登录状态的命令；没登录、模型也没配自己的 key 时，models 输出这句
    loggedIn: async (bin, env) =>
      !(await runAnyway(bin, ['models'], env)).stdout.includes(
        'You are not authenticated'
      ),
    // 原生 ACP；--no-leader：每个 bot 一个独立进程，不连共享的 leader
    launch: async (bin) => ({
      command: bin,
      args: ['agent', '--no-leader', 'stdio'],
    }),
  },
};

/** 在 PATH 里找可执行文件，返回绝对路径 */
function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD').split(';')
      : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const file = join(dir, name + ext);
      try {
        accessSync(file, constants.X_OK);
        return unwrapCmdShim(file);
      } catch {
        // 继续找
      }
    }
  }
  return null;
}

/**
 * npm 在 Windows 上装的命令是 .cmd 包装脚本。包装的是 .exe 时（比如 npm 装的
 * Claude Code）直接用那个 .exe：适配器拉起 agent 不经过 cmd.exe，执行不了 .cmd
 */
function unwrapCmdShim(file: string): string {
  if (!/\.cmd$/i.test(file)) return file;
  try {
    // 包装脚本里目标写成 "%dp0%\node_modules\...\claude.exe"
    const target = /"%dp0%\\(node_modules\\[^"]+\.exe)"/i.exec(
      readFileSync(file, 'utf8')
    )?.[1];
    if (target) {
      const exe = join(dirname(file), target);
      accessSync(exe, constants.X_OK);
      return exe;
    }
  } catch {
    // 读不了或目标不在：还用 .cmd
  }
  return file;
}

async function detect(
  id: string,
  def: AgentDef,
  env: NodeJS.ProcessEnv
): Promise<AgentInfo> {
  const info: AgentInfo = { id, name: def.name, status: 'unavailable' };
  const bin = findOnPath(def.bin, env);
  if (!bin) return info;
  try {
    const { stdout } = await runAgent(bin, ['--version'], env);
    info.version = def.version(stdout.trim());
    info.status = (await def.loggedIn(bin, env)) ? 'ready' : 'not_logged_in';
  } catch {
    // 执行失败、输出无法解析：都算 unavailable
  }
  return info;
}

export async function detectAgents(): Promise<AgentInfo[]> {
  const env = await shellEnv();
  return Promise.all(
    Object.entries(AGENTS).map(([id, def]) => detect(id, def, env))
  );
}

/** bot 用的 agent 怎么拉起（env 是完整的环境变量）；不支持或设备上没装就报错 */
export async function agentLaunch(agentId: string): Promise<AgentLaunch> {
  if (!Object.hasOwn(AGENTS, agentId)) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  const def = AGENTS[agentId];
  const env = await shellEnv();
  const bin = findOnPath(def.bin, env);
  if (!bin) throw new Error(`${def.name} is not installed on this device`);
  const launch = await def.launch(bin);
  return { ...launch, env: { ...env, ...launch.env } };
}
