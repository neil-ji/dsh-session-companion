/**
 * Offline self-test for the SSE answer stream that both the follow-up chat and
 * the automatic overview ride on.
 *
 * The function lives inside the browser bundle, so this harness extracts the
 * delimited region and hands it a fake `fetch`. Frames are deliberately split
 * across chunk boundaries: a model answer is a stream, not a document.
 *
 *   node test/stream.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');
const start = source.indexOf('//#region stream');
const end = source.indexOf('//#endregion stream');
assert.ok(start > 0 && end > start, 'stream region markers are present');

const make = new Function(
  'store',
  'buildHistory',
  'ROUTE',
  'fetch',
  source.slice(start, end) + '\nreturn requestStream;',
);

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('ok  ' + name);
}

function sseResponse(events, chunkSize) {
  const text = events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('');
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: body };
}

function harness(responder) {
  const calls = [];
  const fetchFn = async function (url, init) {
    calls.push({ url, init });
    const value = await responder(url, init);
    return typeof value === 'function' ? value() : value;
  };
  const store = { sessionId: 'session-1', tone: 'plain' };
  return { stream: make(store, () => [{ q: 'q1', a: 'a1' }], '/session-companion', fetchFn), calls, store };
}

await check('deltas survive frames split across chunks, then resolve ok', async () => {
  const h = harness(() => sseResponse([{ t: 'start' }, { t: 'delta', text: '它' }, { t: 'delta', text: '在跑测试。' }, { t: 'done' }], 5));
  const deltas = [];
  const result = await h.stream('现在什么情况？', (t) => deltas.push(t), undefined, []);
  assert.deepEqual(deltas, ['它', '在跑测试。']);
  assert.deepEqual(result, { ok: true });
  const body = JSON.parse(h.calls[0].init.body);
  assert.equal(body.sessionId, 'session-1');
  assert.equal(body.question, '现在什么情况？');
  assert.deepEqual(body.history, [], 'the overview sends no chat history');
  assert.equal(body.tone, 'plain');
});

await check('omitted history falls back to the built transcript', async () => {
  const h = harness(() => sseResponse([{ t: 'delta', text: 'x' }, { t: 'done' }], 64));
  await h.stream('然后呢？', () => {}, undefined);
  assert.deepEqual(JSON.parse(h.calls[0].init.body).history, [{ q: 'q1', a: 'a1' }]);
});

await check('an in-stream error event becomes a failure, not an exception', async () => {
  const h = harness(() => sseResponse([{ t: 'delta', text: '半' }, { t: 'error', code: 'model-error', message: 'boom' }], 3));
  const result = await h.stream('在干嘛', () => {}, undefined, []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'model-error');
  assert.equal(result.message, 'boom');
});

await check('an HTTP refusal carries the Host error code', async () => {
  const h = harness(() => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'session-not-live' }) }));
  const result = await h.stream('在干嘛', () => {}, undefined, []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not-live');
});

await check('a response without a readable body is a failure, not a crash', async () => {
  const h = harness(() => ({ ok: true, status: 200, body: {} }));
  const result = await h.stream('在干嘛', () => {}, undefined, []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'request');
});

await check('a cancelled stream rejects with AbortError for the caller to ignore', async () => {
  const h = harness(
    () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        },
      }),
    }),
  );
  await assert.rejects(() => h.stream('在干嘛', () => {}, undefined, []), (error) => error.name === 'AbortError');
});

console.log('\n' + passed + ' checks passed');
