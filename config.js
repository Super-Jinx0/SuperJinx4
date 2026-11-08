import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PORT = Number(process.env.PORT || 8080);
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024;
export let VERSION = '1.0.0';
try { VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || VERSION; } catch {}
export const SECRET_FROM_ENV = !!(process.env.SECRET_KEY && process.env.SECRET_KEY.length >= 32);
export const STARTED_AT = Date.now();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

// SECRET_KEY should be set as an environment variable. If it is missing, a random one is
// generated once and persisted inside DATA_DIR so restarts do not log you out or lose the API key.
function loadSecret() {
  const fromEnv = process.env.SECRET_KEY;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const file = path.join(DATA_DIR, '.secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
export const SECRET = loadSecret();

const hk = (label) => Buffer.from(crypto.hkdfSync('sha256', SECRET, 'atlas', label, 32));
export const ENC_KEY = hk('enc');
export const SESSION_KEY = hk('session');
export const PREVIEW_KEY = hk('preview');
