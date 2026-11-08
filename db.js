import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR, BACKUP_DIR } from './config.js';

export const DB_FILE = path.join(DATA_DIR, 'atlas.db');
export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = FULL'); // durability over speed: a power loss must not corrupt data
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const MIGRATIONS = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'گفتگوی جدید',
    model TEXT,
    summary TEXT NOT NULL DEFAULT '',
    summarized_upto INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    model TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    memory_used TEXT NOT NULL DEFAULT '[]',
    usage TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_conv ON messages(conv_id, id);
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    tag TEXT NOT NULL DEFAULT 'عمومی',
    pinned INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL,
    estimated INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'chat',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_usage_time ON usage(created_at);
  `,
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

export const now = () => Date.now();

// ---- settings ----
const getS = db.prepare('SELECT value FROM settings WHERE key = ?');
const setS = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
export const getSetting = (k, d = '') => getS.get(k)?.value ?? d;
export const setSetting = (k, v) => setS.run(k, String(v));

// ---- backups ----
export function makeBackup(label) {
  const stamp = label || new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `atlas-${stamp}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function rotateBackups(keep = Number(getSetting('backup_keep', '14'))) {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^atlas-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
}

export function startBackupLoop() {
  const run = () => {
    try { makeBackup(); rotateBackups(); } catch (e) { console.error('[backup] failed:', e.message); }
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
