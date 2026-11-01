// ACP 验证脚本：prompt / steering / 审批 / 进程重启后 resume。
// 运行：pnpm -C daemon exec tsx spike/acp.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  client,
  ndJsonStream,
  type ClientContext,
} from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const AGENT_BIN =
  process.env.ACP_BIN ??
  join(
    require.resolve('@agentclientprotocol/claude-agent-acp/package.json'),
    '../dist/index.js'
  );

const cwd = mkdtempSync(join(tmpdir(), 'crewbot-spike-'));
writeFileSync(
  join(cwd, 'README.md'),
  '# Demo\n\nThis projct is a smal demo. It has three fils.\n'
);
writeFileSync(join(cwd, 'a.txt'), 'alpha\n');
writeFileSync(join(cwd, 'b.txt'), 'beta\n');

const t0 = Date.now();
const log = (...a: unknown[]) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

type UpdateHook = (u: any) => void;
let onUpdate: UpdateHook = () => {};
let permissionCount = 0;

function startAgent() {
  const proc = spawn(process.execPath, [AGENT_BIN], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const stream = ndJsonStream(
    Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
  );
  const app = client({ name: 'crewbot-spike' })
    .onNotification('session/update', (ctx: any) => onUpdate(ctx.params.update))
    .onRequest('session/request_permission', (ctx: any) => {
      permissionCount++;
      const p = ctx.params;
      log(
        '🔐 permission',
        p.toolCall?.title,
        p.options.map((o: any) => `${o.kind}:${o.optionId}`).join(' ')
      );
      const allow =
        p.options.find((o: any) => o.kind === 'allow_once') ?? p.options[0];
      return { outcome: { outcome: 'selected', optionId: allow.optionId } };
    });
  return { proc, app, stream };
}

function summarize(u: any): string {
  switch (u.sessionUpdate) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk':
      return `${u.sessionUpdate} ${JSON.stringify(u.content?.text ?? '').slice(0, 60)}`;
    case 'tool_call':
    case 'tool_call_update':
      return `${u.sessionUpdate} ${u.toolCallId?.slice(-6)} ${u.title ?? ''} ${u.status ?? ''}`;
    default:
      return u.sessionUpdate;
  }
}

async function phase1(ctx: ClientContext): Promise<string> {
  const init: any = await ctx.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  log(
    'initialize: steering =',
    JSON.stringify(init._meta?.steering),
    'loadSession =',
    init.agentCapabilities?.loadSession,
    'sessionCapabilities =',
    Object.keys(init.agentCapabilities?.sessionCapabilities ?? {}).join(',')
  );

  const { sessionId }: any = await ctx.request('session/new', {
    cwd,
    mcpServers: [],
  });
  log('session/new', sessionId);

  // ① 正常一轮 + ② 中途 steering + ③ 审批（改文件）
  const counts: Record<string, number> = {};
  let steered = false;
  let steerPromise: Promise<unknown> | undefined;
  onUpdate = (u) => {
    counts[u.sessionUpdate] = (counts[u.sessionUpdate] ?? 0) + 1;
    if (u.sessionUpdate !== 'agent_message_chunk')
      log('  update', summarize(u));
    if (!steered && u.sessionUpdate === 'tool_call') {
      steered = true;
      log('➡️  steering while turn running');
      steerPromise = ctx
        .request('_session/steering', {
          sessionId,
          prompt: [
            {
              type: 'text',
              text: 'Also: at the very end, tell me how many .txt files there are.',
            },
          ],
          _meta: { steering: { idleBehavior: 'promptRequired' } },
        })
        .then((r) => log('⬅️  steering result', JSON.stringify(r)));
    }
  };
  const res: any = await ctx.request('session/prompt', {
    sessionId,
    prompt: [
      {
        type: 'text',
        text: 'Read README.md, list the typos, then fix them in the file. Be brief.',
      },
    ],
  });
  await steerPromise;
  log(
    'prompt done: stopReason =',
    res.stopReason,
    'updates =',
    JSON.stringify(counts)
  );
  log(
    'README now:',
    JSON.stringify(readFileSync(join(cwd, 'README.md'), 'utf8'))
  );

  // ④ 空闲时 steering → 应返回 promptRequired
  const idle = await ctx.request('_session/steering', {
    sessionId,
    prompt: [{ type: 'text', text: 'hello' }],
    _meta: { steering: { idleBehavior: 'promptRequired' } },
  });
  log('idle steering result', JSON.stringify(idle));
  return sessionId;
}

async function phase2(ctx: ClientContext, sessionId: string) {
  await ctx.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  let replayed = 0;
  onUpdate = (u) => {
    replayed++;
  };
  const r: any = await ctx.request('session/resume', {
    sessionId,
    cwd,
    mcpServers: [],
  });
  log(
    'session/resume ok, updates during resume =',
    replayed,
    'resp keys =',
    Object.keys(r ?? {}).join(',')
  );

  let text = '';
  onUpdate = (u) => {
    if (u.sessionUpdate === 'agent_message_chunk')
      text += u.content?.text ?? '';
  };
  const res: any = await ctx.request('session/prompt', {
    sessionId,
    prompt: [
      {
        type: 'text',
        text: 'In one sentence: what file did you edit earlier in this conversation, and what did I ask you to add at the end?',
      },
    ],
  });
  log('after resume answer:', JSON.stringify(text), res.stopReason);
}

const a = startAgent();
const sessionId = await a.app.connectWith(a.stream, phase1);
a.proc.kill();
log('🔪 agent process killed; permissions handled =', permissionCount);

const b = startAgent();
await b.app.connectWith(b.stream, (ctx) => phase2(ctx, sessionId));
b.proc.kill();
log('done, cwd =', cwd);
