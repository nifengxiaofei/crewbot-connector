import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CREDENTIALS_PATH } from './paths';

export type Credentials = {
  server: string;
  deviceId: string;
  token: string;
};

export async function readCredentials(): Promise<Credentials | null> {
  try {
    return JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'));
  } catch {
    return null;
  }
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
