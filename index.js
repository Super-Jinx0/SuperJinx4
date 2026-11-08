import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PORT, ADMIN_PASSWORD, MAX_UPLOAD_BYTES, DATA_DIR, UPLOAD_DIR, BACKUP_DIR, VERSION, SECRET_FROM_ENV, STARTED_AT } from './config.js';
import { db, now, tx, getSetting, setSetting, startBackupLoop, makeBackup, rotateBackups, DB_FILE } from './db.js';
import * as auth from './auth.js';
import { UpstreamError, listModels, getCreds, request, complete, normalizeBase, validBase } from './upstream.js';
import { listMemories, addMemory } from './memory.js';
import { hasFfmpeg, probe, extractAudio, AUDIO_FORMATS } from './media.js';
import { getBalance } from './upstream.js';
import { checkProject } from './check.js';
import { collect, toMarkdown } from './handoff.js';
import { runChat, runImage, startVideo, getVideoJob, publicMessage, saveUpload, getUpload, uploadPath, DEFAULT_TITLE } from './chat.js';
import zlib from 'node:zlib';
import { extractFiles, mimeFor, sanitizePath } from './files.js';
import { makeZip } from './zip.js';

const PUBLIC = path.dirname(fileURLToPath(import.meta.url));
const STATIC_FILES = new Set(['index.html', 'app.js', 'app.css', 'md.js', 'icons.js', 'icon.svg', 'manifest.webmanifest', 'guard.js', 'brands.js', 'i18n.js']);

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('FATAL: set the ADMIN_PASSWORD environment variable (at least 8 characters).');
  process.exit(1);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (res, status, data, headers = {}) => {
  let body = Buffer.from(JSON.stringify(data));
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers };
  if (body.length > 1400 && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] || ''))) { body = zlib.gzipSync(body, { level: 4 }); h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; }
  h['Content-Length'] = body.length;
  res.writeHead(status, h);
  res.end(body);
};

async function readBody(req, limit) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'حجم درخواست بیش از حد مجاز است.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const readJson = async (req, limit = 2 * 1024 * 1024) => {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new HttpError(400, 'JSON نامعتبر.'); }
};

const clientIp = (req) => (String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean).pop() || req.socket.remoteAddress || '');
const isHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// ---------- helpers ----------
const convRow = (id) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'گفتگو پیدا نشد.');
  return c;
};
const msgRow = (id) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(id));
  if (!m) throw new HttpError(404, 'پیام پیدا نشد.');
  return m;
};

// ---- saved API connections (keys stay encrypted on the server, never sent to the browser) ----
const readProfiles = () => { try { const a = JSON.parse(getSetting('profiles', '[]')); return Array.isArray(a) ? a : []; } catch { return []; } };
const writeProfiles = (a) => setSetting('profiles', JSON.stringify(a.slice(0, 30)));
function upsertProfile({ base_url, key, name }) {
  const id = crypto.createHash('sha256').update(base_url + '\n' + key).digest('hex').slice(0, 12);
  const list = readProfiles();
  const host = (() => { try { return new URL(base_url).hostname; } catch { return base_url; } })();
  const cur = list.find((x) => x.id === id);
  const row = { id, name: (name || cur?.name || host).slice(0, 40), base_url, key_enc: auth.encrypt(key), last4: key.slice(-4), saved_at: Date.now() };
  writeProfiles([row, ...list.filter((x) => x.id !== id)]);
  return row;
}
const publicProfiles = () => {
  const active = getSetting('api_key_enc');
  return readProfiles().map((x) => ({ id: x.id, name: x.name, base_url: x.base_url, hint: '••••' + x.last4, saved_at: x.saved_at, active: !!active && auth.decrypt(x.key_enc) === auth.decrypt(active) && x.base_url === getSetting('base_url') }));
};

function publicSettings() {
  const enc = getSetting('api_key_enc');
  const last4 = getSetting('api_key_last4');
  return {
    profiles: publicProfiles(),
    max_upload_mb: Math.floor(MAX_UPLOAD_BYTES / 1048576),
    ffmpeg: hasFfmpeg(),
    base_url: getSetting('base_url'),
    has_key: !!enc,
    key_hint: enc ? '••••' + last4 : '',
    default_model: getSetting('default_model'),
    image_model: getSetting('image_model'),
    memory_model: getSetting('memory_model'),
    video_model: getSetting('video_model'),
    auto_media: getSetting('auto_media', '1') === '1',
    memory_auto: getSetting('memory_auto', '1') === '1',
    system_prompt: getSetting('system_prompt'),
    context_chars: Number(getSetting('context_chars', '120000')),
    temperature: getSetting('temperature', ''),
    max_tokens: Number(getSetting('max_tokens', '0')),
    request_timeout: Number(getSetting('request_timeout', '60')),
    backup_keep: Number(getSetting('backup_keep', '14')),
    session_days: Number(getSetting('session_days', '30')),
  };
}

