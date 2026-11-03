// bot 的默认工作目录：<CONFIG_DIR>/workspaces/<botId>，用户新建 bot 时没指定目录就用它。
// 目录跟着 bot 走：第一次用到时创建，bot 删了就删。用户自己指定的目录从不创建、从不删除。

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { WORKSPACES_DIR } from './paths';

/** botId 由服务器生成（bot-<十六进制>）；拼路径前先校验，防止 ../ 之类逃出目录 */
const BOT_ID = /^bot-[0-9a-f]+$/;

/** 这个 bot 的默认目录；botId 不合法返回 null */
export function defaultCwd(botId: string): string | null {
  return BOT_ID.test(botId) ? join(WORKSPACES_DIR, botId) : null;
}

/** 现有的默认目录（botId 列表） */
export function listWorkspaces(): string[] {
  try {
    return readdirSync(WORKSPACES_DIR).filter((name) => BOT_ID.test(name));
  } catch {
    return [];
  }
}

export function removeWorkspace(botId: string) {
  const dir = defaultCwd(botId);
  if (dir) rmSync(dir, { recursive: true, force: true });
}

/** 删掉不属于现有 bot 的默认目录：设备离线期间在网页上删掉的 bot */
export function pruneWorkspaces(bots: Set<string>) {
  for (const botId of listWorkspaces()) {
    if (!bots.has(botId)) removeWorkspace(botId);
  }
}
