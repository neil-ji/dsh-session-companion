/**
 * Offline render test for the panel's new "one click, no typing" flow.
 *
 * There is no DOM here: React is replaced by a tiny element factory, hooks are
 * inert, and the two HTTP endpoints are stubbed. What this still proves is the
 * wiring that a screenshot cannot: opening the panel asks the fixed question,
 * streams the answer into the overview, never adds a chat bubble, and reuses a
 * fresh summary instead of calling the model again.
 *
 *   node test/panel.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientFile = path.join(here, '..', 'client.js');
const clientSource = fs.readFileSync(clientFile, 'utf8');

/* ------------------------------------------------------------------ react */

function flatten(children, out) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) flatten(child, out);
    else out.push(child);
  }
  return out;
}

const React = {
  Fragment: 'Fragment',
  createElement(type, props) {
    const children = flatten(Array.prototype.slice.call(arguments, 2), []);
    return { type: type, props: props || {}, children: children };
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, function () {}];
  },
  useEffect() {},
  useMemo(factory) {
    return factory();
  },
  useRef(value) {
    return { current: value };
  },
};

/* -------------------------------------------------------------- globals */

const storage = new Map();
const fakeStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

/** Deterministic, never-actually-called fake stream used by /ask. */
const answerFrames = [
  { t: 'start', model: 'deepseek-v4.1-flash', running: true },
  { t: 'delta', text: '它在跑一轮自测，' },
  { t: 'delta', text: '目前没有报错。' },
  { t: 'done', chars: 20 },
];

const calls = { status: 0, ask: 0 };

let statusReply = 'live';

function jsonResponse(value, status) {
  return { ok: (status || 200) < 400, status: status || 200, json: async () => value };
}

function sseResponse() {
  const text = answerFrames.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
  const bytes = new TextEncoder().encode(text);
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 4) controller.enqueue(bytes.slice(i, i + 4));
        controller.close();
      },
    }),
  };
}

globalThis.fetch = async function (url, init) {
  if (String(url).indexOf('/status') >= 0) {
    calls.status += 1;
    if (statusReply === 'gone') return jsonResponse({ ok: false, error: 'session-not-live' }, 409);
    const advanced = statusReply === 'advanced';
    return jsonResponse({
      ok: true,
      running: true,
      phase: advanced ? '第2轮 第4步' : '第2轮 第3步',
      headline: '正在执行 pwsh',
      model: 'deepseek-v4.1-flash',
      progress: {
        turn: 2,
        step: advanced ? 4 : 3,
        elapsedMs: 60000,
        todos: { total: 3, done: 1, active: '跑自测' },
        files: 2,
        tokens: 48300,
        stall: null,
      },
    });
  }
  calls.ask += 1;
  assert.equal(init.method, 'POST');
  return sseResponse();
};

const listeners = { keydown: [] };
globalThis.window = {
  localStorage: fakeStorage,
  __ModuleLoader__: { load(definition) { globalThis.__companion = definition; } },
  addEventListener: (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  },
  removeEventListener: () => {},
};
// The panel polls on an interval; a test must not keep the process alive.
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
  activeElement: null,
};

await import(pathToFileURL(clientFile).href);

/* ---------------------------------------------------------------- harness */

const slots = {};
const ctx = {
  effect(fn) {
    const dispose = fn();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  locale: {
    register() {
      return () => {};
    },
    bind() {
      return (key) => (globalThis.__dict && globalThis.__dict[key]) || key;
    },
  },
  slots: {
    inject(name, fn) {
      fn();
    },
    register(config, component) {
      slots[config.name] = component;
      return () => {};
    },
  },
};

const plugin = globalThis.__companion.factory((name) => {
  assert.equal(name, 'react');
  return React;
});
assert.ok(plugin && typeof plugin.apply === 'function');
plugin.apply(ctx);

assert.ok(slots['conversation.input.left'], 'the trigger registers into the composer');
assert.ok(slots['shell.overlay'], 'the panel registers into the overlay');

/* Language: the plugin's own Chinese dictionary, captured from the module. */
const dictMatch = /zh:\s*\{([\s\S]*?)\n      \},/.exec(clientSource);
assert.ok(dictMatch, 'the Chinese dictionary is present');
globalThis.__dict = new Function('"use strict"; return {' + dictMatch[1] + '};')();

/* ------------------------------------------------------------------ walk */

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

/**
 * Our fake renderer stores a component as an element whose `type` is the
 * function; React would call it. Resolving here keeps the assertions honest:
 * text inside <Markdown> is really produced by the markdown renderer.
 */
function resolve(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(resolve);
  if (typeof node.type === 'function') return resolve(node.type(node.props));
  return { type: node.type, props: node.props || {}, children: (node.children || []).map(resolve) };
}

function textOfTree(node) {
  const pieces = [];
  (function collect(current) {
    if (current === null || current === undefined || typeof current === 'boolean') return;
    if (typeof current === 'string' || typeof current === 'number') {
      pieces.push(String(current));
      return;
    }
    for (const child of current.children || []) collect(child);
  })(resolve(node));
  return pieces.join('|');
}

function findByClass(node, className) {
  let found = null;
  walk(resolve(node), (current) => {
    if (!found && current.props && String(current.props.className || '').split(' ').indexOf(className) >= 0) {
      found = current;
    }
  });
  return found;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('ok  ' + name);
}

const session = { sessionId: 'session-live' };

function openPanel() {
  const trigger = slots['conversation.input.left'](session);
  trigger.props.onClick();
  return trigger;
}

function closePanel() {
  const trigger = slots['conversation.input.left'](session);
  trigger.props.onClick();
}

await check('opening the panel asks once, with no chat bubble and no question typed', async () => {
  openPanel();
  await tick();
  await tick();

  assert.equal(calls.ask, 1, 'the overview is one automatic model call');

  const panel = slots['shell.overlay']({});
  const text = textOfTree(panel);
  assert.ok(text.includes('现在的情况'), 'the overview card is rendered');
  assert.ok(text.includes('它在跑一轮自测'), 'the streamed answer lands in the card');
  assert.equal(findByClass(panel, 'sc-user'), null, 'no user message was fabricated');
  assert.ok(findByClass(panel, 'sc-ov-btn'), 'the refresh control exists');
});

await check('a fresh summary is reused instead of calling the model again', async () => {
  closePanel();
  await tick();
  openPanel();
  await tick();
  await tick();
  assert.equal(calls.ask, 1, 'no second call inside the reuse window');
});

await check('one click on the refresh control writes a new summary', async () => {
  const panel = slots['shell.overlay']({});
  const button = findByClass(panel, 'sc-ov-btn');
  button.props.onClick();
  await tick();
  await tick();
  assert.equal(calls.ask, 2, 'refresh is a second call');
});

await check('a session that moved on gets a new summary on the next open', async () => {
  closePanel();
  await tick();
  statusReply = 'advanced';
  openPanel();
  await tick();
  await tick();
  assert.equal(calls.ask, 3, 'a new step invalidates the cached summary');
  statusReply = 'live';
});

await check('a session that is not live is not asked at all', async () => {
  const before = calls.ask;
  closePanel();
  await tick();
  statusReply = 'gone';
  openPanel();
  await tick();
  await tick();
  assert.equal(calls.ask, before, 'no model call for a dead session');
  const panel = slots['shell.overlay']({});
  assert.ok(textOfTree(panel).includes('这个会话已经不在当前进程里运行了'), 'the panel explains why');
  statusReply = 'live';
});

console.log('\n' + passed + ' checks passed');
