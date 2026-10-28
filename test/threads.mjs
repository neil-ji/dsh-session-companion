/**
 * Offline self-test for per-Session thread persistence.
 *
 * The helpers live inside the browser bundle, so this harness extracts the
 * delimited region and drives them with a fake Storage.
 *
 *   node test/threads.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');
const start = source.indexOf('//#region threads');
const end = source.indexOf('//#endregion threads');
assert.ok(start > 0 && end > start, 'threads region markers are present');

const region = source.slice(start, end);
const factory = new Function(
  region + '\nreturn { pruneThread, readThreads, writeThreads, THREAD_KEY, THREAD_MAX_MESSAGES, THREAD_MAX_CHARS };',
);
const { pruneThread, readThreads, writeThreads, THREAD_KEY, THREAD_MAX_MESSAGES, THREAD_MAX_CHARS } = factory();

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    map,
  };
}

check('only user and assistant messages survive pruning', () => {
  const kept = pruneThread([
    { role: 'user', text: '问' },
    { role: 'error', text: '错了' },
    { role: 'assistant', text: '答' },
    { role: 'assistant', text: '' },
    null,
    'nope',
  ]);
  assert.deepEqual(kept, [
    { role: 'user', text: '问' },
    { role: 'assistant', text: '答' },
  ]);
});

check('long messages are clipped, not dropped', () => {
  const kept = pruneThread([{ role: 'assistant', text: 'x'.repeat(THREAD_MAX_CHARS + 500) }]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].text.length, THREAD_MAX_CHARS);
});

check('the oldest messages fall off past the cap', () => {
  const many = [];
  for (let i = 0; i < THREAD_MAX_MESSAGES + 10; i += 1) {
    many.push({ role: i % 2 ? 'assistant' : 'user', text: 'm' + i });
  }
  const kept = pruneThread(many);
  assert.equal(kept.length, THREAD_MAX_MESSAGES);
  assert.equal(kept[kept.length - 1].text, 'm' + (THREAD_MAX_MESSAGES + 9));
  assert.equal(kept[0].text, 'm' + 10);
});

check('a thread round-trips through storage', () => {
  const storage = fakeStorage();
  const threads = { 'session-a': [{ role: 'user', text: 'hi' }] };
  assert.equal(writeThreads(storage, threads), true);
  assert.deepEqual(readThreads(storage), threads);
  assert.equal(storage.map.get(THREAD_KEY).includes('session-a'), true);
});

check('corrupt or foreign payloads degrade to empty', () => {
  assert.deepEqual(readThreads(fakeStorage({ [THREAD_KEY]: '{not json' })), {});
  assert.deepEqual(readThreads(fakeStorage({ [THREAD_KEY]: 'null' })), {});
  assert.deepEqual(readThreads(fakeStorage({ [THREAD_KEY]: '"string"' })), {});
  assert.deepEqual(readThreads(fakeStorage({ [THREAD_KEY]: '{"a":42}' })), {});
});

check('stored sessions are pruned on read', () => {
  const payload = JSON.stringify({ s1: [{ role: 'user', text: 'ok' }, { role: 'system', text: 'no' }], s2: [] });
  const threads = readThreads(fakeStorage({ [THREAD_KEY]: payload }));
  assert.deepEqual(threads, { s1: [{ role: 'user', text: 'ok' }] });
});

check('a storage that refuses writes reports failure instead of throwing', () => {
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(writeThreads(hostile, { a: [] }), false);
});

console.log('\n' + passed + ' checks passed');
