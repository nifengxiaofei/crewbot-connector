// daemon ⇄ 服务器
// 心跳不走这里：daemon 每 15 秒发纯文本 "ping"，服务器直接回 "pong"。
import { z } from 'zod';

import {
  deviceInfoSchema,
  permissionOptionSchema,
  sessionUpdateSchema,
  toolCallSchema,
  type BotAutonomy,
  type StopReason,
} from './common';

export const PING = 'ping';
export const PONG = 'pong';

/** 设备在网页上被移除：服务器用这个关闭码断开 daemon，daemon 收到后删掉本机凭据并退出 */
export const CLOSE_REVOKED = 4003;

// ---------- daemon → 服务器 ----------

/** daemon 产生的事件；dseq 由 daemon 按 bot 递增，用于断线补传后去重 */
const daemonEventPayloadSchema = z.discriminatedUnion('type', [
  /** 新建或恢复 ACP 会话后上报 sessionId，服务器存起来 */
  z.object({ type: z.literal('session'), sessionId: z.string() }),
  /** 消息已交给 agent：prompt = 开了新一轮，injected = 插入了正在跑的一轮 */
  z.object({
    type: z.literal('message_accepted'),
    msgId: z.string(),
    mode: z.enum(['prompt', 'injected']),
  }),
  z.object({ type: z.literal('agent_update'), update: sessionUpdateSchema }),
  z.object({
    type: z.literal('permission_request'),
    requestId: z.string(),
    toolCall: toolCallSchema,
    options: z.array(permissionOptionSchema),
  }),
  z.object({
    type: z.literal('turn_end'),
    stopReason: z.custom<StopReason>((v) => typeof v === 'string'),
  }),
  z.object({
    type: z.literal('error'),
    msgId: z.string().optional(),
    message: z.string(),
  }),
]);

export const daemonToServerSchema = z.discriminatedUnion('type', [
  /**
   * 连上后第一条：上报设备信息，以及哪些 bot 的这一轮 daemon 还负责：还在执行，
   * 或者已经结束但结果还没传上去（welcome 后补传收尾）。daemon 重启后之前的
   * 轮次都没了，服务器据此把它们标为中断
   */
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number(),
    device: deviceInfoSchema,
    runningBots: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal('bot_event'),
    botId: z.string(),
    dseq: z.number().int().positive(),
    event: daemonEventPayloadSchema,
  }),
]);
export type DaemonToServer = z.infer<typeof daemonToServerSchema>;
export type DaemonEventPayload = z.infer<typeof daemonEventPayloadSchema>;

// ---------- 服务器 → daemon ----------

/** daemon 需要知道的 bot 信息 */
export type DaemonBot = {
  botId: string;
  agentId: string;
  cwd: string;
  sessionId: string | null; // 没有就新建会话
  /** 自主程度（审批模式）；老服务器不发，daemon 就不设模式 */
  autonomy?: BotAutonomy;
};

export type ServerToDaemon =
  /**
   * 对 hello 的回应：这台设备上的 bot，以及每个 bot 服务器已收到的最大 dseq，
   * daemon 从这里往后补传断线期间的事件
   */
  | {
      type: 'welcome';
      deviceId: string;
      bots: DaemonBot[];
      ackedDseq: Record<string, number>;
    }
  /**
   * 用户发了消息：daemon 决定 session/prompt 还是 steering。
   * 服务器收到 message_accepted 之前，daemon 每次重连都会再发一遍，daemon 按 msgId 去重
   */
  | { type: 'message'; bot: DaemonBot; msgId: string; text: string }
  | {
      type: 'permission_response';
      botId: string;
      requestId: string;
      optionId: string;
    }
  /** 用户点了停止：daemon 发 session/cancel，这一轮以 turn_end(cancelled) 结束 */
  | { type: 'cancel'; botId: string }
  /** bot 的设置改了（目前只有自主程度）：进程还活着就马上切会话模式 */
  | { type: 'bot_updated'; bot: DaemonBot }
  /** bot 被删除：daemon 关掉对应进程 */
  | { type: 'bot_removed'; botId: string };
