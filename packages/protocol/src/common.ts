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
 * 每种 agent 下，自主程度对应的 ACP 会话模式 id（daemon 用 `session/set_mode` 设）
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

/**
 * 没有会话模式、只能在建会话（`session/new` / `session/resume`）时用 `_meta` 开关设
 * 审批模式的 agent：自主程度 → 开关名，daemon 传 `_meta: { [开关]: true }`。
 * 只对这一个会话生效，不碰机器上 agent 自己的配置。
 * Grok 只有这两个开关，所以只有这两档
 */
export const AUTONOMY_SESSION_META: Record<
  string,
  Partial<Record<BotAutonomy, string>>
> = {
  grok: { auto: 'autoMode', full: 'yoloMode' },
};

/** 这种 agent 能设的自主程度（按 BOT_AUTONOMY 的顺序）；一档都不支持的 agent 是空数组 */
export function supportedAutonomy(agentId: string): BotAutonomy[] {
  const modes = AUTONOMY_MODES[agentId] ?? AUTONOMY_SESSION_META[agentId];
  return modes ? BOT_AUTONOMY.filter((level) => level in modes) : [];
}
