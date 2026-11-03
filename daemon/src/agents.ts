import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentInfo } from '@crewbot/protocol';

import { CLAUDE_ACP, CODEX_ACP, ensureAdapter } from './adapters';
import { shellEnv } from './shell-env';

const run = promisify(execFile);
const TIMEOUT_MS = 10_000;

/** 退出码不是 0 也照样拿 stdout */
const runAnyway = (bin: string, args: string[], env: NodeJS.ProcessEnv) =>
  run(bin, args, { timeout: TIMEOUT_MS, env }).catch(
    (err: { stdout?: string }) => ({ stdout: err.stdout ?? '' })
  );

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
      run(bin, ['login', 'status'], { timeout: TIMEOUT_MS, env }).then(
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
        return file;
      } catch {
        // 继续找
      }
    }
  }
  return null;
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
    const { stdout } = await run(bin, ['--version'], {
      timeout: TIMEOUT_MS,
      env,
    });
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
