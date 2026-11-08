import crypto from 'node:crypto';
import { ADMIN_PASSWORD, ENC_KEY, SESSION_KEY, PREVIEW_KEY } from './config.js';
import { getSetting, setSetting } from './db.js';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function checkPassword(input) {
  if (!ADMIN_PASSWORD) return false;
  return crypto.timingSafeEqual(sha(input ?? ''), sha(ADMIN_PASSWORD));
}

// ---- failed-login throttle (per IP) ----
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 6;
export function loginBlocked(ip) {
  const r = fails.get(ip);
  if (!r) return 0;
  if (Date.now() - r.first > WINDOW) { fails.delete(ip); return 0; }
  return r.n >= MAX_FAILS ? Math.ceil((WINDOW - (Date.now() - r.first)) / 1000) : 0;
}
export function loginFailed(ip) {
  const r = fails.get(ip);
  if (!r || Date.now() - r.first > WINDOW) fails.set(ip, { n: 1, first: Date.now() });
  else r.n++;
}
export function loginOk(ip) { fails.delete(ip); }
setInterval(() => { for (const [k, r] of fails) if (Date.now() - r.first > WINDOW) fails.delete(k); }, 10 * 60 * 1000).unref();

// ---- signed session token ----
const epoch = () => getSetting('session_epoch', '1');
const sign = (payload) => crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('base64url');

export function makeSession(days = 30) {
  const exp = Date.now() + days * 86400000;
  const payload = `${exp}.${epoch()}`;
  return { token: `${payload}.${sign(payload)}`, maxAge: days * 86400 };
}

export function verifySession(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(parts[0]) > Date.now() && parts[1] === epoch();
}

export function revokeAllSessions() {
  setSetting('session_epoch', String(Number(epoch()) + 1));
}

export function parseCookies(header = '') {
  const out = {};
  for (const p of header.split(';')) {
    const i = p.indexOf('=');
    if (i > 0) { const v = p.slice(i + 1).trim(); try { out[p.slice(0, i).trim()] = decodeURIComponent(v); } catch { out[p.slice(0, i).trim()] = v; } }
  }
  return out;
}

// ---- AES-256-GCM for the API key ----
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export const previewSig = (id) => crypto.createHmac('sha256', PREVIEW_KEY).update(String(id)).digest('hex').slice(0, 32);
