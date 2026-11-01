import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CREDENTIALS_PATH } from './paths';

export type Credentials = {
  server: string;
  deviceId: string;
  token: string;
};

/** 服务端换过域名：旧地址链接的设备凭据照样有效，只需改成新地址 */
const MOVED_SERVERS: Record<string, string> = {
  'https://crewbot.me': 'https://super-agent.team',
};

export async function readCredentials(): Promise<Credentials | null> {
  let creds: Credentials;
  try {
    creds = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
  } catch {
    return null;
  }
  const moved = MOVED_SERVERS[creds.server.replace(/\/$/, '')];
  if (moved) {
    creds = { ...creds, server: moved };
    await writeCredentials(creds);
  }
  return creds;
}

/** 只有当前用户能读写 */
export async function writeCredentials(creds: Credentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + '\n', {
    mode: 0o600,
  });
}

export async function deleteCredentials(): Promise<void> {
  await rm(CREDENTIALS_PATH, { force: true });
}