let modelCache = { at: 0, key: '', data: [] };

async function testConnection(body) {
  const steps = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, ms: Date.now() - t0, detail: detail || '' });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: e.message });
      return false;
    }
  };
  let creds;
  let models = [];
  if (!(await step('آدرس و کلید', async () => {
    const base = normalizeBase(body.base_url || getSetting('base_url'));
    if (!validBase(base)) throw new UpstreamError('آدرس باید با https:// یا http:// شروع شود.', 400);
    creds = getCreds({ base_url: base, api_key: body.api_key });
    return base;
  }))) return { ok: false, steps };
  if (!(await step('دریافت فهرست مدل‌ها', async () => {
    models = await listModels(creds);
    return `${models.length} مدل`;
  }))) return { ok: false, steps };
  const model = body.model || getSetting('default_model') || models.find((m) => !m.image_output)?.id;
  const ok = await step('ارسال پیام آزمایشی', async () => {
    if (!model) throw new UpstreamError('مدلی برای تست پیدا نشد.', 400);
    const r = await complete([{ role: 'user', content: 'Reply with the single word: pong' }], { model, creds, maxTokens: 12, timeoutMs: 45000 });
    return `${model}: «${r.text.trim().slice(0, 40)}»`;
  });
  return { ok, steps, models_count: models.length };
}

function exportAll() {
  const rows = (t) => db.prepare(`SELECT * FROM ${t}`).all();
  return {
    format: 'jinx-export', version: 1, exported_at: new Date().toISOString(),
    conversations: rows('conversations'), messages: rows('messages'), memories: rows('memories'),
    uploads: rows('uploads').map((u) => { let data = ''; try { data = fs.readFileSync(uploadPath(u.id)).toString('base64'); } catch {} return { ...u, data }; }),
    settings: rows('settings').filter((s) => !['api_key_enc', 'session_epoch', 'profiles', 'api_key_last4'].includes(s.key)),
  };
}

