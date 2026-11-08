// Extracts downloadable files from an assistant message.
// Protocol (taught to the model in the system prompt): a fenced code block whose info string
// contains `file:relative/path.ext` becomes a file.
const FENCE = /^(`{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

export function sanitizePath(p) {
  if (typeof p !== 'string') return null;
  let s = p.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\\/g, '/');
  s = s.replace(/^\.\//, '');
  if (!s || s.length > 200 || s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
  const parts = s.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..')) return null;
  if (/[\p{Cc}<>:"|?*]/u.test(s)) return null;
  return parts.join('/');
}

export function extractFiles(text) {
  const out = new Map();
  if (!text) return [];
  FENCE.lastIndex = 0;
  let m;
  while ((m = FENCE.exec(text))) {
    const info = m[2].trim();
    const hit = info.match(/(?:^|\s)(?:file|path|filename):\s*("[^"]+"|'[^']+'|\S+)/i);
    if (!hit) continue;
    const p = sanitizePath(hit[1]);
    if (!p) continue;
    const lang = info.split(/\s+/)[0].replace(/^(file|path|filename):.*/i, '') || '';
    out.set(p, { path: p, lang, content: m[3] });
  }
  return [...out.values()];
}

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf', zip: 'application/zip',
  woff2: 'font/woff2', ico: 'image/x-icon', xml: 'application/xml; charset=utf-8',
};
export function mimeFor(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}
