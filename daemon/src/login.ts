import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import type {
  DeviceCodeResponse,
  DeviceTokenResponse,
} from '@crewbot/protocol';

import { writeCredentials, type Credentials } from './credentials';
import { getDeviceInfo } from './device';
import { post, SERVER_URL } from './server';

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  // 打不开也没关系，终端里有地址
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

/** 设备配对：显示短码、打开浏览器、等用户确认。成功返回凭据，失败返回 null */
export async function login(): Promise<Credentials | null> {
  const device = await getDeviceInfo();
  console.log(`This device isn't connected to ${SERVER_URL} yet. Let's link it.`);
  const code = await post<DeviceCodeResponse>('/api/device/code', { device });

  console.log(`\n  Your code:  ${code.userCode}\n`);
  console.log(`  Opening ${code.verificationUrl}`);
  console.log(`  (If the browser doesn't open, visit the URL above.)\n`);
  openBrowser(code.verificationUrl);
  console.log('  Waiting for confirmation...');

  const deadline = Date.now() + code.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(code.interval * 1000);
    const res = await post<DeviceTokenResponse>('/api/device/token', {
      deviceCode: code.deviceCode,
    });
    if (res.status === 'pending') continue;
    if (res.status === 'denied') {
      console.log('\n  ✗ Request denied.');
      return null;
    }
    if (res.status === 'expired') break;

    const creds = {
      server: SERVER_URL,
      deviceId: res.deviceId,
      token: res.token,
    };
    await writeCredentials(creds);
    console.log(`\n  ✓ Linked as "${device.hostname}".\n`);
    return creds;
  }
  console.log('\n  ✗ The code expired. Run `crewbot start` again.');
  return null;
}
