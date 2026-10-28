/**
 * Session Companion (Host half).
 *
 * A read-only side channel for a Session whose agent is too busy to answer.
 * The Companion never appends a Session event, never wakes an agent, and never
 * registers a tool: it renders the committed Session log into a compact digest,
 * asks a separate model call about that digest, and streams the prose answer
 * back to the Web client.
 *
 * Boundaries:
 *   - the Session log is only ever read (`snapshotEvents`, no `append`);
 *   - the model call carries no tools and no `sessionId`, so it cannot be
 *     mistaken for a Session request and cannot leave a request header behind;
 *   - the only HTTP surface is `/session-companion/{status,ask}` on the local
 *     Web server, same-origin only, POST bodies capped.
 */

const ROUTE_PREFIX = '/session-companion';
const MAX_BODY_BYTES = 96 * 1024;
const LIVE_FRESH_MS = 90 * 1000;

const DEFAULTS = {
  enabled: true,
  provider: '',
  model: '',
  historyEvents: 60,
  digestChars: 7000,
  maxAnswerTokens: 500,
  keepTurns: 6,
  stallMinutes: 8,
};

/** Tools whose arguments name a file the Session actually changed. */
const FILE_TOOLS = ['write', 'edit', 'multi_edit', 'apply_patch'];
/** Consecutive failures that read as "it is not getting anywhere". */
const FAIL_STREAK = 3;
/** Identical calls inside this window that read as a loop. */
const REPEAT_WINDOW = 12;
const REPEAT_COUNT = 3;

export const inject = ['sessions', 'llm', 'webServer'];

function log(message) {
  console.log('[session-companion] ' + message);
}

const SYSTEM_PROMPT = [
  '你是 DSH 桌面端里的「随行问答」助手。',
  '用户正在另一个会话里让一个 AI 干活，那个 AI 忙着执行任务，回复不了；用户于是来这里问你“现在到底什么情况”。',
  '',
  '怎么说话（用户最在意这一点）：',
  '- 默认 3 句以内、100 字以内就说完。用户明确说“展开说/详细点”才加长。',
  '- 大白话，像同事在旁边顺口解释一句。不用“结论/要点/综上/首先其次”这类套话，也不要写标题。',
  '- 第一句直接回答“它现在在干什么”，第二句说“为什么/接下来要做什么”，最多再来一句提醒。',
  '- 那个 AI 的思考链是英文，你要翻译成中文说出来，别贴英文原文，也别逐字复述。',
  '- 技术名词（文件名、命令、工具名）可以保留，其余都用日常说法。',
  '- 需要罗列时最多两条，用短句或顿号连着说，不要堆多层列表。',
  '- 如果一句具体的话就能帮到用户（提醒它、纠正方向、让它先跑个检查），在回答最后附一个 ```reply 代码块，里面只放用户可以直接发给主 Agent 的那句话：不加引号、不加解释、不署名。没有明确建议就不要给，不要为了格式硬凑。',
  '你没有任何工具：不能执行命令、不能读写文件、不能修改那个会话、也不能让它多做或少做什么。你唯一的材料是下面给定的会话快照。',
  '',
  '事实边界：',
  '- 只依据快照作答。快照里看不到的，直接说“快照里看不到”，不要猜，不要编造文件内容或执行结果。',
  '- 默认用中文；用户用别的语言提问就跟着用那种语言。',
  '- 如果它看起来卡住了、在反复重试、或者在做一件明显偏离目标的事，用一句话直接点出来。',
].join('\n');

/** Appended only when the reader asks for the technical register. */
const TONE_TECHNICAL = [
  '',
  '这次用户想要技术视角：',
  '- 可以直接点名工具（read / edit / pwsh…）、文件路径、命令、报错码，允许贴一两行关键代码或日志。',
  '- 可以说清它这一轮的具体做法和依据，不必把它完全翻译成生活化比喻。',
  '- 仍然不要标题、不要套话、不要为了显得专业而堆术语；长度上限放宽到 200 字。',
].join('\n');

/** The system prompt for one request, in the requested register. */
function buildSystemPrompt(tone) {
  return tone === 'technical' ? SYSTEM_PROMPT + TONE_TECHNICAL : SYSTEM_PROMPT;
}

