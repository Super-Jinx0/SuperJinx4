import { getSetting } from './db.js';
import { decrypt } from './auth.js';

export class UpstreamError extends Error {
  constructor(message, status = 502, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function normalizeBase(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/(chat\/completions|models|images\/generations)$/i, '');
  return u;
}

export function validBase(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getCreds(override = {}) {
  const base = normalizeBase(override.base_url || getSetting('base_url'));
  const key = override.api_key || decrypt(getSetting('api_key_enc'));
  if (!base || !key) throw new UpstreamError('اتصال API هنوز تنظیم نشده است. از بخش «اتصال» آدرس و کلید را وارد کن.', 400);
  if (!validBase(base)) throw new UpstreamError('آدرس API معتبر نیست.', 400);
  return { base, key };
}

export function explain(status, body = '') {
  let hint = '';
  try {
    const j = JSON.parse(body);
    hint = j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '') || '';
  } catch {
    hint = String(body).slice(0, 200);
  }
  hint = String(hint).slice(0, 300);
  const map = {
    400: 'درخواست توسط سرویس رد شد. ممکن است مدل یا ورودی پشتیبانی نشود.',
    401: 'کلید API نامعتبر است یا منقضی شده.',
    402: 'اعتبار حساب تمام شده است.',
    403: 'دسترسی این کلید به این مدل یا سرویس مجاز نیست.',
    404: 'آدرس یا نام مدل پیدا نشد. آدرس پایه و نام مدل را بررسی کن.',
    408: 'سرویس دیر پاسخ داد.',
    413: 'ورودی بیش از حد بزرگ است.',
    429: 'محدودیت تعداد درخواست یا سهمیه. کمی بعد دوباره امتحان کن.',
  };
  const base = map[status] || (status >= 500 ? 'سرویس مقصد موقتا مشکل دارد.' : `خطای ناشناخته از سرویس (${status}).`);
  return new UpstreamError(hint ? `${base} (${hint})` : base, status, hint);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout, and retries for network errors / 429 / 5xx before any byte is consumed */
export async function request(path, { method = 'GET', body, creds, signal, timeoutMs = 120000, retries = 2, stream = false } = {}) {
  const { base, key } = creds || getCreds();
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
    try {
      const res = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Atlas',
          ...(stream ? { Accept: 'text/event-stream' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return res;
      const text = await res.text().catch(() => '');
      const err = explain(res.status, text);
      if ((res.status === 429 || res.status >= 500) && attempt < retries && !signal?.aborted) {
        lastErr = err;
        await sleep(600 * 2 ** attempt);
        continue;
      }
      throw err;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof UpstreamError) throw e;
      if (signal?.aborted) throw e;
      lastErr = new UpstreamError(
        e?.cause?.code === 'ENOTFOUND' ? 'آدرس سرویس پیدا نشد (DNS). آدرس پایه را بررسی کن.'
          : e?.message === 'timeout' || e?.name === 'AbortError' ? 'سرویس در زمان مقرر پاسخ نداد.'
          : 'ارتباط با سرویس برقرار نشد.', 504, String(e?.cause?.code || e?.message || ''));
      if (attempt < retries) { await sleep(600 * 2 ** attempt); continue; }
    }
  }
  throw lastErr;
}

export async function listModels(creds) {
  const res = await request('/models', { creds, retries: 1, timeoutMs: 30000 });
  const j = await res.json().catch(() => ({}));
  const arr = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
  return arr.map((m) => {
    const id = m.id || m.name;
    const out = m.architecture?.output_modalities || [];
    return {
      id,
      name: m.name || id,
      ctx: m.context_length || m.context_window || null,
      image_output: out.includes('image') || /image|dall-e|imagen|flux|sdxl|stable-diffusion/i.test(id || ''),
      price_in: m.pricing?.prompt != null ? Number(m.pricing.prompt) * 1e6 : null,
      price_out: m.pricing?.completion != null ? Number(m.pricing.completion) * 1e6 : null,
    };
  }).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id));
}

/** Non-streaming completion, returns { text, usage } */
export async function complete(messages, { model, creds, signal, maxTokens, temperature = 0.2, timeoutMs = 90000 } = {}) {
  const res = await request('/chat/completions', {
    method: 'POST', creds, signal, timeoutMs, retries: 1,
    body: { model, messages, stream: false, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}) },
  });
  const j = await res.json();
  return { text: j?.choices?.[0]?.message?.content || '', usage: j?.usage || null, raw: j };
}

