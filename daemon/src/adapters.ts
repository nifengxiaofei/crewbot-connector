// agent 的 ACP 适配器按需安装：第一次用到时装到 ~/.config/crewbot/agents/ 下。
// 不打包进 crewbot：claude-agent-acp 依赖的 Claude Agent SDK 不允许再分发，
// 由用户自己从 npm 安装；--omit=optional 跳过 SDK 自带的 Claude 二进制（约 260MB），
// 运行时用设备上的 claude。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AGENTS_DIR } from './paths';

/** 验证过的版本，升级前先用 spike/acp.ts 回归 */
const CLAUDE_ACP = {
  name: '@agentclientprotocol/claude-agent-acp',
  version: '0.99.1',
};


let installing: Promise<string> | undefined;

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
      { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32' }
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

/** 返回 claude-agent-acp 的入口文件，没装（或版本不对）就先装 */
export function ensureClaudeAcp(): Promise<string> {
  installing ??= (async () => {
    const dir = join(AGENTS_DIR, 'claude-acp');
    const pkgDir = join(dir, 'node_modules', ...CLAUDE_ACP.name.split('/'));
    const entry = join(pkgDir, 'dist', 'index.js');
    const installed = existsSync(join(pkgDir, 'package.json'))
      ? JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
      : null;
    if (installed !== CLAUDE_ACP.version || !existsSync(entry)) {
      console.log(
        `Installing ${CLAUDE_ACP.name}@${CLAUDE_ACP.version} (first use only)...`
      );
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(dir, 'package.json'))) {
        writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
      }
      await npmInstall(dir, `${CLAUDE_ACP.name}@${CLAUDE_ACP.version}`);
    }
    return entry;
  })().catch((err) => {
    installing = undefined; // 下次再试
    throw err;
  });
  return installing;
}
