// 命令行：start / stop / restart / status / logs / logout。
// start 把 daemon 放到后台（分离的子进程跑 `crewbot __run`），其余命令通过
// pid 文件和 state.json 管理它。

import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  watchFile,
} from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { PROTOCOL_VERSION } from '@crewbot/protocol';

import {
  deleteCredentials,
  readCredentials,
  type Credentials,
} from './credentials';
import { runDaemon, type DaemonState } from './daemon';
import { getDeviceInfo } from './device';
import { login } from './login';
import {
  DAEMON_LOG,
  LOG_DIR,
  PID_PATH,
  STATE_PATH,
  WORKSPACES_DIR,
} from './paths';
import { checkToken, revokeToken } from './server';
import { listWorkspaces } from './workspaces';

const START_WAIT_MS = 15_000;
const STOP_WAIT_MS = 5_000;

const AGENT_STATUS = {
  ready: '✓ ready',
  not_logged_in: '✗ not logged in (open it in a terminal and log in first)',
  unavailable: '✗ not installed',
} as const;

// ---------- 后台进程 ----------

/** 后台 daemon 的 pid；没在运行返回 null（顺手清掉过期的 pid 文件） */
function runningPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  const pid = Number(readFileSync(PID_PATH, 'utf8'));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    rmSync(PID_PATH, { force: true });
    rmSync(STATE_PATH, { force: true });
    return null;
  }
}

function readState(): DaemonState | null {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** 有效的凭据：没有或已失效就走登录；连不上服务器时先用着，daemon 会自己重连 */
async function ensureCredentials(): Promise<Credentials | null> {
  const creds = await readCredentials();
  if (creds) {
    const check = await checkToken(creds.server, creds.token);
    if (check !== 'invalid') return creds;
    console.log('This device was disconnected from your account.');
    await deleteCredentials();
  }
  return login();
}

// ---------- 命令 ----------

export async function start(options: { foreground: boolean }) {
  const pid = runningPid();
  if (pid) {
    console.log(`CrewBot is already running (pid ${pid}).`);
    console.log('Check it with `crewbot status`.');
    return;
  }

  const creds = await ensureCredentials();
  if (!creds) {
    process.exitCode = 1;
    return;
  }

  if (options.foreground) {
    await runDaemon(creds);
    return;
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(DAEMON_LOG, 'a');
  const child = spawn(process.execPath, [process.argv[1]!, '__run'], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
    windowsHide: true, // Windows：不弹控制台窗口
  });
  child.unref();
  closeSync(out);

  // 等它真的连上，再告诉用户
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(300);
    const state = readState();
    if (state && state.pid === child.pid && state.connected) {
      console.log(
        `✓ CrewBot is running in the background (pid ${child.pid}).`
      );
      console.log(`  Open ${creds.server}/crew to talk to your bots.`);
      console.log('  Manage it with: crewbot status | stop | logs');
      return;
    }
    if (child.exitCode !== null || !runningPid()) break;
  }
  if (runningPid()) {
    console.log(
      `CrewBot started (pid ${child.pid}) but hasn't connected yet. It keeps retrying in the background.`
    );
    console.log('  See what is happening with `crewbot logs`.');
  } else {
    console.log('✗ CrewBot exited right after starting. Last log lines:');
    printTail(20);
    process.exitCode = 1;
  }
}

export async function stop(): Promise<boolean> {
  const pid = runningPid();
  if (!pid) {
    console.log('CrewBot is not running.');
    return false;
  }
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + STOP_WAIT_MS;
  while (Date.now() < deadline && runningPid()) await sleep(200);
  if (runningPid()) {
    process.kill(pid, 'SIGKILL');
    rmSync(PID_PATH, { force: true });
    rmSync(STATE_PATH, { force: true });
  }
  console.log(`✓ CrewBot stopped (pid ${pid}).`);
  return true;
}