/** Streaming completion. Calls onDelta(text), onImages(urls). Returns { text, usage, images } */
export async function streamChat(messages, { model, creds, signal, onDelta, onImages, onReasoning, temperature, maxTokens, timeoutMs = 60000 }) {
  const body = { model, messages, stream: true, stream_options: { include_usage: true } };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (maxTokens > 0) body.max_tokens = maxTokens;
  let res;
  try {
    res = await request('/chat/completions', { method: 'POST', body, creds, signal, stream: true, retries: 2, timeoutMs });
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 400 && /stream_options/i.test(e.detail || '')) {
      delete body.stream_options;
      res = await request('/chat/completions', { method: 'POST', body, creds, signal, stream: true, retries: 1, timeoutMs });
    } else throw e;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  const images = [];
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new UpstreamError(j.error.message || 'خطا در میانه پاسخ', 502, JSON.stringify(j.error).slice(0, 300));
    if (j.usage) usage = j.usage;
    const d = j.choices?.[0]?.delta;
    if (!d) return;
    const rs = typeof d.reasoning === 'string' ? d.reasoning : typeof d.reasoning_content === 'string' ? d.reasoning_content : '';
    if (rs) onReasoning?.(rs);
    if (typeof d.content === 'string' && d.content) { text += d.content; onDelta?.(d.content); }
    else if (Array.isArray(d.content)) {
      for (const p of d.content) if (p?.type === 'text' && p.text) { text += p.text; onDelta?.(p.text); }
    }
    if (Array.isArray(d.images)) {
      const urls = d.images.map((x) => x?.image_url?.url || x?.url).filter(Boolean);
      if (urls.length) { images.push(...urls); onImages?.(urls); }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + (buf[i] === '\r' ? 4 : 2));
      for (const line of block.split(/\r?\n/)) handle(line);
    }
  }
  if (buf.trim()) for (const line of buf.split(/\r?\n/)) handle(line);
  return { text, usage, images };
}

const ASPECT_SIZES = {
  dalle3: { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792', '4:3': '1792x1024', '3:4': '1024x1792' },
  other: { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536', '4:3': '1536x1024', '3:4': '1024x1536' },
};
export const sizeFor = (model, aspect) => (/dall-?e-?3/i.test(model) ? ASPECT_SIZES.dalle3 : ASPECT_SIZES.other)[aspect] || '1024x1024';

/** Image generation: OpenAI images API first (with progressively simpler parameters), then chat-completions with image modality. */
export async function generateImage({ prompt, model, creds, inputImages = [], signal, aspect = '1:1', count = 1 }) {
  const n = Math.min(4, Math.max(1, Number(count) || 1));
  if (inputImages.length === 0) {
    const size = sizeFor(model, aspect);
    const quality = /gpt-image/i.test(model) ? 'high' : /dall-?e-?3/i.test(model) ? 'hd' : null;
    const variants = [
      ...(quality ? [{ size, quality, n }] : []),
      { size, n }, { n }, {},
    ];
    for (const v of variants) {
      try {
        const res = await request('/images/generations', { method: 'POST', creds, signal, retries: 1, timeoutMs: 240000, body: { model, prompt, ...v } });
        const j = await res.json();
        const items = (j.data || []).map((d) => (d.b64_json ? { b64: d.b64_json } : d.url ? { url: d.url } : null)).filter(Boolean);
        if (items.length) return { items, text: '', usage: j.usage || null };
        break;
      } catch (e) {
        if (!(e instanceof UpstreamError)) throw e;
        if (e.status === 400 || e.status === 422) continue; // parameter not supported: try a simpler request
        if (e.status === 404 || e.status === 405) break; // endpoint missing: use chat route
        throw e;
      }
    }
  }
  const content = inputImages.length
    ? [{ type: 'text', text: prompt }, ...inputImages.map((u) => ({ type: 'image_url', image_url: { url: u } }))]
    : prompt;
  const base = { model, messages: [{ role: 'user', content }], modalities: ['image', 'text'], stream: false };
  let res;
  try {
    res = await request('/chat/completions', { method: 'POST', creds, signal, retries: 1, timeoutMs: 240000, body: { ...base, image_config: { aspect_ratio: aspect, image_size: '2K' } } });
  } catch (e) {
    if (e instanceof UpstreamError && (e.status === 400 || e.status === 422)) {
      try {
        res = await request('/chat/completions', { method: 'POST', creds, signal, retries: 1, timeoutMs: 240000, body: { ...base, image_config: { aspect_ratio: aspect } } });
      } catch (e2) {
        if (!(e2 instanceof UpstreamError && (e2.status === 400 || e2.status === 422))) throw e2;
        res = await request('/chat/completions', { method: 'POST', creds, signal, retries: 1, timeoutMs: 240000, body: base });
      }
    } else throw e;
  }
  const j = await res.json();
  const msg = j?.choices?.[0]?.message || {};
  const items = (msg.images || []).map((x) => x?.image_url?.url || x?.url).filter(Boolean).map((u) => {
    const m = /^data:[^;]+;base64,(.+)$/.exec(u);
    return m ? { b64: m[1] } : { url: u };
  });
  if (!items.length) throw new UpstreamError('این مدل تصویری برنگرداند. یک مدل تولید تصویر انتخاب کن.', 422);
  return { items, text: typeof msg.content === 'string' ? msg.content : '', usage: j.usage || null };
}

// ---------- video (OpenAI-compatible async jobs: POST /videos, GET /videos/{id}, GET /videos/{id}/content) ----------
export const VIDEO_SIZES = { '16:9': '1280x720', '9:16': '720x1280', '1:1': '1024x1024' };
export async function createVideo({ prompt, model, creds, seconds, aspect = '16:9', signal }) {
  const body = { model, prompt };
  if (seconds) body.seconds = String(seconds);
  if (VIDEO_SIZES[aspect]) body.size = VIDEO_SIZES[aspect];
  const res = await request('/videos', { method: 'POST', creds, signal, retries: 0, timeoutMs: 120000, body });
  return res.json();
}
export async function getVideo(id, creds, signal) {
  const res = await request(`/videos/${encodeURIComponent(id)}`, { creds, signal, retries: 2, timeoutMs: 30000 });
  return res.json();
}
/** Streams the finished video to a file on disk; returns { bytes, mime } */
export async function downloadVideo({ id, url, creds, dest, signal }) {
  const fs = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  let res;
  if (url) {
    const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000) });
    if (!r.ok) throw new UpstreamError(`دانلود ویدیو ناموفق بود (${r.status}).`, 502);
    res = r;
  } else {
    res = await request(`/videos/${encodeURIComponent(id)}/content`, { creds, signal, retries: 2, timeoutMs: 120000 });
  }
  const mime = (res.headers.get('content-type') || 'video/mp4').split(';')[0];
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  const bytes = fs.statSync(dest).size;
  if (!bytes) throw new UpstreamError('فایل ویدیو خالی بود.', 502);
  return { bytes, mime: /^video\//.test(mime) ? mime : 'video/mp4' };
}

