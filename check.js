// Static quality gate for generated projects: catches the mistakes that make a site show a blank page or a console error
// before the user ever opens the preview. Pure functions, no network.
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const posix = path.posix;
const strip = (s) => String(s).replace(/^#!.*\n/, '\n');

function jsError(code, name, asModule) {
  try {
    if (!asModule) { new vm.Script(strip(code), { filename: name }); return null; }
    const f = path.join(os.tmpdir(), `jinx-chk-${crypto.randomBytes(6).toString('hex')}.mjs`);
    fs.writeFileSync(f, strip(code));
    try {
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', timeout: 8000 });
      if (r.status === 0) return null;
      const line = String(r.stderr).split('\n').find((l) => /Error/.test(l)) || 'SyntaxError';
      return line.trim();
    } finally { fs.rmSync(f, { force: true }); }
  } catch (e) {
    return String(e.message || e).split('\n')[0];
  }
}

const isModule = (code, name) => /\.mjs$/.test(name) || /^\s*(import\s[^('"`]*['"]|export\s)/m.test(code);

export function checkProject(files, rawText = '') {
  const issues = [];
  const add = (file, code, detail = '') => issues.push({ file, code, detail: String(detail).slice(0, 220) });
  const paths = new Set(files.map((f) => f.path));
  const dirs = new Set();
  for (const p of paths) { let d = posix.dirname(p); while (d && d !== '.') { dirs.add(d); d = posix.dirname(d); } }

  // response cut off in the middle of a file
  const opened = new Set([...String(rawText).matchAll(/^`{3,}[^\n]*?(?:file|path|filename):\s*("[^"]+"|'[^']+'|\S+)/gim)].map((m) => m[1].replace(/^["']|["']$/g, '')));
  for (const p of opened) if (!paths.has(p)) add(p, 'truncated');

  const hasHtml = files.some((f) => /\.html?$/i.test(f.path));
  if (hasHtml && !files.some((f) => /(^|\/)index\.html$/i.test(f.path))) add('index.html', 'no_index');

  for (const f of files) {
    const ext = f.path.split('.').pop().toLowerCase();
    const c = f.content || '';
    if (!c.trim()) { add(f.path, 'empty'); continue; }
    if (/\.\.\.\s*(rest|remaining|same|existing)|rest of (the )?code|\/\/\s*\.\.\.\s*$|TODO: implement/i.test(c) && ['js', 'css', 'html', 'ts'].includes(ext)) add(f.path, 'placeholder');
    if (ext === 'js' || ext === 'mjs') {
      const err = jsError(c, f.path, isModule(c, f.path));
      if (err) add(f.path, 'js_syntax', err);
    } else if (ext === 'json') {
      try { JSON.parse(c); } catch (e) { add(f.path, 'json_invalid', e.message); }
    } else if (ext === 'css') {
      const flat = c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
      const o = (flat.match(/{/g) || []).length, cl = (flat.match(/}/g) || []).length;
      if (o !== cl) add(f.path, 'css_braces', `${o} { / ${cl} }`);
    } else if (ext === 'html' || ext === 'htm') {
      if (!/<\/html>\s*$/i.test(c.trim()) && /<html/i.test(c)) add(f.path, 'html_unfinished');
      // inline scripts
      for (const m of c.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = m[1];
        if (/\bsrc\s*=/.test(attrs)) continue;
        const type = /type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] || '';
        if (type && !/^(module|text\/javascript|application\/javascript)$/i.test(type)) continue;
        if (!m[2].trim()) continue;
        const err = jsError(m[2], f.path + '<script>', type === 'module' || isModule(m[2], ''));
        if (err) add(f.path, 'js_syntax', err);
      }
      // local references must exist
      const base = posix.dirname(f.path);
      for (const m of c.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        let ref = m[1].trim();
        if (!ref || /^(#|[a-z][a-z0-9+.-]*:|\/\/|\{\{|<%|\$\{)/i.test(ref)) continue;
        ref = ref.split('#')[0].split('?')[0];
        if (!ref) continue;
        let target = ref.startsWith('/') ? ref.slice(1) : posix.normalize(posix.join(base, ref));
        target = target.replace(/\/$/, '');
        if (!(paths.has(target) || dirs.has(target) || paths.has(posix.join(target, 'index.html')) || target === '' || target === '.')) add(f.path, 'missing_ref', ref);
      }
    }
  }
  return { ok: issues.length === 0, files: files.length, issues };
}
