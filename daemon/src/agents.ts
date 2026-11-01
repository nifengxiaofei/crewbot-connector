import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentInfo } from '@crewbot/protocol';

const run = promisify(execFile);
const TIMEOUT_MS = 10_000;

/** 在 PATH 里找可执行文件，返回绝对路径 */
function findOnPath(name: string): string | null {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';')
      : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
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

/** 设备上用户自己装的 claude；没有就是 null */
export function findClaude(): string | null {
  return findOnPath('claude');
}

async function detectClaudeCode(): Promise<AgentInfo> {
  const info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    status: 'unavailable',
  };
  const bin = findClaude();
  if (!bin) return info;
  try {
    const { stdout: version } = await run(bin, ['--version'], {
      timeout: TIMEOUT_MS,
    });
    info.version = version.trim().split(' ')[0];
    // 没登录时退出码是 1，但 stdout 里照样是 JSON
    const auth = await run(bin, ['auth', 'status', '--json'], {
      timeout: TIMEOUT_MS,
    }).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? '' }));
    info.status = JSON.parse(auth.stdout).loggedIn ? 'ready' : 'not_logged_in';
  } catch {
    // 执行失败、输出无法解析：都算 unavailable
  }
  return info;
}

export async function detectAgents(): Promise<AgentInfo[]> {
  return Promise.all([detectClaudeCode()]);
}