/**
 * Remaining credit / usage limits. Tries the common provider shapes and returns a normalized object:
 * { supported, total, used, remaining, unlimited, label, raw_source }  (amounts in USD / provider currency)
 */
export async function getBalance(creds) {
  const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
  const tries = [
    async () => { // OpenRouter key info
      const j = await (await request('/key', { creds, retries: 0, timeoutMs: 15000 })).json();
      const d = j.data || j;
      if (d.usage === undefined && d.limit === undefined) return null;
      const used = num(d.usage), limit = num(d.limit);
      return { source: 'key', label: d.label || '', used, total: limit, remaining: num(d.limit_remaining) ?? (limit != null && used != null ? limit - used : null), unlimited: limit == null, free: !!d.is_free_tier };
    },
    async () => { // OpenRouter account credits
      const j = await (await request('/credits', { creds, retries: 0, timeoutMs: 15000 })).json();
      const d = j.data || j;
      const total = num(d.total_credits), used = num(d.total_usage);
      if (total == null) return null;
      return { source: 'credits', used, total, remaining: used != null ? total - used : null, unlimited: false };
    },
    async () => { // DeepSeek style
      const j = await (await request('/user/balance', { creds, retries: 0, timeoutMs: 15000 })).json();
      const b = j.balance_infos?.[0];
      if (!b) return null;
      return { source: 'balance', remaining: num(b.total_balance), total: null, used: null, unlimited: false, currency: b.currency };
    },
    async () => { // OpenAI-compatible proxies (new-api / one-api)
      const j = await (await request('/dashboard/billing/subscription', { creds, retries: 0, timeoutMs: 15000 })).json();
      const total = num(j.hard_limit_usd ?? j.system_hard_limit_usd);
      if (total == null) return null;
      let used = null;
      try {
        const d1 = new Date(), d0 = new Date(Date.now() - 90 * 86400000);
        const f = (d) => d.toISOString().slice(0, 10);
        const u = await (await request(`/dashboard/billing/usage?start_date=${f(d0)}&end_date=${f(new Date(d1.getTime() + 86400000))}`, { creds, retries: 0, timeoutMs: 15000 })).json();
        used = num(u.total_usage) != null ? num(u.total_usage) / 100 : null;
      } catch {}
      return { source: 'billing', total, used, remaining: used != null ? total - used : null, unlimited: total > 1e8 };
    },
  ];
  for (const t of tries) {
    try { const r = await t(); if (r) return { supported: true, currency: 'USD', ...r }; } catch {}
  }
  return { supported: false };
}
