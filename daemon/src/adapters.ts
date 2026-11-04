// agent 的 ACP 适配器按需安装：第一次用到时装到 ~/.config/crewbot/agents/ 下。
// 不打包进 crewbot：claude-agent-acp 依赖的 Claude Agent SDK 不允许再分发，
// 由用户自己从 npm 安装；--omit=optional 跳过适配器自带的 agent 二进制
// （Claude 约 260MB，codex-acp 依赖的 @openai/codex 也是可选依赖），运行时用设备上的 claude / codex。
// Grok 原生支持 ACP，不需要适配器。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AGENTS_DIR } from './paths';

type Adapter = {
  name: string;
  version: string;
  dir: string;
  /** 装好后要改的地方（见 patchCodexNetwork） */
  patch?: (entry: string) => void;
};

/** 验证过的版本，升级前先用 spike/acp.ts 回归 */
export const CLAUDE_ACP: Adapter = {
  name: '@agentclientprotocol/claude-agent-acp',
  version: '0.99.1',
  dir: 'claude-acp',
};
export const CODEX_ACP: Adapter = {
  name: '@agentclientprotocol/codex-acp',
  version: '2.5.0',
  dir: 'codex-acp',
  patch: patchCodexNetwork,
};

/**
 * codex-acp 把每个模式的沙箱策略写死在代码里，每一轮都原样发给 Codex，所以 Codex 自己的
 * 配置（config.toml、CODEX_CONFIG）管不到。“自动审查”（agent）这一档写的是不联网：
 * 联网命令在沙箱里静默失败，不问也不报。这里把它改成联网，联网命令和别的一样交给
 * Codex 的审查器把关。只改 crewbot 自己装的这一份，不碰用户的 codex；“工作区内自动”
 * 和“只看不改”不动。整段只能出现一次，否则（适配器换了写法）不改，记一条日志
 */
function patchCodexNetwork(entry: string) {
  const before = `    "on-request",
    "auto_review",
    {
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,`;
  const after = before.replace('networkAccess: false', 'networkAccess: true');
  const code = readFileSync(entry, 'utf8');
  if (code.includes(after)) return; // 已经改过
  if (code.split(before).length !== 2) {
    console.error(
      `${CODEX_ACP.name}: auto review mode not found, leaving the network off`
    );
    return;
  }
  writeFileSync(entry, code.replace(before, after));
}

const installing = new Map<string, Promise<string>>();

function npmInstall(dir: string, spec: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npm',
      [
        'install',
        '--omit=optional',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        spec,
      ],
      {
        cwd: dir,
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: process.platform === 'win32',
        windowsHide: true,
      }
    );
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', (err) => reject(new Error(`npm not found: ${err.message}`)));
    proc.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`npm install ${spec} failed: ${stderr.trim()}`))
    );
  });
}

/** 返回适配器的入口文件，没装（或版本不对）就先装 */
export function ensureAdapter(adapter: Adapter): Promise<string> {
  let pending = installing.get(adapter.name);
  if (pending) return pending;
  pending = (async () => {
    const dir = join(AGENTS_DIR, adapter.dir);
    const pkgDir = join(dir, 'node_modules', ...adapter.name.split('/'));
    const entry = join(pkgDir, 'dist', 'index.js');
    const installed = existsSync(join(pkgDir, 'package.json'))
      ? JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
      : null;
    if (installed !== adapter.version || !existsSync(entry)) {
      console.log(
        `Installing ${adapter.name}@${adapter.version} (first use only)...`
      );
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(dir, 'package.json'))) {
        writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
      }
      await npmInstall(dir, `${adapter.name}@${adapter.version}`);
    }
    adapter.patch?.(entry);
    return entry;
  })().catch((err) => {
    installing.delete(adapter.name); // 下次再试
    throw err;
  });
  installing.set(adapter.name, pending);
  return pending;
}
