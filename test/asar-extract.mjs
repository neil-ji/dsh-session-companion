/**
 * Extract one file out of an Electron `app.asar` archive.
 *
 *   node test/asar-extract.mjs <archive> <inner/path> <destination>
 *
 * The archive is a Chromium pickle: an 8-byte prologue, a JSON directory, then
 * the concatenated file bodies. Only used when a shipped bundle must be read
 * from disk; nothing here is part of the plugin.
 */

import fs from 'node:fs';

const [archivePath, innerPath, destination] = process.argv.slice(2);
if (!archivePath || !innerPath || !destination) {
  console.error('usage: asar-extract.mjs <archive> <inner/path> <destination>');
  process.exit(2);
}

const fd = fs.openSync(archivePath, 'r');
const prologue = Buffer.alloc(8);
fs.readSync(fd, prologue, 0, 8, 0);
const headerBlockSize = prologue.readUInt32LE(4);
const headerBlock = Buffer.alloc(headerBlockSize);
fs.readSync(fd, headerBlock, 0, headerBlockSize, 8);

// The header string sits inside a pickle, so locate the JSON object itself and
// cut it out by brace matching instead of trusting the surrounding framing.
const text = headerBlock.toString('utf8');
const start = text.indexOf('{"files"');
if (start < 0) {
  console.error('no directory header found');
  process.exit(1);
}
let depth = 0;
let inString = false;
let escaped = false;
let end = -1;
for (let i = start; i < text.length; i += 1) {
  const ch = text[i];
  if (inString) {
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === '"') inString = false;
    continue;
  }
  if (ch === '"') inString = true;
  else if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
if (end < 0) {
  console.error('unterminated directory header');
  process.exit(1);
}
const header = JSON.parse(text.slice(start, end));
const baseOffset = 8 + headerBlockSize;

function find(node, parts) {
  if (!parts.length) return node;
  const [head, ...rest] = parts;
  if (!node || !node.files || !node.files[head]) return null;
  return find(node.files[head], rest);
}

const entry = find(header, innerPath.split('/'));
if (!entry || typeof entry.offset !== 'string') {
  console.error('not found: ' + innerPath);
  process.exit(1);
}

const size = Number(entry.size);
const buffer = Buffer.alloc(size);
fs.readSync(fd, buffer, 0, size, baseOffset + Number(entry.offset));
fs.closeSync(fd);
fs.writeFileSync(destination, buffer);
console.log('extracted ' + innerPath + ' -> ' + destination + ' (' + size + ' bytes)');
