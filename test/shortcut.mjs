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

console.log('\n' + passed + ' checks passed');
