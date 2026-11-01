// crewbot 在本机的文件都放在 ~/.config/crewbot/（或 $XDG_CONFIG_HOME/crewbot/）
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
  'crewbot'
);
/** 设备凭据（权限 600） */
export const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json');
/** 后台 daemon 的 pid */
export const PID_PATH = join(CONFIG_DIR, 'daemon.pid');
/** 后台 daemon 的运行状态，crewbot status 读它 */
export const STATE_PATH = join(CONFIG_DIR, 'state.json');
export const LOG_DIR = join(CONFIG_DIR, 'logs');
export const DAEMON_LOG = join(LOG_DIR, 'daemon.log');
/** 按需安装的 agent 适配器 */
export const AGENTS_DIR = join(CONFIG_DIR, 'agents');
