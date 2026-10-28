/**
 * Development harness: renders the panel's stylesheet outside the app so the
 * layout and every palette can be inspected in a headless browser.
 *
 *   node test/preview.mjs        # writes test/preview-<palette>.html
 *
 * Not part of the plugin contract.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8');

export const PALETTES = ['aurora', 'mist', 'celadon', 'paper', 'blush', 'glass'];

function extractArray(name) {
  const marker = 'const ' + name + ' = [';
  const start = clientSource.indexOf(marker);
  if (start < 0) throw new Error('missing array ' + name);
  const bodyStart = start + marker.length;
  const end = clientSource.indexOf('].join', bodyStart);
  if (end < 0) throw new Error('unterminated array ' + name);
  // eslint-disable-next-line no-eval
  const parts = eval('[' + clientSource.slice(bodyStart, end) + ']');
  return parts.join('\n');
}

const pluginCss = (extractArray('CSS') + '\n' + extractArray('REFINED_CSS') + '\n' + extractArray('PALETTE_CSS')).replace(
  /body\[data-ds-dark-theme\]/g,
  '[data-ds-dark-theme]',
);

const TOKENS = `
:root{
  --dsw-alias-bg-base:#ffffff;
  --dsw-alias-bg-layer-1:#f7f8fa;
  --dsw-alias-bg-layer-2:#eef0f4;
  --dsw-alias-bg-overlay:#f4f5f8;
  --dsw-alias-border-l1:rgba(15,23,42,.10);
  --dsw-alias-border-l2:rgba(15,23,42,.18);
  --dsw-alias-brand-primary:#4d6bfe;
  --dsw-alias-label-primary:#1a1c22;
  --dsw-alias-label-secondary:#6b7280;
  --dsw-alias-state-error-primary:#d64545;
  --dsw-alias-state-idle-primary:#9aa3b2;
  --dsw-alias-state-success-primary:#2ea043;
  --dsw-alias-state-warn-primary:#c9821b;
}
body[data-ds-dark-theme]{
  --dsw-alias-bg-base:#16181d;
  --dsw-alias-bg-layer-1:#1c1f26;
  --dsw-alias-bg-layer-2:#232733;
  --dsw-alias-bg-overlay:#1e2128;
  --dsw-alias-border-l1:rgba(255,255,255,.10);
  --dsw-alias-border-l2:rgba(255,255,255,.18);
  --dsw-alias-brand-primary:#6b8bff;
  --dsw-alias-label-primary:#e8eaf0;
  --dsw-alias-label-secondary:#9aa1b1;
}
html,body{margin:0;padding:0;height:100%;}
body{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}
.stage{position:relative;width:100vw;height:100vh;overflow:hidden;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#f2f5fa 0%,#fafbfd 55%,#f5f7fb 100%);}
.stage.dark{background:linear-gradient(160deg,#0e1015 0%,#14161c 55%,#101218 100%);}
/* the real surface is fixed to the viewport corner; the harness centers it */
.stage .sc-panel{position:relative!important;right:auto!important;bottom:auto!important;max-height:none!important;}
`;

const HEAD = (dark) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>companion preview</title>
<style>${TOKENS}${pluginCss}</style>
</head><body${dark ? ' data-ds-dark-theme="1"' : ''}>
<div class="stage${dark ? ' dark' : ''}">`;

const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const SEND_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3.6M8 3.6L4 7.6M8 3.6l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TRASH_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.8 4.6h10.4M6.3 4.6V3h3.4v1.6M4.3 4.6l.7 8.4h6L11.7 4.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const THEMES = ['aurora', 'mist', 'celadon', 'paper', 'blush', 'glass'];
const THEME_LABELS = {
  aurora: '极光',
  mist: '雾蓝',
  celadon: '青瓷',
  paper: '宣纸',
  blush: '藕粉',
  glass: '玻璃白',
};

const PROGRESS_NORMAL = `<div class="sc-progress"><span class="sc-pitem">待办 6/9</span><span class="sc-pitem"><span class="sc-psep">·</span>4 个文件</span><span class="sc-pitem"><span class="sc-psep">·</span>48.3k tok</span><span class="sc-pitem"><span class="sc-psep">·</span>已跑 12 分</span></div>`;
const PROGRESS_STALL = `<div class="sc-progress is-warn"><span class="sc-pitem sc-pwarn">可能卡住了</span><span class="sc-psep">·</span><span class="sc-pitem">连续 3 次工具调用失败</span></div>`;

function head(live, theme, picker, progress, clearState) {
  const dotClass = 'sc-dot' + (live ? ' is-live' : '') + (progress === 'stall' ? ' is-warn' : '');
  const progressHtml = progress === 'stall' ? PROGRESS_STALL : progress === 'normal' ? PROGRESS_NORMAL : '';
  const clearHtml =
    clearState === 'armed'
      ? '<button type="button" class="sc-clear is-armed" aria-label="确认清空？">确认清空？</button>'
      : '<button type="button" class="sc-clear" aria-label="清空本会话的问答记录">' + TRASH_ICON + '</button>';
  return `<div class="sc-head">
  <div class="sc-head-row">
    <span class="${dotClass}"></span>
    <div class="sc-title">随行问答</div>
    <span class="sc-spacer"></span>
    <span class="sc-badge">${live ? '运行中' : '空闲'}</span>
    ${clearHtml}
    <button type="button" class="sc-theme-btn${picker ? ' is-open' : ''}" aria-label="切换材质"><i></i></button>
    <button type="button" class="sc-close" aria-label="关闭">${CLOSE_ICON}</button>
  </div>
  <div class="sc-activity">
    <span class="sc-phase">第3轮 第33步</span>
    <span class="sc-act">正在执行 pwsh</span>
  </div>
  ${progressHtml}
  ${
    picker
      ? `<div class="sc-theme-row">${THEMES.map(
          (key) =>
            `<button type="button" class="sc-swatch${key === theme ? ' is-active' : ''}" data-palette="${key}" title="${THEME_LABELS[key]}"></button>`,
        ).join('')}<span class="sc-theme-name">${THEME_LABELS[theme]}</span></div>`
      : ''
  }
</div>`;
}

