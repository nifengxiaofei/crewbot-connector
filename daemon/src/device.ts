import { arch, hostname, platform } from 'node:os';
import type { DeviceInfo } from '@crewbot/protocol';

import pkg from '../package.json' with { type: 'json' };
import { detectAgents } from './agents';

export async function getDeviceInfo(): Promise<DeviceInfo> {
  return {
    hostname: hostname(),
    os: platform(),
    arch: arch(),
    daemonVersion: pkg.version,
    agents: await detectAgents(),
  };
}
