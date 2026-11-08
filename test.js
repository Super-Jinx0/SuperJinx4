import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startMock, calls } from './mock-upstream.js';

const PORT = 4311, MOCK = 4312;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jinx-test-'));
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${!c && extra ? '  -> ' + extra : ''}`); };

const mock = await startMock(MOCK);
const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'index.js'], {
  env: { ...process.env, VIDEO_POLL_MS: '100', PORT, DATA_DIR: data, ADMIN_PASSWORD: 'correct-horse-battery', SECRET_KEY: 'x'.repeat(40) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
srv.stdout.on('data', (d) => (logs += d)); srv.stderr.on('data', (d) => (logs += d));
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

let cookie = '';
const call = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { cookie, 'x-requested-with': 'jinx', ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined });
  return res;
};
const jcall = async (...a) => { const r = await call(...a); return { status: r.status, data: await r.json().catch(() => ({})) }; };

async function sse(p, body) {
  const res = await call('POST', p, body);
  const text = await res.text();
  const events = [];
  for (const blk of text.split('\n\n')) {
    const ev = /^event: (.+)$/m.exec(blk)?.[1]; const d = /^data: (.+)$/m.exec(blk)?.[1];
    if (ev && d) events.push({ ev, data: JSON.parse(d) });
  }
  return { status: res.status, events, text };
}

try {
  // ---- auth ----
  ok((await jcall('GET', '/api/conversations')).status === 401, 'API rejects unauthenticated requests');
  ok((await jcall('POST', '/api/login', { password: 'wrong' })).status === 401, 'wrong password rejected');
  const login = await call('POST', '/api/login', { password: 'correct-horse-battery' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  ok(login.status === 200 && /HttpOnly/.test(login.headers.get('set-cookie')) && /SameSite=Strict/.test(login.headers.get('set-cookie')), 'login sets HttpOnly SameSite=Strict cookie');
  const noCsrf = await fetch(base + '/api/conversations', { method: 'POST', headers: { cookie } });
  ok(noCsrf.status === 403, 'state-changing call without CSRF header rejected');
  ok((await fetch(base + '/')).headers.get('content-security-policy')?.includes("default-src 'self'"), 'CSP header present');

  // ---- settings & connection ----
  let r = await jcall('POST', '/api/settings/test', { base_url: `http://127.0.0.1:${MOCK}/v1`, api_key: 'bad-key' });
  ok(r.data.ok === false && /نامعتبر/.test(JSON.stringify(r.data.steps)), 'connection test explains invalid key in Persian', JSON.stringify(r.data));
  r = await jcall('POST', '/api/settings/test', { base_url: `http://127.0.0.1:${MOCK}/v1/chat/completions/`, api_key: 'test-key' });
  ok(r.data.ok === true && r.data.steps.length === 3, 'connection test passes with good key (URL normalised)', JSON.stringify(r.data));
  r = await jcall('PUT', '/api/settings', { base_url: `http://127.0.0.1:${MOCK}/v1`, api_key: 'test-key', default_model: 'mock/chat-model', image_model: 'mock/image-model' });
  ok(r.data.has_key && r.data.key_hint === '••••-key' && !JSON.stringify(r.data).includes('test-key'.slice(0, 4) + 'xxxx'), 'key saved, only last 4 returned', JSON.stringify(r.data));
  const dbRaw = fs.readFileSync(path.join(data, 'atlas.db'));
  ok(!dbRaw.includes('test-key'), 'API key is not stored in plaintext in the database');
  r = await jcall('GET', '/api/models');
  ok(r.data.models?.length >= 2 && r.data.models.find((m) => m.id === 'mock/image-model').image_output, 'models listed, image model detected', JSON.stringify(r.data));

  // ---- chat + streaming + memory ----
  const conv = (await jcall('POST', '/api/conversations')).data.id;
  let s = await sse(`/api/chat/${conv}`, { content: 'من با Termux روی اندروید کار میکنم، سلام', model: 'mock/chat-model' });
  const deltas = s.events.filter((e) => e.ev === 'delta').map((e) => e.data.text).join('');
  ok(s.events.some((e) => e.ev === 'meta') && deltas.startsWith('Echo:') && s.events.some((e) => e.ev === 'done'), 'chat streams deltas and finishes', s.text.slice(0, 300));
  ok(s.events.find((e) => e.ev === 'title'), 'title auto-set from first message');
  await new Promise((r) => setTimeout(r, 600));
  let mem = (await jcall('GET', '/api/memories')).data.memories;
  ok(mem.length === 1 && mem[0].source === 'auto' && /Termux/.test(mem[0].text), 'memory auto-extracted after exchange', JSON.stringify(mem));
  s = await sse(`/api/chat/${conv}`, { content: 'سلام دوباره، یک سوال دارم', model: 'mock/chat-model' });
  const meta = s.events.find((e) => e.ev === 'meta').data;
  ok(meta.memories.length === 1 && s.events.filter((e) => e.ev === 'delta').map((e) => e.data.text).join('').includes('[mem]'), 'saved memory is injected into the next reply');
  ok(!calls.some((c) => JSON.stringify(c.body).includes('test-key')), 'API key never appears in request bodies');
  const saveAgain = await sse(`/api/chat/${conv}`, { content: 'ok ok ok ok ok ok ok ok', model: 'mock/chat-model' });
  await new Promise((r) => setTimeout(r, 500));
  ok((await jcall('GET', '/api/memories')).data.memories.length === 1, 'no duplicate memories created');

  // manual memory CRUD
  const added = (await jcall('POST', '/api/memories', { text: 'طراحی روشن و مینیمال را دوست دارم', pinned: true })).data.memory;
  ok(added?.pinned === true, 'manual memory added');
  await jcall('PATCH', `/api/memories/${added.id}`, { enabled: false });
  s = await sse(`/api/chat/${conv}`, { content: 'تست', model: 'mock/chat-model' });
  ok(!s.events.find((e) => e.ev === 'meta').data.memories.some((m) => m.id === added.id), 'disabled memory is not injected');
  await jcall('DELETE', `/api/memories/${added.id}`);
  ok((await jcall('GET', '/api/memories')).data.memories.length === 1, 'memory deleted');

  // regenerate
  const before = (await jcall('GET', `/api/conversations/${conv}`)).data.messages.length;
  s = await sse(`/api/chat/${conv}`, { regenerate: true, model: 'mock/chat-model' });
  const after = (await jcall('GET', `/api/conversations/${conv}`)).data.messages.length;
  ok(before === after && s.events.some((e) => e.ev === 'done'), 'regenerate replaces the last answer');

  // mid-stream failure keeps partial text
  const c2 = (await jcall('POST', '/api/conversations')).data.id;
  s = await sse(`/api/chat/${c2}`, { content: 'FAIL_MID please', model: 'mock/chat-model' });
  const msgs2 = (await jcall('GET', `/api/conversations/${c2}`)).data.messages;
  ok(msgs2.at(-1)?.role === 'assistant' && msgs2.at(-1).content.includes('partial'), 'partial answer is saved when upstream drops mid-stream', JSON.stringify(msgs2.at(-1)));

  // bad key -> clear error
  await jcall('PUT', '/api/settings', { api_key: 'wrong-key-1234' });
  s = await sse(`/api/chat/${conv}`, { content: 'hello', model: 'mock/chat-model' });
  ok(s.events.some((e) => e.ev === 'error' && /نامعتبر/.test(e.data.message)), 'invalid key during chat shows Persian error');
  await jcall('PUT', '/api/settings', { api_key: 'test-key' });

  // ---- uploads: text + image reach the model ----
  const up = (await jcall('POST', '/api/upload', Buffer.from('print("hello from file")'), { 'x-filename': encodeURIComponent('تست.py'), 'content-type': 'text/x-python' })).data;
  ok(up.id && up.name === 'تست.py', 'file uploaded with unicode name');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const img = (await jcall('POST', '/api/upload', png, { 'x-filename': 'a.png', 'content-type': 'image/png' })).data;
  calls.length = 0;
  s = await sse(`/api/chat/${conv}`, { content: 'look at these', attachments: [up.id, img.id], model: 'mock/chat-model' });
  const sent = calls.find((c) => c.url === '/v1/chat/completions' && c.body.stream);
  const lastUser = sent.body.messages.filter((m) => m.role === 'user').at(-1).content;
  ok(Array.isArray(lastUser) && lastUser.some((p) => p.type === 'image_url') && JSON.stringify(lastUser).includes('hello from file'), 'text file inlined and image sent as vision input');
  const fileRes = await call('GET', `/api/files/${img.id}`);
  ok(fileRes.status === 200 && fileRes.headers.get('content-type') === 'image/png', 'uploaded image served back');
  ok((await call('GET', '/api/files/..%2f..%2fetc%2fpasswd')).status === 404 && (await call('GET', '/api/files/not-a-real-id')).status === 404 && (await call('GET', `/api/files/${up.id}`)).headers.get('content-disposition').startsWith('attachment'), 'path traversal blocked; non-media forced to download');

  // ---- generated files / zip / preview ----
  const c3 = (await jcall('POST', '/api/conversations')).data.id;
  s = await sse(`/api/chat/${c3}`, { content: 'please make a website', model: 'mock/chat-model' });
  const done = s.events.find((e) => e.ev === 'done').data.message;
  const fl = (await jcall('GET', `/api/messages/${done.id}/files`)).data;
  ok(fl.files.length === 3 && fl.has_index, 'three generated files detected', JSON.stringify(fl));
  const zipRes = await call('GET', `/api/messages/${done.id}/zip`);
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  fs.writeFileSync(path.join(data, 't.zip'), zipBuf);
  const py = execFileSync('python3', ['-c', `import zipfile;z=zipfile.ZipFile("${path.join(data, 't.zip')}");assert z.testzip() is None;print(sorted(z.namelist()), z.read("style.css").decode())`]).toString();
  ok(py.includes("'index.html'") && py.includes('color:#0f4d3f'), 'ZIP is valid and contents match', py);
  const pv = await fetch(`${base}/preview/${done.id}.${fl.preview}/style.css`);
  ok(pv.status === 200 && (await pv.text()).includes('h1{'), 'preview serves sibling files without cookies');
  ok(/sandbox/.test(pv.headers.get('content-security-policy')), 'preview is sandboxed');
  ok((await fetch(`${base}/preview/${done.id}.${'0'.repeat(32)}/index.html`)).status === 404, 'preview rejects bad signature');

  // ---- image generation ----
  const gi = await jcall('POST', '/api/image', { conv_id: c3, prompt: 'a jade mountain', model: 'mock/image-model' });
  ok(gi.status === 200 && gi.data.assistant.attachments[0]?.mime === 'image/png', 'image generated and stored', JSON.stringify(gi.data).slice(0, 200));
  const gimg = await call('GET', `/api/files/${gi.data.assistant.attachments[0].id}`);
  ok(gimg.status === 200 && (await gimg.arrayBuffer()).byteLength > 50, 'generated image downloadable');

  // ---- usage, export/import, backup, search ----
  const us = (await jcall('GET', '/api/usage')).data;
  ok(us.rows.some((x) => x.model === 'mock/chat-model' && x.prompt_tokens > 0), 'usage recorded');
  const exp = await (await call('GET', '/api/export')).json();
  ok(exp.format === 'jinx-export' && exp.messages.length > 5 && !JSON.stringify(exp).includes('api_key_enc'), 'export contains data and no API key');
  const imp = await jcall('POST', '/api/import', exp);
  ok(imp.status === 200 && imp.data.imported.messages === 0, 'import is idempotent (no duplicates)', JSON.stringify(imp.data));
  const bk = await call('GET', '/api/backup');
  const bkBuf = Buffer.from(await bk.arrayBuffer());
  ok(bk.status === 200 && bkBuf.subarray(0, 15).toString() === 'SQLite format 3', 'database backup downloadable');
  ok((await jcall('GET', '/api/conversations?q=Termux')).data.conversations.length >= 1, 'search finds conversations by message text');
  ok(fs.readdirSync(path.join(data, 'backups')).some((f) => f.startsWith('atlas-')), 'automatic backup file created');

  // ---- Jinx features: reasoning, enhanced images, video ----
  const cvr = (await jcall('POST', '/api/conversations')).data.id;
  const rs = await sse(`/api/chat/${cvr}`, { content: 'please think hard about this' });
  ok(rs.events.some((e) => e.ev === 'reasoning' && /think/.test(e.data.text)) && rs.events.some((e) => e.ev === 'done'), 'reasoning stream is forwarded to the client');
  await jcall('PUT', '/api/settings', { default_model: 'mock/chat-model', image_model: 'mock/image-model', video_model: 'sora-2' });
  const ci = (await jcall('POST', '/api/conversations')).data.id;
  const before2 = calls.length;
  const im = await jcall('POST', '/api/image', { conv_id: ci, prompt: 'یه شهر آینده‌نگر', model: 'mock/gpt-image-1', aspect: '16:9', style: 'cinematic', enhance: true, count: 2 });
  const imgCalls = calls.slice(before2).filter((c) => c.url === "/v1/images/generations");
  ok(im.status === 200 && im.data.assistant.attachments.length === 2, 'image: 2 images generated');
  ok(/پرامپت نهایی/.test(im.data.assistant.content) && /no pixelation/.test(imgCalls.at(-1).body.prompt), 'image: prompt enhanced + quality tail added');
  ok(imgCalls.length >= 2 && !imgCalls.at(-1).body.quality && imgCalls.at(-1).body.size === '1536x1024', 'image: falls back when quality param unsupported, keeps size');
  const vs = await jcall('POST', '/api/video', { conv_id: ci, prompt: 'sunrise over misty mountains', seconds: 8, aspect: '9:16' });
  ok(vs.status === 200 && vs.data.job_id, 'video: job started');
  let job;
  for (let i = 0; i < 60; i++) { job = (await jcall('GET', `/api/video/${vs.data.job_id}`)).data; if (job.status === 'done' || job.status === 'error') break; await new Promise((r) => setTimeout(r, 200)); }
  ok(job.status === 'done' && job.message.attachments[0].mime === 'video/mp4', 'video: finished and saved', JSON.stringify(job));
  const vcall = calls.find((c) => c.url === '/v1/videos' && c.body.prompt);
  ok(vcall.body.size === '720x1280' && vcall.body.seconds === '8', 'video: size and duration mapped');
  const vf = await call('GET', `/api/files/${job.message.attachments[0].id}`);
  ok(vf.status === 200 && vf.headers.get('content-type') === 'video/mp4' && (await vf.text()).startsWith('FAKE-MP4'), 'video: playable file served');
  ok((await jcall('GET', '/api/video/nope')).status === 404, 'video: unknown job gives 404');

  // ---- system settings & hardening ----
  const sys = await jcall('GET', '/api/system');
  ok(sys.status === 200 && sys.data.version && Array.isArray(sys.data.backups), 'system info available');
  const st = await jcall('PUT', '/api/settings', { temperature: '0.5', max_tokens: 999999999, request_timeout: 5, backup_keep: 1, session_days: 500 });
  ok(st.data.temperature === '0.5' && st.data.max_tokens === 200000 && st.data.request_timeout === 15 && st.data.backup_keep === 3 && st.data.session_days === 90, 'system settings saved and clamped');
  await jcall('PUT', '/api/settings', { temperature: '', max_tokens: 0, request_timeout: 60, backup_keep: 14, session_days: 30 });
  ok((await jcall('POST', '/api/system/backup')).data.ok === true, 'manual backup works');
  ok((await call('GET', '/server.js')).status === 404 && (await call('GET', '/db.js')).status === 404 && (await call('GET', '/config.js')).status === 404, 'server source files are not served');
  ok((await call('GET', '/guard.js')).status === 200 && (await call('GET', '/app.js')).status === 200 && (await call('GET', '/brands.js')).status === 200, 'frontend files served');
  ok((await call('GET', '/%E0%A4%A')).status === 400, 'bad URL encoding gives 400 not 500');
  ok((await call('GET', '/api/health')).status === 200, 'health ok');
  ok((await call('GET', '/nonexistent-page')).status === 200, 'unknown route falls back to app shell');

  // ---- credits, audio export, upscale, i18n ----
  const cr = await jcall('GET', '/api/credits?fresh=1');
  ok(cr.data.supported && cr.data.remaining === 37.5 && cr.data.total === 50 && cr.data.used === 12.5, 'credits: remaining/total/used from provider');
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('ffmpeg', ['-version']).status === 0) {
    const mk = (name, args) => { const f = path.join(data, name); spawnSync('ffmpeg', ['-y', '-v', 'error', ...args, f]); return fs.readFileSync(f); };
    const withAudio = mk('a.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-pix_fmt', 'yuv420p']);
    const silent = mk('s.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=1', '-pix_fmt', 'yuv420p']);
    const up1 = await jcall('POST', '/api/upload', withAudio, { 'content-type': 'video/mp4', 'x-filename': 'a.mp4' });
    const up2 = await jcall('POST', '/api/upload', silent, { 'content-type': 'video/mp4', 'x-filename': 's.mp4' });
    const info = await jcall('GET', `/api/files/${up1.data.id}/info`);
    ok(info.data.width === 320 && info.data.audio_export === true, 'video info: size and audio detected');
    const au = await call('GET', `/api/files/${up1.data.id}/audio?format=mp3&download=1`);
    const ab = Buffer.from(await au.arrayBuffer());
    ok(au.status === 200 && /audio\/mpeg/.test(au.headers.get('content-type')) && ab.length > 1000 && (ab.subarray(0, 3).toString() === 'ID3' || ab[0] === 0xff), 'audio export: real MP3 produced');
    const wv = await call('GET', `/api/files/${up1.data.id}/audio?format=wav`);
    ok(wv.status === 200 && Buffer.from(await wv.arrayBuffer()).subarray(0, 4).toString() === 'RIFF', 'audio export: WAV produced');
    ok((await call('GET', `/api/files/${up2.data.id}/audio`)).status === 422, 'audio export: silent video gives clear 422');
    const { upscaleImage } = await import('./media.js');
    const png = path.join(data, 'small.png'); spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=512x512:duration=1', '-frames:v', '1', png]);
    const r = await upscaleImage(png, path.join(data, 'big.png'));
    ok(r && Math.max(r.width, r.height) >= 1536, 'small images are upscaled to a crisp size');
  }
  const i18n = await import('./i18n.js').catch((e) => ({ err: e }));
  ok(!i18n.err || /localStorage|document|location/.test(String(i18n.err)), 'i18n module parses');

  // ---- project checker, saved connections, handoff ----
  const { checkProject } = await import('./check.js');
  const good = checkProject([
    { path: 'index.html', content: '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><script src="script.js"></script></body></html>' },
    { path: 'style.css', content: 'body{margin:0}' }, { path: 'script.js', content: 'document.title="x";' },
  ]);
  ok(good.ok, 'checker: clean project passes', JSON.stringify(good.issues));
  const bad = checkProject([
    { path: 'index.html', content: '<!doctype html><html><body><img src="missing.png"><script src="app.js"></script><script>let a = ;</script></body></html>' },
    { path: 'app.js', content: 'function x( {' }, { path: 'data.json', content: '{bad' }, { path: 'a.css', content: 'a{color:red' },
  ], '```js file:cut.js\nconst a = 1');
  const codes = bad.issues.map((i) => i.code);
  ok(['missing_ref', 'js_syntax', 'json_invalid', 'css_braces', 'truncated'].every((c) => codes.includes(c)) && bad.issues.filter((i) => i.code === 'js_syntax').length === 2, 'checker: finds syntax, json, css, missing file and cut-off errors', codes.join());
  const cm = await jcall('POST', '/api/conversations');
  ok(cm.status === 200, 'conversation created for checker');
  const pr0 = await jcall('GET', '/api/profiles');
  ok(Array.isArray(pr0.data.profiles), 'profiles list available');
  await jcall('PUT', '/api/settings', { base_url: `http://127.0.0.1:${MOCK}/v1`, api_key: 'sk-second-key-1234567890' });
  const pr1 = await jcall('GET', '/api/profiles');
  const second = pr1.data.profiles.find((x) => x.hint.endsWith('7890'));
  ok(second && second.active && !JSON.stringify(pr1.data).includes('sk-second'), 'profile saved automatically, key never exposed');
  const olderKey = pr1.data.profiles.find((x) => !x.active);
  if (olderKey) {
    const act = await jcall('POST', `/api/profiles/${olderKey.id}/activate`);
    ok(act.data.key_hint === olderKey.hint, 'switching to an older saved key works');
    const del = await jcall('DELETE', `/api/profiles/${second.id}`);
    ok(!del.data.profiles.some((x) => x.id === second.id), 'saved key deleted');
  }
  await jcall('PUT', '/api/memories'.replace('memories', 'settings'), {});
  const memImp = await jcall('POST', '/api/memories/import', { text: '# Notes\n- User prefers dark themes\n- User builds Telegram bots\n- User prefers dark themes' });
  ok(memImp.data.added === 2, 'memory import adds lines and skips duplicates', JSON.stringify(memImp.data));
  const hd = await call('GET', '/api/handoff?format=md');
  const hdt = await hd.text();
  ok(hd.status === 200 && hdt.includes('User prefers dark themes') && hdt.includes('Work history') && !hdt.includes('sk-'), 'handoff pack contains memories and no secrets');
  const hj = await jcall('GET', '/api/handoff?format=json');
  ok(hj.data.format === 'jinx-handoff' && Array.isArray(hj.data.chats), 'handoff JSON pack');
  const expTxt = await (await call('GET', '/api/export')).text();
  ok(!expTxt.includes('key_enc') && !expTxt.includes('"profiles"'), 'export never contains saved API keys');

  // ---- sessions ----
  await jcall('POST', '/api/logout-all');
  ok((await jcall('GET', '/api/conversations')).status === 401, 'logout-all invalidates existing sessions');
} catch (e) {
  fail++; console.log('FAIL  test crashed:', e);
} finally {
  srv.kill(); mock.close();
  if (fail) console.log('\n--- server logs ---\n' + logs.slice(-2000));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
