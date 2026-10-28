/**
 * Offline self-test for the Session Companion Host half.
 *
 * Runs the digest renderer against a synthetic Session log, so the read-only
 * path can be exercised without a live Harness:
 *   node test/selftest.mjs
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { apply, _internals } from '../index.js';

const { normalizeConfig, readSession, renderEvent, renderLive, textOf, reasoningOf, oneLine, tail, head } = _internals;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

function textBlock(text) {
  return { type: 'text', text };
}
function reasoningBlock(text) {
  return { type: 'reasoning', text };
}

let clock = Date.now() - 60000;
function event(type, data) {
  clock += 1000;
  return { type, seq: clock, time: clock, data };
}

function makeSession(events, overrides) {
  return Object.assign(
    {
      id: 'session-test',
      seq: events.length,
      header: { cwd: 'F:\\AgentStudio\\general', version: 1 },
      snapshotEvents: (from) => events.slice(from || 0),
      ownEvents: () => events,
      requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } }),
    },
    overrides || {},
  );
}

const log = [
  event('turn/start', { turn: 1 }),
  event('user/message', { role: 'user', content: [textBlock('帮我修一下登录页的样式')] }),
  event('step/start', { turn: 1, step: 1 }),
  event('assistant/message', {
    turn: 1,
    step: 1,
    message: {
      role: 'assistant',
      content: [reasoningBlock('I should first inspect the login component and list its CSS.'), textBlock('先看一下登录页的样式文件。')],
      source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    },
    stream: [],
  }),
  event('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"file_path":"src/login.css"}' }),
  event('tool/result', {
    turn: 1,
    step: 1,
    message: { role: 'tool', content: [textBlock('body { margin: 0; }')], toolCallId: 'call-1' },
  }),
  event('step/end', { turn: 1, step: 1 }),
];

check('textOf joins text blocks and marks attachments', () => {
  assert.equal(textOf([textBlock('a'), { type: 'image' }, { type: 'file', attachment: { name: 'x.png' } }]), 'a\n[图片]\n[附件 x.png]');
  assert.equal(textOf('raw'), 'raw');
  assert.equal(textOf(undefined), '');
});

check('reasoningOf only picks reasoning blocks', () => {
  assert.equal(reasoningOf([reasoningBlock('think'), textBlock('say')]), 'think');
});

check('oneLine collapses whitespace and clips', () => {
  assert.equal(oneLine('  a \n\n b  ', 20), 'a b');
  assert.equal(oneLine('abcdef', 3), 'abc…');
});

check('head clips the tail, tail clips the head', () => {
  assert.equal(head('abcdef', 3), 'abc…');
  assert.equal(tail('abcdef', 3), '…def');
});

check('renderEvent keeps the English reasoning and the tool call', () => {
  const lines = renderEvent(log[3]);
  assert.ok(lines[0].startsWith('思考：I should first inspect'));
  assert.ok(lines[1].startsWith('助手：先看一下'));
  assert.equal(renderEvent(log[4])[0], '工具 read 参数 {"file_path":"src/login.css"}');
  assert.equal(renderEvent(log[5])[0], '结果：body { margin: 0; }');
  assert.equal(renderEvent(event('request/header', {})), null);
});

check('digest carries a compact, newest-first-last log', () => {
  const session = makeSession(log);
  const { digest, status } = readSession(session, null, false, normalizeConfig({}));
  assert.ok(digest.includes('用户：帮我修一下登录页的样式'));
  assert.ok(digest.includes('工具 read 参数'));
  assert.ok(digest.includes('模型: deepseek-v4.1-flash'));
  assert.ok(digest.includes('工作目录'));
  assert.equal(status.model, 'deepseek-v4.1-flash');
  assert.equal(status.phase, '第1轮 第1步');
  assert.equal(status.running, false, 'a closed step is not running');
});

check('an open step with recent activity reads as running', () => {
  const session = makeSession(log.slice(0, 5));
  const { status } = readSession(session, null, false, normalizeConfig({}));
  assert.equal(status.running, true);
  assert.equal(status.headline, '正在执行 read');
});

check('live stream frames win the headline and appear after the log', () => {
  const session = makeSession(log.slice(0, 4));
  const live = { at: Date.now(), reasoning: 'Checking the grid rules again', text: '', tools: [] };
  const { digest, status } = readSession(session, live, false, normalizeConfig({}));
  assert.ok(digest.includes('[正在生成，尚未写入日志]'));
  assert.ok(digest.includes('Checking the grid rules again'));
  assert.ok(status.headline.startsWith('思考中：'));
  assert.equal(status.running, true);
});

check('stale live frames are ignored', () => {
  assert.equal(renderLive({ at: Date.now() - 10 * 60 * 1000, reasoning: 'x', text: '', tools: [] }), '');
  assert.equal(renderLive(null), '');
});

check('the character budget drops the oldest lines only', () => {
  const long = [];
  for (let i = 0; i < 40; i += 1) {
    long.push(event('user/message', { role: 'user', content: [textBlock('问题' + i + ' ' + 'x'.repeat(200))] }));
  }
  const session = makeSession(long);
  const cfg = normalizeConfig({ digestChars: 2000, historyEvents: 200 });
  const { digest } = readSession(session, null, false, cfg);
  assert.ok(digest.includes('问题39'), 'newest line survives');
  assert.ok(!digest.includes('问题0 '), 'oldest line is dropped');
  assert.ok(digest.length < 4000);
});

check('config normalization clamps hostile values', () => {
  const cfg = normalizeConfig({ historyEvents: 9999, digestChars: -5, maxAnswerTokens: 'x', provider: '  p  ' });
  assert.equal(cfg.historyEvents, 200);
  assert.equal(cfg.digestChars, 1500);
  assert.equal(cfg.maxAnswerTokens, 500, 'a non-numeric cap falls back to the short-answer default');
  assert.equal(cfg.provider, 'p');
});

check('an unreadable session degrades instead of throwing', () => {
  const session = makeSession([], {
    snapshotEvents: () => {
      throw new Error('boom');
    },
    ownEvents: () => {
      throw new Error('boom');
    },
  });
  const { digest } = readSession(session, null, false, normalizeConfig({}));
  assert.ok(digest.includes('（暂无内容）'));
});

/* ---------------------------------------------------------------- progress */

