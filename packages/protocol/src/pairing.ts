// 设备配对（OAuth 2.0 设备授权流程，RFC 8628）：daemon ⇄ 服务器的 HTTP 接口。
// 响应外面还包一层 { code, message, data }，这里只定义 data。
import type { DeviceInfo } from './common';

/** POST /api/device/code：daemon 申请短码，不需要登录 */
export type DeviceCodeRequest = { device: DeviceInfo };
export type DeviceCodeResponse = {
  deviceCode: string; // 只给 daemon，用来轮询
  userCode: string; // 显示给用户，形如 WDJB-MJHT
  verificationUrl: string; // 带短码的确认页地址
  expiresIn: number; // 秒
  interval: number; // 轮询间隔，秒
};

/** POST /api/device/token：daemon 轮询，用户确认后拿到长期凭据 */
export type DeviceTokenRequest = { deviceCode: string };
export type DeviceTokenResponse =
  | { status: 'pending' }
  | { status: 'denied' }
  | { status: 'expired' } // 过期、不存在或已被领取
  | { status: 'approved'; deviceId: string; token: string };
