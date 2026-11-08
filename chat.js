import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now, getSetting, tx } from './db.js';
import { UPLOAD_DIR } from './config.js';
import { complete, streamChat, getCreds, generateImage, createVideo, getVideo, downloadVideo, UpstreamError } from './upstream.js';
import { hasFfmpeg, upscaleImage } from './media.js';
import { selectMemories, memoryBlock, extractMemories } from './memory.js';

export const DEFAULT_TITLE = 'گفتگوی جدید';

export const SYSTEM_BASE = `You are Jinx, the user's private AI assistant: a world-class senior software architect, full-stack engineer, product designer, researcher and writer in one. You are built to deliver professional, production-grade, enterprise-level results. Be direct, accurate and genuinely useful, with a warm, confident, concise tone. Reply in the language the user writes in (Persian by default; match English, Arabic, Turkish etc. when the user uses them).
If you do not know something, say so; never invent facts, links, APIs or results.

HOW YOU WORK
1. Understand the real goal behind the request, including what the user did not say. Make sensible decisions yourself instead of asking many questions; ask only when something critical is truly ambiguous.
2. For anything non-trivial, think first: decide the architecture, edge cases, failure modes, security and performance before writing. Then deliver the complete solution in one go, not a sketch.
3. Verify before you answer: re-read your own code for syntax errors, undefined names, wrong imports, off-by-one and async mistakes, broken links and mismatched file names. Fix what you find silently.
4. Prefer the best modern, well-supported tools and the latest stable practices. Write clean, typed where useful, well-structured, commented-where-needed code with proper error handling, input validation, logging and tests when the project warrants it.
5. Zero-defect delivery for websites and apps: every file you reference must exist in your answer; every id/class/function used by JS must exist in the HTML/CSS; no undefined variables, no external images/scripts that may fail (inline SVG and CSS instead), no console errors, no blank states, all buttons and forms actually work, keyboard and mobile friendly. Mentally run the page once from load to every interaction before finishing.
6. Be fast: no long preambles or restating the request. Begin the files quickly; keep prose outside code to a few short lines.
7. Be honest about trade-offs and risks, and suggest the next most valuable improvement in one short line.

FILES AND PROJECTS
When the user asks you to create a file, a website, an app or a project, output EVERY file as its own fenced code block whose info string contains file:<relative/path>, for example:
\`\`\`html file:index.html
<!doctype html>...
\`\`\`
Rules: complete working content with no placeholders or "rest of code here"; relative paths only (no leading slash, no ..); every file you reference (CSS, JS, images) must also be delivered; if a file itself contains triple backticks wrap it in a fence of four backticks. Keep explanations outside the code blocks short and write the files in a sensible build order (structure first, then styles, then logic) so the user can watch the project take shape live. The app turns these blocks into downloadable files, a ZIP and a live preview, so never tell the user to copy files manually.
For large or organization-level projects (SaaS, dashboards, APIs, bots, internal tools): provide a clear folder structure, README with setup/run/deploy steps, .env.example, Dockerfile when relevant, authentication and role handling, database schema/migrations, validation, error handling, security basics (secrets in env, rate limiting, sanitization, CSRF/XSS/SQL-injection protection) and a short test suite. Split the work into modules; never produce one giant file.

WEBSITE AND UI QUALITY BAR (when building anything visual)
Aim for a striking, professional, award-level result, never a bland template. Use a deliberate design system: CSS variables for colors/spacing/radius/shadows, a refined palette (not default blue/purple gradients unless asked), fluid typography with clamp(), generous whitespace, strong hierarchy, glassmorphism/gradients/subtle noise only when they fit. Make it fully responsive (mobile first), accessible (contrast, focus states, aria, alt text, prefers-reduced-motion) and fast. Add tasteful motion: smooth hover/focus transitions, scroll reveal with IntersectionObserver, micro-interactions, a real dark/light theme when it fits. Use real, believable copy in the user's language (no lorem ipsum). For Persian use dir="rtl" lang="fa" and the Vazirmatn font (Google Fonts link plus system fallbacks). Do not rely on external images: draw visuals with inline SVG, CSS gradients and shapes. Use vanilla HTML/CSS/JS in separate files (index.html, style.css, script.js, more pages if useful) unless a framework is requested; the page must work by opening index.html.

MEDIA
Image and video generation are built into this app and are triggered from the composer (or automatically when the user asks for a picture or video). Generated images and videos can be downloaded, and the soundtrack of a video can be downloaded as audio. Never claim you cannot create images or videos. For icons, logos, diagrams or illustrations you may also deliver clean SVG files.

Markdown is supported. Use code fences with a language for any code.`;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yml|yaml|toml|ini|env|log|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|sql|swift|dart|vue|svelte|gitignore|dockerfile)$/i;
const IMG_MIME = /^image\/(png|jpe?g|webp|gif)$/;

