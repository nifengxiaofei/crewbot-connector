// crewbot 协议：daemon ⇄ 服务器的消息类型。
// 消息用 zod 定义（服务器要校验收到的消息）；ACP 内容原样转发，只引用类型。
export const PROTOCOL_VERSION = 2;

export * from './common';
export * from './daemon';
export * from './pairing';
