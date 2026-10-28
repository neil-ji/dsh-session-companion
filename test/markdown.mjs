/**
 * Offline self-test for the panel's Markdown renderer.
 *
 * The parser lives inside the browser bundle, so this harness extracts the
 * delimited region and evaluates it in isolation. The React rendering layer is
 * a straight map from these tokens, so token-level checks cover it.
 *
 *   node test/markdown.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');
const start = source.indexOf('//#region markdown');
const end = source.indexOf('//#endregion markdown');
assert.ok(start > 0 && end > start, 'markdown region markers are present');

const region = source.slice(start, end);
const factory = new Function(region + '\nreturn { parseInline: parseInline, parseMarkdown: parseMarkdown };');
const { parseInline, parseMarkdown } = factory();

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok  ' + name);
}

const kinds = (blocks) => blocks.map((b) => b.type);

check('paragraph keeps plain text', () => {
  const blocks = parseMarkdown('它在看登录页。\n第二行。');
  assert.deepEqual(kinds(blocks), ['p']);
  assert.deepEqual(blocks[0].inlines, [{ type: 'text', value: '它在看登录页。\n第二行。' }]);
});

check('inline emphasis, code and strike become tokens', () => {
  const inlines = parseInline('它在 **收尾**，用了 `read` 和 ~~旧方案~~。');
  assert.deepEqual(
    inlines.map((t) => t.type),
    ['text', 'strong', 'text', 'code', 'text', 'del', 'text'],
  );
  assert.equal(inlines[1].value, '收尾');
  assert.equal(inlines[3].value, 'read');
});

check('single asterisk is emphasis, not strong', () => {
  const inlines = parseInline('a *b* c');
  assert.deepEqual(
    inlines.map((t) => t.type),
    ['text', 'em', 'text'],
  );
  assert.equal(inlines[1].value, 'b');
});

check('unclosed markers stay literal while streaming', () => {
  const inlines = parseInline('结论：**它在');
  assert.deepEqual(inlines, [{ type: 'text', value: '结论：**它在' }]);
});

check('only http and root-relative links become anchors', () => {
  const ok = parseInline('看[这里](https://example.com/a)');
  assert.equal(ok[1].type, 'link');
  assert.equal(ok[1].href, 'https://example.com/a');

  const rel = parseInline('看[这里](/session-companion/status)');
  assert.equal(rel[1].type, 'link');

  const bad = parseInline('看[这里](javascript:alert(1))');
  assert.equal(bad.every((t) => t.type !== 'link'), true, 'javascript: is not a link');
});

check('bullet and numbered lists parse with their own markers', () => {
  const bullet = parseMarkdown('- 第一条\n- 第二条');
  assert.deepEqual(kinds(bullet), ['list']);
  assert.equal(bullet[0].ordered, false);
  assert.equal(bullet[0].items.length, 2);

  const numbered = parseMarkdown('1. 先编译\n2. 再自测');
  assert.equal(numbered[0].ordered, true);
  assert.equal(numbered[0].items[1][0].value, '再自测');
});

check('a hyphen list is not mistaken for a horizontal rule', () => {
  assert.deepEqual(kinds(parseMarkdown('- **x** 一条')), ['list']);
  assert.deepEqual(kinds(parseMarkdown('---')), ['hr']);
});

check('fenced code keeps blank lines and is not parsed inline', () => {
  const blocks = parseMarkdown('前\n```js\nconst a = 1;\n\n**not bold**\n```\n后');
  assert.deepEqual(kinds(blocks), ['p', 'code', 'p']);
  assert.equal(blocks[1].code, 'const a = 1;\n\n**not bold**');
  assert.equal(blocks[1].lang, 'js');
});

check('an unterminated fence still renders as code (streaming)', () => {
  const blocks = parseMarkdown('看：\n```\nconst a = 1;');
  assert.deepEqual(kinds(blocks), ['p', 'code']);
  assert.equal(blocks[1].code, 'const a = 1;');
});

check('the reply fence keeps its language tag for the draft card', () => {
  const blocks = parseMarkdown('可以这样回它：\n```reply\n先跑一遍 lint 再改样式。\n```');
  assert.deepEqual(kinds(blocks), ['p', 'code']);
  assert.equal(blocks[1].lang, 'reply');
  assert.equal(blocks[1].code, '先跑一遍 lint 再改样式。');
});

check('headings map onto the small type scale', () => {
  const blocks = parseMarkdown('## 进展\n### 细节');
  assert.deepEqual(kinds(blocks), ['h', 'h']);
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[1].level, 3);
});

check('blockquotes collect their consecutive lines', () => {
  const blocks = parseMarkdown('> 第一行\n> 第二行');
  assert.deepEqual(kinds(blocks), ['quote']);
  assert.equal(blocks[0].inlines[0].value, '第一行\n第二行');
});

check('indented continuation joins the previous list item', () => {
  const blocks = parseMarkdown('- 第一条\n  补充说明\n- 第二条');
  assert.equal(blocks[0].items.length, 2);
  assert.equal(
    blocks[0].items[0].map((t) => t.value).join(''),
    '第一条补充说明'.replace('第一条', '第一条 '),
  );
});

check('angle brackets stay text, never markup', () => {
  const blocks = parseMarkdown('<script>alert(1)</script>');
  assert.equal(blocks[0].inlines[0].value, '<script>alert(1)</script>');
});

check('an empty answer yields no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
});

console.log('\n' + passed + ' checks passed');
