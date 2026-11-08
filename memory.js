import crypto from 'node:crypto';
import { db, now, getSetting } from './db.js';
import { complete } from './upstream.js';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u064b-\u065f]/g, '');

const STOP = new Set(['و', 'در', 'به', 'از', 'که', 'این', 'را', 'با', 'برای', 'است', 'the', 'a', 'an', 'is', 'to', 'of', 'and', 'in', 'for', 'on', 'it', 'i', 'my']);

export function tokens(s) {
  return (norm(s).match(/[\p{L}\p{N}]{2,}/gu) || []).filter((t) => !STOP.has(t));
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
};

export const listMemories = () =>
  db.prepare('SELECT * FROM memories ORDER BY pinned DESC, updated_at DESC').all();

export function addMemory({ text, tag = 'عمومی', pinned = 0, source = 'manual' }) {
  const t = String(text || '').trim().slice(0, 500);
  if (!t) return null;
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare('INSERT INTO memories(id,text,tag,pinned,enabled,source,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)')
    .run(id, t, String(tag).slice(0, 30), pinned ? 1 : 0, source, ts, ts);
  return db.prepare('SELECT * FROM memories WHERE id=?').get(id);
}

/** Pick memories to inject. Small stores go in whole; large ones are ranked by relevance. */
export function selectMemories(query, { maxChars = 4500 } = {}) {
  const all = db.prepare('SELECT * FROM memories WHERE enabled = 1').all();
  if (!all.length) return [];
  const q = tokens(query);
  const qset = new Set(q);
  const scored = all.map((m) => {
    const mt = tokens(m.text + ' ' + m.tag);
    let hit = 0;
    for (const t of mt) if (qset.has(t)) hit++;
    const age = (now() - m.updated_at) / 86400000;
    const score = (m.pinned ? 1000 : 0) + hit * 10 + Math.max(0, 3 - age / 30);
    return { m, score, hit };
  });
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  let chars = 0;
  const smallStore = all.length <= 30;
  for (const s of scored) {
    if (!smallStore && !s.m.pinned && s.hit === 0 && out.length >= 6) continue;
    if (chars + s.m.text.length > maxChars) continue;
    out.push(s.m);
    chars += s.m.text.length;
    if (out.length >= 40) break;
  }
  return out;
}

export function memoryBlock(mems) {
  if (!mems.length) return '';
  return 'Persistent memory about the user (facts and preferences saved from earlier conversations; use them naturally, never recite them unless asked):\n' +
    mems.map((m) => `- ${m.text}`).join('\n');
}

function parseJsonArray(text) {
  const s = String(text || '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** After an exchange, ask the model for durable facts worth remembering. Never throws. */
export async function extractMemories({ userText, assistantText, model, creds }) {
  try {
    if (getSetting('memory_auto', '1') !== '1') return [];
    if (String(userText).trim().length < 12) return [];
    const existing = selectMemories(userText, { maxChars: 2500 }).map((m) => `- ${m.text}`).join('\n') || '(none)';
    const prompt = [
      { role: 'system', content:
        'You maintain a long-term memory about one user. From the exchange below, extract ONLY durable facts worth remembering for future conversations: stable preferences, skills, tools, ongoing projects, goals, constraints, personal context the user shared, anything they explicitly asked to remember, AND a short record of significant work completed together (e.g. "Built a Persian landing page for the user bakery brand with files index.html, style.css, script.js"; "Decided to deploy the Telegram bot on Railway"). ' +
        'Ignore one-off questions, temporary details, and anything about the assistant. Write each memory as one short self-contained sentence in the same language the user used. ' +
        'Do not repeat anything already in the existing memory list. Never store secrets, passwords, API keys or tokens. ' +
        'Reply with ONLY a JSON array like [{"text":"...","tag":"..."}] with at most 4 items (tag is a one-word category). Reply [] if nothing qualifies.' },
      { role: 'user', content: `Existing memory:\n${existing}\n\nUser message:\n${String(userText).slice(0, 4000)}\n\nAssistant reply:\n${String(assistantText).slice(0, 3000)}` },
    ];
    const { text } = await complete(prompt, { model, creds, maxTokens: 500, temperature: 0 });
    const items = parseJsonArray(text);
    const saved = [];
    const current = db.prepare('SELECT text FROM memories').all().map((r) => tokens(r.text));
    for (const it of items.slice(0, 4)) {
      const t = String(it?.text || '').trim();
      if (t.length < 6 || t.length > 400) continue;
      if (/(sk-[a-z0-9_-]{16,}|api[_ -]?key\s*[:=]|password\s*[:=]|token\s*[:=])/i.test(t)) continue;
      const tk = tokens(t);
      if (current.some((c) => jaccard(c, tk) >= 0.6)) continue;
      const row = addMemory({ text: t, tag: String(it.tag || 'عمومی'), source: 'auto' });
      if (row) { saved.push(row); current.push(tk); }
    }
    return saved;
  } catch (e) {
    console.error('[memory] extraction failed:', e.message);
    return [];
  }
}