export const isTextFile = (name, mime) => /^text\//.test(mime) || /json|xml|javascript|yaml/.test(mime) || TEXT_EXT.test(name);
export const uploadPath = (id) => path.join(UPLOAD_DIR, id);

export function getUpload(id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) return null;
  return db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
}

export function saveUpload({ name, mime, buffer }) {
  const id = crypto.randomUUID();
  fs.writeFileSync(uploadPath(id), buffer);
  db.prepare('INSERT INTO uploads(id,name,mime,size,created_at) VALUES(?,?,?,?,?)').run(id, name, mime, buffer.length, now());
  return { id, name, mime, size: buffer.length };
}

function userContent(row, { withImages }) {
  const atts = JSON.parse(row.attachments || '[]');
  let text = row.content || '';
  const parts = [];
  for (const a of atts) {
    const up = getUpload(a.id);
    if (!up) continue;
    if (IMG_MIME.test(up.mime)) {
      if (withImages && up.size <= 8 * 1024 * 1024) {
        try {
          const b64 = fs.readFileSync(uploadPath(up.id)).toString('base64');
          parts.push({ type: 'image_url', image_url: { url: `data:${up.mime};base64,${b64}` } });
        } catch {}
      } else text += `\n[Earlier attached image: ${up.name}]`;
    } else if (isTextFile(up.name, up.mime) && up.size <= 1024 * 1024) {
      let body = '';
      try { body = fs.readFileSync(uploadPath(up.id), 'utf8'); } catch {}
      const clipped = body.length > 100000 ? body.slice(0, 100000) + '\n…[truncated]' : body;
      text += `\n\n[Attached file: ${up.name}]\n\`\`\`\n${clipped}\n\`\`\``;
    } else {
      text += `\n[Attached file "${up.name}" (${up.mime}, ${up.size} bytes). Its content could not be read by the assistant.]`;
    }
  }
  if (!parts.length) return text;
  return [{ type: 'text', text: text || ' ' }, ...parts];
}

const lengthOf = (c) => (typeof c === 'string' ? c.length : c.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 1500), 0));

export const FAST_NOTE = `FAST BUILD MODE (the user wants a result quickly): do not plan out loud, do not list options, no preamble. Start with ONE short sentence, then immediately output the files. Keep the project compact: for a website deliver index.html + style.css + script.js (or a single index.html with inline CSS/JS when simpler), roughly 250 to 500 lines total, polished but without bloat, no long comments. After the files write at most two short lines. Still obey every quality rule: working code, no placeholders, no broken links, no console errors.`;

export function buildContext(conv, memBlock, { fast = false } = {}) {
  const rows = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY id').all(conv.id);
  const budget = Number(getSetting('context_chars', '120000'));
  const imgRowIds = new Set(rows.filter((r) => r.role === 'user' && JSON.parse(r.attachments || '[]').some((a) => IMG_MIME.test(a.mime || ''))).slice(-3).map((r) => r.id));
  const msgs = [];
  let used = 0;
  let cut = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const content = r.role === 'user' ? userContent(r, { withImages: imgRowIds.has(r.id) }) : r.content;
    const len = lengthOf(content);
    if (used + len > budget && msgs.length > 0) break;
    used += len;
    msgs.unshift({ role: r.role, content });
    cut = i;
  }
  const dropped = rows.slice(0, cut);
  const custom = getSetting('system_prompt', '').trim();
  const sys = [SYSTEM_BASE];
  if (fast) sys.push(FAST_NOTE);
  if (custom) sys.push('User-defined instructions:\n' + custom);
  if (memBlock) sys.push(memBlock);
  if (conv.summary) sys.push('Summary of the earlier part of this conversation (older messages were trimmed):\n' + conv.summary);
  return { messages: [{ role: 'system', content: sys.join('\n\n') }, ...msgs], dropped };
}

