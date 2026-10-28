window.__ModuleLoader__.load({
  id: '@local/dsh-session-companion',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'sessionCompanion';
    const ROUTE = '/session-companion';
    const POLL_MS = 6000;
    const EMIT_MS = 45;

    /**
     * Materials ("themes"). Every hue lives in PALETTE_CSS; this table only
     * names them for the picker. The pick is stored per browser profile.
     */
    const THEMES = ['aurora', 'mist', 'celadon', 'paper', 'blush', 'glass'];
    const DEFAULT_THEME = 'aurora';
    const THEME_KEY = 'dsh-session-companion.theme';

    function readTheme() {
      try {
        const stored = window.localStorage.getItem(THEME_KEY);
        if (stored && THEMES.indexOf(stored) >= 0) return stored;
      } catch {
        /* storage can be unavailable; the default still applies */
      }
      return DEFAULT_THEME;
    }

    function writeTheme(value) {
      try {
        window.localStorage.setItem(THEME_KEY, value);
      } catch {
        /* ignore */
      }
    }

    const TONE_KEY = 'dsh-session-companion.tone';

    function readTone() {
      try {
        return window.localStorage.getItem(TONE_KEY) === 'technical' ? 'technical' : 'plain';
      } catch {
        return 'plain';
      }
    }

    function writeTone(value) {
      try {
        window.localStorage.setItem(TONE_KEY, value);
      } catch {
        /* ignore */
      }
    }

    //#region keys
    /** Ctrl+Shift+/ — layout independent, and safe inside a text field. */
    function isCompanionShortcut(event) {
      if (!event || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return false;
      return event.code === 'Slash' || event.key === '/' || event.key === '?';
    }
    //#endregion keys

    //#region threads
    const THREAD_KEY = 'dsh-session-companion.threads.v1';
    const THREAD_MAX_MESSAGES = 30;
    const THREAD_MAX_CHARS = 2000;

    /** Keep a thread small enough for localStorage and cheap to re-render. */
    function pruneThread(messages) {
      const kept = [];
      for (const message of messages) {
        if (!message || typeof message !== 'object') continue;
        if (message.role !== 'user' && message.role !== 'assistant') continue;
        const text = String(message.text || '').slice(0, THREAD_MAX_CHARS);
        if (!text) continue;
        kept.push({ role: message.role, text: text });
      }
      return kept.slice(-THREAD_MAX_MESSAGES);
    }

    function readThreads(storage) {
      try {
        const raw = storage.getItem(THREAD_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        const threads = {};
        for (const key of Object.keys(parsed)) {
          if (!Array.isArray(parsed[key])) continue;
          const pruned = pruneThread(parsed[key]);
          if (pruned.length) threads[key] = pruned;
        }
        return threads;
      } catch {
        return {};
      }
    }

    function writeThreads(storage, threads) {
      try {
        storage.setItem(THREAD_KEY, JSON.stringify(threads));
        return true;
      } catch {
        // Quota or private mode: the thread simply stays in memory.
        return false;
      }
    }

    /**
     * Forget one Session's thread. The empty case removes the key entirely so
     * clearing really leaves nothing behind in storage.
     */
    function dropThread(storage, threads, sessionId) {
      delete threads[sessionId];
      if (Object.keys(threads).length === 0) {
        try {
          storage.removeItem(THREAD_KEY);
        } catch {
          // Some storages omit removeItem; an empty object still clears it.
          try {
            storage.setItem(THREAD_KEY, '{}');
          } catch {
            /* ignore */
          }
        }
        return threads;
      }
      writeThreads(storage, threads);
      return threads;
    }
    //#endregion threads

    const DICTS = {
      en: {
        trigger: 'Companion',
        title: 'Session companion',
        intro:
          'A separate little model that only reads this session. It has no tools, cannot change anything, and never interrupts the agent at work.',
        placeholder: 'What is it doing right now?',
        send: 'Send',
        stop: 'Stop',
        close: 'Close companion',
        running: 'Running',
        idle: 'Idle',
        thinking: 'Reading the session…',
        empty: 'Ask something about the work in progress.',
        notLive: 'This session is not running in this process any more, so there is nothing live to read.',
        failed: 'The companion could not answer',
        retry: 'Retry',
        jump: 'Jump to the latest answer',
        footNote: 'Read-only · the working agent is not disturbed',
        themePicker: 'Change material',
        progressTodos: 'todos',
        progressFiles: 'files',
        progressTokens: 'tok',
        elapsed: 'running for',
        unitMin: 'm',
        unitHour: 'h',
        stalled: 'may be stuck',
        suggestLabel: 'Suggested reply',
        suggestHint: 'Fills the composer. You still press Enter.',
        suggestFill: 'Put in composer',
        suggestDone: 'In composer ✓',
        suggestFailed: 'Could not fill',
        tonePlain: 'Plain',
        toneTechnical: 'Technical',
        toneHint: 'Switch how answers are written',
        clearHint: 'Clear this session\u2019s thread',
        clearConfirm: 'Clear?',
        theme_aurora: 'Aurora',
        theme_mist: 'Mist',
        theme_celadon: 'Celadon',
        theme_paper: 'Paper',
        theme_blush: 'Blush',
        theme_glass: 'Glass',
        q1: 'What is it doing right now?',
        q2: 'Which step is it stuck on?',
        q3: 'In plain Chinese, what is it thinking?',
        q4: 'What has it changed so far?',
      },
      zh: {
        trigger: '随行',
        title: '随行问答',
        intro: '一个只读当前会话的独立小助手：没有工具、改不了任何东西，也不会打扰正在干活的 Agent。',
        placeholder: '问问它现在在干嘛…',
        send: '发送',
        stop: '停止',
        close: '关闭随行问答',
        running: '运行中',
        idle: '空闲',
        thinking: '正在读取会话…',
        empty: '关于这次任务，你有什么想问的？',
        notLive: '这个会话已经不在当前进程里运行了，读不到实时日志。',
        failed: '随行助手没能回答',
        retry: '重试',
        jump: '跳到最新',
        footNote: '只读 · 不打扰主 Agent',
        themePicker: '切换材质',
        progressTodos: '待办',
        progressFiles: '个文件',
        progressTokens: 'tok',
        elapsed: '已跑',
        unitMin: ' 分',
        unitHour: ' 小时',
        stalled: '可能卡住了',
        suggestLabel: '建议这样回复',
        suggestHint: '只填进输入框，发不发由你决定。',
        suggestFill: '填入输入框',
        suggestDone: '已填入 ✓',
        suggestFailed: '填入失败',
        tonePlain: '说人话',
        toneTechnical: '技术细节',
        toneHint: '切换回答的语气（Ctrl+Shift+/ 开关面板）',
        clearHint: '清空本会话的问答记录',
        clearConfirm: '确认清空？',
        theme_aurora: '极光',
        theme_mist: '雾蓝',
        theme_celadon: '青瓷',
        theme_paper: '宣纸',
        theme_blush: '藕粉',
        theme_glass: '玻璃白',
        q1: '现在在干什么？',
        q2: '卡在哪一步了？',
        q3: '它在想什么？说人话',
        q4: '到现在改了哪些文件？',
      },
    };

    const CSS = [
      /* ---- panel shell -------------------------------------------------- */
      '.sc-panel{position:fixed;right:24px;bottom:96px;width:424px;max-width:calc(100vw - 32px);height:min(64vh,596px);min-height:340px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.24),0 2px 10px rgba(0,0,0,.10);pointer-events:auto;overflow:hidden;font-size:13px;line-height:1.62;z-index:2147483000;animation:sc-in .16s ease-out;}',
      '@keyframes sc-in{from{opacity:0;transform:translateY(6px) scale(.995)}to{opacity:1;transform:none}}',
      /* ---- header ------------------------------------------------------- */
      '.sc-head{padding:12px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);flex:none;}',
      '.sc-head-row{display:flex;align-items:center;gap:8px;}',
      '.sc-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none;}',
      '.sc-dot.is-live{background:var(--dsw-alias-state-success-primary);animation:sc-pulse 1.9s ease-out infinite;}',
      '@keyframes sc-pulse{0%{box-shadow:0 0 0 0 rgba(46,160,67,.42)}70%{box-shadow:0 0 0 7px rgba(46,160,67,0)}100%{box-shadow:0 0 0 0 rgba(46,160,67,0)}}',
      '.sc-title{font-size:13px;font-weight:600;letter-spacing:.01em;flex:none;}',
      '.sc-badge{font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 7px;flex:none;}',
      '.sc-spacer{flex:1;min-width:0;}',
      '.sc-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);width:24px;height:24px;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;padding:0;}',
      '.sc-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.sc-activity{display:flex;align-items:baseline;gap:7px;margin-top:5px;padding-left:15px;min-width:0;}',
      '.sc-phase{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums;}',
      '.sc-act{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}',
      /* ---- body --------------------------------------------------------- */
      '.sc-body{position:relative;flex:1;min-height:0;display:flex;}',
      '.sc-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;padding:14px 14px 16px;display:flex;flex-direction:column;gap:14px;}',
      '.sc-jump{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;height:24px;padding:0 10px 0 7px;border-radius:999px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.14);}',
      '.sc-jump:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}',
      /* ---- messages ----------------------------------------------------- */
      '.sc-user{align-self:flex-end;max-width:86%;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:14px 14px 5px 14px;padding:8px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;}',
      '.sc-bot{align-self:stretch;font-size:13.5px;line-height:1.74;overflow-wrap:anywhere;}',
      '.sc-caret{display:inline-block;width:5px;height:14px;margin-left:2px;vertical-align:-2px;border-radius:1px;background:var(--dsw-alias-brand-primary);animation:sc-blink 1s steps(2,start) infinite;}',
      '@keyframes sc-blink{50%{opacity:0}}',
      '.sc-typing{display:inline-flex;gap:4px;align-items:center;height:18px;}',
      '.sc-typing i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.4;animation:sc-bounce 1.15s infinite;}',
      '.sc-typing i:nth-child(2){animation-delay:.14s}.sc-typing i:nth-child(3){animation-delay:.28s}',
      '@keyframes sc-bounce{0%,62%,100%{transform:translateY(0);opacity:.32}28%{transform:translateY(-3px);opacity:.85}}',
      '.sc-error{align-self:stretch;border:1px solid var(--dsw-alias-state-error-primary);border-radius:10px;padding:9px 11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;display:flex;flex-direction:column;gap:6px;}',
      '.sc-error-title{color:var(--dsw-alias-state-error-primary);font-weight:600;font-size:12px;}',
      '.sc-error-detail{color:var(--dsw-alias-label-secondary);font-size:11.5px;overflow-wrap:anywhere;}',
      '.sc-retry{align-self:flex-start;appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;height:24px;padding:0 10px;border-radius:7px;cursor:pointer;}',
      '.sc-retry:hover{border-color:var(--dsw-alias-border-l2);}',
      /* ---- markdown ----------------------------------------------------- */
      '.sc-md p{margin:0 0 9px;white-space:pre-wrap;}',
      '.sc-md p:last-child{margin-bottom:0;}',
      '.sc-md h3,.sc-md h4{font-size:13px;font-weight:600;margin:12px 0 6px;line-height:1.5;}',
      '.sc-md h3:first-child,.sc-md h4:first-child{margin-top:0;}',
      '.sc-md ul,.sc-md ol{margin:0 0 9px;padding-left:18px;}',
      '.sc-md ul:last-child,.sc-md ol:last-child{margin-bottom:0;}',
      '.sc-md li{margin:2px 0;white-space:pre-wrap;}',
      '.sc-md strong{font-weight:600;}',
      '.sc-md em{font-style:italic;}',
      '.sc-md del{opacity:.65;}',
      '.sc-md a{color:var(--dsw-alias-brand-primary);text-decoration:none;border-bottom:1px solid var(--dsw-alias-border-l2);}',
      '.sc-md a:hover{border-bottom-color:var(--dsw-alias-brand-primary);}',
      '.sc-md blockquote{margin:0 0 9px;padding:1px 0 1px 10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}',
      '.sc-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:11px 0;}',
      '.sc-md pre{margin:0 0 9px;padding:9px 11px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.6;white-space:pre;}',
      '.sc-md code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.8px;}',
      '.sc-md :not(pre)>code{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:.5px 4px;}',
      /* ---- empty state --------------------------------------------------- */
      '.sc-intro{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;}',
      '.sc-chips{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;}',
      '.sc-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.45;padding:9px 10px;border-radius:10px;cursor:pointer;text-align:left;}',
      '.sc-chip:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}',
      '.sc-chip:disabled{opacity:.5;cursor:default;}',
      '.sc-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.65;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:9px 11px;}',
      /* ---- footer -------------------------------------------------------- */
      '.sc-foot{border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);padding:10px 12px 9px;display:flex;flex-direction:column;gap:7px;flex:none;}',
      '.sc-inputwrap{display:flex;align-items:flex-end;gap:8px;}',
      '.sc-input{flex:1;min-height:36px;max-height:116px;resize:none;box-sizing:border-box;font:inherit;font-size:13px;line-height:1.55;padding:8px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .12s ease;}',
      '.sc-input::placeholder{color:var(--dsw-alias-label-secondary);}',
      '.sc-input:focus{border-color:var(--dsw-alias-brand-primary);}',
      '.sc-send{appearance:none;border:0;width:34px;height:34px;border-radius:10px;background:var(--dsw-alias-brand-primary);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;transition:opacity .12s ease,transform .12s ease;padding:0;}',
      '.sc-send:hover:not(:disabled){transform:translateY(-1px);}',
      '.sc-send:disabled{opacity:.38;cursor:default;}',
      '.sc-send.sc-stop{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);}',
      '.sc-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10.5px;color:var(--dsw-alias-label-secondary);}',
      '.sc-meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      /* ---- trigger -------------------------------------------------------- */
      '.sc-trigger{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;height:26px;padding:0 8px 0 7px;border-radius:8px;display:inline-flex;align-items:center;gap:5px;cursor:pointer;transition:background .12s ease,color .12s ease;}',
      '.sc-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.sc-trigger.is-active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1);}',
      '.sc-trigger svg{display:block;flex:none;}',
      '.sc-tdot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:none;}',
      '.sc-tdot.is-live{background:var(--dsw-alias-state-success-primary);animation:sc-pulse 1.9s ease-out infinite;}',
      /* ---- shared states -------------------------------------------------- */
      '.sc-panel button:focus-visible,.sc-panel a:focus-visible,.sc-panel textarea:focus-visible,.sc-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '@media (prefers-reduced-motion:reduce){.sc-panel{animation:none}.sc-dot.is-live,.sc-tdot.is-live,.sc-caret,.sc-typing i{animation:none}.sc-list{scroll-behavior:auto}}',
    ].join('\n');

    /* ------------------------------------------------------------------ *
     * Visual pass 2 — "light as air".
     *
     * The token-only sheet could not express a surface that is lighter than
     * the host's own panels, so these rules lay a translucent, brand-tinted
     * glass over the content and split light/dark explicitly. The panel also
     * stops being a fixed-height grey slab: it is sized by its content and
     * only starts scrolling once it reaches the viewport cap.
     * ------------------------------------------------------------------ */

    const REFINED_CSS = [
      '.sc-panel{right:24px;bottom:96px;width:424px;max-width:calc(100vw - 32px);height:auto;min-height:0;max-height:min(66vh,612px);background:linear-gradient(168deg,rgba(255,255,255,.92) 0%,rgba(247,250,255,.80) 62%,rgba(250,247,255,.82) 100%);border:1px solid rgba(255,255,255,.85);border-radius:20px;box-shadow:0 0 0 1px rgba(77,107,254,.07),inset 0 1px 0 rgba(255,255,255,.95),0 34px 80px -28px rgba(31,45,92,.32),0 12px 30px -16px rgba(31,45,92,.18);-webkit-backdrop-filter:blur(30px) saturate(1.75);backdrop-filter:blur(30px) saturate(1.75);animation:sc-fade .18s cubic-bezier(.2,.8,.2,1);}',
      '@keyframes sc-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '.sc-panel::before{content:"";position:absolute;left:0;right:0;top:0;height:240px;background:linear-gradient(180deg,rgba(104,132,255,.17) 0%,rgba(104,132,255,.06) 46%,rgba(104,132,255,0) 100%);pointer-events:none;}',
      'body[data-ds-dark-theme] .sc-panel{background:linear-gradient(168deg,rgba(33,36,46,.92) 0%,rgba(22,24,31,.88) 60%,rgba(26,24,34,.90) 100%);border-color:rgba(255,255,255,.09);box-shadow:0 0 0 1px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06),0 34px 80px -28px rgba(0,0,0,.7),0 12px 30px -16px rgba(0,0,0,.5);}',
      'body[data-ds-dark-theme] .sc-panel::before{background:linear-gradient(180deg,rgba(112,142,255,.13) 0%,rgba(112,142,255,.045) 46%,rgba(112,142,255,0) 100%);}',
      '@supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))){.sc-panel{background:#fff}body[data-ds-dark-theme] .sc-panel{background:#1e2027}}',
      '.sc-head{padding:16px 18px 11px;background:transparent;border-bottom:0;position:relative;}',
      '.sc-head::after{content:"";position:absolute;left:18px;right:18px;bottom:0;height:1px;background:linear-gradient(90deg,rgba(15,23,42,0),rgba(15,23,42,.07) 20%,rgba(15,23,42,.07) 80%,rgba(15,23,42,0));}',
      'body[data-ds-dark-theme] .sc-head::after{background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.09) 20%,rgba(255,255,255,.09) 80%,rgba(255,255,255,0));}',
      '.sc-title{font-size:13.5px;}',
      '.sc-badge{border:0;background:transparent;padding:0;font-size:10.5px;letter-spacing:.03em;opacity:.9;}',
      '.sc-close{opacity:.55;transition:opacity .12s ease,background .12s ease;}',
      '.sc-panel:hover .sc-close{opacity:.85;}',
      '.sc-activity{padding-left:14px;margin-top:6px;}',
      '.sc-phase::after{content:"·";margin-left:6px;opacity:.45;}',
      '.sc-list{flex:1 1 auto;padding:18px 18px 20px;gap:18px;}',
      '.sc-body{flex:1 1 auto;}',
      '.sc-bot{font-size:13.5px;line-height:1.82;letter-spacing:.008em;color:var(--dsw-alias-label-primary);}',
      '.sc-user{background:rgba(104,132,255,.08);border:1px solid rgba(104,132,255,.13);box-shadow:0 1px 2px rgba(23,32,64,.04);}',
      'body[data-ds-dark-theme] .sc-user{background:rgba(112,142,255,.16);border-color:rgba(112,142,255,.24);}',
      '.sc-intro{font-size:12.5px;line-height:1.75;}',
      '.sc-chips{gap:9px;margin-top:14px;}',
      '.sc-chip{background:rgba(255,255,255,.72);border:1px solid rgba(15,23,42,.07);border-radius:12px;padding:10px 12px;transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease,background .14s ease;}',
      '.sc-chip:hover{transform:translateY(-1px);border-color:rgba(104,132,255,.35);background:rgba(255,255,255,.94);box-shadow:0 10px 24px -12px rgba(31,45,92,.35);}',
      'body[data-ds-dark-theme] .sc-chip{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.09);}',
      'body[data-ds-dark-theme] .sc-chip:hover{background:rgba(255,255,255,.09);border-color:rgba(112,142,255,.35);}',
      '.sc-md pre{background:rgba(15,23,42,.045);border-color:rgba(15,23,42,.07);border-radius:10px;}',
      'body[data-ds-dark-theme] .sc-md pre{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08);}',
      '.sc-md :not(pre)>code{background:rgba(15,23,42,.05);border-color:rgba(15,23,42,.06);}',
      'body[data-ds-dark-theme] .sc-md :not(pre)>code{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.09);}',
      '.sc-foot{background:transparent;border-top:0;padding:12px 18px 14px;position:relative;}',
      '.sc-foot::before{content:"";position:absolute;left:18px;right:18px;top:0;height:1px;background:linear-gradient(90deg,rgba(15,23,42,0),rgba(15,23,42,.07) 20%,rgba(15,23,42,.07) 80%,rgba(15,23,42,0));}',
      'body[data-ds-dark-theme] .sc-foot::before{background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.09) 20%,rgba(255,255,255,.09) 80%,rgba(255,255,255,0));}',
      '.sc-input{background:rgba(255,255,255,.72);border:1px solid rgba(15,23,42,.08);border-radius:12px;transition:border-color .14s ease,box-shadow .14s ease,background .14s ease;}',
      '.sc-input:focus{border-color:rgba(91,140,255,.55);box-shadow:0 0 0 3px rgba(91,140,255,.12);background:rgba(255,255,255,.92);}',
      'body[data-ds-dark-theme] .sc-input{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.10);}',
      'body[data-ds-dark-theme] .sc-input:focus{background:rgba(255,255,255,.09);border-color:rgba(120,158,255,.6);box-shadow:0 0 0 3px rgba(120,158,255,.15);}',
      '.sc-send{width:32px;height:32px;border-radius:50%;background-image:linear-gradient(140deg,rgba(255,255,255,.24),rgba(255,255,255,0) 58%);background-color:var(--dsw-alias-brand-primary);box-shadow:0 10px 22px -10px rgba(77,107,254,.85);transition:transform .14s ease,box-shadow .14s ease,background .14s ease,color .14s ease;}',
      '.sc-send:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 22px -8px rgba(91,140,255,.75);}',
      '.sc-send:disabled{background:transparent;border:1px solid rgba(15,23,42,.10);color:var(--dsw-alias-label-secondary);box-shadow:none;opacity:1;}',
      'body[data-ds-dark-theme] .sc-send:disabled{border-color:rgba(255,255,255,.12);}',
      '.sc-meta{font-size:10.5px;opacity:.9;padding:0 1px;}',
    ].join('\n');

    /* ------------------------------------------------------------------ *
     * Color layer — the only place a hue is decided.
     *
     * REFINED_CSS above owns geometry, typography and the neutral defaults;
     * these rules re-color the surface from two palette variables (--sc-accent,
     * --sc-glass-*) and derive the rest with color-mix, so adding a palette
     * means adding one block at the bottom.
     * ------------------------------------------------------------------ */

    const PALETTE_CSS = [
      '.sc-panel{--sc-ring:color-mix(in srgb,var(--sc-accent) 9%,transparent);--sc-user-bd:color-mix(in srgb,var(--sc-accent) 15%,transparent);--sc-hover-bd:color-mix(in srgb,var(--sc-accent) 34%,transparent);--sc-focus-bd:color-mix(in srgb,var(--sc-accent) 55%,transparent);--sc-focus-ring:color-mix(in srgb,var(--sc-accent) 13%,transparent);--sc-d-user-bd:color-mix(in srgb,var(--sc-d-accent) 26%,transparent);--sc-d-hover-bd:color-mix(in srgb,var(--sc-d-accent) 36%,transparent);--sc-d-focus-bd:color-mix(in srgb,var(--sc-d-accent) 60%,transparent);--sc-d-focus-ring:color-mix(in srgb,var(--sc-d-accent) 16%,transparent);}',
      '.sc-panel{background:linear-gradient(168deg,var(--sc-glass-1) 0%,var(--sc-glass-2) 62%,var(--sc-glass-3) 100%);border-color:var(--sc-edge);box-shadow:0 0 0 1px var(--sc-ring),inset 0 1px 0 rgba(255,255,255,.95),0 34px 80px -28px var(--sc-shadow),0 12px 30px -16px var(--sc-shadow-2);}',
      '.sc-panel::before{background:linear-gradient(180deg,var(--sc-wash) 0%,transparent 100%);}',
      '[data-ds-dark-theme] .sc-panel{background:linear-gradient(168deg,var(--sc-d-glass-1) 0%,var(--sc-d-glass-2) 60%,var(--sc-d-glass-3) 100%);border-color:var(--sc-d-edge);}',
      '[data-ds-dark-theme] .sc-panel::before{background:linear-gradient(180deg,var(--sc-d-wash) 0%,transparent 100%);}',
      '.sc-user{background:var(--sc-user);border-color:var(--sc-user-bd);}',
      '[data-ds-dark-theme] .sc-user{background:var(--sc-d-user);border-color:var(--sc-d-user-bd);}',
      '.sc-chip:hover{border-color:var(--sc-hover-bd);}',
      '[data-ds-dark-theme] .sc-chip:hover{border-color:var(--sc-d-hover-bd);}',
      '.sc-send{background-color:var(--sc-accent);box-shadow:0 10px 22px -10px var(--sc-accent-glow);}',
      '[data-ds-dark-theme] .sc-send{background-color:var(--sc-d-accent);box-shadow:0 10px 22px -10px var(--sc-d-accent-glow);}',
      '.sc-input:focus{border-color:var(--sc-focus-bd);box-shadow:0 0 0 3px var(--sc-focus-ring);}',
      '[data-ds-dark-theme] .sc-input:focus{border-color:var(--sc-d-focus-bd);box-shadow:0 0 0 3px var(--sc-d-focus-ring);}',

      /* 1 · 雾蓝 — pale blue sheet, steel accent */
      '[data-palette="mist"]{--sc-accent:#4a76a8;--sc-glass-1:rgba(249,252,255,.97);--sc-glass-2:rgba(238,245,253,.95);--sc-glass-3:rgba(240,246,254,.96);--sc-edge:rgba(255,255,255,.72);--sc-wash:rgba(96,150,210,.18);--sc-user:rgba(74,118,168,.11);--sc-shadow:rgba(28,44,70,.28);--sc-shadow-2:rgba(28,44,70,.15);--sc-accent-glow:rgba(74,118,168,.5);--sc-d-glass-1:rgba(28,33,41,.95);--sc-d-glass-2:rgba(21,26,33,.93);--sc-d-glass-3:rgba(24,29,37,.94);--sc-d-edge:rgba(255,255,255,.08);--sc-d-wash:rgba(120,160,210,.11);--sc-d-user:rgba(120,160,210,.16);--sc-d-accent:#86aede;--sc-d-accent-glow:rgba(134,174,222,.45);}',

      /* 2 · 青瓷 — pale jade sheet, tea calm */
      '[data-palette="celadon"]{--sc-accent:#3f8f7c;--sc-glass-1:rgba(250,254,252,.97);--sc-glass-2:rgba(240,249,245,.95);--sc-glass-3:rgba(242,250,246,.96);--sc-edge:rgba(255,255,255,.75);--sc-wash:rgba(80,170,145,.18);--sc-user:rgba(63,143,124,.11);--sc-shadow:rgba(28,58,50,.26);--sc-shadow-2:rgba(28,58,50,.14);--sc-accent-glow:rgba(63,143,124,.5);--sc-d-glass-1:rgba(26,36,33,.95);--sc-d-glass-2:rgba(20,29,27,.93);--sc-d-glass-3:rgba(22,31,29,.94);--sc-d-edge:rgba(255,255,255,.08);--sc-d-wash:rgba(90,180,155,.11);--sc-d-user:rgba(90,180,155,.16);--sc-d-accent:#6fc0a8;--sc-d-accent-glow:rgba(111,192,168,.45);}',

      /* 3 · 宣纸 — warm ivory, terracotta accent */
      '[data-palette="paper"]{--sc-accent:#b4653f;--sc-glass-1:rgba(255,252,246,.97);--sc-glass-2:rgba(252,246,236,.95);--sc-glass-3:rgba(250,244,234,.96);--sc-edge:rgba(255,255,255,.7);--sc-wash:rgba(214,150,110,.19);--sc-user:rgba(180,101,63,.10);--sc-shadow:rgba(74,52,34,.26);--sc-shadow-2:rgba(74,52,34,.14);--sc-accent-glow:rgba(180,101,63,.45);--sc-d-glass-1:rgba(38,34,30,.95);--sc-d-glass-2:rgba(30,27,24,.93);--sc-d-glass-3:rgba(33,30,26,.94);--sc-d-edge:rgba(255,255,255,.09);--sc-d-wash:rgba(214,160,120,.10);--sc-d-user:rgba(214,150,110,.16);--sc-d-accent:#d99a6c;--sc-d-accent-glow:rgba(217,154,108,.45);}',

      /* 4 · 藕粉 — soft rose sheet, mauve accent */
      '[data-palette="blush"]{--sc-accent:#b5637f;--sc-glass-1:rgba(255,250,252,.97);--sc-glass-2:rgba(253,242,246,.95);--sc-glass-3:rgba(252,244,247,.96);--sc-edge:rgba(255,255,255,.72);--sc-wash:rgba(214,130,160,.17);--sc-user:rgba(181,99,127,.11);--sc-shadow:rgba(72,34,46,.24);--sc-shadow-2:rgba(72,34,46,.13);--sc-accent-glow:rgba(181,99,127,.45);--sc-d-glass-1:rgba(38,31,34,.95);--sc-d-glass-2:rgba(30,24,27,.93);--sc-d-glass-3:rgba(33,26,30,.94);--sc-d-edge:rgba(255,255,255,.08);--sc-d-wash:rgba(220,150,175,.11);--sc-d-user:rgba(220,150,175,.16);--sc-d-accent:#e39bb2;--sc-d-accent-glow:rgba(227,155,178,.45);}',

      /* 5 · 玻璃白 — no hue, the most transparent of the set */
      '[data-palette="glass"]{--sc-accent:#5a6472;--sc-glass-1:rgba(255,255,255,.93);--sc-glass-2:rgba(250,251,253,.88);--sc-glass-3:rgba(249,250,252,.90);--sc-edge:rgba(255,255,255,.9);--sc-wash:rgba(120,130,150,.08);--sc-user:rgba(90,100,114,.07);--sc-shadow:rgba(24,30,44,.28);--sc-shadow-2:rgba(24,30,44,.15);--sc-accent-glow:rgba(90,100,114,.4);--sc-d-glass-1:rgba(30,32,37,.93);--sc-d-glass-2:rgba(22,24,28,.90);--sc-d-glass-3:rgba(25,27,32,.91);--sc-d-edge:rgba(255,255,255,.08);--sc-d-wash:rgba(255,255,255,.05);--sc-d-user:rgba(255,255,255,.08);--sc-d-accent:#cfd5df;--sc-d-accent-glow:rgba(207,213,223,.35);}',

      /* 6 · 极光 — drifting mint → lilac → rose */
      '[data-palette="aurora"]{--sc-accent:#7b6cf6;--sc-glass-1:rgba(255,255,255,.92);--sc-glass-2:rgba(248,250,255,.80);--sc-glass-3:rgba(251,247,255,.82);--sc-edge:rgba(255,255,255,.86);--sc-wash:rgba(120,200,190,.16);--sc-user:rgba(123,108,246,.09);--sc-shadow:rgba(34,40,80,.30);--sc-shadow-2:rgba(34,40,80,.16);--sc-accent-glow:rgba(123,108,246,.55);--sc-d-glass-1:rgba(30,34,46,.92);--sc-d-glass-2:rgba(21,25,34,.88);--sc-d-glass-3:rgba(25,25,36,.90);--sc-d-edge:rgba(255,255,255,.09);--sc-d-wash:rgba(120,190,190,.12);--sc-d-user:rgba(140,150,255,.16);--sc-d-accent:#9d94ff;--sc-d-accent-glow:rgba(157,148,255,.5);}',
      '.sc-panel[data-palette="aurora"]::before{background:linear-gradient(100deg,rgba(118,214,196,.20),rgba(146,146,255,.17) 46%,rgba(255,168,198,.17) 100%);-webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.4) 52%,transparent 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.4) 52%,transparent 100%);}',
      '[data-ds-dark-theme] .sc-panel[data-palette="aurora"]::before{background:linear-gradient(100deg,rgba(112,200,186,.16),rgba(140,140,250,.15) 46%,rgba(240,150,190,.15) 100%);}',

      /* clear-thread button, with its two-step arm state */
      '.sc-clear{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;height:24px;min-width:24px;padding:0 4px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;opacity:.82;transition:opacity .12s ease,background .12s ease,color .12s ease,border-color .12s ease;}',
      '.sc-clear:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);opacity:1;}',
      '.sc-clear:disabled{opacity:.22;cursor:default;}',
      '.sc-clear.is-armed{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);padding:0 7px;opacity:1;}',
      '.sc-clear.is-armed:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);}',
      /* material picker */
      '.sc-theme-btn{appearance:none;border:0;background:transparent;padding:0;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;opacity:.75;transition:opacity .12s ease,background .12s ease;}',
      '.sc-theme-btn:hover,.sc-theme-btn.is-open{opacity:1;background:var(--dsw-alias-bg-layer-2);}',
      '.sc-theme-btn i{display:block;width:13px;height:13px;border-radius:50%;box-sizing:border-box;background-color:var(--sc-accent);background-image:linear-gradient(160deg,rgba(255,255,255,.55),rgba(255,255,255,0) 62%);}',
      '.sc-theme-row{display:flex;align-items:center;gap:10px;margin-top:11px;padding-left:14px;animation:sc-fade .14s ease-out;}',
      '.sc-swatch{appearance:none;width:21px;height:21px;border-radius:50%;padding:0;cursor:pointer;flex:none;box-sizing:border-box;border:0;background-color:var(--sc-accent);background-image:linear-gradient(160deg,rgba(255,255,255,.5),rgba(255,255,255,0) 62%);transition:transform .12s ease,box-shadow .12s ease;}',
      '[data-ds-dark-theme] .sc-swatch,[data-ds-dark-theme] .sc-theme-btn i{background-color:var(--sc-d-accent);}',
      '.sc-swatch:hover{transform:translateY(-1px);}',
      '.sc-swatch.is-active{box-shadow:0 0 0 2px var(--dsw-alias-bg-overlay),0 0 0 3.5px var(--sc-accent);}',
      '.sc-theme-name{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:2px;}',

      /* progress strip */
      '.sc-progress{display:flex;align-items:center;gap:7px;margin-top:6px;padding-left:14px;font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;white-space:nowrap;animation:sc-fade .16s ease-out;}',
      '.sc-progress .sc-pitem{flex:none;}',
      '.sc-progress .sc-psep{opacity:.38;flex:none;}',
      '.sc-progress.is-warn{color:#a8690f;}',
      '[data-ds-dark-theme] .sc-progress.is-warn{color:var(--dsw-alias-state-warn-primary);}',
      '.sc-progress .sc-pwarn{font-weight:600;}',
      '.sc-dot.is-warn{background:var(--dsw-alias-state-warn-primary);}',
      '.sc-dot.is-warn.is-live{animation:none;}',

      /* suggested reply */
      '.sc-suggest{margin:2px 0 10px;border:1px solid var(--sc-user-bd);border-radius:12px;padding:10px 12px;background:color-mix(in srgb,var(--sc-accent) 6%,transparent);}',
      '.sc-suggest-head{font-size:10.5px;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);margin-bottom:5px;}',
      '.sc-suggest-body{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.sc-suggest-foot{display:flex;align-items:center;gap:8px;margin-top:9px;}',
      '.sc-suggest-btn{appearance:none;border:1px solid var(--sc-hover-bd);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;height:26px;padding:0 10px;border-radius:8px;cursor:pointer;transition:background .12s ease;}',
      '.sc-suggest-btn:hover{background:color-mix(in srgb,var(--sc-accent) 15%,transparent);}',
      '.sc-suggest-btn.is-done{opacity:.7;cursor:default;}',
      '.sc-suggest-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary);}',

      /* tone switch */
      '.sc-meta-left{display:flex;align-items:center;gap:7px;min-width:0;}',
      '.sc-tone{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;height:19px;padding:0 7px;border-radius:6px;cursor:pointer;flex:none;transition:color .12s ease,border-color .12s ease,background .12s ease;}',
      '.sc-tone:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}',
      '.sc-model{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    ].join('\n');

    /* ------------------------------------------------------------------ *
     * Markdown
     *
     * Deliberately small. The answer is two or three short sentences, so a
     * paragraph, a short list, inline emphasis, a link and a fenced block
     * cover everything the model realistically emits. Parsing yields plain
     * tokens and React builds the elements, so no HTML is ever injected.
     * ------------------------------------------------------------------ */

    //#region markdown
    function parseInline(text) {
      const source = String(text == null ? '' : text);
      const out = [];
      let buffer = '';
      let i = 0;
      const flush = function () {
        if (buffer) {
          out.push({ type: 'text', value: buffer });
          buffer = '';
        }
      };
      while (i < source.length) {
        const ch = source[i];
        if (ch === '\\' && i + 1 < source.length) {
          buffer += source[i + 1];
          i += 2;
          continue;
        }
        if (ch === '`') {
          const end = source.indexOf('`', i + 1);
          if (end > i + 1) {
            flush();
            out.push({ type: 'code', value: source.slice(i + 1, end) });
            i = end + 1;
            continue;
          }
        }
        if (ch === '*' && source[i + 1] === '*') {
          const end = source.indexOf('**', i + 2);
          if (end > i + 2) {
            flush();
            out.push({ type: 'strong', value: source.slice(i + 2, end) });
            i = end + 2;
            continue;
          }
        }
        if (ch === '~' && source[i + 1] === '~') {
          const end = source.indexOf('~~', i + 2);
          if (end > i + 2) {
            flush();
            out.push({ type: 'del', value: source.slice(i + 2, end) });
            i = end + 2;
            continue;
          }
        }
        if (ch === '*') {
          const end = source.indexOf('*', i + 1);
          if (end > i + 1) {
            flush();
            out.push({ type: 'em', value: source.slice(i + 1, end) });
            i = end + 1;
            continue;
          }
        }
        if (ch === '[') {
          const close = source.indexOf(']', i + 1);
          if (close > i + 1 && source[close + 1] === '(') {
            const paren = source.indexOf(')', close + 2);
            if (paren > close + 2) {
              const href = source.slice(close + 2, paren).trim();
              if (/^(https?:\/\/|\/)/i.test(href)) {
                flush();
                out.push({ type: 'link', href: href, value: source.slice(i + 1, close) });
                i = paren + 1;
                continue;
              }
            }
          }
        }
        buffer += ch;
        i += 1;
      }
      flush();
      return out;
    }

    function parseMarkdown(source) {
      const text = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
      const lines = text.split('\n');
      const blocks = [];
      let paragraph = [];
      let i = 0;

      const flushParagraph = function () {
        if (paragraph.length) {
          blocks.push({ type: 'p', inlines: parseInline(paragraph.join('\n')) });
          paragraph = [];
        }
      };

      while (i < lines.length) {
        const line = lines[i];

        const fence = /^\s*```\s*([^\s`]*)\s*$/.exec(line);
        if (fence) {
          flushParagraph();
          const body = [];
          i += 1;
          while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
            body.push(lines[i]);
            i += 1;
          }
          if (i < lines.length) i += 1;
          blocks.push({ type: 'code', lang: fence[1] || '', code: body.join('\n') });
          continue;
        }

        if (/^\s*$/.test(line)) {
          flushParagraph();
          i += 1;
          continue;
        }

        const heading = /^\s{0,3}(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
          flushParagraph();
          blocks.push({ type: 'h', level: heading[1].length, inlines: parseInline(heading[2]) });
          i += 1;
          continue;
        }

        if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
          flushParagraph();
          blocks.push({ type: 'hr' });
          i += 1;
          continue;
        }

        if (/^\s{0,3}>\s?/.test(line)) {
          flushParagraph();
          const quoted = [];
          while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
            quoted.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
            i += 1;
          }
          blocks.push({ type: 'quote', inlines: parseInline(quoted.join('\n')) });
          continue;
        }

        const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(line);
        const numbered = /^(\s*)(\d{1,2})[.)]\s+(.*)$/.exec(line);
        if (bullet || numbered) {
          flushParagraph();
          const ordered = !!numbered;
          const items = [];
          while (i < lines.length) {
            const b = /^(\s*)([-*+])\s+(.*)$/.exec(lines[i]);
            const n = /^(\s*)(\d{1,2})[.)]\s+(.*)$/.exec(lines[i]);
            if (ordered && n) {
              items.push(parseInline(n[3]));
              i += 1;
              continue;
            }
            if (!ordered && b) {
              items.push(parseInline(b[3]));
              i += 1;
              continue;
            }
            if (items.length && /^\s{2,}\S/.test(lines[i])) {
              const continuation = parseInline(' ' + lines[i].trim());
              items[items.length - 1] = items[items.length - 1].concat(continuation);
              i += 1;
              continue;
            }
            break;
          }
          blocks.push({ type: 'list', ordered: ordered, items: items });
          continue;
        }

        paragraph.push(line);
        i += 1;
      }

      flushParagraph();
      return blocks;
    }
    //#endregion markdown

    function renderInline(inlines, keyBase) {
      return inlines.map(function (token, index) {
        const key = keyBase + ':' + index;
        if (token.type === 'strong') return h('strong', { key: key }, token.value);
        if (token.type === 'em') return h('em', { key: key }, token.value);
        if (token.type === 'del') return h('del', { key: key }, token.value);
        if (token.type === 'code') return h('code', { key: key }, token.value);
        if (token.type === 'link') {
          return h('a', { key: key, href: token.href, target: '_blank', rel: 'noreferrer noopener' }, token.value);
        }
        return token.value;
      });
    }

    function renderBlocks(blocks) {
      return blocks.map(function (block, index) {
        const key = 'b' + index;
        if (block.type === 'code') {
          if (block.lang === 'reply') {
            return h(Suggestion, { key: key, text: String(block.code || '').trim() });
          }
          return h('pre', { key: key }, h('code', null, block.code));
        }
        if (block.type === 'h') {
          return h(block.level <= 2 ? 'h3' : 'h4', { key: key }, renderInline(block.inlines, key));
        }
        if (block.type === 'hr') return h('hr', { key: key });
        if (block.type === 'quote') return h('blockquote', { key: key }, renderInline(block.inlines, key));
        if (block.type === 'list') {
          const items = block.items.map(function (inlines, itemIndex) {
            const itemKey = key + ':' + itemIndex;
            return h('li', { key: itemKey }, renderInline(inlines, itemKey));
          });
          return h(block.ordered ? 'ol' : 'ul', { key: key }, items);
        }
        return h('p', { key: key }, renderInline(block.inlines, key));
      });
    }

    function Markdown(props) {
      const blocks = React.useMemo(
        function () {
          return parseMarkdown(props.text);
        },
        [props.text],
      );
      return h('div', { className: 'sc-md' }, renderBlocks(blocks));
    }

    /* ------------------------------------------------------- shared store */

    const store = {
      open: false,
      sessionId: '',
      currentSession: '',
      messages: [],
      busy: false,
      status: null,
      statusFor: '',
      statusError: '',
      theme: readTheme(),
      themePicker: false,
      tone: readTone(),
      pendingDraft: null,
      draftResult: null,
      confirmClear: false,
      threads: readThreads(window.localStorage),
    };
    const listeners = new Set();
    let seq = 0;
    let abortController = null;
    let pollTimer = null;

    function snapshot() {
      return {
        open: store.open,
        sessionId: store.sessionId,
        currentSession: store.currentSession,
        messages: store.messages,
        busy: store.busy,
        status: store.status,
        statusFor: store.statusFor,
        statusError: store.statusError,
        theme: store.theme,
        themePicker: store.themePicker,
        tone: store.tone,
        pendingDraft: store.pendingDraft,
        draftResult: store.draftResult,
        confirmClear: store.confirmClear,
      };
    }

    function emit() {
      for (const fn of Array.from(listeners)) {
        try {
          fn();
        } catch {
          /* a broken subscriber must not break the panel */
        }
      }
    }

    function patch(next) {
      Object.assign(store, next);
      emit();
    }

    function subscribe(fn) {
      listeners.add(fn);
      return function () {
        listeners.delete(fn);
      };
    }

    function applyStatus(next, forId) {
      const current = store.status;
      const same =
        current &&
        store.statusFor === forId &&
        current.running === next.running &&
        current.phase === next.phase &&
        current.headline === next.headline &&
        current.model === next.model;
      if (same && !store.statusError) return;
      patch({ status: next, statusFor: forId, statusError: '' });
    }

    function formatElapsed(ms) {
      const minutes = Math.floor(ms / 60000);
      if (minutes < 1) return '';
      if (minutes < 60) return minutes + t('unitMin');
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours + t('unitHour') + (rest ? ' ' + rest + t('unitMin') : '');
    }

    function formatTokens(value) {
      const tokens = Number(value) || 0;
      if (tokens < 1000) return String(tokens);
      if (tokens < 1000000) return (tokens / 1000).toFixed(tokens < 10000 ? 1 : 0) + 'k';
      return (tokens / 1000000).toFixed(1) + 'M';
    }

    /* ------------------------------------------------------------ polling */

    function pollTarget() {
      return store.open ? store.sessionId : store.currentSession;
    }

    async function pollOnce() {
      const id = pollTarget();
      if (!id) return;
      try {
        const response = await fetch(ROUTE + '/status?session=' + encodeURIComponent(id), {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (response.status === 409) {
          if (store.open && store.sessionId === id) patch({ statusError: 'session-not-live', status: null });
          return;
        }
        if (!response.ok) return;
        const json = await response.json();
        if (!json || !json.ok) return;
        applyStatus(
          {
            running: !!json.running,
            phase: json.phase || '',
            headline: json.headline || '',
            model: json.model || '',
            progress: json.progress || null,
          },
          id,
        );
      } catch {
        /* the Host may be restarting; the next tick retries */
      }
    }

    function ensurePolling() {
      if (pollTimer) return;
      void pollOnce();
      pollTimer = setInterval(function () {
        void pollOnce();
      }, POLL_MS);
    }

    function stopPolling() {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    /* -------------------------------------------------------- conversation */

    function buildHistory() {
      const pairs = [];
      let pending = '';
      for (const message of store.messages) {
        if (message.role === 'user') pending = message.text;
        else if (message.role === 'assistant' && pending) {
          if (message.text) pairs.push({ q: pending, a: message.text });
          pending = '';
        }
      }
      return pairs.slice(-6);
    }

    function fail(message, code, question) {
      const list = store.messages;
      const last = list[list.length - 1];
      const text = message || '';
      if (last && last.role === 'assistant' && !last.text) {
        last.role = 'error';
        last.error = code || 'failed';
        last.text = text;
        last.q = question || '';
      } else {
        list.push({ id: ++seq, role: 'error', error: code || 'failed', text: text, q: question || '' });
      }
      patch({ busy: false });
    }

    async function ask(question) {
      const text = String(question || '').trim();
      if (!text || store.busy || !store.sessionId) return;

      const history = buildHistory();
      const userMessage = { id: ++seq, role: 'user', text: text };
      const botMessage = { id: ++seq, role: 'assistant', text: '' };
      store.messages.push(userMessage, botMessage);
      patch({ busy: true });

      const controller = new AbortController();
      abortController = controller;
      let buffered = '';
      let lastEmitAt = 0;

      function flush(force) {
        const now = Date.now();
        if (!force && now - lastEmitAt < EMIT_MS) return;
        if (buffered) {
          botMessage.text += buffered;
          buffered = '';
        }
        lastEmitAt = now;
        emit();
      }

      try {
        const response = await fetch(ROUTE + '/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ sessionId: store.sessionId, question: text, history: history, tone: store.tone }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = 'http-' + response.status;
          try {
            const json = await response.json();
            if (json && json.error) detail = json.error;
          } catch {
            /* keep the status code */
          }
          fail(detail, 'request', text);
          return;
        }
        if (!response.body || typeof response.body.getReader !== 'function') {
          fail('stream-unsupported', 'request', text);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let rest = '';

        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          rest += decoder.decode(chunk.value, { stream: true });
          let split = rest.indexOf('\n\n');
          while (split >= 0) {
            const frame = rest.slice(0, split);
            rest = rest.slice(split + 2);
            for (const line of frame.split('\n')) {
              if (line.slice(0, 5) !== 'data:') continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              let event;
              try {
                event = JSON.parse(payload);
              } catch {
                continue;
              }
              if (event.t === 'delta' && event.text) buffered += event.text;
              else if (event.t === 'error') fail(event.message || '', event.code, text);
              else if (event.t === 'done') flush(true);
            }
            split = rest.indexOf('\n\n');
          }
          flush(false);
        }
        flush(true);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (!botMessage.text) botMessage.text = '（' + t('stop') + '）';
          flush(true);
        } else {
          fail((error && error.message) || String(error), 'network', text);
        }
      } finally {
        abortController = null;
        persistThread();
        patch({ busy: false });
      }
    }

    function stop() {
      if (abortController) abortController.abort();
    }

    /** Fold the open thread into the per-Session store (best effort). */
    function persistThread() {
      const id = store.sessionId;
      if (!id || !store.messages.length) return;
      const pruned = pruneThread(store.messages);
      if (!pruned.length) return;
      store.threads[id] = pruned;
      writeThreads(window.localStorage, store.threads);
    }

    function restoreThread(sessionId) {
      const stored = store.threads[sessionId] || [];
      return stored.map(function (message) {
        return { id: ++seq, role: message.role, text: message.text };
      });
    }

    function openCompanion(sessionId) {
      // Threads are per Session: stash the one being left, restore the one
      // being opened, so switching back and forth keeps each conversation.
      if (store.sessionId !== sessionId) {
        persistThread();
        store.messages = restoreThread(sessionId);
      }
      patch({ open: true, sessionId: sessionId, statusError: '', draftResult: null });
      ensurePolling();
      void pollOnce();
    }

    function closeCompanion() {
      patch({ open: false, confirmClear: false });
    }

    /** Forget this Session's thread, in memory and in storage. */
    function clearThread() {
      const id = store.sessionId;
      if (id) dropThread(window.localStorage, store.threads, id);
      patch({ messages: [], draftResult: null, confirmClear: false });
    }

    /**
     * Ask the Session-scoped trigger to put this text into the composer. The
     * trigger owns `inputActions`; the panel only records the intent.
     */
    function beginDraft(text) {
      const value = String(text || '').trim();
      if (!value || !store.sessionId) return;
      patch({ pendingDraft: { sessionId: store.sessionId, text: value, at: Date.now() } });
    }

    /* ---------------------------------------------------------- components */

    function useStore() {
      const [state, setState] = React.useState(snapshot);
      React.useEffect(function () {
        return subscribe(function () {
          setState(snapshot());
        });
      }, []);
      return state;
    }

    const ICON_BUBBLE = h(
      'svg',
      { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', {
        d: 'M2.5 4.2A2.2 2.2 0 0 1 4.7 2h6.6a2.2 2.2 0 0 1 2.2 2.2v4.1a2.2 2.2 0 0 1-2.2 2.2H7.4l-3.6 3v-3h-.1a2.2 2.2 0 0 1-1.2-1.9z',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 6, cy: 6.4, r: 1, fill: 'currentColor' }),
      h('circle', { cx: 9.9, cy: 6.4, r: 1, fill: 'currentColor' }),
    );

    const ICON_CLOSE = h(
      'svg',
      { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
    );

    const ICON_TRASH = h(
      'svg',
      { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', {
        d: 'M2.8 4.6h10.4M6.3 4.6V3h3.4v1.6M4.3 4.6l.7 8.4h6L11.7 4.6',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );

    const ICON_SEND = h(
      'svg',
      { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', {
        d: 'M8 13V3.6M8 3.6L4 7.6M8 3.6l4 4',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );

    const ICON_STOP = h(
      'svg',
      { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.6, fill: 'currentColor' }),
    );

    const ICON_DOWN = h(
      'svg',
      { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      h('path', {
        d: 'M8 3.5v9M8 12.5l-3.2-3.2M8 12.5l3.2-3.2',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );

    function Suggestion(props) {
      const state = useStore();
      const failed = state.draftResult && state.draftResult.text === props.text && !state.draftResult.ok;
      return h(
        'div',
        { className: 'sc-suggest' },
        h('div', { className: 'sc-suggest-head' }, t('suggestLabel')),
        h('div', { className: 'sc-suggest-body' }, props.text),
        h(
          'div',
          { className: 'sc-suggest-foot' },
          h(
            'button',
            {
              type: 'button',
              className: 'sc-suggest-btn' + (failed ? ' is-done' : ''),
              onClick: function () {
                beginDraft(props.text);
              },
            },
            failed ? t('suggestFailed') : t('suggestFill'),
          ),
          h('span', { className: 'sc-suggest-hint' }, t('suggestHint')),
        ),
      );
    }

    function CompanionTrigger(props) {
      const state = useStore();
      const live = state.statusFor === props.sessionId && state.status && state.status.running;
      const active = state.open && state.sessionId === props.sessionId;

      React.useEffect(
        function () {
          // The panel lives in the root-scoped overlay, so it outlives this
          // trigger. Switching Sessions therefore has to close it here: the
          // open thread and its streaming request belong to the old Session.
          const switched = state.currentSession && state.currentSession !== props.sessionId;
          if (switched) {
            if (store.open) {
              persistThread();
              closeCompanion();
            }
            if (store.busy) stop();
          }
          if (state.currentSession !== props.sessionId) patch({ currentSession: props.sessionId });
          ensurePolling();
        },
        [props.sessionId],
      );

      React.useEffect(
        function () {
          const pending = state.pendingDraft;
          if (!pending || pending.sessionId !== props.sessionId) return;
          let ok = false;
          try {
            const actions = props.inputActions;
            // Insert at the caret so an existing draft survives; fall back to
            // replacing it only when the composer refuses the insertion.
            if (actions && typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
              ok = actions.insertText(pending.text, actions.captureInsertion()) !== false;
            }
            if (!ok && actions && typeof actions.setDraft === 'function') {
              actions.setDraft(pending.text);
              ok = true;
            }
            if (ok && typeof actions.persistDraft === 'function') actions.persistDraft();
          } catch {
            ok = false;
          }
          // Success hands the composer back to the user: close the panel so the
          // text they are about to send is visible. Failure stays put and says so.
          patch(
            ok
              ? { pendingDraft: null, draftResult: null, open: false }
              : { pendingDraft: null, draftResult: { text: pending.text, ok: false } },
          );
        },
        [state.pendingDraft],
      );

      return h(
        'button',
        {
          type: 'button',
          title: t('trigger'),
          'aria-label': t('trigger'),
          'aria-pressed': active ? 'true' : 'false',
          className: 'sc-trigger' + (active ? ' is-active' : ''),
          onClick: function () {
            if (active) closeCompanion();
            else openCompanion(props.sessionId);
          },
        },
        ICON_BUBBLE,
        h('span', null, t('trigger')),
        h('span', { className: 'sc-tdot' + (live ? ' is-live' : ''), 'aria-hidden': 'true' }),
      );
    }

    function CompanionPanel() {
      const state = useStore();
      const [draft, setDraft] = React.useState('');
      const [stuck, setStuck] = React.useState(true);
      const listRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const stickRef = React.useRef(true);
      const inputRef = React.useRef(null);

      React.useEffect(
        function () {
          if (!state.open) return undefined;
          const onKey = function (event) {
            if (event.key !== 'Escape') return;
            const node = panelRef.current;
            if (node && (node.contains(event.target) || node.contains(document.activeElement))) closeCompanion();
          };
          window.addEventListener('keydown', onKey);
          return function () {
            window.removeEventListener('keydown', onKey);
          };
        },
        [state.open],
      );

      React.useEffect(function () {
        const node = listRef.current;
        if (!node) return;
        if (stickRef.current) node.scrollTop = node.scrollHeight;
      });

      React.useEffect(
        function () {
          if (state.open && inputRef.current) inputRef.current.focus();
        },
        [state.open],
      );

      React.useEffect(
        function () {
          const node = inputRef.current;
          if (!node) return;
          node.style.height = 'auto';
          node.style.height = Math.min(node.scrollHeight, 116) + 'px';
        },
        [draft, state.open],
      );

      // The clear button un-arms itself, so a stray click cannot wipe a thread
      // minutes later.
      React.useEffect(
        function () {
          if (!state.confirmClear) return undefined;
          const timer = setTimeout(function () {
            patch({ confirmClear: false });
          }, 4000);
          return function () {
            clearTimeout(timer);
          };
        },
        [state.confirmClear],
      );

      if (!state.open) return null;

      const status = state.statusFor === state.sessionId ? state.status : null;
      const live = !!(status && status.running);
      const phase = status && status.phase ? status.phase : '';
      const activity = status && status.headline ? status.headline : state.busy ? t('thinking') : t('empty');

      const progress = status && status.progress ? status.progress : null;
      const stall = progress && progress.stall ? progress.stall : null;
      const chips = [];
      if (progress) {
        if (progress.todos && progress.todos.total > 0) {
          chips.push(t('progressTodos') + ' ' + progress.todos.done + '/' + progress.todos.total);
        }
        if (progress.files > 0) chips.push(progress.files + ' ' + t('progressFiles'));
        if (progress.tokens > 0) chips.push(formatTokens(progress.tokens) + ' ' + t('progressTokens'));
        const elapsed = formatElapsed(progress.elapsedMs || 0);
        if (elapsed) chips.push(t('elapsed') + ' ' + elapsed);
      }

      function submit() {
        const value = draft.trim();
        if (!value || state.busy) return;
        setDraft('');
        stickRef.current = true;
        setStuck(true);
        void ask(value);
      }

      const rows = state.messages.map(function (message, index) {
        if (message.role === 'user') {
          return h('div', { key: message.id, className: 'sc-user' }, message.text);
        }
        if (message.role === 'error') {
          return h(
            'div',
            { key: message.id, className: 'sc-error', role: 'alert' },
            h('div', { className: 'sc-error-title' }, t('failed')),
            message.text ? h('div', { className: 'sc-error-detail' }, message.text) : null,
            message.q
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-retry',
                    onClick: function () {
                      stickRef.current = true;
                      setStuck(true);
                      void ask(message.q);
                    },
                  },
                  t('retry'),
                )
              : null,
          );
        }
        const isLast = index === state.messages.length - 1;
        const streaming = state.busy && isLast;
        if (!message.text && streaming) {
          return h(
            'div',
            { key: message.id, className: 'sc-bot' },
            h('span', { className: 'sc-typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          );
        }
        return h(
          'div',
          { key: message.id, className: 'sc-bot' },
          h(Markdown, { text: message.text }),
          streaming ? h('span', { className: 'sc-caret', 'aria-hidden': 'true' }) : null,
        );
      });

      const empty = state.messages.length === 0;

      return h(
        'div',
        { className: 'sc-panel', role: 'dialog', 'aria-label': t('title'), ref: panelRef, 'data-palette': state.theme },
        h(
          'div',
          { className: 'sc-head' },
          h(
            'div',
            { className: 'sc-head-row' },
            h('span', {
              className: 'sc-dot' + (live ? ' is-live' : '') + (stall ? ' is-warn' : ''),
              'aria-hidden': 'true',
            }),
            h('div', { className: 'sc-title' }, t('title')),
            h('span', { className: 'sc-spacer' }),
            h('span', { className: 'sc-badge' }, live ? t('running') : t('idle')),
            state.messages.length
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-clear' + (state.confirmClear ? ' is-armed' : ''),
                    title: state.confirmClear ? t('clearConfirm') : t('clearHint'),
                    'aria-label': state.confirmClear ? t('clearConfirm') : t('clearHint'),
                    disabled: state.busy,
                    onClick: function () {
                      if (state.busy) return;
                      if (state.confirmClear) {
                        clearThread();
                        return;
                      }
                      patch({ confirmClear: true });
                    },
                  },
                  state.confirmClear ? h('span', null, t('clearConfirm')) : ICON_TRASH,
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'sc-theme-btn' + (state.themePicker ? ' is-open' : ''),
                title: t('themePicker'),
                'aria-label': t('themePicker'),
                'aria-expanded': state.themePicker ? 'true' : 'false',
                onClick: function () {
                  patch({ themePicker: !state.themePicker });
                },
              },
              h('i'),
            ),
            h(
              'button',
              { type: 'button', className: 'sc-close', title: t('close'), 'aria-label': t('close'), onClick: closeCompanion },
              ICON_CLOSE,
            ),
          ),
          h(
            'div',
            { className: 'sc-activity' },
            phase ? h('span', { className: 'sc-phase' }, phase) : null,
            h('span', { className: 'sc-act', title: activity }, activity),
          ),
          stall
            ? h(
                'div',
                { className: 'sc-progress is-warn', role: 'status' },
                h('span', { className: 'sc-pitem sc-pwarn' }, t('stalled')),
                h('span', { className: 'sc-psep', 'aria-hidden': 'true' }, '·'),
                h('span', { className: 'sc-pitem', title: stall.detail }, stall.detail),
              )
            : chips.length
              ? h(
                  'div',
                  { className: 'sc-progress', role: 'status' },
                  chips.map(function (text, index) {
                    return h(
                      'span',
                      { key: 'p' + index, className: 'sc-pitem' },
                      index > 0 ? h('span', { className: 'sc-psep', 'aria-hidden': 'true' }, '·') : null,
                      text,
                    );
                  }),
                )
              : null,
          state.themePicker
            ? h(
                'div',
                { className: 'sc-theme-row', role: 'group', 'aria-label': t('themePicker') },
                THEMES.map(function (key) {
                  const active = key === state.theme;
                  return h('button', {
                    key: key,
                    type: 'button',
                    className: 'sc-swatch' + (active ? ' is-active' : ''),
                    'data-palette': key,
                    title: t('theme_' + key),
                    'aria-label': t('theme_' + key),
                    'aria-pressed': active ? 'true' : 'false',
                    onClick: function () {
                      writeTheme(key);
                      patch({ theme: key, themePicker: false });
                    },
                  });
                }),
                h('span', { className: 'sc-theme-name' }, t('theme_' + state.theme)),
              )
            : null,
        ),
        h(
          'div',
          { className: 'sc-body' },
          h(
            'div',
            {
              className: 'sc-list',
              ref: listRef,
              role: 'log',
              'aria-live': state.busy ? 'off' : 'polite',
              onScroll: function (event) {
                const node = event.currentTarget;
                const near = node.scrollHeight - node.scrollTop - node.clientHeight < 56;
                stickRef.current = near;
                if (near !== stuck) setStuck(near);
              },
            },
            state.statusError === 'session-not-live' ? h('div', { className: 'sc-note' }, t('notLive')) : null,
            empty && !state.statusError
              ? h(
                  'div',
                  null,
                  h('div', { className: 'sc-intro' }, t('intro')),
                  h(
                    'div',
                    { className: 'sc-chips' },
                    ['q1', 'q2', 'q3', 'q4'].map(function (key) {
                      return h(
                        'button',
                        {
                          key: key,
                          type: 'button',
                          className: 'sc-chip',
                          disabled: state.busy,
                          onClick: function () {
                            stickRef.current = true;
                            setStuck(true);
                            void ask(t(key));
                          },
                        },
                        t(key),
                      );
                    }),
                  ),
                )
              : null,
            rows,
          ),
          !stuck
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'sc-jump',
                  onClick: function () {
                    const node = listRef.current;
                    stickRef.current = true;
                    setStuck(true);
                    if (node) node.scrollTop = node.scrollHeight;
                  },
                },
                ICON_DOWN,
                t('jump'),
              )
            : null,
        ),
        h(
          'div',
          { className: 'sc-foot' },
          h(
            'div',
            { className: 'sc-inputwrap' },
            h('textarea', {
              className: 'sc-input',
              ref: inputRef,
              rows: 1,
              value: draft,
              placeholder: t('placeholder'),
              'aria-label': t('placeholder'),
              onChange: function (event) {
                setDraft(event.target.value);
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              },
            }),
            state.busy
              ? h(
                  'button',
                  { type: 'button', className: 'sc-send sc-stop', title: t('stop'), 'aria-label': t('stop'), onClick: stop },
                  ICON_STOP,
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-send',
                    title: t('send'),
                    'aria-label': t('send'),
                    disabled: !draft.trim(),
                    onClick: submit,
                  },
                  ICON_SEND,
                ),
          ),
          h(
            'div',
            { className: 'sc-meta' },
            h(
              'span',
              { className: 'sc-meta-left' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'sc-tone',
                  title: t('toneHint'),
                  'aria-label': t('toneHint'),
                  'aria-pressed': state.tone === 'technical' ? 'true' : 'false',
                  onClick: function () {
                    const next = state.tone === 'technical' ? 'plain' : 'technical';
                    writeTone(next);
                    patch({ tone: next });
                  },
                },
                state.tone === 'technical' ? t('toneTechnical') : t('tonePlain'),
              ),
              status && status.model ? h('span', { className: 'sc-model', title: status.model }, status.model) : null,
            ),
            h('span', null, t('footNote')),
          ),
        ),
      );
    }

    /* --------------------------------------------------------------- apply */

    let t = function (key) {
      return key;
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          function () {
            return ctx.locale.register(NS, DICTS);
          },
          'session-companion.locale',
        );
        t = ctx.locale.bind(NS);

        ctx.effect(
          function () {
            const style = document.createElement('style');
            style.dataset.dshSessionCompanion = 'styles';
            // Dark overrides are authored against `body[data-ds-dark-theme]`
            // (the host's own convention) and widened here to any ancestor
            // carrying the attribute, so a shell that puts it on <html>
            // cannot leave the glass panel white in dark mode.
            style.textContent = (CSS + '\n' + REFINED_CSS + '\n' + PALETTE_CSS).replace(
              /body\[data-ds-dark-theme\]/g,
              '[data-ds-dark-theme]',
            );
            document.head.appendChild(style);
            return function () {
              style.remove();
            };
          },
          'session-companion.styles',
        );

        ctx.effect(
          function () {
            const onKey = function (event) {
              if (!isCompanionShortcut(event)) return;
              event.preventDefault();
              if (store.open) {
                closeCompanion();
              } else if (store.currentSession) {
                openCompanion(store.currentSession);
              }
            };
            window.addEventListener('keydown', onKey);
            return function () {
              window.removeEventListener('keydown', onKey);
            };
          },
          'session-companion.shortcut',
        );

        ctx.effect(
          function () {
            return function () {
              stopPolling();
              if (abortController) abortController.abort();
              store.messages = [];
              store.open = false;
              listeners.clear();
            };
          },
          'session-companion.lifecycle',
        );

        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'session-companion',
              order: 40,
              label: function () {
                return t('trigger');
              },
            },
            CompanionTrigger,
          );
        });

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'session-companion',
              order: 60,
            },
            CompanionPanel,
          );
        });
      },
    };
  },
});