export async function restart() {
  await stop();
  await start({ foreground: false });
}

export async function status() {
  const device = await getDeviceInfo();
  const creds = await readCredentials();
  const pid = runningPid();
  const state = pid ? readState() : null;
  const now = Date.now();

  console.log(
    `crewbot ${device.daemonVersion} (protocol v${PROTOCOL_VERSION})\n`
  );
  console.log('Daemon');
  if (pid && state) {
    console.log(`  status    running (pid ${pid}, up ${duration(now - state.startedAt)})`);
    console.log(
      `  server    ${state.server} — ${
        state.connected ? 'connected' : 'reconnecting'
      } for ${duration(now - state.since)}`
    );
    console.log(`  agents    ${state.agents} process(es) running`);
  } else {
    console.log('  status    stopped (start it with `crewbot start`)');
  }
  if (creds) {
    const check = await checkToken(creds.server, creds.token);
    const label = {
      ok: 'linked',
      invalid: 'disconnected from your account — run `crewbot start` to link again',
      unreachable: 'linked (server unreachable right now)',
    }[check];
    console.log(`  account   ${label}`);
  } else {
    console.log('  account   not linked — `crewbot start` will link this device');
  }

  console.log('\nDevice');
  console.log(`  hostname  ${device.hostname}`);
  console.log(`  os        ${device.os} (${device.arch})`);
  console.log('\nAgents');
  for (const agent of device.agents) {
    const version = agent.version ? ` ${agent.version}` : '';
    console.log(`  ${agent.name}${version}  ${AGENT_STATUS[agent.status]}`);
  }
}

function printTail(lines: number) {
  if (!existsSync(DAEMON_LOG)) return;
  const text = readFileSync(DAEMON_LOG, 'utf8').trimEnd().split('\n');
  console.log(text.slice(-lines).join('\n'));
}

export async function logs(options: { follow: boolean }) {
  if (!existsSync(DAEMON_LOG)) {
    console.log('No logs yet.');
    return;
  }
  printTail(50);
  if (!options.follow) return;

  let pos = statSync(DAEMON_LOG).size;
  watchFile(DAEMON_LOG, { interval: 500 }, (curr) => {
    if (curr.size < pos) pos = 0; // 文件被清空
    if (curr.size === pos) return;
    const fd = openSync(DAEMON_LOG, 'r');
    const buf = Buffer.alloc(curr.size - pos);
    readSync(fd, buf, 0, buf.length, pos);
    closeSync(fd);
    pos = curr.size;
    process.stdout.write(buf);
  });
  await new Promise(() => {}); // Ctrl+C 退出
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // 不是终端（输入被关掉）时读到空，按“不继续”处理
  const answer = await rl.question(question).catch(() => '');
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** 注销：服务器上这台设备和它的 bot 都会删掉，bot 的默认目录跟着删，所以先确认 */
export async function logout({ yes }: { yes: boolean }) {
  const workspaces = listWorkspaces();
  if (!yes) {
    console.log(
      'This unlinks this computer and deletes its bots from your account.'
    );
    if (workspaces.length > 0) {
      console.log(
        `${workspaces.length} bot folder(s) in ${WORKSPACES_DIR} will be deleted too.`
      );
    }
    if (!(await confirm('Continue? [y/N] '))) {
      console.log('Cancelled.');
      return;
    }
  }
  await stop();
  const creds = await readCredentials();
  if (creds && !(await revokeToken(creds.server, creds.token))) {
    console.log(
      `Could not reach ${creds.server}. Remove this computer on the Devices page to finish.`
    );
  }
  await deleteCredentials();
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
  console.log('✓ Logged out. This computer is no longer linked.');
}

/** 后台子进程的入口（`crewbot __run`） */
export async function runInBackground() {
  const creds = await readCredentials();
  if (!creds) {
    console.error('No credentials. Run `crewbot start`.');
    process.exit(1);
  }
  await runDaemon(creds);
}