export function insertMessage(convId, fields) {
  const r = db.prepare(
    'INSERT INTO messages(conv_id,role,content,model,attachments,memory_used,usage,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).run(convId, fields.role, fields.content ?? '', fields.model ?? null, JSON.stringify(fields.attachments || []),
    JSON.stringify(fields.memory_used || []), fields.usage ? JSON.stringify(fields.usage) : null, now());
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), convId);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
}

export function recordUsage(model, usage, { kind = 'chat', estimate = 0 } = {}) {
  const p = usage?.prompt_tokens ?? 0;
  const c = usage?.completion_tokens ?? 0;
  const cost = typeof usage?.cost === 'number' ? usage.cost : null;
  db.prepare('INSERT INTO usage(model,prompt_tokens,completion_tokens,cost,estimated,kind,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(model || 'unknown', p || estimate, c, cost, usage ? 0 : 1, kind, now());
}

export function publicMessage(r) {
  return {
    id: r.id, role: r.role, content: r.content, model: r.model,
    attachments: JSON.parse(r.attachments || '[]'),
    memory_used: JSON.parse(r.memory_used || '[]'),
    usage: r.usage ? JSON.parse(r.usage) : null,
    created_at: r.created_at,
  };
}

function saveDataUrlImage(u, name) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(u);
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg').replace('+xml', '');
  return saveUpload({ name: `${name}.${ext}`, mime: m[1], buffer: Buffer.from(m[2], 'base64') });
}

