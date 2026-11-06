/**
 * Offline self-test for the global shortcut predicate and the tone plumbing.
 *
 *   node test/shortcut.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');
const start = clientSource.indexOf('//#region keys');
const end = clientSource.indexOf('//#endregion keys');
assert.ok(start > 0 && end > start, 'keys region markers are present');
const { isCompanionShortcut } = new Function(
  clientSource.slice(start, end) + '\nreturn { isCompanionShortcut };',
)();

const { _internals } = await import('../index.js');
const { buildSystemPrompt } = _internals;

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

const key = (over) => Object.assign({ code: 'Slash', key: '/', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, over);

check('ctrl+shift+slash toggles', () => {
  assert.equal(isCompanionShortcut(key({ ctrlKey: true, shiftKey: true })), true);
});

check('the shifted glyph still matches on other layouts', () => {
  assert.equal(isCompanionShortcut(key({ ctrlKey: true, shiftKey: true, code: '', key: '?' })), true);
});

check('a bare ctrl+/ is not enough', () => {
  assert.equal(isCompanionShortcut(key({ ctrlKey: true })), false);
});

check('extra modifiers are refused', () => {
  assert.equal(isCompanionShortcut(key({ ctrlKey: true, shiftKey: true, altKey: true })), false);
  assert.equal(isCompanionShortcut(key({ ctrlKey: true, shiftKey: true, metaKey: true })), false);
});

check('other keys and empty events are ignored', () => {
  assert.equal(isCompanionShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyA', key: 'A' })), false);
  assert.equal(isCompanionShortcut(null), false);
  assert.equal(isCompanionShortcut({}), false);
});

check('the plain tone is the default prompt', () => {
  const plain = buildSystemPrompt('plain');
  assert.equal(plain.includes('这次用户想要技术视角'), false);
  assert.equal(buildSystemPrompt(undefined), plain);
  assert.equal(buildSystemPrompt('nonsense'), plain);
});

check('the technical tone appends its register block', () => {
  const technical = buildSystemPrompt('technical');
  assert.equal(technical.startsWith(buildSystemPrompt('plain')), true);
  assert.equal(technical.includes('这次用户想要技术视角'), true);
  assert.equal(technical.includes('200 字'), true);
});

check('the automatic overview forbids advice', () => {
  const overview = buildSystemPrompt('plain', true);
  assert.equal(buildSystemPrompt('plain'), buildSystemPrompt('plain', false), 'off by default');
  assert.equal(overview.startsWith(buildSystemPrompt('plain')), true);
  assert.equal(overview.includes('这一次只要现状，不要建议'), true);
  assert.equal(overview.includes('不出现“你可以/建议/先别/应该/不妨/记得/最好”这类话'), true);
});

check('the base prompt only offers a judgement when asked for one', () => {
  const plain = buildSystemPrompt('plain');
  assert.equal(plain.includes('最多再来一句提醒'), false, 'no unsolicited closing reminder');
  assert.equal(plain.includes('用户问的是判断'), true);
});

check('overview mode keeps the technical block but still ends with the ban', () => {
  const both = buildSystemPrompt('technical', true);
  assert.equal(both.indexOf('这次用户想要技术视角') < both.indexOf('这一次只要现状'), true);
});

console.log('\n' + passed + ' checks passed');