/* ------------------------------------------------------------------ utils */

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const round = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    enabled: src.enabled !== false,
    provider: text(src.provider),
    model: text(src.model),
    historyEvents: round(src.historyEvents, DEFAULTS.historyEvents, 6, 200),
    digestChars: round(src.digestChars, DEFAULTS.digestChars, 1500, 40000),
    maxAnswerTokens: round(src.maxAnswerTokens, DEFAULTS.maxAnswerTokens, 0, 8000),
    keepTurns: round(src.keepTurns, DEFAULTS.keepTurns, 0, 20),
    stallMinutes: round(src.stallMinutes, DEFAULTS.stallMinutes, 1, 120),
  };
}

function oneLine(value, max) {
  const s = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Keep the most recent characters: for a thought that is still growing. */
function tail(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? '…' + s.slice(s.length - max) : s;
}

function head(value, max) {
  const s = String(value == null ? '' : value).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function blocks(content) {
  return Array.isArray(content) ? content : [];
}

function textOf(content) {
  if (typeof content === 'string') return content;
  const out = [];
  for (const block of blocks(content)) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') out.push(block.text);
    else if (block.type === 'file' && block.attachment && block.attachment.name) out.push('[附件 ' + block.attachment.name + ']');
    else if (block.type === 'image') out.push('[图片]');
  }
  return out.join('\n');
}

function reasoningOf(content) {
  const out = [];
  for (const block of blocks(content)) {
    if (block && block.type === 'reasoning' && typeof block.text === 'string') out.push(block.text);
  }
  return out.join('\n');
}

/**
 * A routing id for the Companion's own model calls. Providers that demand a
 * session affinity token must not be handed the Session's id, otherwise the
 * Companion's traffic is attributed to the Session it is only supposed to read.
 */
function companionSessionId(sessionId) {
  const cleaned = String(sessionId || '').replace(/[^A-Za-z0-9-]/g, '');
  return 'session-companion-' + (cleaned.slice(-12) || 'local');
}

/** Tool arguments arrive as a JSON string; a partial one is simply ignored. */
function parseArguments(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** The newest `todo_write` payload, reduced to what a status line can show. */
function summarizeTodos(list) {
  const items = [];
  let done = 0;
  let active = '';
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const content = oneLine(item.content, 80);
    const status = item.status === 'completed' ? 'completed' : item.status === 'in_progress' ? 'in_progress' : 'pending';
    if (status === 'completed') done += 1;
    if (status === 'in_progress' && !active) active = content;
    if (items.length < 20) items.push({ content, status });
  }
  return { total: list.length, done, active, items };
}

function safe(fn, fallback) {  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'dsh-app:') return true;
    return parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

/** Render one committed event into digest lines. Returns null for noise. */
function renderEvent(event) {
  const data = (event && event.data) || {};
  switch (event.type) {
    case 'turn/start':
      return ['— 第' + data.turn + '轮 —'];
    case 'step/start':
      return ['· 第' + data.turn + '轮 第' + data.step + '步'];
    case 'turn/end': {
      const kind = (data.reason && data.reason.kind) || '?';
      return ['— 第' + data.turn + '轮结束（' + kind + '）—'];
    }
    case 'user/message': {
      const text = head(textOf(data.content), 700);
      return text ? ['用户：' + text] : ['用户：（非文本内容）'];
    }
    case 'assistant/message': {
      const lines = [];
      const reasoning = reasoningOf(data.message && data.message.content);
      if (reasoning) lines.push('思考：' + tail(reasoning, 1100));
      const text = textOf(data.message && data.message.content);
      if (text) lines.push('助手：' + head(text, 1100));
      return lines.length ? lines : null;
    }
    case 'tool/call':
      return ['工具 ' + oneLine(data.name, 60) + ' 参数 ' + oneLine(data.arguments, 320)];
    case 'tool/result': {
      const failed = data.error || (data.message && data.message.isError);
      const body = oneLine(textOf(data.message && data.message.content), 460);
      const code = data.error && (data.error.code || data.error.name);
      return ['结果' + (failed ? '（失败' + (code ? ' ' + code : '') + '）' : '') + '：' + (body || '（空）')];
    }
    case 'step/end':
    case 'request/header':
    case 'request/context':
    case 'system/message':
    case 'developer/message':
    case 'session/end-seed':
      return null;
    default:
      return null;
  }
}

/**
 * Walk the tail of a Session's log and turn it into a digest plus the state a
 * status line needs. Pure: nothing is written back.
 */
function readSession(session, live, running, cfg, tokens) {
  const end = Number(session.seq) || 0;
  const from = Math.max(0, end - cfg.historyEvents * 4);
  let events = safe(() => session.snapshotEvents(from), null);
  if (!Array.isArray(events) || !events.length) events = safe(() => session.snapshotEvents(), []);
  if (!Array.isArray(events)) events = safe(() => session.ownEvents(), []);

  const lines = [];
  let turn = 0;
  let step = 0;
  let openStep = false;
  let lastAt = 0;
  let lastUser = '';
  let lastAssistant = '';
  let pendingTool = '';
  let closedTurns = 0;
  let turnStartedAt = 0;
  let failRun = 0;
  let todos = null;
  const files = new Set();
  const signatures = [];

  for (const event of events) {
    if (!event) continue;
    const data = event.data || {};
    if (typeof data.turn === 'number') turn = data.turn;
    if (typeof data.step === 'number') step = data.step;
    if (typeof event.time === 'number') lastAt = Math.max(lastAt, event.time);

    if (event.type === 'step/start') openStep = true;
    else if (event.type === 'step/end') openStep = false;
    else if (event.type === 'turn/start') {
      turnStartedAt = event.time || turnStartedAt;
      openStep = false;
      pendingTool = '';
      failRun = 0;
    } else if (event.type === 'turn/end') {
      closedTurns += 1;
      openStep = false;
      pendingTool = '';
      failRun = 0;
    } else if (event.type === 'user/message') {
      lastUser = oneLine(textOf(data.content), 160);
      pendingTool = '';
    } else if (event.type === 'assistant/message') {
      const text = textOf(data.message && data.message.content);
      if (text) lastAssistant = oneLine(text, 160);
    } else if (event.type === 'tool/call') {
      const name = String(data.name || '');
      pendingTool = oneLine(name, 40);
      const args = parseArguments(data.arguments);
      if (args) {
        if (FILE_TOOLS.indexOf(name) >= 0) {
          const path =
            typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : '';
          if (path) files.add(path);
        } else if (name === 'todo_write' && Array.isArray(args.todos)) {
          todos = summarizeTodos(args.todos);
        }
      }
      signatures.push(name + '|' + oneLine(data.arguments, 160));
      if (signatures.length > REPEAT_WINDOW) signatures.shift();
    } else if (event.type === 'tool/result') {
      pendingTool = '';
      const failed = data.error || (data.message && data.message.isError);
      failRun = failed ? failRun + 1 : 0;
    }

    const rendered = renderEvent(event);
    if (rendered) lines.push.apply(lines, rendered);
  }

  // Keep the newest lines inside the character budget.
  while (lines.length > cfg.historyEvents * 2) lines.shift();
  let body = lines.join('\n');
  while (body.length > cfg.digestChars && lines.length > 1) {
    lines.shift();
    body = lines.join('\n');
  }

  const liveText = renderLive(live);
  const header = safe(() => session.requestHeader(), undefined);
  const route = header && header.config ? header.config : null;
  const model = route && route.model ? route.model : '';

  const fresh = lastAt > 0 && Date.now() - lastAt < LIVE_FRESH_MS;
  const isRunning = Boolean(running) || Boolean(liveText) || (openStep && fresh);

  let repeatCount = 0;
  const seen = new Map();
  for (const signature of signatures) {
    const next = (seen.get(signature) || 0) + 1;
    seen.set(signature, next);
    if (next > repeatCount) repeatCount = next;
  }

  const quietMs = lastAt > 0 ? Date.now() - lastAt : 0;
  let stall = null;
  if (isRunning) {
    if (failRun >= FAIL_STREAK) {
      stall = { kind: 'failing', detail: '连续 ' + failRun + ' 次工具调用失败' };
    } else if (repeatCount >= REPEAT_COUNT) {
      stall = { kind: 'looping', detail: '同一个调用重复了 ' + repeatCount + ' 次' };
    } else if (quietMs > cfg.stallMinutes * 60000) {
      stall = { kind: 'quiet', detail: '已经 ' + cfg.stallMinutes + ' 分钟没有新动作' };
    }
  }

  let phase = '';
  if (turn > 0) phase = '第' + turn + '轮' + (step > 0 ? ' 第' + step + '步' : '');

  let headline = '';
  if (live && live.text) headline = oneLine(live.text, 90);
  else if (live && live.reasoning) headline = '思考中：' + oneLine(live.reasoning, 80);
  else if (pendingTool) headline = '正在执行 ' + pendingTool;
  else if (isRunning) headline = '运行中，等待模型输出';
  else if (lastAssistant) headline = lastAssistant;
  else if (lastUser) headline = '已收到：' + lastUser;
  else headline = '还没有内容';

  const status = {
    running: isRunning,
    phase,
    headline,
    model,
    turn,
    step,
    closedTurns,
    progress: {
      turn,
      step,
      elapsedMs: isRunning && turnStartedAt > 0 ? Math.max(0, Date.now() - turnStartedAt) : 0,
      todos: todos ? { total: todos.total, done: todos.done, active: todos.active } : null,
      files: files.size,
      tokens: typeof tokens === 'number' ? tokens : null,
      stall,
    },
  };

  const parts = [];
  parts.push('[会话] ' + String(session.id || '?') + '   模型: ' + (model || '未知') + '   轮次: ' + (phase || '未开始'));
  const cwd = safe(() => (session.header && session.header.cwd) || '', '');
  if (cwd) parts.push('[工作目录] ' + cwd);
  parts.push('[状态] ' + (isRunning ? '运行中' : '空闲'));
  if (todos && todos.total > 0) {
    parts.push(
      '[待办] ' +
        todos.done +
        '/' +
        todos.total +
        ' 已完成' +
        (todos.active ? '，正在做：' + todos.active : ''),
    );
  }
  if (files.size > 0) parts.push('[已改动文件] ' + files.size + ' 个');
  if (typeof tokens === 'number' && tokens > 0) parts.push('[上下文用量] 约 ' + tokens + ' tokens');
  if (stall) parts.push('[注意] ' + stall.detail + '（可能是空转，可以直接问它为什么）');
  parts.push('');
  parts.push('[最近日志]（越靠后越新）');
  parts.push(body || '（暂无内容）');
  if (liveText) parts.push('', '[正在生成，尚未写入日志]', liveText);
  const digest = parts.join('\n');

  return { digest, status };
}

function renderLive(live) {
  if (!live || !live.at || Date.now() - live.at > LIVE_FRESH_MS) return '';
  const parts = [];
  if (live.reasoning) parts.push('思考（进行中）：' + tail(live.reasoning, 1400));
  if (live.text) parts.push('回答（进行中）：' + tail(live.text, 1400));
  for (const tool of live.tools) {
    parts.push('工具（进行中）：' + oneLine(tool.name || '?', 40) + ' ' + oneLine(tool.text, 240));
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ plugin */

export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig);
  if (!cfg.enabled) {
    log('disabled by config');
    return;
  }

  /** sessionId -> live assistant stream (only what a running step is producing) */
  const liveBySession = new Map();
  /** sessionId -> true while its agent reports running */
  const runningBySession = new Map();

  ctx.effect(() => {
    const off = ctx.on('agent/assistant-stream', (payload) => {
      const frame = payload && payload.frame;
      const agent = payload && payload.agent;
      if (!frame || !agent) return;
      const id = String(agent.id);
      if (frame.type === 'start') {
        liveBySession.set(id, {
          turn: frame.turn,
          step: frame.step,
          reasoning: '',
          text: '',
          tools: [],
          at: Date.now(),
        });
        return;
      }
      if (frame.type === 'end') {
        const current = liveBySession.get(id);
        if (current) current.at = 0;
        return;
      }
      const current = liveBySession.get(id) || { turn: 0, step: 0, reasoning: '', text: '', tools: [], at: 0 };
      current.at = Date.now();
      const chunk = frame.chunk;
      if (chunk && chunk.type === 'reasoning-delta') current.reasoning = tail(current.reasoning + (chunk.text || ''), 6000);
      else if (chunk && chunk.type === 'text-delta') current.text = tail(current.text + (chunk.text || ''), 6000);
      else if (chunk && chunk.type === 'tool-call-delta') {
        const last = current.tools[current.tools.length - 1];
        if (last && last.id === chunk.id) last.text = tail(last.text + (chunk.argumentsDelta || ''), 800);
        else current.tools.push({ id: chunk.id, name: chunk.name || '', text: chunk.argumentsDelta || '' });
      }
      liveBySession.set(id, current);
    });
    return () => {
      off();
    };
  }, 'session-companion.live');

  ctx.effect(() => {
    const off = ctx.on('agent/status', (payload) => {
      if (!payload || !payload.agent) return;
      runningBySession.set(String(payload.agent.id), payload.status === 'running');
    });
    return () => {
      off();
    };
  }, 'session-companion.running');

  function findSession(sessionId) {
    const live = safe(() => ctx.sessions.get(sessionId), undefined);
    if (live) return { session: live, persisted: false };
    return null;
  }

  function resolveRoute(session) {
    if (cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model };
    const header = safe(() => session && session.requestHeader(), undefined);
    const config = header && header.config;
    if (config && config.provider && config.model) {
      return { provider: cfg.provider || config.provider, model: cfg.model || config.model };
    }
    const fallback = safe(() => {
      const service = ctx.get('agentDefaultModel');
      return service && service.currentSelection();
    }, null);
    if (fallback && fallback.provider && fallback.model) {
      return { provider: cfg.provider || fallback.provider, model: cfg.model || fallback.model };
    }
    return null;
  }

  /** Context pressure, sampled at most every 15 s: `measure` is O(surface). */
  const tokenCache = new Map();

  function measureTokens(session) {
    const meter = safe(() => ctx.get('tokenMeter'), null);
    if (!meter || typeof meter.measure !== 'function') return null;
    const id = String(session.id);
    const cached = tokenCache.get(id);
    if (cached && Date.now() - cached.at < 15000) return cached.total;
    const measurement = safe(() => meter.measure(session), null);
    const total =
      measurement && typeof measurement.totalTokens === 'number' && measurement.totalTokens > 0
        ? measurement.totalTokens
        : null;
    tokenCache.set(id, { at: Date.now(), total });
    return total;
  }

  function snapshot(sessionId) {
    const found = findSession(sessionId);
    if (!found) return { ok: false, error: 'session-not-live' };
    const id = String(sessionId);
    const built = readSession(
      found.session,
      liveBySession.get(id),
      runningBySession.get(id),
      cfg,
      measureTokens(found.session),
    );
    return { ok: true, digest: built.digest, status: built.status };
  }

  /* ---------------------------------------------------------- HTTP edge */

  function sendJson(res, value, code) {
    const body = JSON.stringify(value);
    res.writeHead(code || 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('body-too-large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch (error) {
          reject(error);
        }
      });
      req.on('error', reject);
    });
  }

  function openStream(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let ended = false;
    const peerHandlers = [];
    res.on('close', () => {
      if (ended) return;
      ended = true;
      for (const handler of peerHandlers) {
        try {
          handler();
        } catch {
          /* ignore */
        }
      }
    });

    return {
      send(event) {
        if (ended || res.writableEnded) return;
        try {
          res.write('data: ' + JSON.stringify(event) + '\n\n');
        } catch {
          ended = true;
        }
      },
      close() {
        if (ended) return;
        ended = true;
        try {
          res.end();
        } catch {
          /* already gone */
        }
      },
      onPeerClose(handler) {
        if (ended) {
          try {
            handler();
          } catch {
            /* ignore */
          }
          return;
        }
        peerHandlers.push(handler);
      },
    };
  }

  async function handleAsk(req, res) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, { ok: false, error: String((error && error.message) || error) }, 400);
      return;
    }

    const sessionId = String(body.sessionId || '');
    const question = String(body.question || '').trim().slice(0, 4000);
    const tone = body.tone === 'technical' ? 'technical' : 'plain';
    if (!sessionId || !question) {
      sendJson(res, { ok: false, error: 'missing-arguments' }, 400);
      return;
    }

    const found = findSession(sessionId);
    if (!found) {
      sendJson(res, { ok: false, error: 'session-not-live' }, 409);
      return;
    }
    const route = resolveRoute(found.session);
    if (!route) {
      sendJson(res, { ok: false, error: 'no-model-route' }, 409);
      return;
    }

    const built = readSession(found.session, liveBySession.get(sessionId), runningBySession.get(sessionId), cfg);

    const history = Array.isArray(body.history) ? body.history.slice(-cfg.keepTurns) : [];
    const transcript = [];
    for (const turn of history) {
      const asked = String((turn && turn.q) || '').trim().slice(0, 1200);
      const answered = String((turn && turn.a) || '').trim().slice(0, 2400);
      if (!asked) continue;
      transcript.push('我：' + asked);
      if (answered) transcript.push('你：' + answered);
    }

    const prompt = [
      built.digest,
      '',
      transcript.length ? '[我们之前的对话]\n' + transcript.join('\n') : '',
      '[我现在的问题]',
      question,
    ]
      .filter((part) => part !== '')
      .join('\n');

    const stream = openStream(res);
    const controller = new AbortController();
    stream.onPeerClose(() => controller.abort());

    stream.send({
      t: 'start',
      model: route.model,
      running: built.status.running,
      phase: built.status.phase,
    });

    let answer = '';
    let finish = null;
    const options = {
      provider: route.provider,
      model: route.model,
      system: buildSystemPrompt(tone),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      // The route needs a stable id for cache affinity, but it must NOT be the
      // Session's own id: these tokens are the Companion's, not the Session's.
      sessionId: companionSessionId(sessionId),
      signal: controller.signal,
    };
    if (cfg.maxAnswerTokens > 0) options.maxTokens = cfg.maxAnswerTokens;

    try {
      for await (const chunk of ctx.llm.stream(options)) {
        if (!chunk) continue;
        if (chunk.type === 'text-delta') {
          if (!chunk.text) continue;
          answer += chunk.text;
          stream.send({ t: 'delta', text: chunk.text });
        } else if (chunk.type === 'finish') {
          finish = chunk.reason;
        }
      }
    } catch (error) {
      const message = (error && error.message) || String(error);
      log('ask failed: ' + oneLine(message, 200));
      stream.send({ t: 'error', code: 'stream-failed', message });
      stream.close();
      return;
    }

    if (finish && finish.kind === 'error') {
      stream.send({
        t: 'error',
        code: 'model-error',
        message: (finish.failure && finish.failure.message) || 'model call failed',
      });
    } else if (!answer.trim()) {
      stream.send({ t: 'error', code: 'empty-answer', message: '' });
    } else {
      stream.send({ t: 'done', chars: answer.length });
    }
    stream.close();
  }

  async function handle(req, res) {
    try {
      if (!sameOrigin(req)) {
        sendJson(res, { ok: false, error: 'cross-origin' }, 403);
        return;
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (!url.pathname.startsWith(ROUTE_PREFIX)) {
        sendJson(res, { ok: false, error: 'not-found' }, 404);
        return;
      }
      const sub = url.pathname.slice(ROUTE_PREFIX.length);

      if (sub === '/status') {
        if (req.method !== 'GET') {
          sendJson(res, { ok: false, error: 'method' }, 405);
          return;
        }
        const sessionId = url.searchParams.get('session') || '';
        if (!sessionId) {
          sendJson(res, { ok: false, error: 'missing-session' }, 400);
          return;
        }
        const found = snapshot(sessionId);
        if (!found.ok) {
          sendJson(res, found, 409);
          return;
        }
        sendJson(res, {
          ok: true,
          sessionId,
          rev: 5,
          running: found.status.running,
          phase: found.status.phase,
          headline: found.status.headline,
          model: found.status.model,
          progress: found.status.progress,
        });
        return;
      }

      if (sub === '/ask') {
        if (req.method !== 'POST') {
          sendJson(res, { ok: false, error: 'method' }, 405);
          return;
        }
        await handleAsk(req, res);
        return;
      }

      sendJson(res, { ok: false, error: 'not-found' }, 404);
    } catch (error) {
      log('request failed: ' + oneLine((error && error.message) || error, 200));
      try {
        sendJson(res, { ok: false, error: 'internal' }, 500);
      } catch {
        /* headers already sent */
      }
    }
  }

  ctx.effect(() => {
    const off = ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => {
        void handle(req, res);
      },
    });
    log('mounted at ' + ROUTE_PREFIX);
    return () => {
      off();
      log('unmounted');
    };
  }, 'session-companion.route');
}

// Offline self-test surface; not part of the plugin contract.
export const _internals = {
  normalizeConfig,
  readSession,
  buildSystemPrompt,
  renderEvent,
  renderLive,
  textOf,
  reasoningOf,
  parseArguments,
  summarizeTodos,
  oneLine,
  tail,
  head,
  routePrefix: ROUTE_PREFIX,
};