function toolCall(name, args) {
  return event('tool/call', { turn: 1, step: 1, callId: 'call-' + name, name, arguments: JSON.stringify(args) });
}

function toolResult(ok, callId) {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: { role: 'tool', content: [textBlock(ok ? 'done' : 'boom')], toolCallId: callId },
    ...(ok ? {} : { error: { name: 'ToolError', code: 'E_FAILED' } }),
  });
}

check('todo_write becomes a done/total counter with the active item', () => {
  const session = makeSession([
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    toolCall('todo_write', {
      todos: [
        { content: '读代码', status: 'completed' },
        { content: '改样式', status: 'in_progress' },
        { content: '跑自测', status: 'pending' },
      ],
    }),
    toolResult(true, 'call-todo_write'),
  ]);
  const { status, digest } = readSession(session, null, true, normalizeConfig({}));
  assert.deepEqual(status.progress.todos, { total: 3, done: 1, active: '改样式' });
  assert.ok(digest.includes('[待办] 1/3 已完成，正在做：改样式'));
});

check('a later todo_write replaces the earlier list', () => {
  const session = makeSession([
    toolCall('todo_write', { todos: [{ content: 'a', status: 'pending' }] }),
    toolCall('todo_write', { todos: [{ content: 'a', status: 'completed' }] }),
  ]);
  const { status } = readSession(session, null, true, normalizeConfig({}));
  assert.deepEqual(status.progress.todos, { total: 1, done: 1, active: '' });
});

check('write and edit arguments add distinct files only', () => {
  const session = makeSession([
    toolCall('write', { file_path: 'a.js', content: 'x' }),
    toolCall('edit', { file_path: 'a.js', old_string: 'x', new_string: 'y' }),
    toolCall('edit', { file_path: 'b.js', old_string: 'x', new_string: 'y' }),
    toolCall('read', { file_path: 'c.js' }),
  ]);
  const { status, digest } = readSession(session, null, true, normalizeConfig({}));
  assert.equal(status.progress.files, 2);
  assert.ok(digest.includes('[已改动文件] 2 个'));
});

check('three failed tool results in a row raise a failing stall', () => {
  const session = makeSession([
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    toolCall('edit', { file_path: 'a.js' }),
    toolResult(false, 'call-edit'),
    toolCall('edit', { file_path: 'a.js' }),
    toolResult(false, 'call-edit'),
    toolCall('edit', { file_path: 'a.js' }),
    toolResult(false, 'call-edit'),
  ]);
  const { status } = readSession(session, null, true, normalizeConfig({}));
  assert.equal(status.progress.stall.kind, 'failing');
  assert.ok(status.progress.stall.detail.includes('3'));
});

check('a success breaks the failure streak', () => {
  const session = makeSession([
    toolCall('edit', {}),
    toolResult(false, 'call-edit'),
    toolResult(false, 'call-edit'),
    toolResult(true, 'call-edit'),
    toolResult(false, 'call-edit'),
  ]);
  const { status } = readSession(session, null, true, normalizeConfig({}));
  assert.equal(status.progress.stall, null);
});

check('the same call repeated three times reads as a loop', () => {
  const same = { file_path: 'a.js', old_string: 'x', new_string: 'y' };
  const session = makeSession([
    event('turn/start', { turn: 1 }),
    toolCall('edit', same),
    toolResult(false, 'call-edit'),
    toolCall('edit', same),
    toolResult(false, 'call-edit'),
    toolCall('edit', same),
    toolResult(true, 'call-edit'),
  ]);
  const { status } = readSession(session, null, true, normalizeConfig({}));
  assert.equal(status.progress.stall.kind, 'looping');
});

