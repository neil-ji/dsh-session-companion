/**
 * Offline self-test for the overview cache: which Session state a summary
 * describes, when it is stale, and when it may be reused instead of spending
 * another model call.
 *
 * The helpers live inside the browser bundle, so this harness extracts the
 * delimited region and drives it with plain objects.
 *
 *   node test/overview.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');
const start = source.indexOf('//#region overview');
const end = source.indexOf('//#endregion overview');
assert.ok(start > 0 && end > start, 'overview region markers are present');

const factory = new Function(
  source.slice(start, end) +
    '\nreturn { OVERVIEW_TTL_MS, overviewKey, isOverviewStale, canReuseOverview, clockOf, plainStatus };',
);
const { OVERVIEW_TTL_MS, overviewKey, isOverviewStale, canReuseOverview, clockOf, plainStatus } = factory();

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

const status = (over) =>
  Object.assign({ running: true, phase: '第2轮 第3步', progress: { turn: 2, step: 3 } }, over || {});
const view = (over) =>
  Object.assign({ sessionId: 's1', key: overviewKey(status()), text: '它在跑测试。', at: Date.now(), streaming: false, error: '' }, over || {});

check('the key changes with turn, step, running state and phase', () => {
  assert.equal(overviewKey(status()), 'run|2|3|第2轮 第3步');
  assert.notEqual(overviewKey(status({ progress: { turn: 2, step: 4 } })), overviewKey(status()));
  assert.notEqual(overviewKey(status({ running: false })), overviewKey(status()));
  assert.equal(overviewKey(null), '');
});

check('an unchanged state is not stale', () => {
  assert.equal(isOverviewStale(view(), status()), false);
});

check('a new step marks the summary stale', () => {
  assert.equal(isOverviewStale(view(), status({ progress: { turn: 2, step: 4 } })), true);
});

check('nothing is stale while streaming, empty, failed or without status', () => {
  assert.equal(isOverviewStale(view({ streaming: true }), status({ progress: { turn: 9, step: 9 } })), false);
  assert.equal(isOverviewStale(view({ text: '' }), status({ progress: { turn: 9, step: 9 } })), false);
  assert.equal(isOverviewStale(view({ error: 'boom' }), status({ progress: { turn: 9, step: 9 } })), false);
  assert.equal(isOverviewStale(view(), null), false);
  assert.equal(isOverviewStale(null, status()), false);
});

check('a fresh summary for the same state is reused', () => {
  const now = Date.now();
  assert.equal(canReuseOverview(view({ at: now - 1000 }), 's1', status(), now), true);
});

check('a stale, old, other-session or failed summary is not reused', () => {
  const now = Date.now();
  assert.equal(canReuseOverview(view({ at: now - 1000 }), 's2', status(), now), false, 'other session');
  assert.equal(canReuseOverview(view({ at: now - OVERVIEW_TTL_MS - 1 }), 's1', status(), now), false, 'expired');
  assert.equal(
    canReuseOverview(view({ at: now - 1000 }), 's1', status({ progress: { turn: 3, step: 1 } }), now),
    false,
    'moved on',
  );
  assert.equal(canReuseOverview(view({ at: now, error: 'x' }), 's1', status(), now), false, 'failed');
  assert.equal(canReuseOverview(view({ at: now, streaming: true }), 's1', status(), now), false, 'streaming');
  assert.equal(canReuseOverview(null, 's1', status(), now), false, 'none yet');
});

check('the timestamp is HH:MM', () => {
  const date = new Date(2026, 10, 7, 9, 5, 0);
  assert.equal(clockOf(date.getTime()), '09:05');
  assert.match(clockOf(undefined), /^\d{2}:\d{2}$/);
});

check('the status line drops the markdown the model left in it', () => {
  assert.equal(plainStatus('改好了。核心变化：**这个插件**现在是 `概况`'), '改好了。核心变化：这个插件现在是 概况');
  assert.equal(plainStatus('  a \n b  '), 'a b');
  assert.equal(plainStatus(null), '');
  assert.equal(plainStatus(undefined), '');
});

console.log('\n' + passed + ' checks passed');