function foot(value) {
  return `<div class="sc-foot">
  <div class="sc-inputwrap">
    <textarea class="sc-input" rows="1" placeholder="问问它现在在干嘛…" aria-label="提问">${value}</textarea>
    <button type="button" class="sc-send"${value ? '' : ' disabled'} aria-label="发送">${SEND_ICON}</button>
  </div>
    <div class="sc-meta"><span class="sc-meta-left"><button type="button" class="sc-tone">说人话</button><span class="sc-model">deepseek-v4.1-flash</span></span><span>只读 · 不打扰主 Agent</span></div>
</div>`;
}

const SUGGEST_BLOCK = `<div class="sc-suggest">
    <div class="sc-suggest-head">建议这样回复</div>
    <div class="sc-suggest-body">先别继续改样式了，跑一遍 lint 看看语法有没有问题。</div>
    <div class="sc-suggest-foot"><button type="button" class="sc-suggest-btn">填入输入框</button><span class="sc-suggest-hint">只填进输入框，发不发由你决定。</span></div>
  </div>`;

const CHAT_BODY = `<div class="sc-body"><div class="sc-list">
  <div class="sc-user">现在在干什么？</div>
  <div class="sc-bot"><div class="sc-md"><p>它在给「随行问答」换视觉基调，顺手把配色做成了可切换的调色板。现在你看到的是其中一套。<span class="sc-caret"></span></p></div></div>
  <div class="sc-user">我该不该打断它？</div>
  <div class="sc-bot"><div class="sc-md"><p>它已经连着两次改同一个文件，可以先让它自查一轮。</p>${SUGGEST_BLOCK}</div></div>
</div></div>`;

const EMPTY_BODY = `<div class="sc-body"><div class="sc-list">
  <div class="sc-intro">一个只读当前会话的独立小助手：没有工具、改不了任何东西，也不会打扰正在干活的 Agent。</div>
  <div class="sc-chips">
    <button class="sc-chip">现在在干什么？</button>
    <button class="sc-chip">卡在哪一步了？</button>
    <button class="sc-chip">它在想什么？说人话</button>
    <button class="sc-chip">到现在改了哪些文件？</button>
  </div>
</div></div>`;

function page(options) {
  const { dark, body, live, value, palette, picker, progress, clearState } = options;
  return (
    HEAD(dark) +
    `<div class="sc-panel" role="dialog" aria-label="随行问答" data-palette="${palette}">` +
    head(live, palette, !!picker, progress, clearState) +
    body +
    foot(value) +
    `</div></div></body></html>`
  );
}

let written = 0;
for (const palette of PALETTES) {
  // A typed draft keeps the send button in its enabled (accent) state so the
  // palette's strongest color is actually visible.
  const html = page({ dark: false, body: CHAT_BODY, live: true, value: '下一步呢？', palette });
  fs.writeFileSync(path.join(here, 'preview-' + palette + '.html'), html, 'utf8');
  written += 1;
  const darkHtml = page({ dark: true, body: CHAT_BODY, live: true, value: '下一步呢？', palette });
  fs.writeFileSync(path.join(here, 'preview-' + palette + '-dark.html'), darkHtml, 'utf8');
  written += 1;
}
fs.writeFileSync(
  path.join(here, 'preview-picker.html'),
  page({ dark: false, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', picker: true }),
  'utf8',
);
fs.writeFileSync(
  path.join(here, 'preview-picker-dark.html'),
  page({ dark: true, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', picker: true }),
  'utf8',
);
written += 2;
fs.writeFileSync(
  path.join(here, 'preview-progress.html'),
  page({ dark: false, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', progress: 'normal' }),
  'utf8',
);
fs.writeFileSync(
  path.join(here, 'preview-progress-dark.html'),
  page({ dark: true, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', progress: 'normal' }),
  'utf8',
);
fs.writeFileSync(
  path.join(here, 'preview-stall.html'),
  page({ dark: false, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', progress: 'stall' }),
  'utf8',
);
written += 3;
fs.writeFileSync(
  path.join(here, 'preview-clear.html'),
  page({ dark: false, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', progress: 'normal', clearState: 'idle' }),
  'utf8',
);
fs.writeFileSync(
  path.join(here, 'preview-clear-armed.html'),
  page({ dark: false, body: CHAT_BODY, live: true, value: '下一步呢？', palette: 'aurora', progress: 'normal', clearState: 'armed' }),
  'utf8',
);
written += 2;
fs.writeFileSync(path.join(here, 'preview-aurora-empty.html'), page({ dark: false, body: EMPTY_BODY, live: false, value: '', palette: 'aurora' }), 'utf8');
written += 1;

console.log('wrote ' + written + ' preview pages; css bytes = ' + pluginCss.length);
