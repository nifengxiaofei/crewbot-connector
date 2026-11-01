// daemon 和服务器共用的对象。
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
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;
