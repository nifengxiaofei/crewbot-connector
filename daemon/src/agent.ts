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
import {
  AUTONOMY_MODES,
  type BotAutonomy,
  type DaemonBot,
  type DaemonEventPayload,
  type SessionUpdate,
} from '@crewbot/protocol';

import { agentLaunch } from './agents';
import { LOG_DIR } from './paths';
import { defaultCwd } from './workspaces';

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

/** 文字片段最多攒这么久、这么多字就上报一条 */
const CHUNK_FLUSH_MS = 300;
const CHUNK_FLUSH_CHARS = 8_000;

/** 能合并的输出：回复或思考的纯文字片段 */
type TextChunk = Extract<
  SessionUpdate,
  { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' }
> & { content: { type: 'text'; text: string } };

function isTextChunk(update: SessionUpdate): update is TextChunk {
  return (
    (update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk') &&
    update.content.type === 'text'
  );
}

/** 一个 bot 对应一个 agent 进程和一个 ACP 会话 */
export class BotAgent {
  private proc?: ChildProcess;
  private conn?: ClientConnection;
  private sessionId?: string;
  private ready?: Promise<void>;
  private steeringSupported = false;
  private turnRunning = false;
  /** 收到了、还在等 agent 准备好（拉起进程、恢复会话要几秒）的消息数 */
  private starting = 0;
  private queue: { msgId: string; text: string }[] = [];
  /** 等用户审批的请求：requestId → 回复 agent */
  private permissions = new Map<
    string,
    (res: RequestPermissionResponse) => void
  >();
  private idleTimer?: NodeJS.Timeout;
  /** 还没上报的文字片段（见 bufferChunk） */
  private pendingChunk?: { update: TextChunk; timer: NodeJS.Timeout };
  /** 当前会话上已经设好的 ACP 模式 id（见 applyAutonomy） */
  private appliedMode?: string;

  constructor(
    private bot: DaemonBot,
    private emit: Emit
  ) {}

  /** 用户发来一条消息：没有在跑就开新一轮；在跑就插入当前轮（不支持插入就排队） */
  get running(): boolean {
    return this.turnRunning || this.starting > 0;
  }

  /** agent 进程还在 */
  get alive(): boolean {
    return this.proc !== undefined;
  }

  async handleMessage(bot: DaemonBot, msgId: string, text: string) {
    this.bot = bot;
    clearTimeout(this.idleTimer);
    this.starting++;
    try {
      await this.ensureSession();
      // 自主程度在上次会话建立后改过（当时切失败、或 daemon 那会儿不在线）：现在切，切不了就报错
      await this.applyAutonomy();
    } catch (err) {
      this.emit(bot.botId, {
        type: 'error',
        msgId,
        message: (err as Error).message,
      });
      return;
    } finally {
      this.starting--;
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

  /**
   * 文字片段攒一会儿再上报：agent 每几个字就发一条
   * agent_message_chunk，原样上报会让服务器一轮存几百上千行。连续的同类文字片段
   * 合并成一条，攒满 CHUNK_FLUSH_MS 或 CHUNK_FLUSH_CHARS、或来了别的类型的事件就上报
   */
  private bufferChunk(update: TextChunk) {
    const pending = this.pendingChunk;
    if (pending && pending.update.sessionUpdate === update.sessionUpdate) {
      pending.update = {
        ...pending.update,
        content: {
          ...pending.update.content,
          text: pending.update.content.text + update.content.text,
        },
      };
      if (pending.update.content.text.length >= CHUNK_FLUSH_CHARS) {
        this.flushChunks();
      }
      return;
    }
    this.flushChunks();
    this.pendingChunk = {
      update,
      timer: setTimeout(() => this.flushChunks(), CHUNK_FLUSH_MS),
    };
  }

  private flushChunks() {
    const pending = this.pendingChunk;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingChunk = undefined;
    this.emit(this.bot.botId, { type: 'agent_update', update: pending.update });
  }

  /** 结束当前这一轮（只报一次），然后跑排队的消息；没有就开始计空闲时间 */
  private endTurn(event: DaemonEventPayload) {
    if (!this.turnRunning) return;
    this.turnRunning = false;
    this.flushChunks();
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

  /** bot 的设置改了（自主程度）：进程还活着就马上切模式；切不了只记日志，下次来消息时再报错 */
  updateBot(bot: DaemonBot) {
    this.bot = bot;
    if (!this.conn || !this.sessionId) return;
    void this.applyAutonomy().catch((err: Error) =>
      console.error(`[${bot.botId}] ${err.message}`)
    );
  }

  /**
   * 把 bot 的自主程度设到 ACP 会话上。
   * 老服务器不发 autonomy、agent 不在映射表里（Grok）、或已经是这个模式：不调
   */
  private async applyAutonomy() {
    const modes = AUTONOMY_MODES[this.bot.agentId] as
      Record<BotAutonomy, string> | undefined;
    const modeId = this.bot.autonomy && modes?.[this.bot.autonomy];
    if (
      !modeId ||
      modeId === this.appliedMode ||
      !this.conn ||
      !this.sessionId
    ) {
      return;
    }
    try {
      await this.conn.agent.request('session/set_mode', {
        sessionId: this.sessionId,
        modeId,
      });
    } catch (err) {
      throw new Error(
        `Autonomy level "${this.bot.autonomy}" is not available for this agent: ${(err as Error).message}`
      );
    }
    this.appliedMode = modeId;
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
    // 默认目录第一次用到时创建；用户指定的目录必须已经存在
    if (cwd === defaultCwd(botId)) mkdirSync(cwd, { recursive: true });
    else if (!existsSync(cwd)) throw new Error(`Directory not found: ${cwd}`);

    mkdirSync(LOG_DIR, { recursive: true });
    const launch = await agentLaunch(agentId);
    const proc = spawn(launch.command, launch.args, {
      cwd,
      env: launch.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, // Windows：后台 daemon 没有控制台，不加会弹出窗口
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
        if (!FORWARDED_UPDATES.has(update.sessionUpdate)) return;
        if (isTextChunk(update)) {
          this.bufferChunk(update);
        } else {
          this.flushChunks();
          this.emit(botId, { type: 'agent_update', update });
        }
      })
      .onRequest('session/request_permission', (ctx) => {
        // 交给网页上的用户决定，等服务器把选择发回来
        this.flushChunks();
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

    this.appliedMode = undefined;
    if (this.bot.sessionId) {
      try {
        await this.conn.agent.request('session/resume', {
          sessionId: this.bot.sessionId,
          cwd,
          mcpServers: [],
        });
        this.sessionId = this.bot.sessionId;
      } catch {
        // 恢复不了（比如会话文件被删了），新建一个
      }
    }
    if (!this.sessionId) {
      const created = await this.conn.agent.request('session/new', {
        cwd,
        mcpServers: [],
      });
      this.sessionId = created.sessionId;
      this.emit(botId, { type: 'session', sessionId: created.sessionId });
    }
    // 新建的会话落在 agent 自己的默认模式，恢复的沿用上次的：都要设成 bot 现在的自主程度
    await this.applyAutonomy();
  }

  stop() {
    clearTimeout(this.idleTimer);
    this.flushChunks();
    this.cancelPermissions();
    const proc = this.proc;
    this.proc = undefined;
    this.conn = undefined;
    this.ready = undefined;
    this.sessionId = undefined;
    this.appliedMode = undefined;
    proc?.kill();
  }
}
