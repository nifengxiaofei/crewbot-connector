// daemon 的环境变量来自启动它的进程。从 IDE、脚本等地方启动时不会读用户 shell 的配置，
// 写在 ~/.zshrc 里的 ANTHROPIC_AUTH_TOKEN 之类就拿不到，agent 会以为没登录。
// 所以查 agent 状态、拉起 agent 前，用用户的登录 shell 读一遍环境变量（VS Code 也这么做）。
// 每次都重读：用户改了配置不用重启 daemon
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MARK = '__CREWBOT_ENV__';
/** 这些是 shell 自己的状态，不是用户配置的 */
const SKIP = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);

export async function shellEnv(): Promise<NodeJS.ProcessEnv> {
  const shell = process.env.SHELL;
  if (process.platform === 'win32' || !shell) return process.env;
  try {
    // 前后加标记：rc 文件自己打印的内容不算
    const { stdout } = await run(
      shell,
      ['-ilc', `printf ${MARK}; command env -0; printf ${MARK}`],
      { timeout: 10_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const body = stdout.split(MARK)[1];
    if (!body) return process.env;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const line of body.split('\0')) {
      const i = line.indexOf('=');
      if (i <= 0 || SKIP.has(line.slice(0, i))) continue;
      env[line.slice(0, i)] = line.slice(i + 1);
    }
    return env;
  } catch {
    // shell 配置有问题（超时、报错）：退回 daemon 自己的环境
    return process.env;
  }
}