const privateHost = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1|\[?fc|\[?fd)/i;
async function downloadImage(url, baseHost) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  if (u.hostname !== baseHost && privateHost.test(u.hostname)) throw new Error('blocked host');
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('download ' + res.status);
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
  if (!/^image\//.test(mime)) throw new Error('not an image');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('too large');
  return saveUpload({ name: `image-${Date.now()}.${mime.split('/')[1].replace('jpeg', 'jpg')}`, mime, buffer: buf });
}

// ---- main chat turn (SSE) ----
export async function runChat({ conv, model, content, attachments, regenerate, fast = false, send, signal }) {
  const creds = getCreds();
  const useModel = model || conv.model || getSetting('default_model');
  if (!useModel) throw new UpstreamError('هیچ مدلی انتخاب نشده است.', 400);

  tx(() => {
    if (regenerate) {
      const last = db.prepare("SELECT id FROM messages WHERE conv_id=? AND role='user' ORDER BY id DESC LIMIT 1").get(conv.id);
      if (!last) throw new UpstreamError('پیامی برای تولید دوباره نیست.', 400);
      db.prepare('DELETE FROM messages WHERE conv_id = ? AND id > ?').run(conv.id, last.id);
    } else {
      insertMessage(conv.id, { role: 'user', content, attachments });
      if (conv.title === DEFAULT_TITLE) {
        const t = content.replace(/\s+/g, ' ').trim().slice(0, 48) || attachments[0]?.name || DEFAULT_TITLE;
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(t, conv.id);
        send('title', { title: t });
      }
    }
    db.prepare('UPDATE conversations SET model = ? WHERE id = ?').run(useModel, conv.id);
  });

  const lastUser = db.prepare("SELECT * FROM messages WHERE conv_id=? AND role='user' ORDER BY id DESC LIMIT 1").get(conv.id);
  const mems = selectMemories(lastUser.content);
  send('meta', { model: useModel, memories: mems.map((m) => ({ id: m.id, text: m.text })) });

  const fresh = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
  const { messages, dropped } = buildContext(fresh, memoryBlock(mems), { fast });

  let text = '';
  const savedImages = [];
  let usage = null;
  let failure = null;
  try {
    const r = await streamChat(messages, {
      model: useModel, creds, signal,
      temperature: getSetting('temperature', '') === '' ? undefined : Number(getSetting('temperature')),
      maxTokens: Number(getSetting('max_tokens', '0')),
      timeoutMs: Number(getSetting('request_timeout', '60')) * 1000,
      onDelta: (d) => { text += d; send('delta', { text: d }); },
      onReasoning: (d) => send('reasoning', { text: d }),
      onImages: (urls) => {
        for (const u of urls) {
          const up = saveDataUrlImage(u, `image-${Date.now()}`);
          if (up) { savedImages.push(up); send('image', up); }
        }
      },
    });
    usage = r.usage;
    if (!text) text = r.text;
  } catch (e) {
    failure = e;
  }

  if (failure && !text && !savedImages.length) throw failure;

  const aborted = signal?.aborted;
  const row = insertMessage(conv.id, {
    role: 'assistant', content: text + (failure && !aborted ? '\n\n> پاسخ ناقص ماند: ' + failure.message : ''),
    model: useModel, attachments: savedImages, memory_used: mems.map((m) => m.id), usage,
  });
  recordUsage(useModel, usage, { estimate: Math.ceil(lengthOf(messages.map((m) => m.content).join('')) / 4) });
  const pub = publicMessage(row);
  if (!aborted) send('done', { message: pub });
  if (failure && !aborted) send('error', { message: failure.message });

  // background work: never blocks the reply, never throws
  setImmediate(async () => {
    try {
      if (!failure) {
        const saved = await extractMemories({ userText: lastUser.content, assistantText: text, model: getSetting('memory_model') || useModel, creds });
        if (saved.length) send('memory', { saved: saved.map((m) => ({ id: m.id, text: m.text })) });
      }
      const fresh2 = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
      const fresh3 = dropped.filter((r) => r.id > fresh2.summarized_upto);
      if (fresh3.length) {
        const chunk = fresh3.map((r) => `${r.role}: ${r.content}`).join('\n\n').slice(-30000);
        const { text: summary } = await complete([
          { role: 'system', content: 'Update the running summary of a conversation. Keep decisions, facts, code/file names, open tasks and the user\'s goals. Be dense and under 400 words. Same language as the conversation. Output only the summary.' },
          { role: 'user', content: `Previous summary:\n${fresh2.summary || '(none)'}\n\nNew older messages:\n${chunk}` },
        ], { model: getSetting('memory_model') || useModel, creds, maxTokens: 700 });
        if (summary.trim()) db.prepare('UPDATE conversations SET summary = ?, summarized_upto = ? WHERE id = ?').run(summary.trim(), fresh3.at(-1).id, conv.id);
      }
    } catch (e) {
      console.error('[chat] background task failed:', e.message);
    }
  });
}

// ---- image generation turn ----
export const IMAGE_STYLES = {
  photo: 'photorealistic photograph, full-frame camera, 35mm lens, natural light, shallow depth of field, lifelike textures',
  cinematic: 'cinematic film still, dramatic lighting, anamorphic lens, rich color grading, epic composition, subtle film grain',
  render3d: 'premium 3D render, soft global illumination, physically based materials, subsurface scattering, studio quality',
  illustration: 'polished digital illustration, clean confident linework, rich painterly shading, professional concept art',
  anime: 'high quality anime key visual, detailed background, vibrant colors, clean cel shading',
  logo: 'minimal vector logo design, flat colors, perfect geometry, centered on a clean background, scalable',
  product: 'premium product photography, studio softbox lighting, seamless backdrop, crisp reflections',
  art: 'fine art painting, expressive brushwork, museum quality, harmonious palette',
};
const QUALITY_TAIL = 'ultra high resolution, sharp focus, crisp fine detail, clean edges, professional quality, no pixelation, no blur, no watermark, no distorted text';

async function enhanceImagePrompt(prompt, style, creds, signal) {
  const model = getSetting('memory_model') || getSetting('default_model');
  if (!model) return null;
  try {
    const { text } = await complete([
      { role: 'system', content:
        'You are an expert prompt writer for state-of-the-art text-to-image models. Rewrite the user\'s idea as ONE rich, vivid English prompt (60-110 words): subject and action, composition and camera angle, setting, lighting, color palette, materials and textures, mood. Be concrete and visual; keep every detail the user asked for and never contradict them. Do not add text or logos unless asked. ' +
        (style ? `Visual style to follow: ${style}. ` : '') + 'Output ONLY the prompt, no quotes, no preface.' },
      { role: 'user', content: prompt },
    ], { model, creds, signal, maxTokens: 420, temperature: 0.7, timeoutMs: 40000 });
    const t = text.trim().replace(/^["'`]+|["'`]+$/g, '');
    return t.length > 20 ? t.slice(0, 1800) : null;
  } catch { return null; }
}

export async function runImage({ conv, prompt, model, attachments, signal, opts = {} }) {
  const creds = getCreds();
  const useModel = model || getSetting('image_model');
  if (!useModel) throw new UpstreamError('یک مدل تولید تصویر انتخاب کن (در تنظیمات اتصال یا کنار کادر پیام).', 400);
  const aspect = ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(opts.aspect) ? opts.aspect : '1:1';
  const style = IMAGE_STYLES[opts.style] || '';
  const enhance = opts.enhance !== false;
  const count = Math.min(4, Math.max(1, Number(opts.count) || 1));

  const inputImages = [];
  for (const a of attachments) {
    const up = getUpload(a.id);
    if (up && IMG_MIME.test(up.mime) && up.size <= 8 * 1024 * 1024)
      inputImages.push(`data:${up.mime};base64,${fs.readFileSync(uploadPath(up.id)).toString('base64')}`);
  }
  const userRow = tx(() => {
    const r = insertMessage(conv.id, { role: 'user', content: prompt, attachments });
    if (conv.title === DEFAULT_TITLE) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(prompt.slice(0, 48), conv.id);
    return r;
  });

  let finalPrompt = prompt;
  let enhanced = null;
  if (enhance && !inputImages.length) enhanced = await enhanceImagePrompt(prompt, style, creds, signal);
  if (enhanced) finalPrompt = enhanced;
  else if (style) finalPrompt = `${prompt}. Style: ${style}`;
  finalPrompt = `${finalPrompt}. ${QUALITY_TAIL}`.slice(0, 3800);

  const result = await generateImage({ prompt: finalPrompt, model: useModel, creds, inputImages, signal, aspect, count });
  const baseHost = new URL(creds.base).hostname;
  const saved = [];
  for (const [i, it] of result.items.entries()) {
    if (it.b64) saved.push(saveUpload({ name: `image-${Date.now()}-${i}.png`, mime: 'image/png', buffer: Buffer.from(it.b64, 'base64') }));
    else if (it.url) saved.push(await downloadImage(it.url, baseHost));
  }
  if (hasFfmpeg() && getSetting('upscale_images', '1') !== '0') {
    for (const [i, a] of saved.entries()) {
      try {
        const tmp = uploadPath(a.id) + '.up.png';
        const r = await upscaleImage(uploadPath(a.id), tmp);
        if (r) {
          fs.renameSync(tmp, uploadPath(a.id));
          const size = fs.statSync(uploadPath(a.id)).size;
          const name = a.name.replace(/\.\w+$/, '') + '.png';
          db.prepare('UPDATE uploads SET mime=?, size=?, name=? WHERE id=?').run('image/png', size, name, a.id);
          saved[i] = { ...a, mime: 'image/png', size, name, width: r.width, height: r.height };
        }
      } catch (e) { console.error('[image] upscale skipped:', e.message); }
    }
  }
  const note = enhanced ? `> **پرامپت نهایی:** ${enhanced}` : '';
  const row = insertMessage(conv.id, { role: 'assistant', content: [result.text, note].filter(Boolean).join('\n\n'), model: useModel, attachments: saved, usage: result.usage });
  recordUsage(useModel, result.usage, { kind: 'image' });
  return { user: publicMessage(userRow), assistant: publicMessage(row), title: db.prepare('SELECT title FROM conversations WHERE id=?').get(conv.id).title };
}

// ---- video generation (background jobs, polled by the client) ----
export const videoJobs = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL_MS = Number(process.env.VIDEO_POLL_MS || 4000);

export function getVideoJob(id) { return videoJobs.get(id) || null; }

export function startVideo({ conv, prompt, model, seconds, aspect, attachments = [] }) {
  const creds = getCreds();
  const useModel = model || getSetting('video_model');
  if (!useModel) throw new UpstreamError('یک مدل ویدیو انتخاب کن (در بخش اتصال، «مدل ساخت ویدیو»).', 400);
  const userRow = tx(() => {
    const r = insertMessage(conv.id, { role: 'user', content: prompt, attachments });
    if (conv.title === DEFAULT_TITLE) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(prompt.slice(0, 48), conv.id);
    return r;
  });
  const job = { id: crypto.randomUUID(), conv_id: conv.id, status: 'queued', progress: 0, error: '', message: null, created_at: now() };
  videoJobs.set(job.id, job);
  for (const [k, j] of videoJobs) if (now() - j.created_at > 3 * 3600 * 1000) videoJobs.delete(k);

  (async () => {
    const fail = (msg) => {
      job.status = 'error'; job.error = msg;
      const row = insertMessage(conv.id, { role: 'assistant', content: '> ساخت ویدیو ناموفق بود: ' + msg, model: useModel });
      job.message = publicMessage(row);
    };
    try {
      let v = await createVideo({ prompt, model: useModel, creds, seconds, aspect });
      job.status = 'running';
      const direct = (x) => x?.data?.[0]?.url || x?.video_url || x?.url || x?.output?.[0] || '';
      const deadline = Date.now() + 25 * 60 * 1000;
      let url = direct(v);
      const done = (x) => ['completed', 'succeeded', 'success', 'done'].includes(String(x?.status || '').toLowerCase());
      const bad = (x) => ['failed', 'error', 'cancelled', 'canceled', 'expired', 'rejected'].includes(String(x?.status || '').toLowerCase());
      while (!url && !done(v)) {
        if (bad(v)) throw new UpstreamError(v?.error?.message || v?.error || 'سرویس ساخت ویدیو را رد کرد.', 502);
        if (!v?.id) throw new UpstreamError('پاسخ سرویس ویدیو قابل فهم نبود. مطمئن شو سرویس تو از مسیر /videos پشتیبانی می‌کند.', 502);
        if (Date.now() > deadline) throw new UpstreamError('ساخت ویدیو بیش از حد طول کشید.', 504);
        await sleep(POLL_MS);
        v = await getVideo(v.id, creds);
        if (typeof v.progress === 'number') job.progress = Math.max(job.progress, Math.min(99, Math.round(v.progress)));
        else job.progress = Math.min(95, job.progress + 3);
        url = direct(v);
      }
      job.progress = 99;
      const id = crypto.randomUUID();
      const dest = uploadPath(id);
      const { bytes, mime } = await downloadVideo({ id: v.id, url: url || '', creds, dest });
      db.prepare('INSERT INTO uploads(id,name,mime,size,created_at) VALUES(?,?,?,?,?)').run(id, `video-${Date.now()}.mp4`, mime, bytes, now());
      const att = { id, name: `video-${Date.now()}.mp4`, mime, size: bytes };
      const row = insertMessage(conv.id, { role: 'assistant', content: '', model: useModel, attachments: [att] });
      recordUsage(useModel, { prompt_tokens: 0, completion_tokens: 0, cost: typeof v.cost === 'number' ? v.cost : null }, { kind: 'video' });
      job.progress = 100; job.status = 'done'; job.message = publicMessage(row);
    } catch (e) {
      console.error('[video] failed:', e.message);
      try { fail(e.message || 'خطای نامشخص'); } catch (e2) { job.status = 'error'; job.error = e.message; }
    }
  })();
  return { job, user: publicMessage(userRow) };
}
