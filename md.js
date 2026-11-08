import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same protocol as the server: ```lang file:path
const FENCE_OPEN = /^(`{3,})([^\n]*)$/;

export function fileOf(info) {
  const hit = info.match(/(?:^|\s)(?:file|path|filename):\s*("[^"]+"|'[^']+'|\S+)/i);
  return hit ? hit[1].replace(/^["']|["']$/g, '') : '';
}

export function extractFiles(text) {
  const out = new Map();
  const re = /^(`{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;
  let m;
  while ((m = re.exec(text || ''))) {
    const p = fileOf(m[2].trim());
    if (p && !p.startsWith('/') && !p.includes('..')) out.set(p, { path: p, size: new Blob([m[3]]).size });
  }
  return [...out.values()];
}

function inline(s) {
  let t = esc(s);
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0002`; });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:؟،]|$)/g, '$1<em>$2</em>')
       .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
       .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return t.replace(/\u0001(\d+)\u0002/g, (_, i) => `<code>${codes[i]}</code>`);
}

function codeBlock(info, body, closed) {
  const lang = info.split(/\s+/)[0].replace(/^(file|path|filename):.*/i, '');
  const file = fileOf(info);
  if (file && closed) {
    const n = body ? body.split('\n').length : 0;
    return `<details class="code file"><summary><span class="fchev">${icon('down', 'sm')}</span><span class="fname">${esc(file)}</span><span class="fmeta">${n} خط</span><button type="button" data-copy>${icon('copy', 'sm')} کپی</button></summary><pre><code>${esc(body)}</code></pre></details>`;
  }
  const label = file ? `<span>${esc(file)}</span>` : `<span>${esc(lang || 'code')}</span>`;
  const copy = closed ? `<button type="button" data-copy>${icon('copy', 'sm')} کپی</button>` : '';
  return `<div class="code"><div class="code-h">${label}${copy}</div><pre><code>${esc(body)}</code></pre></div>`;
}

export function render(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p dir="auto">${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    const fo = FENCE_OPEN.exec(line);
    if (fo) {
      flush();
      const fence = fo[1];
      const body = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim() === fence || (lines[i].startsWith(fence) && lines[i].trim().replace(/`/g, '') === '' && lines[i].trim().length >= fence.length)) { closed = true; i++; break; }
        body.push(lines[i]); i++;
      }
      out.push(codeBlock(fo[2].trim(), body.join('\n'), closed));
      continue;
    }
    let m;
    if ((m = /^(#{1,4})\s+(.+)$/.exec(line))) { flush(); out.push(`<h${m[1].length} dir="auto">${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote dir="auto">${inline(q.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li dir="auto">${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (/^\|.+\|\s*$/.test(line) && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line); i++;
  }
  flush();
  return out.join('');
}

/**
 * Splits streaming text into prose (everything outside `file:` blocks) and the list of files being written.
 * Used by the live "what is it doing" panel. Files: { path, lines, done, tail[] }
 */
export function splitLive(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const prose = [];
  const files = [];
  let i = 0;
  while (i < lines.length) {
    const fo = FENCE_OPEN.exec(lines[i]);
    if (!fo) { prose.push(lines[i++]); continue; }
    const fence = fo[1];
    const path = fileOf(fo[2].trim());
    const body = [];
    let closed = false;
    const start = i;
    i++;
    while (i < lines.length) {
      if (lines[i].trim() === fence) { closed = true; i++; break; }
      body.push(lines[i++]);
    }
    if (path) {
      const f = { path, lines: body.length, done: closed, tail: body.slice(-14) };
      const k = files.findIndex((x) => x.path === path);
      if (k >= 0) files[k] = f; else files.push(f);
    } else {
      for (let j = start; j < i; j++) prose.push(lines[j]);
    }
  }
  return { prose: prose.join('\n'), files };
}