check('a long silence on a running session reads as quiet', () => {
  const stale = Date.now() - 30 * 60 * 1000;
  const events = [
    { type: 'turn/start', seq: 1, time: stale, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: stale + 1000, data: { turn: 1, step: 1 } },
  ];
  const session = makeSession(events);
  const { status } = readSession(session, null, true, normalizeConfig({ stallMinutes: 8 }));
  assert.equal(status.progress.stall.kind, 'quiet');
  assert.ok(status.progress.stall.detail.includes('8'));

  const idle = readSession(session, null, false, normalizeConfig({ stallMinutes: 8 }));
  assert.equal(idle.status.progress.stall, null, 'an idle session is not stalled');
});

check('progress survives a session with no recognisable events', () => {
  const { status } = readSession(makeSession([]), null, false, normalizeConfig({}));
  assert.deepEqual(status.progress, {
    turn: 0,
    step: 0,
    elapsedMs: 0,
    todos: null,
    files: 0,
    tokens: null,
    stall: null,
  });
});

check('context pressure is passed through to the strip and the digest', () => {
  const session = makeSession([event('turn/start', { turn: 1 })]);
  const off = readSession(session, null, false, normalizeConfig({}));
  assert.equal(off.status.progress.tokens, null);
  assert.ok(!off.digest.includes('上下文用量'), 'no token line when the meter is absent');

  const on = readSession(session, null, false, normalizeConfig({}), 48300);
  assert.equal(on.status.progress.tokens, 48300);
  assert.ok(on.digest.includes('[上下文用量] 约 48300 tokens'));
});

check('malformed tool arguments never throw', () => {
  const session = makeSession([
    { type: 'tool/call', seq: 1, time: Date.now(), data: { name: 'edit', arguments: '{"file_path":' } },
    { type: 'tool/call', seq: 2, time: Date.now(), data: { name: 'todo_write', arguments: '"nope"' } },
  ]);
  const { status } = readSession(session, null, true, normalizeConfig({}));
  assert.equal(status.progress.files, 0);
  assert.equal(status.progress.todos, null);
});

/* ------------------------------------------------------------ integration */

// A stub Context is enough to catch the class of bug that takes the whole
// desktop down at boot: a service touched without being present, a wiring
// reference that only resolves at activation, a handler that throws early.
const routes = [];
const stubCtx = {
  effect(fn) {
    const dispose = fn();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  on() {
    return () => {};
  },
  get() {
    return null;
  },
  sessions: { get: () => undefined },
  llm: { stream: async function* () {} },
  webServer: {
    register(route) {
      routes.push(route);
      return () => {};
    },
  },
};

check('apply() wires up against a stub Context', () => {
  apply(stubCtx, { enabled: true });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, _internals.routePrefix);
});

check('apply() is inert when disabled', () => {
  const before = routes.length;
  apply(stubCtx, { enabled: false });
  assert.equal(routes.length, before);
});

function fakeResponse() {
  return {
    code: 0,
    body: '',
    writableEnded: false,
    writeHead(code) {
      this.code = code;
      return this;
    },
    end(body) {
      this.body = body;
      this.writableEnded = true;
    },
    on() {},
  };
}

async function hit(route, method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  req.destroy = () => {};
  // Deliver the body on the next tick so the handler's listeners are attached.
  setTimeout(() => {
    if (body) req.emit('data', Buffer.from(body));
    req.emit('end');
  }, 0);
  const res = fakeResponse();
  route.handler(req, res);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return res;
}

const notLive = await hit(routes[0], 'GET', '/session-companion/status?session=session-missing');
assert.equal(notLive.code, 409);
assert.equal(JSON.parse(notLive.body).error, 'session-not-live');
passed += 1;
console.log('ok  the status route answers 409 for an unknown Session');

const wrongMethod = await hit(routes[0], 'POST', '/session-companion/status?session=x');
assert.equal(wrongMethod.code, 405);
passed += 1;
console.log('ok  the status route rejects a POST');

const emptyAsk = await hit(routes[0], 'POST', '/session-companion/ask');
assert.equal(emptyAsk.code, 400);
passed += 1;
console.log('ok  /ask without a body is a 400, not a crash');

const askMissing = await hit(routes[0], 'POST', '/session-companion/ask', JSON.stringify({ sessionId: 'nope', question: '在干嘛' }));
assert.equal(askMissing.code, 409);
assert.equal(JSON.parse(askMissing.body).error, 'session-not-live');
passed += 1;
console.log('ok  /ask for an unknown Session is refused before any model call');

const badJson = await hit(routes[0], 'POST', '/session-companion/ask', '{not json');
assert.equal(badJson.code, 400);
passed += 1;
console.log('ok  /ask with malformed JSON is a 400');

console.log('\n' + passed + ' checks passed');