function importAll(d) {
  if (!['atlas-export', 'jinx-export'].includes(d?.format)) throw new HttpError(400, 'فایل پشتیبان معتبر نیست.');
  let counts = { conversations: 0, messages: 0, memories: 0 };
  tx(() => {
    for (const c of d.conversations || []) {
      const r = db.prepare('INSERT OR IGNORE INTO conversations(id,title,model,summary,summarized_upto,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(c.id, c.title, c.model ?? null, c.summary || '', c.summarized_upto || 0, c.created_at, c.updated_at);
      counts.conversations += Number(r.changes);
    }
    const idMap = new Map();
    for (const m of d.messages || []) {
      if (!db.prepare('SELECT 1 FROM conversations WHERE id=?').get(m.conv_id)) continue;
      const dup = db.prepare('SELECT id FROM messages WHERE conv_id=? AND created_at=? AND role=? AND content=?').get(m.conv_id, m.created_at, m.role, m.content);
      if (dup) { idMap.set(m.id, dup.id); continue; }
      const r = db.prepare('INSERT INTO messages(conv_id,role,content,model,attachments,memory_used,usage,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(m.conv_id, m.role, m.content, m.model ?? null, m.attachments || '[]', m.memory_used || '[]', m.usage ?? null, m.created_at);
      idMap.set(m.id, Number(r.lastInsertRowid));
      counts.messages++;
    }
    for (const u of d.uploads || []) {
      if (!u?.id || !u.data || !/^[a-f0-9-]{36}$/.test(u.id)) continue;
      const r = db.prepare('INSERT OR IGNORE INTO uploads(id,name,mime,size,created_at) VALUES(?,?,?,?,?)').run(u.id, u.name, u.mime, u.size, u.created_at);
      if (Number(r.changes)) fs.writeFileSync(uploadPath(u.id), Buffer.from(u.data, 'base64'));
    }
    for (const m of d.memories || []) {
      const r = db.prepare('INSERT OR IGNORE INTO memories(id,text,tag,pinned,enabled,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(m.id, m.text, m.tag || 'عمومی', m.pinned ? 1 : 0, m.enabled ? 1 : 0, m.source || 'manual', m.created_at, m.updated_at);
      counts.memories += Number(r.changes);
    }
  });
  return counts;
}

// ---------- API router ----------
async function api(req, res, url) {
  let m;
  const method = req.method;
  const p = url.pathname;
  const ip = clientIp(req);

  if (p === '/api/health') {
    try { db.prepare('SELECT 1').get(); return json(res, 200, { ok: true, time: now(), version: VERSION }); }
    catch { return json(res, 503, { ok: false }); }
  }

  if (p === '/api/login' && method === 'POST') {
    const wait = auth.loginBlocked(ip);
    if (wait) return json(res, 429, { error: `تلاش‌های ناموفق زیاد بود. ${Math.ceil(wait / 60)} دقیقه دیگر دوباره امتحان کن.` });
    const body = await readJson(req, 4096);
    if (!auth.checkPassword(body.password)) {
      auth.loginFailed(ip);
      await new Promise((r) => setTimeout(r, 600));
      return json(res, 401, { error: 'رمز عبور اشتباه است.' });
    }
    auth.loginOk(ip);
    const { token, maxAge } = auth.makeSession(Number(getSetting('session_days', '30')) || 30);
    return json(res, 200, { ok: true }, {
      'Set-Cookie': `jinx_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`,
    });
  }

  const cookies = auth.parseCookies(req.headers.cookie);
  const authed = auth.verifySession(cookies.jinx_session);
  if (p === '/api/me') return authed ? json(res, 200, { ok: true }) : json(res, 401, { error: 'unauthorized' });
  if (!authed) return json(res, 401, { error: 'نشست منقضی شده. دوباره وارد شو.' });

  // CSRF defence on top of SameSite=Strict: state-changing calls must carry a custom header
  if (method !== 'GET' && method !== 'HEAD' && req.headers['x-requested-with'] !== 'jinx') throw new HttpError(403, 'درخواست نامعتبر.');

  if (p === '/api/logout' && method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'jinx_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p === '/api/logout-all' && method === 'POST') {
    auth.revokeAllSessions();
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'jinx_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // settings
  if (p === '/api/settings' && method === 'GET') return json(res, 200, publicSettings());
  if (p === '/api/settings' && method === 'PUT') {
    const b = await readJson(req);
    tx(() => {
      if (typeof b.base_url === 'string') {
        const base = normalizeBase(b.base_url);
        if (base && !validBase(base)) throw new HttpError(400, 'آدرس باید با https:// یا http:// شروع شود.');
        setSetting('base_url', base);
        modelCache = { at: 0, key: '', data: [] };
      }
      if (typeof b.api_key === 'string' && b.api_key.trim()) {
        const k = b.api_key.trim();
        setSetting('api_key_enc', auth.encrypt(k));
        setSetting('api_key_last4', k.slice(-4));
        modelCache = { at: 0, key: '', data: [] };
      }
      if (b.clear_key === true) { setSetting('api_key_enc', ''); setSetting('api_key_last4', ''); }
      for (const k of ['default_model', 'image_model', 'memory_model', 'video_model']) if (typeof b[k] === 'string') setSetting(k, b[k].trim());
      if (typeof b.system_prompt === 'string') setSetting('system_prompt', b.system_prompt.slice(0, 4000));
      if (typeof b.auto_media === 'boolean') setSetting('auto_media', b.auto_media ? '1' : '0');
      if (typeof b.memory_auto === 'boolean') setSetting('memory_auto', b.memory_auto ? '1' : '0');
      if (b.temperature === '' || b.temperature === null) setSetting('temperature', '');
      else if (Number.isFinite(Number(b.temperature)) && b.temperature !== undefined) setSetting('temperature', String(Math.min(2, Math.max(0, Number(b.temperature)))));
      const num = (k, lo, hi) => { if (b[k] !== undefined && Number.isFinite(Number(b[k]))) setSetting(k, String(Math.min(hi, Math.max(lo, Math.floor(Number(b[k])))))); };
      num('max_tokens', 0, 200000); num('request_timeout', 15, 900); num('backup_keep', 3, 60); num('session_days', 1, 90);
      if (Number.isFinite(b.context_chars)) setSetting('context_chars', String(Math.min(600000, Math.max(8000, Math.floor(b.context_chars)))));
    });
    if (typeof b.api_key === 'string' && b.api_key.trim() && getSetting('base_url')) upsertProfile({ base_url: getSetting('base_url'), key: b.api_key.trim(), name: typeof b.profile_name === 'string' ? b.profile_name.trim() : '' });
    return json(res, 200, publicSettings());
  }
  if (p === '/api/profiles' && method === 'GET') return json(res, 200, { profiles: publicProfiles() });
  if ((m = p.match(/^\/api\/profiles\/([a-f0-9]{12})\/activate$/)) && method === 'POST') {
    const row = readProfiles().find((x) => x.id === m[1]);
    if (!row) throw new HttpError(404, 'اتصال ذخیره‌شده پیدا نشد.');
    tx(() => { setSetting('base_url', row.base_url); setSetting('api_key_enc', row.key_enc); setSetting('api_key_last4', row.last4); });
    modelCache = { at: 0, key: '', data: [] }; globalThis.__credits = null;
    return json(res, 200, publicSettings());
  }
  if ((m = p.match(/^\/api\/profiles\/([a-f0-9]{12})$/)) && method === 'PATCH') {
    const b = await readJson(req);
    writeProfiles(readProfiles().map((x) => (x.id === m[1] && typeof b.name === 'string' && b.name.trim() ? { ...x, name: b.name.trim().slice(0, 40) } : x)));
    return json(res, 200, publicSettings());
  }
  if ((m = p.match(/^\/api\/profiles\/([a-f0-9]{12})$/)) && method === 'DELETE') {
    const row = readProfiles().find((x) => x.id === m[1]);
    if (!row) throw new HttpError(404, 'اتصال ذخیره‌شده پیدا نشد.');
    writeProfiles(readProfiles().filter((x) => x.id !== m[1]));
    if (getSetting('api_key_enc') === row.key_enc || (getSetting('api_key_enc') && auth.decrypt(getSetting('api_key_enc')) === auth.decrypt(row.key_enc))) { setSetting('api_key_enc', ''); setSetting('api_key_last4', ''); modelCache = { at: 0, key: '', data: [] }; }
    globalThis.__credits = null;
    return json(res, 200, publicSettings());
  }
  if (p === '/api/settings/test' && method === 'POST') return json(res, 200, await testConnection(await readJson(req)));

  if (p === '/api/models' && method === 'GET') {
    const creds = getCreds();
    const key = creds.base + creds.key.slice(-6);
    if (url.searchParams.get('refresh') || modelCache.key !== key || Date.now() - modelCache.at > 5 * 60 * 1000) {
      modelCache = { at: Date.now(), key, data: await listModels(creds) };
    }
    return json(res, 200, { models: modelCache.data });
  }

  // conversations
  if (p === '/api/conversations' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const rows = q
      ? db.prepare(`SELECT DISTINCT c.id,c.title,c.model,c.updated_at FROM conversations c LEFT JOIN messages m ON m.conv_id=c.id
                    WHERE c.title LIKE ?1 ESCAPE '\\' OR m.content LIKE ?1 ESCAPE '\\' ORDER BY c.updated_at DESC LIMIT 100`)
          .all('%' + q.replace(/[\\%_]/g, '\\$&') + '%')
      : db.prepare('SELECT id,title,model,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 300').all();
    return json(res, 200, { conversations: rows });
  }
  if (p === '/api/conversations' && method === 'POST') {
    const id = crypto.randomUUID();
    const t = now();
    db.prepare('INSERT INTO conversations(id,title,model,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, DEFAULT_TITLE, getSetting('default_model') || null, t, t);
    return json(res, 200, { id });
  }
  // m declared above
  if ((m = p.match(/^\/api\/conversations\/([\w-]+)$/))) {
    const c = convRow(m[1]);
    if (method === 'GET') {
      const msgs = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id').all(c.id).map(publicMessage);
      const memIds = [...new Set(msgs.flatMap((x) => x.memory_used))];
      const mems = memIds.length ? db.prepare(`SELECT id,text FROM memories WHERE id IN (${memIds.map(() => '?').join(',')})`).all(...memIds) : [];
      return json(res, 200, { conversation: { id: c.id, title: c.title, model: c.model }, messages: msgs, memories: mems });
    }
    if (method === 'PATCH') {
      const b = await readJson(req);
      if (typeof b.title === 'string' && b.title.trim()) db.prepare('UPDATE conversations SET title=? WHERE id=?').run(b.title.trim().slice(0, 120), c.id);
      if (typeof b.model === 'string') db.prepare('UPDATE conversations SET model=? WHERE id=?').run(b.model, c.id);
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      const ids = db.prepare('SELECT attachments FROM messages WHERE conv_id=?').all(c.id).flatMap((r) => { try { return JSON.parse(r.attachments || '[]').map((a) => a.id); } catch { return []; } });
      db.prepare('DELETE FROM conversations WHERE id=?').run(c.id);
      const still = new Set(db.prepare('SELECT attachments FROM messages').all().flatMap((r) => { try { return JSON.parse(r.attachments || '[]').map((a) => a.id); } catch { return []; } }));
      for (const id of new Set(ids)) if (id && !still.has(id) && getUpload(id)) { db.prepare('DELETE FROM uploads WHERE id=?').run(id); { fs.rm(uploadPath(id), { force: true }, () => {}); for (const x of ['mp3','m4a','wav']) fs.rm(`${uploadPath(id)}.${x}`, { force: true }, () => {}); } }
      return json(res, 200, { ok: true });
    }
  }

  // chat (SSE)
  if ((m = p.match(/^\/api\/chat\/([\w-]+)$/)) && method === 'POST') {
    const conv = convRow(m[1]);
    const b = await readJson(req);
    const content = String(b.content || '').slice(0, 200000);
    const atts = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10).map((id) => getUpload(id)).filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name, mime: u.mime, size: u.size }));
    if (!b.regenerate && !content.trim() && !atts.length) throw new HttpError(400, 'پیام خالی است.');
    getCreds(); // fail fast with a clear message before opening the stream

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    const send = (event, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    try {
      await runChat({ conv, model: b.model, content, attachments: atts, regenerate: !!b.regenerate, fast: !!b.fast, send, signal: ctl.signal });
    } catch (e) {
      if (!ctl.signal.aborted) send('error', { message: e.message || 'خطای نامشخص' });
    } finally {
      clearInterval(ping);
      if (!res.writableEnded) res.end();
    }
    return;
  }

  if (p === '/api/image' && method === 'POST') {
    const b = await readJson(req);
    const conv = convRow(String(b.conv_id));
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, 'توضیح تصویر خالی است.');
    const atts = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 4).map((id) => getUpload(id)).filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name, mime: u.mime, size: u.size }));
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    return json(res, 200, await runImage({ conv, prompt, model: b.model, attachments: atts, signal: ctl.signal, opts: { aspect: b.aspect, style: b.style, enhance: b.enhance, count: b.count } }));
  }

  // video: starts a background job, the client polls it
  if (p === '/api/video' && method === 'POST') {
    const b = await readJson(req);
    const conv = convRow(String(b.conv_id));
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, 'توضیح ویدیو خالی است.');
    const seconds = [4, 8, 12].includes(Number(b.seconds)) ? Number(b.seconds) : 8;
    const aspect = ['16:9', '9:16', '1:1'].includes(b.aspect) ? b.aspect : '16:9';
    const { job, user } = startVideo({ conv, prompt, model: b.model, seconds, aspect });
    return json(res, 200, { job_id: job.id, user });
  }
  if ((m = p.match(/^\/api\/video\/([\w-]+)$/)) && method === 'GET') {
    const job = getVideoJob(m[1]);
    if (!job) throw new HttpError(404, 'کار ویدیو پیدا نشد (ممکن است سرور دوباره راه‌اندازی شده باشد).');
    return json(res, 200, { status: job.status, progress: job.progress, error: job.error, message: job.message });
  }

  // uploads: raw body, filename in header
  if (p === '/api/upload' && method === 'POST') {
    const name = decodeURIComponent(String(req.headers['x-filename'] || 'file')).replace(/[\\/]/g, '_').replace(/[^\P{Cc}]/gu, '').slice(0, 150) || 'file';
    const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].slice(0, 100);
    const buf = await readBody(req, MAX_UPLOAD_BYTES);
    if (!buf.length) throw new HttpError(400, 'فایل خالی است.');
    return json(res, 200, saveUpload({ name, mime, buffer: buf }));
  }
  if ((m = p.match(/^\/api\/files\/([\w-]+)$/)) && (method === 'GET' || method === 'HEAD')) {
    const u = getUpload(m[1]);
    if (!u || !fs.existsSync(uploadPath(u.id))) throw new HttpError(404, 'فایل پیدا نشد.');
    const inline = /^(image\/(png|jpe?g|webp|gif)|video\/(mp4|webm|quicktime)|audio\/)/.test(u.mime) && !url.searchParams.get('download');
    return serveFile(req, res, uploadPath(u.id), {
      'Content-Type': inline ? u.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(u.name)}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
  }

  // soundtrack of a video as a downloadable audio file (mp3 / m4a / wav)
  if ((m = p.match(/^\/api\/files\/([\w-]+)\/audio$/)) && method === 'GET') {
    const u = getUpload(m[1]);
    if (!u || !fs.existsSync(uploadPath(u.id))) throw new HttpError(404, 'فایل پیدا نشد.');
    if (!/^(video|audio)\//.test(u.mime)) throw new HttpError(400, 'این فایل ویدیو نیست.');
    if (!hasFfmpeg()) throw new HttpError(501, 'استخراج صدا روی این سرور فعال نیست (ffmpeg نصب نیست).');
    const fmt = AUDIO_FORMATS[url.searchParams.get('format')] ? url.searchParams.get('format') : 'mp3';
    const src = uploadPath(u.id);
    const info = await probe(src);
    if (info && !info.hasAudio) throw new HttpError(422, 'این ویدیو صدا ندارد.');
    const cache = `${src}.${fmt}`;
    if (!fs.existsSync(cache)) {
      const tmp = `${cache}.${process.pid}.tmp`;
      try { await extractAudio(src, tmp, fmt); fs.renameSync(tmp, cache); }
      catch (e) { fs.rm(tmp, { force: true }, () => {}); throw new HttpError(500, 'استخراج صدا ناموفق بود.'); }
    }
    return serveFile(req, res, cache, {
      'Content-Type': AUDIO_FORMATS[fmt].mime,
      'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(u.name.replace(/\.\w+$/, '') + '.' + fmt)}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
  }
  // media facts (resolution, duration, has sound) for the download menu
  if ((m = p.match(/^\/api\/files\/([\w-]+)\/info$/)) && method === 'GET') {
    const u = getUpload(m[1]);
    if (!u || !fs.existsSync(uploadPath(u.id))) throw new HttpError(404, 'فایل پیدا نشد.');
    const info = await probe(uploadPath(u.id));
    return json(res, 200, { ...u, ...(info || {}), audio_export: hasFfmpeg() && !!info?.hasAudio });
  }

  // remaining credit of the connected API key (best effort, depends on what the provider exposes)
  if (p === '/api/credits' && method === 'GET') {
    let creds;
    try { creds = getCreds(); } catch { return json(res, 200, { supported: false, connected: false }); }
    const cached = globalThis.__credits;
    if (cached && Date.now() - cached.at < 20000 && !url.searchParams.get('fresh')) return json(res, 200, cached.data);
    const data = { connected: true, ...(await getBalance(creds)) };
    globalThis.__credits = { at: Date.now(), data };
    return json(res, 200, data);
  }

  // generated files (from code blocks)
  if ((m = p.match(/^\/api\/messages\/(\d+)\/files$/)) && method === 'GET') {
    const msg = msgRow(m[1]);
    const files = extractFiles(msg.content);
    return json(res, 200, { files: files.map((f) => ({ path: f.path, size: Buffer.byteLength(f.content) })), preview: auth.previewSig(msg.id), has_index: files.some((f) => f.path === 'index.html' || f.path.endsWith('/index.html')) });
  }
  if ((m = p.match(/^\/api\/messages\/(\d+)\/check$/)) && method === 'GET') {
    const msg = msgRow(m[1]);
    return json(res, 200, checkProject(extractFiles(msg.content), msg.content));
  }
  if ((m = p.match(/^\/api\/messages\/(\d+)\/zip$/)) && method === 'GET') {
    const msg = msgRow(m[1]);
    const files = extractFiles(msg.content);
    if (!files.length) throw new HttpError(404, 'فایلی در این پیام نیست.');
    const zip = makeZip(files.map((f) => ({ path: f.path, data: Buffer.from(f.content, 'utf8') })));
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Content-Disposition': `attachment; filename="jinx-project-${msg.id}.zip"`, 'Cache-Control': 'no-store' });
    return res.end(zip);
  }
  if ((m = p.match(/^\/api\/messages\/(\d+)\/file$/)) && method === 'GET') {
    const msg = msgRow(m[1]);
    const want = sanitizePath(url.searchParams.get('path') || '');
    const f = extractFiles(msg.content).find((x) => x.path === want);
    if (!f) throw new HttpError(404, 'فایل پیدا نشد.');
    const buf = Buffer.from(f.content, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.path.split('/').pop())}` });
    return res.end(buf);
  }

  // memory
  if (p === '/api/memories' && method === 'GET') return json(res, 200, { memories: listMemories().map((x) => ({ ...x, pinned: !!x.pinned, enabled: !!x.enabled })) });
  if (p === '/api/handoff' && method === 'GET') {
    const d = collect({ maxChats: 60 });
    const fmt = url.searchParams.get('format') === 'json' ? 'json' : 'md';
    const body = fmt === 'json' ? JSON.stringify({ format: 'jinx-handoff', ...d }, null, 2) : toMarkdown(d);
    res.writeHead(200, { 'Content-Type': fmt === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="jinx-handoff-${new Date().toISOString().slice(0, 10)}.${fmt === 'json' ? 'json' : 'md'}"`, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (p === '/api/handoff/briefing' && method === 'POST') {
    const creds = getCreds();
    const model = getSetting('memory_model') || getSetting('default_model');
    if (!model) throw new HttpError(400, 'هیچ مدلی انتخاب نشده است.');
    const raw = toMarkdown(collect({ maxChats: 30 })).slice(0, 60000);
    const { text } = await complete([
      { role: 'system', content: 'You write handoff briefings. Turn the raw handoff pack into a polished, well-structured Markdown briefing another AI assistant can use to continue working with this user with zero context loss. Sections: 1) Who the user is and how they like to work (language, tone, preferences), 2) Active projects and their exact current state, 3) Completed work (what was built, key decisions, file names), 4) Open tasks and likely next steps, 5) Technical stack and conventions in use. Be dense, concrete and faithful: never invent facts, never include secrets or API keys. Write it in the language the user mostly uses.' },
      { role: 'user', content: raw },
    ], { model, creds, maxTokens: 3500, temperature: 0.2, timeoutMs: 120000 });
    return json(res, 200, { markdown: text.trim() });
  }
  if (p === '/api/memories/import' && method === 'POST') {
    const b = await readJson(req, 2 * 1024 * 1024);
    let lines = [];
    const txt = String(b.text || '');
    try { const j = JSON.parse(txt); const arr = Array.isArray(j) ? j : j.memories; if (Array.isArray(arr)) lines = arr.map((x) => (typeof x === 'string' ? x : x?.text)); } catch {}
    if (!lines.length) lines = txt.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^\[pinned\]\s*/i, '').trim()).filter((l) => l.length >= 6 && !/^#+\s/.test(l));
    const have = new Set(listMemories().map((x) => x.text.trim().toLowerCase()));
    let added = 0;
    for (const l of lines.slice(0, 300)) {
      const t = String(l || '').trim();
      if (!t || have.has(t.toLowerCase()) || /(sk-[a-z0-9_-]{16,}|api[_ -]?key\s*[:=])/i.test(t)) continue;
      if (addMemory({ text: t, tag: 'وارد‌شده', source: 'manual' })) { added++; have.add(t.toLowerCase()); }
    }
    return json(res, 200, { added });
  }
  if (p === '/api/memories' && method === 'POST') {
    const b = await readJson(req);
    const row = addMemory({ text: b.text, tag: b.tag || 'دستی', pinned: b.pinned });
    if (!row) throw new HttpError(400, 'متن خاطره خالی است.');
    return json(res, 200, { memory: { ...row, pinned: !!row.pinned, enabled: !!row.enabled } });
  }
  if ((m = p.match(/^\/api\/memories\/([\w-]+)$/))) {
    const row = db.prepare('SELECT * FROM memories WHERE id=?').get(m[1]);
    if (!row) throw new HttpError(404, 'خاطره پیدا نشد.');
    if (method === 'PATCH') {
      const b = await readJson(req);
      const next = {
        text: typeof b.text === 'string' && b.text.trim() ? b.text.trim().slice(0, 500) : row.text,
        tag: typeof b.tag === 'string' ? b.tag.slice(0, 30) : row.tag,
        pinned: typeof b.pinned === 'boolean' ? +b.pinned : row.pinned,
        enabled: typeof b.enabled === 'boolean' ? +b.enabled : row.enabled,
      };
      db.prepare('UPDATE memories SET text=?,tag=?,pinned=?,enabled=?,updated_at=? WHERE id=?').run(next.text, next.tag, next.pinned, next.enabled, now(), row.id);
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') { db.prepare('DELETE FROM memories WHERE id=?').run(row.id); return json(res, 200, { ok: true }); }
  }

  // system
  if (p === '/api/system' && method === 'GET') {
    const dirSize = (d) => { let n = 0, c = 0; try { for (const f of fs.readdirSync(d)) { try { const s = fs.statSync(path.join(d, f)); if (s.isFile()) { n += s.size; c++; } } catch {} } } catch {} return { bytes: n, count: c }; };
    const backups = (() => { try { return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().reverse().slice(0, 10).map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size })); } catch { return []; } })();
    const warnings = [];
    if (!SECRET_FROM_ENV) warnings.push('SECRET_KEY در متغیرهای محیطی تنظیم نشده؛ کلید موقت داخل پوشه داده‌ها ذخیره شده است.');
    if (!isHttps(req) && !/^(localhost|127\.)/.test(String(req.headers.host || ''))) warnings.push('اتصال از راه HTTPS نیست.');
    if (ADMIN_PASSWORD.length < 12) warnings.push('رمز مدیر کوتاه است؛ حداقل ۱۲ کاراکتر پیشنهاد می‌شود.');
    const mem = process.memoryUsage();
    return json(res, 200, {
      version: VERSION, node: process.version, uptime_s: Math.floor((Date.now() - STARTED_AT) / 1000), data_dir: DATA_DIR,
      db_bytes: (() => { try { return fs.statSync(DB_FILE).size; } catch { return 0; } })(),
      uploads: dirSize(UPLOAD_DIR), backups, rss: mem.rss, warnings,
    });
  }
  if (p === '/api/system/backup' && method === 'POST') {
    const f = makeBackup(); rotateBackups();
    return json(res, 200, { ok: true, name: path.basename(f) });
  }

  // usage
  if (p === '/api/usage' && method === 'GET') {
    const since = now() - 30 * 86400000;
    const rows = db.prepare(`SELECT model, COUNT(*) AS calls, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,
                             SUM(cost) AS cost, MAX(estimated) AS estimated FROM usage WHERE created_at >= ? GROUP BY model ORDER BY (SUM(prompt_tokens)+SUM(completion_tokens)) DESC`).all(since);
    return json(res, 200, { since, rows, memories: db.prepare('SELECT COUNT(*) n FROM memories').get().n, conversations: db.prepare('SELECT COUNT(*) n FROM conversations').get().n });
  }

  // data safety
  if (p === '/api/export' && method === 'GET') {
    const body = JSON.stringify(exportAll());
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="jinx-export-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (p === '/api/import' && method === 'POST') return json(res, 200, { imported: importAll(await readJson(req, 100 * 1024 * 1024)) });
  if (p === '/api/backup' && method === 'GET') {
    const f = makeBackup('download-' + Date.now());
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="jinx-${new Date().toISOString().slice(0, 10)}.db"`, 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res).on('close', () => fs.rm(f, { force: true }, () => {}));
    return;
  }

  throw new HttpError(404, 'مسیر پیدا نشد.');
}

function serveFile(req, res, file, headers) {
  const st = fs.statSync(file);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// live preview of generated sites, served from the message content under a signed, unguessable URL
function preview(req, res, url) {
  const m = url.pathname.match(/^\/preview\/(\d+)\.([a-f0-9]{32})\/(.*)$/);
  if (!m || m[2] !== auth.previewSig(m[1])) throw new HttpError(404, 'پیش‌نمایش پیدا نشد.');
  const msg = msgRow(m[1]);
  const files = extractFiles(msg.content);
  let want;
  try { want = decodeURIComponent(m[3] || '') || 'index.html'; } catch { throw new HttpError(400, 'آدرس نامعتبر.'); }
  if (want.endsWith('/')) want += 'index.html';
  const f = files.find((x) => x.path === want) || files.find((x) => x.path === want.replace(/^[^/]+\//, ''));
  if (!f) throw new HttpError(404, 'فایل پیدا نشد.');
  let text = f.content;
  if (/\.html?$/i.test(f.path)) {
    const probe = `<script>(function(){function s(m){try{parent.postMessage({jinx:'err',msg:String(m).slice(0,300)},'*')}catch(e){}}window.addEventListener('error',function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){s('Failed to load '+(t.src||t.href).split('/').slice(-2).join('/'));return}s((e.message||'Error')+(e.filename?' @ '+e.filename.split('/').pop()+':'+e.lineno:''))},true);window.addEventListener('unhandledrejection',function(e){s('Promise: '+((e.reason&&e.reason.message)||e.reason))});var ce=console.error;console.error=function(){s([].join.call(arguments,' '));ce.apply(console,arguments)}})();</script>`;
    text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (h) => h + probe) : probe + text;
  }
  const body = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': mimeFor(f.path), 'Content-Length': body.length, 'Cache-Control': 'no-store',
    'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// ---------- static ----------
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const STATIC_CACHE = new Map();
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'آدرس نامعتبر.'); }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const name = rel.slice(1);
  if (!STATIC_FILES.has(name)) throw new HttpError(404, 'پیدا نشد.');
  const file = path.join(PUBLIC, name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'پیدا نشد.');
  const ext = path.extname(file);
  const st = fs.statSync(file);
  const ck = name + ':' + st.mtimeMs;
  let ent = STATIC_CACHE.get(ck);
  if (!ent) {
    const raw = fs.readFileSync(file);
    ent = { raw, gz: raw.length > 600 ? zlib.gzipSync(raw, { level: 9 }) : null, etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
    STATIC_CACHE.set(ck, ent);
  }
  const headers = { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: ent.etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === ent.etag) { res.writeHead(304, headers); return res.end(); }
  const useGz = ent.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const out = useGz ? ent.gz : ent.raw;
  if (useGz) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = out.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/preview/')) return preview(req, res, url);
    for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'روش مجاز نیست.');
    return serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    if (e instanceof UpstreamError) return json(res, e.status >= 400 && e.status < 600 ? e.status : 502, { error: e.message });
    console.error('[server]', req.method, url.pathname, e);
    return json(res, 500, { error: 'خطای داخلی سرور.' });
  }
});
server.requestTimeout = 0;
server.headersTimeout = 30000;
server.keepAliveTimeout = 65000;

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); });

startBackupLoop();
server.on('error', (e) => { console.error('FATAL: server error:', e.message); process.exit(1); });
server.listen(PORT, '0.0.0.0', () => console.log(`Jinx listening on :${PORT}  data: ${DATA_DIR}`));
