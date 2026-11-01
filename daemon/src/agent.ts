import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  client,
  ndJsonStream,
  type ClientConnection,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import type {
  DaemonBot,
  DaemonEventPayload,
  SessionUpdate,
} from '@crewbot/protocol';

import { ensureClaudeAcp } from './adapters';
import { findClaude } from './agents';
import { LOG_DIR } from './paths';

export type Emit = (botId: string, event: DaemonEventPayload) => void;

/** bot 空闲这么久就关掉 agent 进程，下次来消息再拉起并恢复会话 */
const IDLE_EXIT_MS = 15 * 60_000;

const CANCELLED: RequestPermissionResponse = {
  outcome: { outcome: 'cancelled' },
};

/** 转发给服务器的输出类型，其余（命令列表、用量等）界面用不上，不转发 */
const FORWARDED_UPDATES = new Set<SessionUpdate['sessionUpdate']>([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
]);

/** 一个 bot 对应一个 agent 进程和一个 ACP 会话 */
export class BotAgent {
  private proc?: ChildProcess;
  private conn?: ClientConnection;
  private sessionId?: string;
  private ready?: Promise<void>;
  private steeringSupported = false;
  private turnRunning = false;
  private queue: { msgId: string; text: string }[] = [];
  /** 等用户审批的请求：requestId → 回复 agent */
  private permissions = new Map<
    string,
    (res: RequestPermissionResponse) => void
  >();
  private idleTimer?: NodeJS.Timeout;

  constructor(
    private bot: DaemonBot,
    private emit: Emit
  ) {}

  /** 用户发来一条消息：没有在跑就开新一轮；在跑就插入当前轮（不支持插入就排队） */
  get running(): boolean {
    return this.turnRunning;
  }

  /** agent 进程还在 */
  get alive(): boolean {
    return this.proc !== undefined;
  }

  async handleMessage(bot: DaemonBot, msgId: string, text: string) {
    this.bot = bot;
    clearTimeout(this.idleTimer);
    try {
      await this.ensureSession();
    } catch (err) {
      this.emit(bot.botId, {
        type: 'error',
        msgId,
        message: (err as Error).message,
      });
      return;
    }

    if (this.turnRunning) {
      if (!this.steeringSupported) {
        this.queue.push({ msgId, text });
        return;
      }
      const res = (await this.conn!.agent
        .request('_session/steering', {
          sessionId: this.sessionId,
          prompt: [{ type: 'text', text }],
          _meta: { steering: { idleBehavior: 'promptRequired' } },
        })
        .catch(() => null)) as {
        outcome: 'injected' | 'promptRequired';
      } | null;
      if (!res) {
        // 插入失败，退回排队
        this.queue.push({ msgId, text });
        return;
      }
      if (res.outcome === 'injected') {
        this.emit(bot.botId, {
          type: 'message_accepted',
          msgId,
          mode: 'injected',
        });
        return;
      }
      // promptRequired：这一轮刚好结束，开新一轮
    }
    void this.runTurn(msgId, text);
  }

  private async runTurn(msgId: string, text: string) {
    this.turnRunning = true;
    this.emit(this.bot.botId, { type: 'message_accepted', msgId, mode: 'prompt' });
    try {
      const res = await this.conn!.agent.request('session/prompt', {
        sessionId: this.sessionId!,
        prompt: [{ type: 'text', text }],
      });
      this.endTurn({ type: 'turn_end', stopReason: res.stopReason });
    } catch (err) {
      this.endTurn({ type: 'error', message: (err as Error).message });
    }
  }

  /** 结束当前这一轮（只报一次），然后跑排队的消息；没有就开始计空闲时间 */
  private endTurn(event: DaemonEventPayload) {
    if (!this.turnRunning) return;
    this.turnRunning = false;
    this.cancelPermissions();
    this.emit(this.bot.botId, event);
    const next = this.queue.shift();
    if (next) {
      void this.runTurn(next.msgId, next.text);
    } else {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.stop(), IDLE_EXIT_MS);
    }
  }

  /** 用户在网页上选了审批选项 */
  resolvePermission(requestId: string, optionId: string) {
    const resolve = this.permissions.get(requestId);
    this.permissions.delete(requestId);
    resolve?.({ outcome: { outcome: 'selected', optionId } });
  }

  /** 用户点了停止：取消这一轮，排队的消息也不再执行 */
  cancel() {
    if (!this.turnRunning || !this.conn || !this.sessionId) return;
    this.queue = [];
    // ACP 要求：取消时还在等的审批回复 cancelled
    this.cancelPermissions();
    void this.conn.agent
      .notify('session/cancel', { sessionId: this.sessionId })
      .catch(() => {});
  }

  private cancelPermissions() {
    for (const resolve of this.permissions.values()) resolve(CANCELLED);
    this.permissions.clear();
  }

  /** 拉起 agent 进程并准备好会话：有 sessionId 就恢复，没有或恢复失败就新建 */
  private ensureSession(): Promise<void> {
    this.ready ??= this.start().catch((err) => {
      this.stop();
      throw err;
    });
    return this.ready;
  }

  private async start() {
    const { botId, agentId, cwd } = this.bot;
    if (agentId !== 'claude-code') throw new Error(`Unknown agent: ${agentId}`);
    const claude = findClaude();
    if (!claude) throw new Error('Claude Code is not installed on this device');
    if (!existsSync(cwd)) throw new Error(`Directory not found: ${cwd}`);

    mkdirSync(LOG_DIR, { recursive: true });
    const entry = await ensureClaudeAcp();
    const proc = spawn(process.execPath, [entry], {
      cwd,
      env: { ...process.env, CLAUDE_CODE_EXECUTABLE: claude },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr!.pipe(
      createWriteStream(join(LOG_DIR, `${botId}.log`), { flags: 'a' })
    );
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.endTurn({
        type: 'error',
        message: `Agent process exited (code ${code})`,
      });
      this.stop();
    });
    this.proc = proc;

    const stream = ndJsonStream(
      Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>
    );
    this.conn = client({ name: 'crewbot' })
      .onNotification('session/update', (ctx) => {
        const { update } = ctx.params;
        if (FORWARDED_UPDATES.has(update.sessionUpdate)) {
          this.emit(botId, { type: 'agent_update', update });
        }
      })
      .onRequest('session/request_permission', (ctx) => {
        // 交给网页上的用户决定，等服务器把选择发回来
        const requestId = randomUUID();
        const { toolCall, options } = ctx.params;
        this.emit(botId, {
          type: 'permission_request',
          requestId,
          toolCall,
          options,
        });
        return new Promise<RequestPermissionResponse>((resolve) => {
          this.permissions.set(requestId, resolve);
        });
      })
      .connect(stream);

    const init = (await this.conn.agent.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    })) as { _meta?: { steering?: { supported?: boolean } } };
    this.steeringSupported = init._meta?.steering?.supported === true;

    if (this.bot.sessionId) {
      try {
        await this.conn.agent.request('session/resume', {
          sessionId: this.bot.sessionId,
          cwd,
          mcpServers: [],
        });
        this.sessionId = this.bot.sessionId;
        return;
      } catch {
        // 恢复不了（比如会话文件被删了），新建一个
      }
    }
    const created = await this.conn.agent.request('session/new', {
      cwd,
      mcpServers: [],
    });
    this.sessionId = created.sessionId;
    this.emit(botId, { type: 'session', sessionId: created.sessionId });
  }

  stop() {
    clearTimeout(this.idleTimer);
    this.cancelPermissions();
    const proc = this.proc;
    this.proc = undefined;
    this.conn = undefined;
    this.ready = undefined;
    proc?.kill();
  }
}
