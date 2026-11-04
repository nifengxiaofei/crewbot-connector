// 共用的基础对象：ACP 类型和 daemon 上报的设备信息。
import type {
  PermissionOption,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import { z } from 'zod';

export type { PermissionOption, SessionUpdate, StopReason, ToolCallUpdate };

// ACP 的内容原样转发，不校验结构，只标注类型
export const sessionUpdateSchema = z.custom<SessionUpdate>(
  (v) => typeof v === 'object' && v !== null
);
export const toolCallSchema = z.custom<ToolCallUpdate>(
  (v) => typeof v === 'object' && v !== null
);
export const permissionOptionSchema = z.custom<PermissionOption>(
  (v) => typeof v === 'object' && v !== null
);

// ---------- 设备 ----------

export const agentInfoSchema = z.object({
  id: z.string(), // 例如 "claude-code"
  name: z.string(),
  version: z.string().optional(),
  /** ready：可以用；not_logged_in：没登录，需要用户先登录；unavailable：找不到或跑不起来 */
  status: z.enum(['ready', 'not_logged_in', 'unavailable']),
});
export type AgentInfo = z.infer<typeof agentInfoSchema>;

/** daemon 上报的设备信息 */
export const deviceInfoSchema = z.object({
  hostname: z.string(),
  os: z.string(), // process.platform
  arch: z.string(),
  daemonVersion: z.string(),
  agents: z.array(agentInfoSchema),
  /** bot 的默认工作目录放在这下面（<workspacesDir>/<botId>）；旧版 daemon 没有 */
  workspacesDir: z.string().optional(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

// ---------- bot 的自主程度（审批模式） ----------

/**
 * read_only：只看不改；workspace：自己目录里的文件改动直接做，命令要问；
 * auto：agent 自带的审查器判断，只问“可能不安全”的；full：什么都不问
 */
export const BOT_AUTONOMY = ['read_only', 'workspace', 'auto', 'full'] as const;
export type BotAutonomy = (typeof BOT_AUTONOMY)[number];
export const DEFAULT_AUTONOMY: BotAutonomy = 'auto';

/**
 * 每种 agent 下，自主程度对应的 ACP 会话模式 id（daemon 用 `session/set_mode` 设）。
 * 不在表里的 agent（Grok 的 ACP 没有审批模式）忽略这个设置，按它自己的行为
 */
export const AUTONOMY_MODES: Record<string, Record<BotAutonomy, string>> = {
  'claude-code': {
    read_only: 'plan',
    workspace: 'acceptEdits',
    auto: 'auto',
    full: 'bypassPermissions',
  },
  codex: {
    read_only: 'read-only',
    workspace: 'workspace-write',
    auto: 'agent',
    full: 'agent-full-access',
  },
};
