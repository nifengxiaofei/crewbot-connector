import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CLOSE_REVOKED,
  PING,
  PONG,
  PROTOCOL_VERSION,
  type DaemonEventPayload,
  type DaemonToServer,
  type ServerToDaemon,
} from '@crewbot/protocol';

import { BotAgent } from './agent';
import { deleteCredentials, type Credentials } from './credentials';
import { getDeviceInfo } from './device';
import { CONFIG_DIR, PID_PATH, STATE_PATH } from './paths';
import { checkToken } from './server';

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
/** 服务器收到同一台设备的新连接时，用这个关闭码关掉旧连接 */
const CLOSE_REPLACED = 4000;

const log = (msg: string) =>
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

/** 每个 bot 最多缓存这么多条还没确认的事件 */
const OUTBOX_LIMIT = 2000;

/** 当前连接；断线期间为 null */
let socket: WebSocket | null = null;
/** 每个 bot 的事件编号，服务器按它去重；重连时从服务器已收到的编号接着往后编 */
const dseq = new Map<string, number>();
/**
 * 每个 bot 发出后还没确认的事件（断线期间的输出也在这里）。
 * 重连收到 welcome 时，服务器已收到的丢掉，其余重发——断线前一刻在路上丢了的也能补回来
 */
const outbox = new Map<string, Extract<DaemonToServer, { type: 'bot_event' }>[]>();
const agents = new Map<string, BotAgent>();

/** 写给 crewbot status 看的运行状态 */
export type DaemonState = {
  pid: number;
  startedAt: number;
  server: string;
  connected: boolean;
  /** connected 变化的时间 */
  since: number;
  /** 正在运行的 agent 进程数 */
  agents: number;
};
let state: DaemonState;

function saveState(patch: Partial<DaemonState>) {
  state = {
    ...state,
    ...patch,
    agents: [...agents.values()].filter((a) => a.alive).length,
  };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function emit(botId: string, event: DaemonEventPayload) {
  const next = (dseq.get(botId) ?? 0) + 1;
  dseq.set(botId, next);
  const msg = { type: 'bot_event' as const, botId, dseq: next, event };
  const box = outbox.get(botId) ?? [];
  box.push(msg);
  if (box.length > OUTBOX_LIMIT) box.shift();
  outbox.set(botId, box);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function onMessage(msg: ServerToDaemon) {
  switch (msg.type) {
    case 'welcome': {
      // 服务器那边已经没有的 bot（离线期间被删了）：关掉进程
      const known = new Set(msg.bots.map((b) => b.botId));
      for (const [botId, agent] of agents) {
        if (!known.has(botId)) removeBot(botId, agent);
      }
      let resent = 0;
      for (const [botId, acked] of Object.entries(msg.ackedDseq)) {
        dseq.set(botId, Math.max(dseq.get(botId) ?? 0, acked));
        const pending = (outbox.get(botId) ?? []).filter((m) => m.dseq > acked);
        outbox.set(botId, pending);
        for (const m of pending) socket?.send(JSON.stringify(m));
        resent += pending.length;
      }
      saveState({ connected: true, since: Date.now() });
      log(resent > 0 ? `Online. Resent ${resent} event(s).` : 'Online.');
      return;
    }
    case 'permission_response':
      agents.get(msg.botId)?.resolvePermission(msg.requestId, msg.optionId);
      return;
    case 'cancel':
      agents.get(msg.botId)?.cancel();
      return;
    case 'bot_removed': {
      const agent = agents.get(msg.botId);
      if (agent) removeBot(msg.botId, agent);
      return;
    }
    case 'message': {
      const { botId } = msg.bot;
      let agent = agents.get(botId);
      if (!agent) {
        agent = new BotAgent(msg.bot, emit);
        agents.set(botId, agent);
      }
      void agent.handleMessage(msg.bot, msg.msgId, msg.text);
      return;
    }
  }
}

function removeBot(botId: string, agent: BotAgent) {
  agent.stop();
  agents.delete(botId);
  outbox.delete(botId);
  dseq.delete(botId);
}

/** 连一次，直到断开；返回关闭码和原因 */
function connectOnce(
  creds: Credentials,
  onOpen: () => void
): Promise<{ code: number; reason: string }> {
  const url = `${creds.server.replace(/^http/, 'ws')}/api/daemon/ws`;
  return new Promise((resolve) => {
    // Node 自带的 WebSocket（undici）支持自定义请求头
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    } as unknown as string[]);
    let pingTimer: NodeJS.Timeout | undefined;
    let pongTimer: NodeJS.Timeout | undefined;
    let done = false;

    const finish = (code: number, reason: string) => {
      if (done) return;
      done = true;
      clearInterval(pingTimer);
      clearTimeout(pongTimer);
      resolve({ code, reason });
    };
    const send = (msg: DaemonToServer) => ws.send(JSON.stringify(msg));

    ws.onopen = async () => {
      socket = ws;
      onOpen();
      send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        device: await getDeviceInfo(),
        runningBots: [...agents]
          .filter(([, agent]) => agent.running)
          .map(([botId]) => botId),
      });
      pingTimer = setInterval(() => {
        saveState({});
        ws.send(PING);
        pongTimer ??= setTimeout(() => {
          ws.close();
          // 网络已经断了，关闭握手可能永远完不成，不等它
          finish(1006, 'heartbeat timeout');
        }, PONG_TIMEOUT_MS);
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      if (event.data === PONG) {
        clearTimeout(pongTimer);
        pongTimer = undefined;
        return;
      }
      onMessage(JSON.parse(String(event.data)) as ServerToDaemon);
    };

    ws.onclose = (event) => {
      if (socket === ws) socket = null;
      if (state.connected) saveState({ connected: false, since: Date.now() });
      finish(event.code, event.reason);
    };
  });
}

function shutdown(reason: string): never {
  log(`${reason} Stopping agents and exiting.`);
  for (const agent of agents.values()) agent.stop();
  rmSync(PID_PATH, { force: true });
  rmSync(STATE_PATH, { force: true });
  process.exit(0);
}

/** 后台进程的主循环：一直保持和服务器的连接，断了就退避重连 */
export async function runDaemon(creds: Credentials): Promise<never> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));
  state = {
    pid: process.pid,
    startedAt: Date.now(),
    server: creds.server,
    connected: false,
    since: Date.now(),
    agents: 0,
  };
  saveState({});
  process.on('SIGTERM', () => shutdown('Received SIGTERM.'));
  process.on('SIGINT', () => shutdown('Received SIGINT.'));

  log(`Connecting to ${creds.server} ...`);
  let backoff = 1000;
  for (;;) {
    let opened = false;
    const { code, reason } = await connectOnce(creds, () => {
      opened = true;
      backoff = 1000;
    });
    if (code === CLOSE_REPLACED) {
      shutdown('Another crewbot started on this device.');
    }
    // 在网页上被移除：在线时服务器直接用 CLOSE_REVOKED 断开；离线期间被移除的，
    // 重连时握手被拒（401），这里确认一下凭据确实失效了
    if (
      code === CLOSE_REVOKED ||
      (!opened && (await checkToken(creds.server, creds.token)) === 'invalid')
    ) {
      await deleteCredentials();
      shutdown('This computer was removed from your account.');
    }
    log(
      `Disconnected${reason ? ` (${reason})` : ''}. Reconnecting in ${backoff / 1000}s ...`
    );
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}
