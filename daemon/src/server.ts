// 和 crewbot 服务端的 HTTP 交互
export const SERVER_URL = (
  process.env.CREWBOT_SERVER ?? 'https://super-agent.team'
).replace(/\/$/, '');

/** POST JSON，拆开服务器响应的 { code, message, data } 外壳 */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error(`Cannot reach ${SERVER_URL}`);
  });
  const json = (await res.json().catch(() => null)) as {
    code: number;
    message: string;
    data: T;
  } | null;
  if (!json || json.code !== 0) {
    throw new Error(json?.message || `${res.status} ${res.statusText}`);
  }
  return json.data;
}

/** 凭据是否还有效：ok / invalid（被撤销等）/ unreachable（连不上服务器） */
export async function checkToken(
  server: string,
  token: string
): Promise<'ok' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(`${server}/api/device/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return 'invalid';
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** 注销这台设备：服务器删掉凭据和设备记录。连不上服务器时返回 false */
export async function revokeToken(
  server: string,
  token: string
): Promise<boolean> {
  try {
    const res = await fetch(`${server}/api/device/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    // 401：凭据早就失效了，也算注销成功
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}
