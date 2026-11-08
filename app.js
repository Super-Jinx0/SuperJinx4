import { icon, MARK } from './icons.js';
import { esc, render, extractFiles, splitLive } from './md.js';
import { brandOf, prettyModel, themeVars, badge } from './brands.js';
import { LANGS, getLang, langInfo, setLang, startI18n } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LOCALE = langInfo().locale;
const nf = new Intl.NumberFormat(LOCALE);
const fa = (n) => nf.format(n ?? 0);
const coarse = matchMedia('(pointer: coarse)').matches;

const S = {
  settings: null, models: null, modelsError: '', convs: [], q: '',
  conv: null, messages: [], memUsed: {}, pending: [], mode: 'chat', busy: false, abort: null, themeModel: '',
  img: { aspect: '1:1', style: '', enhance: true, count: 1 }, vid: { seconds: 8, aspect: '16:9' },
  memories: [], memFilter: 'all', chatModel: '', route: { name: 'chat', id: null },
};

// ---------- storage + theme ----------
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
try { Object.assign(S.img, JSON.parse(lsGet('jinx_img', '{}'))); Object.assign(S.vid, JSON.parse(lsGet('jinx_vid', '{}'))); } catch {}
S.theme = lsGet('jinx_theme', 'auto');
S.fast = lsGet('jinx_fast', '0') === '1';
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => S.theme === 'dark' || (S.theme === 'auto' && prefersDark.matches);
function applyTheme(modelId) {
  if (modelId !== undefined) S.themeModel = modelId || '';
  const dark = isDark();
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.brand = brandOf(S.themeModel).key;
  for (const [k, v] of Object.entries(themeVars(S.themeModel, dark))) root.style.setProperty(k, v);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0f1113' : '#fbfcfb');
  const tb = $('#themebtn'); if (tb) tb.innerHTML = icon(dark ? 'sun' : 'moon');
}
prefersDark.addEventListener?.('change', () => applyTheme());
applyTheme('');

// ---------- infrastructure ----------
class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }

async function api(method, path, body, extra = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'X-Requested-With': 'jinx', ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...extra.headers },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined, signal: extra.signal,
  });
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new ApiError('نشست منقضی شده', 401); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `خطا (${res.status})`, res.status);
  return data;
}

function toast(msg, err = false, ms = 3800) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, ms);
}

function openSheet({ title, body, footer, wide = false, onClose }) {
  const ov = $('#overlay');
  ov.innerHTML = `<div class="scrim"></div><div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-h"><b>${esc(title)}</b><button class="icon-btn" type="button" data-close aria-label="بستن">${icon('x')}</button></div>
    <div class="sheet-b"></div>${footer ? '<div class="sheet-f"></div>' : ''}</div>`;
  ov.classList.add('open');
  const close = () => { ov.classList.remove('open'); ov.innerHTML = ''; document.removeEventListener('keydown', esc_); onClose?.(); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  $('.scrim', ov).onclick = close;
  $('[data-close]', ov).onclick = close;
  const b = $('.sheet-b', ov);
  if (typeof body === 'string') b.innerHTML = body; else b.append(body);
  const f = $('.sheet-f', ov);
  if (f && footer) footer(f, close);
  return { el: $('.sheet', ov), body: b, close };
}

function confirmDialog(text, okLabel = 'تایید', danger = true) {
  return new Promise((resolve) => {
    let settled = false;
    const sh = openSheet({
      title: 'تایید', body: `<p style="margin:0">${esc(text)}</p>`,
      footer: (f, close) => {
        f.innerHTML = `<button class="btn" type="button" data-no>انصراف</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-yes>${esc(okLabel)}</button>`;
        $('[data-yes]', f).onclick = () => { settled = true; close(); resolve(true); };
        $('[data-no]', f).onclick = close;
      },
      onClose: () => { if (!settled) resolve(false); },
    });
    return sh;
  });
}

function promptDialog(title, value, label = 'ذخیره') {
  return new Promise((resolve) => {
    let settled = false;
    openSheet({
      title, body: `<input class="input" id="pd" value="${esc(value)}" maxlength="120">`,
      footer: (f, close) => {
        f.innerHTML = `<button class="btn" type="button" data-no>انصراف</button><button class="btn primary" type="button" data-yes>${esc(label)}</button>`;
        const done = () => { settled = true; const v = $('#pd').value.trim(); close(); resolve(v || null); };
        $('[data-yes]', f).onclick = done;
        $('[data-no]', f).onclick = close;
        $('#pd').onkeydown = (e) => { if (e.key === 'Enter') done(); };
        setTimeout(() => $('#pd')?.select(), 50);
      },
      onClose: () => { if (!settled) resolve(null); },
    });
  });
}

const timeGroup = (t) => {
  const d = (Date.now() - t) / 86400000;
  return d < 1 ? 'امروز' : d < 2 ? 'دیروز' : d < 8 ? 'هفته اخیر' : 'قدیمی‌تر';
};
const shortModel = (id) => (id ? prettyModel(id).name : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modelFor = (mode) => (mode === 'image' ? S.settings?.image_model : mode === 'video' ? S.settings?.video_model : S.chatModel) || '';
const hhmm = (t) => new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const bytes = (n) => (n < 1024 ? `${fa(n)} B` : n < 1048576 ? `${fa(Math.round(n / 1024))} KB` : `${nf.format(+(n / 1048576).toFixed(1))} MB`);

// ---------- login ----------
function showLogin() {
  $('#app').hidden = true;
  const l = $('#login');
  l.hidden = false;
  l.innerHTML = `<div class="login-card">${MARK}<div><h1>Jinx</h1><p>جینکس، پنل خصوصی هوش مصنوعی</p></div>
    <form id="lf"><input class="input" id="pw" type="password" placeholder="رمز عبور" autocomplete="current-password" dir="ltr" style="text-align:center" required>
    <button class="btn primary" type="submit">ورود</button><div class="err-txt" id="le" role="alert"></div></form></div>`;
  $('#pw').focus();
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#lf button');
    btn.disabled = true;
    try {
      await api('POST', '/api/login', { password: $('#pw').value });
      l.hidden = true; l.innerHTML = '';
      await boot();
    } catch (err) { $('#le').textContent = err.message; btn.disabled = false; }
  };
}

// ---------- language ----------
function pickLang() {
  const cur = getLang();
  const sh = openSheet({
    title: 'زبان',
    body: Object.entries(LANGS).map(([k, l]) => `<button class="opt" type="button" data-lang="${k}" data-notr><span class="nm" dir="${l.dir}" style="text-align:start">${l.name}</span>${k === cur ? icon('check', 'sm') : ''}</button>`).join(''),
  });
  sh.body.onclick = (e) => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); };
}

// ---------- credit / balance of the connected API ----------
const money = (n, cur = 'USD') => (n == null ? '—' : (cur === 'USD' ? '$' : '') + (Math.abs(n) >= 100 ? nf.format(Math.round(n)) : nf.format(+n.toFixed(2))) + (cur && cur !== 'USD' ? ' ' + cur : ''));
async function loadCredit(fresh) {
  try { S.credit = await api('GET', '/api/credits' + (fresh ? '?fresh=1' : '')); } catch { S.credit = { supported: false }; }
  renderCredit();
  return S.credit;
}
function creditPct(c) { return c.total ? Math.max(0, Math.min(100, (c.remaining / c.total) * 100)) : null; }
function renderCredit() {
  const el = $('#credit'); const c = S.credit;
  if (!el) return;
  if (!c?.connected || !c.supported) { el.hidden = true; return; }
  el.hidden = false;
  const pct = creditPct(c);
  const low = pct != null && pct < 10;
  el.classList.toggle('low', low);
  el.innerHTML = `<div class="credit-h"><span>اعتبار باقی‌مانده</span><b class="ltr">${c.unlimited && c.remaining == null ? '∞' : money(c.remaining, c.currency)}</b></div>` +
    (pct != null ? `<div class="credit-bar"><i style="width:${pct.toFixed(1)}%"></i></div><div class="credit-f"><span>${low ? 'اعتبار رو به پایان است' : 'مصرف‌شده'} <span class="ltr">${money(c.used, c.currency)}</span></span><span class="ltr">/ ${money(c.total, c.currency)}</span></div>`
      : c.unlimited ? `<div class="credit-f"><span>نامحدود</span><span class="ltr">${c.used != null ? money(c.used, c.currency) : ''}</span></div>` : '');
}

// ---------- shell ----------
const NAV = [['chat', 'گفتگو', 'chat', '#/'], ['memory', 'حافظه', 'layers', '#/memory'], ['settings', 'اتصال', 'link', '#/settings'], ['usage', 'مصرف', 'chart', '#/usage']];

function shell() {
  const app = $('#app');
  app.hidden = false;
  app.innerHTML = `
  <aside class="side" id="side">
    <div class="brand">${MARK}<b>Jinx</b><small>جینکس</small></div>
    <nav class="nav">${NAV.map(([id, l, ic, h]) => `<a href="${h}" data-nav="${id}">${icon(ic)}${l}</a>`).join('')}</nav>
    <button class="new-chat" type="button" id="newchat">${icon('plus')} گفتگوی جدید</button>
    <div class="search">${icon('search')}<input id="q" placeholder="جستجو در گفتگوها" autocomplete="off"></div>
    <div class="hist" id="hist"></div>
    <div class="credit" id="credit" hidden></div>
    <div class="side-foot"><span class="dot" id="conn"></span><span id="conntxt" style="flex:1">در حال بررسی</span>
      <button class="icon-btn" type="button" id="langbtn" aria-label="زبان" title="زبان">${icon('globe')}</button>
      <button class="icon-btn" type="button" id="themebtn" aria-label="تم تیره/روشن" title="تم تیره/روشن"></button>
      <button class="icon-btn" type="button" id="logout" aria-label="خروج" title="خروج">${icon('logout')}</button></div>
  </aside>
  <div class="scrim-m" id="scrimm"></div>
  <main class="main">
    <header class="top"><button class="icon-btn only-m" type="button" id="burger" aria-label="منو">${icon('menu')}</button><h1 id="title"></h1><div id="topx" class="row"></div></header>
    <div class="view" id="view"></div>
    <nav class="tabs">${NAV.map(([id, l, ic, h]) => `<a href="${h}" data-nav="${id}">${icon(ic)}${l}</a>`).join('')}</nav>
  </main>`;
  const side = $('#side'), scrim = $('#scrimm');
  const toggle = (o) => { side.classList.toggle('open', o); scrim.classList.toggle('open', o); };
  $('#burger').onclick = () => toggle(true);
  scrim.onclick = () => toggle(false);
  S.closeDrawer = () => toggle(false);
  $('#langbtn').onclick = pickLang;
  $('#credit').onclick = () => { location.hash = '#/usage'; };
  $('#newchat').onclick = () => { S.closeDrawer(); newChat(); };
  $('#themebtn').onclick = () => { S.theme = isDark() ? 'light' : 'dark'; lsSet('jinx_theme', S.theme); applyTheme(); };
  applyTheme();
  $('#logout').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); location.hash = '#/'; location.reload(); };
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); loadConvs(); }, 250); };
  $('#hist').onclick = onHistClick;
}

function markNav() {
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === S.route.name));
}

function updateConn() {
  const ok = S.settings?.has_key && S.settings?.base_url;
  $('#conn')?.classList.toggle('ok', !!ok);
  if ($('#conntxt')) $('#conntxt').textContent = ok ? (S.settings.base_url.replace(/^https?:\/\//, '').split('/')[0]) : 'API وصل نیست';
  if ($('#conntxt')) $('#conntxt').style.direction = 'ltr';
}

// ---------- history ----------
async function loadConvs() {
  try {
    S.convs = (await api('GET', '/api/conversations' + (S.q ? `?q=${encodeURIComponent(S.q)}` : ''))).conversations;
  } catch { return; }
  renderHist();
}

function renderHist() {
  const h = $('#hist');
  if (!h) return;
  if (!S.convs.length) { h.innerHTML = `<h6>${S.q ? 'موردی پیدا نشد' : 'هنوز گفتگویی نیست'}</h6>`; return; }
  const groups = {};
  for (const c of S.convs) (groups[timeGroup(c.updated_at)] ||= []).push(c);
  h.innerHTML = ['امروز', 'دیروز', 'هفته اخیر', 'قدیمی‌تر'].filter((g) => groups[g]).map((g) =>
    `<div><h6>${g}</h6>${groups[g].map((c) => `<div class="conv${S.conv?.id === c.id && S.route.name === 'chat' ? ' on' : ''}"><a href="#/c/${c.id}" dir="auto">${esc(c.title)}</a>
      <button class="more" type="button" data-more="${c.id}" aria-label="گزینه‌ها">${icon('more', 'sm')}</button></div>`).join('')}</div>`).join('');
}

async function onHistClick(e) {
  const a = e.target.closest('a');
  if (a) S.closeDrawer?.();
  const btn = e.target.closest('[data-more]');
  if (!btn) return;
  const id = btn.dataset.more;
  const c = S.convs.find((x) => x.id === id);
  openSheet({
    title: c?.title || 'گفتگو',
    body: `<button class="opt" type="button" data-a="rename">${icon('edit')}<span class="nm" style="direction:rtl;text-align:start">تغییر نام</span></button>
           <button class="opt" type="button" data-a="del" style="color:var(--danger)">${icon('trash')}<span class="nm" style="direction:rtl;text-align:start">حذف گفتگو</span></button>`,
  });
  $('#overlay').onclick = async (ev) => {
    const act = ev.target.closest('[data-a]')?.dataset.a;
    if (!act) return;
    $('#overlay .scrim').click();
    if (act === 'rename') {
      const v = await promptDialog('تغییر نام گفتگو', c.title);
      if (v) { await api('PATCH', `/api/conversations/${id}`, { title: v }); if (S.conv?.id === id) { S.conv.title = v; $('#title').textContent = v; } loadConvs(); }
    } else if (await confirmDialog('این گفتگو برای همیشه حذف شود؟', 'حذف')) {
      await api('DELETE', `/api/conversations/${id}`);
      if (S.conv?.id === id) location.hash = '#/';
      loadConvs();
    }
  };
}

// ---------- routing ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('c/')) return { name: 'chat', id: h.slice(2) };
  if (['memory', 'settings', 'usage'].includes(h)) return { name: h };
  return { name: 'chat', id: null };
}

async function route() {
  S.route = parseRoute();
  markNav();
  S.closeDrawer?.();
  if (S.busy && S.route.name !== 'chat') S.abort?.abort();
  const v = $('#view');
  if (S.route.name === 'chat') return viewChat();
  S.conv = null;
  $('#topx').innerHTML = '';
  v.innerHTML = '';
  ({ memory: viewMemory, settings: viewSettings, usage: viewUsage })[S.route.name]();
  renderHist();
}

function newChat() { S.conv = null; S.messages = []; S.pending = []; if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/'; }

// ---------- chat ----------
const STARTERS = [
  ['code', 'یک سایت خفن بساز', 'یک وب‌سایت لندینگ فوق‌العاده مدرن و لوکس برای برند من طراحی کن (انیمیشن‌های نرم، کاملا ریسپانسیو، با تم تیره و روشن). همه فایل‌ها را کامل بده تا پیش‌نمایش زنده ببینم.', 'chat'],
  ['spark', 'تصویر سینمایی', 'یک تصویر سینمایی خیره‌کننده از شهری در آینده زیر باران نئونی در شب', 'image'],
  ['play', 'ساخت ویدیو', 'یک ویدیوی کوتاه سینمایی از طلوع خورشید روی کوه‌های مه‌آلود', 'video'],
  ['db', 'ربات تلگرام', 'یک ربات تلگرام با Node.js و دستورات استقرار روی Railway بنویس.', 'chat'],
];

async function viewChat() {
  const v = $('#view');
  const id = S.route.id;
  v.innerHTML = `<div class="scroller" id="scroller"><div class="thread" id="thread"></div></div>
    <div class="composer-wrap"><div class="composer" id="composer">
      <div class="chips" id="chips" hidden></div>
      <div class="mbar" id="mbar" hidden></div>
      <textarea id="input" rows="1" placeholder="پیامت را بنویس" enterkeyhint="send"></textarea>
      <div class="tools">
        <button class="tool" type="button" id="attach" aria-label="پیوست فایل" title="فایل">${icon('clip')}</button>
        <button class="tool" type="button" id="attachimg" aria-label="پیوست تصویر" title="تصویر">${icon('image')}</button>
        <button class="tool" type="button" id="imgmode" title="ساخت تصویر">${icon('spark')}<span>ساخت تصویر</span></button>
        <button class="tool${S.fast ? ' on' : ''}" type="button" id="fastmode" title="ساخت سریع" aria-pressed="${S.fast}">${icon('bolt')}<span>سریع</span></button>
        <button class="tool" type="button" id="vidmode" title="ساخت ویدیو">${icon('film')}<span>ساخت ویدیو</span></button>
        <span class="sp"></span>
        <button class="tool model-chip" type="button" id="modelbtn"><span id="modeltxt" class="mt"></span>${icon('down', 'sm')}</button>
        <button class="send" type="button" id="send" aria-label="ارسال">${icon('send')}</button>
      </div>
      <input type="file" id="fileinp" multiple hidden>
      <input type="file" id="imginp" accept="image/*" multiple hidden>
    </div></div>`;
  $('#topx').innerHTML = '';
  bindComposer();

  if (id) {
    if (S.conv?.id !== id || !S.messages.length) {
      try {
        const r = await api('GET', `/api/conversations/${id}`);
        S.conv = r.conversation; S.messages = r.messages;
        S.memUsed = Object.fromEntries(r.memories.map((m) => [m.id, m.text]));
      } catch (e) { toast(e.message, true); location.hash = '#/'; return; }
    }
    $('#title').textContent = S.conv.title;
  } else {
    S.conv = null; S.messages = []; S.memUsed = {};
    $('#title').textContent = 'Jinx';
  }
  S.chatModel = S.conv?.model || S.chatModel || S.settings?.default_model || '';
  updateModelBtn();
  renderThread();
  renderHist();
  scrollEnd(true);
  if (!coarse) $('#input')?.focus();
}

const ASPECTS = [['1:1', '۱:۱'], ['16:9', '۱۶:۹'], ['9:16', '۹:۱۶'], ['4:3', '۴:۳'], ['3:4', '۳:۴']];
const STYLES = [['', 'خودکار'], ['photo', 'فوتورئال'], ['cinematic', 'سینمایی'], ['render3d', 'سه‌بعدی'], ['illustration', 'تصویرسازی'], ['anime', 'انیمه'], ['logo', 'لوگو'], ['product', 'محصول'], ['art', 'نقاشی']];

function renderMbar() {
  const bar = $('#mbar');
  if (!bar) return;
  if (S.mode === 'chat') { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  const chips = (list, cur, attr) => list.map(([v, l]) => `<button type="button" class="mchip${String(cur) === String(v) ? ' on' : ''}" data-${attr}="${v}">${l}</button>`).join('');
  bar.innerHTML = S.mode === 'image'
    ? `<div class="mrow2"><span>نسبت</span>${chips(ASPECTS, S.img.aspect, 'asp')}</div>
       <div class="mrow2"><span>سبک</span>${chips(STYLES, S.img.style, 'sty')}</div>
       <div class="mrow2"><span>تعداد</span>${chips([[1, '۱'], [2, '۲'], [4, '۴']], S.img.count, 'cnt')}<button type="button" class="mchip${S.img.enhance ? ' on' : ''}" data-enh>${icon('spark', 'sm')} بهبود هوشمند پرامپت</button></div>`
    : `<div class="mrow2"><span>مدت</span>${chips([[4, '۴ ثانیه'], [8, '۸ ثانیه'], [12, '۱۲ ثانیه']], S.vid.seconds, 'sec')}</div>
       <div class="mrow2"><span>نسبت</span>${chips([['16:9', '۱۶:۹'], ['9:16', '۹:۱۶'], ['1:1', '۱:۱']], S.vid.aspect, 'vasp')}</div>`;
}

function onMbarClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.asp) S.img.aspect = d.asp;
  else if (d.sty !== undefined) S.img.style = d.sty;
  else if (d.cnt) S.img.count = Number(d.cnt);
  else if ('enh' in d) S.img.enhance = !S.img.enhance;
  else if (d.sec) S.vid.seconds = Number(d.sec);
  else if (d.vasp) S.vid.aspect = d.vasp;
  else return;
  lsSet('jinx_img', JSON.stringify(S.img)); lsSet('jinx_vid', JSON.stringify(S.vid));
  renderMbar();
}

function updateModelBtn() {
  const m = modelFor(S.mode);
  const t = $('#modeltxt');
  if (t) t.innerHTML = m ? `${badge(m, 'xs')}<span>${esc(shortModel(m))}</span>` : '<span>انتخاب مدل</span>';
  $('#imgmode')?.classList.toggle('on', S.mode === 'image');
  $('#vidmode')?.classList.toggle('on', S.mode === 'video');
  const inp = $('#input');
  if (inp) inp.placeholder = S.mode === 'image' ? 'تصویر را توصیف کن (فارسی هم می‌شود)' : S.mode === 'video' ? 'ویدیو را توصیف کن' : 'پیامت را بنویس';
  renderMbar();
  applyTheme(m || S.chatModel || S.settings?.default_model || '');
}

function scrollEnd(force) {
  const s = $('#scroller');
  if (!s) return;
  const near = s.scrollHeight - s.scrollTop - s.clientHeight < 160;
  if (force || near) { s.style.scrollBehavior = force ? 'auto' : ''; s.scrollTop = s.scrollHeight; }
}

function emptyState() {
  const need = !S.settings?.has_key || !S.settings?.base_url;
  return `<div class="empty"><h2 class="hello">سلام <em>خوش آمدی</em></h2><p>امروز چه بسازیم؟</p>
    ${need ? `<div class="notice">${icon('key')}<span>اول API را وصل کن تا گفتگو شروع شود.</span><a class="btn primary sm" href="#/settings">اتصال</a></div>` : ''}
    <div class="starters">${STARTERS.map(([ic, t, p], i) => `<button class="starter" type="button" data-st="${i}"><b>${icon(ic)}${t}</b><span>${esc(p)}</span></button>`).join('')}</div></div>`;
}

function renderThread() {
  const th = $('#thread');
  if (!th) return;
  if (!S.messages.length) { th.innerHTML = emptyState(); return; }
  th.innerHTML = S.messages.map(msgHtml).join('');
  hydrateVideos(th);
  hydrateChecks(th);
  const last = th.lastElementChild;
  if (last?.classList.contains('assistant') && !S.busy) last.querySelector('[data-regen]')?.removeAttribute('hidden');
}

function attHtml(atts, user) {
  if (!atts?.length) return '';
  const imgs = atts.filter((a) => /^image\//.test(a.mime));
  const vids = atts.filter((a) => /^video\//.test(a.mime));
  const rest = atts.filter((a) => !/^(image|video)\//.test(a.mime));
  let h = '';
  if (imgs.length) {
    h += user
      ? `<div class="atts">${imgs.map((a) => `<a class="att-img" href="/api/files/${a.id}" target="_blank" rel="noopener"><img src="/api/files/${a.id}" alt="${esc(a.name)}" loading="lazy"></a>`).join('')}</div>`
      : `<div class="gen-imgs n${Math.min(imgs.length, 4)}">${imgs.map((a) => `<figure><img src="/api/files/${a.id}" alt="${esc(a.name)}" loading="lazy" data-zoom="${a.id}"><figcaption>
          <button type="button" class="fbtn" data-zoom="${a.id}" aria-label="نمایش کامل" title="نمایش کامل">${icon('eye', 'sm')}</button>
          <a class="fbtn pri" href="/api/files/${a.id}?download=1" download aria-label="دانلود تصویر" title="دانلود تصویر">${icon('download', 'sm')}<span>دانلود تصویر</span></a></figcaption></figure>`).join('')}</div>`;
  }
  for (const a of vids) h += `<div class="vid-card"><video class="att-video" controls playsinline preload="metadata" src="/api/files/${a.id}"></video>
      <div class="vid-actions"><a class="btn sm primary" href="/api/files/${a.id}?download=1" download>${icon('download', 'sm')} دانلود ویدیو</a>
        <span class="aud" data-audio="${a.id}" hidden><a class="btn sm" href="/api/files/${a.id}/audio?format=mp3&download=1" download>${icon('music', 'sm')} <span>دانلود صدا</span> <em class="ltr">MP3</em></a>
        <a class="btn sm ghost" href="/api/files/${a.id}/audio?format=wav&download=1" download><em class="ltr">WAV</em></a>
        <a class="btn sm ghost" href="/api/files/${a.id}/audio?format=m4a&download=1" download><em class="ltr">M4A</em></a></span>
        <span class="vmeta ltr" data-vmeta="${a.id}"></span></div></div>`;
  if (rest.length) h += `<div class="atts">${rest.map((a) => `<a class="att-file" href="/api/files/${a.id}?download=1">${icon('file', 'sm')}<span>${esc(a.name)}</span><small>${bytes(a.size)}</small></a>`).join('')}</div>`;
  return h;
}

function filesHtml(m) {
  const files = extractFiles(m.content);
  if (!files.length) return '';
  const hasIndex = files.some((f) => /(^|\/)index\.html$/.test(f.path));
  return `<div class="files"><div class="files-h"><b>${fa(files.length)} فایل آماده</b><div class="row">
      ${hasIndex ? `<button class="btn sm" type="button" data-preview="${m.id}">${icon('eye', 'sm')} پیش‌نمایش زنده</button>` : ''}
      <a class="btn sm primary" href="/api/messages/${m.id}/zip">${icon('download', 'sm')} دانلود ZIP</a></div></div>
    <div class="chk" data-check="${m.id}"></div>
    ${files.map((f) => `<div class="file">${icon('file', 'sm')}<span class="nm">${esc(f.path)}</span><span class="sz">${bytes(f.size)}</span>
      <a class="icon-btn" style="width:34px;height:34px" href="/api/messages/${m.id}/file?path=${encodeURIComponent(f.path)}" aria-label="دانلود ${esc(f.path)}">${icon('download', 'sm')}</a></div>`).join('')}</div>`;
}

const ISSUE = {
  js_syntax: 'خطای نحوی در', json_invalid: 'JSON نامعتبر در', missing_ref: 'فایل ارجاع‌شده وجود ندارد', truncated: 'پاسخ وسط فایل قطع شده',
  no_index: 'فایل index.html وجود ندارد', css_braces: 'آکولادهای CSS ناقص در', html_unfinished: 'HTML ناتمام است', empty: 'فایل خالی', placeholder: 'کد ناتمام در',
};
async function hydrateChecks(root = document) {
  for (const el of $$('[data-check]', root)) {
    if (el.dataset.done) continue;
    el.dataset.done = '1';
    const id = el.dataset.check;
    if (String(id).startsWith('tmp')) continue;
    try {
      const r = await api('GET', `/api/messages/${id}/check`);
      if (r.ok) { el.innerHTML = `<span class="chk-ok">${icon('check', 'sm')} بررسی خودکار: بدون خطا</span>`; continue; }
      el.innerHTML = `<div class="chk-bad"><div class="chk-h">${icon('shield', 'sm')}<b>${fa(r.issues.length)} مشکل پیدا شد</b><button class="btn sm primary" type="button" data-fix="${id}">${icon('spark', 'sm')} رفع خودکار</button></div>
        <ul>${r.issues.slice(0, 8).map((i) => `<li><span class="ltr">${esc(i.file)}</span> ${ISSUE[i.code] ? ISSUE[i.code] : i.code}${i.detail ? ` <code class="ltr" data-notr>${esc(i.detail)}</code>` : ''}</li>`).join('')}</ul></div>`;
      el._issues = r.issues;
    } catch {}
  }
}
function askFix(issues) {
  const list = issues.slice(0, 12).map((i) => `- ${i.file}: ${i.code}${i.detail ? ' (' + i.detail + ')' : ''}`).join('\n');
  const inp = $('#input');
  if (!inp) return;
  S.mode = 'chat'; updateModelBtn();
  inp.value = `Automatic checks found problems in the project you just delivered:\n${list}\n\nFix every one of them. Return the COMPLETE corrected project again (every file in full, using file:path code blocks), with no placeholders. Reply briefly.`;
  inp.dispatchEvent(new Event('input'));
  sendMessage();
}

function memLineHtml(m) {
  const ids = (m.memory_used || []).filter((id) => S.memUsed[id]);
  if (!ids.length) return '';
  return `<div class="memline"><button type="button" data-memtoggle>${icon('layers', 'sm')} ${fa(ids.length)} خاطره در این پاسخ استفاده شد</button></div>
    <ul class="memlist" hidden>${ids.map((id) => `<li dir="auto">${esc(S.memUsed[id])}</li>`).join('')}</ul>`;
}

function msgHtml(m) {
  if (m.role === 'user') {
    return `<div class="msg user" data-id="${m.id}">${attHtml(m.attachments, true)}${m.content ? `<div class="bubble" dir="auto">${esc(m.content)}</div>` : ''}</div>`;
  }
  return `<div class="msg assistant" data-id="${m.id}">
    <div class="a-head">${badge(m.model || S.chatModel)}<span class="ltr">${esc(shortModel(m.model || S.chatModel))}</span><span>${hhmm(m.created_at)}</span></div>
    <div class="md">${render(m.content)}</div>${attHtml(m.attachments, false)}${filesHtml(m)}${memLineHtml(m)}
    <div class="m-actions"><button type="button" data-copymsg>${icon('copy', 'sm')} کپی</button><button type="button" data-regen hidden>${icon('refresh', 'sm')} تولید دوباره</button></div></div>`;
}

function bindComposer() {
  const inp = $('#input'), send = $('#send');
  const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, window.innerHeight * 0.38) + 'px'; syncSend(); };
  const syncSend = () => {
    send.disabled = !S.busy && !inp.value.trim() && !S.pending.some((p) => p.id);
    send.classList.toggle('stop', S.busy);
    send.innerHTML = S.busy ? icon('stop') : icon('send');
    send.setAttribute('aria-label', S.busy ? 'توقف' : 'ارسال');
  };
  S.syncSend = syncSend;
  inp.oninput = grow;
  inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); sendMessage(); } };
  send.onclick = () => (S.busy ? S.abort?.abort() : sendMessage());
  $('#attach').onclick = () => $('#fileinp').click();
  $('#attachimg').onclick = () => $('#imginp').click();
  $('#fileinp').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#imginp').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('#imgmode').onclick = () => { S.mode = S.mode === 'image' ? 'chat' : 'image'; updateModelBtn(); };
  $('#vidmode').onclick = () => { S.mode = S.mode === 'video' ? 'chat' : 'video'; updateModelBtn(); };
  $('#fastmode').onclick = (e) => { S.fast = !S.fast; lsSet('jinx_fast', S.fast ? '1' : '0'); e.currentTarget.classList.toggle('on', S.fast); e.currentTarget.setAttribute('aria-pressed', S.fast); toast(S.fast ? 'ساخت سریع روشن شد: پروژه جمع‌وجور و بدون حاشیه' : 'ساخت سریع خاموش شد', false, 2200); };
  $('#modelbtn').onclick = () => pickModel(S.mode);
  $('#mbar').onclick = onMbarClick;
  inp.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } });
  const comp = $('#composer');
  ['dragenter', 'dragover'].forEach((ev) => comp.addEventListener(ev, (e) => { e.preventDefault(); comp.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => comp.addEventListener(ev, (e) => { e.preventDefault(); comp.classList.remove('drag'); }));
  comp.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  $('#thread').onclick = onThreadClick;
  renderChips();
  syncSend();
}

function renderChips() {
  const c = $('#chips');
  if (!c) return;
  c.hidden = !S.pending.length;
  c.innerHTML = S.pending.map((p, i) => `<div class="chip${p.id ? '' : ' up'}">${p.thumb ? `<img src="${p.thumb}" alt="">` : icon(/^video\//.test(p.mime) ? 'play' : 'file', 'sm')}<span dir="auto">${esc(p.name)}</span>${p.id ? `<small class="ltr">${bytes(p.size || 0)}</small>` : `<small class="pt ltr">${p.pct || 0}%</small><i class="pg"></i>`}<button class="x" type="button" data-rm="${i}" aria-label="حذف">${icon('x', 'sm')}</button></div>`).join('');
  $$('[data-rm]', c).forEach((b) => (b.onclick = () => { const it = S.pending[Number(b.dataset.rm)]; it?.xhr?.abort(); S.pending.splice(Number(b.dataset.rm), 1); renderChips(); S.syncSend?.(); }));
}

const maxUp = () => (S.settings?.max_upload_mb || 25) * 1048576;
function uploadFile(f, item) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/upload');
    x.withCredentials = true;
    x.setRequestHeader('X-Requested-With', 'jinx');
    x.setRequestHeader('Content-Type', item.mime);
    x.setRequestHeader('X-Filename', encodeURIComponent(f.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) { item.pct = Math.round((e.loaded / e.total) * 100); updateChipProgress(item); } };
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText); } catch {}
      if (x.status === 401) { showLogin(); return reject(new ApiError('نشست منقضی شده', 401)); }
      x.status >= 200 && x.status < 300 ? resolve(j) : reject(new ApiError(j.error || `خطا (${x.status})`, x.status));
    };
    x.onerror = () => reject(new ApiError('ارتباط قطع شد'));
    item.xhr = x;
    x.send(f);
  });
}
function updateChipProgress(item) {
  const i = S.pending.indexOf(item);
  const el = $(`#chips .chip:nth-child(${i + 1}) .pg`);
  if (el) el.style.width = (item.pct || 0) + '%';
  const t = $(`#chips .chip:nth-child(${i + 1}) .pt`);
  if (t) t.textContent = (item.pct || 0) + '%';
}
async function addFiles(list) {
  const files = [...list];
  const jobs = [];
  for (const f of files) {
    if (S.pending.length >= 8) { toast('حداکثر ۸ پیوست', true); break; }
    if (f.size > maxUp()) { toast(`${f.name}: بیش از ${fa(maxUp() / 1048576)} مگابایت است`, true); continue; }
    if (!f.size) { toast(`${f.name}: فایل خالی است.`, true); continue; }
    const item = { name: f.name, mime: f.type || 'application/octet-stream', size: f.size, pct: 0, thumb: /^image\//.test(f.type) ? URL.createObjectURL(f) : '' };
    S.pending.push(item);
    jobs.push([f, item]);
  }
  renderChips();
  S.syncSend?.();
  await Promise.all(jobs.map(async ([f, item]) => {
    try {
      const r = await uploadFile(f, item);
      Object.assign(item, r); item.pct = 100;
    } catch (e) { toast(`${f.name}: ${e.message}`, true); const k = S.pending.indexOf(item); if (k >= 0) S.pending.splice(k, 1); }
    renderChips();
    S.syncSend?.();
  }));
}

function lightbox(id) {
  const list = $$('[data-zoom]').filter((x) => x.tagName === 'IMG').map((x) => x.dataset.zoom);
  let i = Math.max(0, list.indexOf(id));
  const ov = document.createElement('div');
  ov.className = 'lightbox';
  ov.innerHTML = `<button class="lb-x" type="button" aria-label="بستن" data-notr>${icon('x')}</button>
    <img alt=""><div class="lb-bar"><a class="btn primary" download>${icon('download', 'sm')} دانلود تصویر</a><a class="btn" target="_blank" rel="noopener">${icon('eye', 'sm')} باز کردن در تب جدید</a></div>`;
  document.body.append(ov);
  const show = () => { const u = `/api/files/${list[i]}`; $('img', ov).src = u; const [d, o] = $$('.lb-bar a', ov); d.href = u + '?download=1'; o.href = u; };
  const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') { i = (i + 1) % list.length; show(); } else if (e.key === 'ArrowLeft') { i = (i - 1 + list.length) % list.length; show(); } };
  document.addEventListener('keydown', key);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest('.lb-x')) close(); };
  show();
}

// reveal the audio buttons / resolution only for videos that really carry a soundtrack
async function hydrateVideos(root = document) {
  for (const el of $$('[data-audio]', root)) {
    if (el.dataset.done) continue;
    el.dataset.done = '1';
    try {
      const i = await api('GET', `/api/files/${el.dataset.audio}/info`);
      if (i.audio_export) el.hidden = false;
      const m = $(`[data-vmeta="${el.dataset.audio}"]`, root);
      if (m) m.textContent = [i.width ? `${i.width}×${i.height}` : '', i.duration ? `${Math.round(i.duration)}s` : '', bytes(i.size || 0)].filter(Boolean).join(' · ');
    } catch {}
  }
}

function onThreadClick(e) {
  const t = e.target;
  const fx = t.closest('[data-fix]');
  if (fx) { const box = fx.closest('[data-check]'); if (box?._issues) askFix(box._issues); return; }
  const zm = t.closest('[data-zoom]');
  if (zm) { e.preventDefault(); lightbox(zm.dataset.zoom); return; }
  const st = t.closest('[data-st]');
  if (st) {
    const [, , p, md] = STARTERS[Number(st.dataset.st)];
    S.mode = md || 'chat'; updateModelBtn();
    $('#input').value = p; $('#input').dispatchEvent(new Event('input')); $('#input').focus();
    return;
  }
  const rt = t.closest('[data-rtoggle]');
  if (rt) { const box = rt.closest('.reason'); box.dataset.touched = '1'; box.classList.toggle('collapsed'); return; }
  const cp = t.closest('[data-copy]');
  if (cp) {
    e.preventDefault();
    const code = cp.closest('.code').querySelector('code').textContent;
    navigator.clipboard?.writeText(code).then(() => { cp.innerHTML = `${icon('check', 'sm')} کپی شد`; setTimeout(() => (cp.innerHTML = `${icon('copy', 'sm')} کپی`), 1500); });
    return;
  }
  const cm = t.closest('[data-copymsg]');
  if (cm) {
    const id = Number(cm.closest('.msg').dataset.id);
    const m = S.messages.find((x) => x.id === id);
    navigator.clipboard?.writeText(m?.content || cm.closest('.msg').querySelector('.md').innerText);
    toast('کپی شد', false, 1400);
    return;
  }
  if (t.closest('[data-regen]')) return regenerate();
  const mt = t.closest('[data-memtoggle]');
  if (mt) { const l = mt.closest('.msg').querySelector('.memlist'); l.hidden = !l.hidden; return; }
  const pv = t.closest('[data-preview]');
  if (pv) return openPreview(Number(pv.dataset.preview));
}

async function openPreview(id) {
  let info;
  try { info = await api('GET', `/api/messages/${id}/files`); } catch (e) { return toast(e.message, true); }
  const entry = info.files.find((f) => /(^|\/)index\.html$/.test(f.path))?.path || 'index.html';
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding:0';
  body.innerHTML = `<div class="preview-bar"><button class="btn sm on" type="button" data-w="100%">${icon('monitor', 'sm')} دسکتاپ</button><button class="btn sm" type="button" data-w="390px">${icon('phone', 'sm')} موبایل</button></div>
    <iframe class="preview-frame" sandbox="allow-scripts allow-forms allow-popups allow-modals" src="/preview/${id}.${info.preview}/${entry.split('/').map(encodeURIComponent).join('/')}"></iframe>`;
  const errs = [];
  const bar = document.createElement('div');
  bar.className = 'pv-err'; bar.hidden = true;
  body.insertBefore(bar, $('.preview-frame', body));
  const onMsg = (ev) => {
    const fr = $('.preview-frame', body);
    if (!fr || ev.source !== fr.contentWindow || ev.data?.jinx !== 'err') return;
    const m = String(ev.data.msg || '');
    if (errs.includes(m) || errs.length >= 8) return;
    errs.push(m);
    bar.hidden = false;
    bar.innerHTML = `<div class="chk-h">${icon('shield', 'sm')}<b>${fa(errs.length)} خطا هنگام اجرا</b><button class="btn sm primary" type="button" id="pvfix">${icon('spark', 'sm')} رفع خودکار</button></div><ul>${errs.slice(0, 4).map((e) => `<li><code class="ltr" data-notr>${esc(e)}</code></li>`).join('')}</ul>`;
    $('#pvfix', bar).onclick = () => { sh.close(); askFix(errs.map((e) => ({ file: 'runtime', code: 'runtime_error', detail: e }))); };
  };
  window.addEventListener('message', onMsg);
  const sh = openSheet({ title: 'پیش‌نمایش زنده سایت', body, wide: true, onClose: () => window.removeEventListener('message', onMsg) });
  $$('[data-w]', body).forEach((b) => (b.onclick = () => { $('.preview-frame', body).style.width = b.dataset.w; }));
}

async function ensureConv() {
  if (S.conv) return S.conv;
  const { id } = await api('POST', '/api/conversations');
  S.conv = { id, title: 'گفتگوی جدید', model: S.chatModel };
  history.replaceState(null, '', `#/c/${id}`);
  S.route = { name: 'chat', id };
  return S.conv;
}

// ---------- live activity (what the AI is doing right now) ----------
const ratioCss = (a) => String(a || '1:1').replace(':', ' / ');

function liveShell(model, kind) {
  const media = kind === 'image' || kind === 'video';
  return `<div class="msg assistant" id="live"><div class="a-head">${badge(model)}<span class="ltr">${esc(shortModel(model))}</span>
    <span class="live-stat"><i class="pulse"></i><span id="livestat">در حال آماده‌سازی</span><span id="livesec" class="ltr"></span></span></div>
    <div class="reason" id="livereason" hidden><button type="button" data-rtoggle>${icon('spark', 'sm')}<span>مراحل فکر کردن</span>${icon('down', 'sm')}</button><div class="rbody" id="livereasonb" dir="auto"></div></div>
    ${media
      ? `<div class="mediaph ${kind}" id="livemedia" style="aspect-ratio:${ratioCss(kind === 'image' ? S.img.aspect : S.vid.aspect)}"><div class="shimmer"></div><div class="mp-t"><b id="livemt"></b><div class="bar" id="livebar" hidden><i></i></div></div></div>`
      : '<div class="md" id="livemd"><div class="typing"><i></i><i></i><i></i></div></div><div class="build" id="livebuild" hidden></div>'}</div>`;
}

function startLive(steps = []) {
  const t0 = Date.now();
  const set = (txt) => { const el = $('#livestat'); if (el) el.textContent = txt; };
  const mt = (txt) => { const el = $('#livemt'); if (el) el.textContent = txt; };
  const apply = (s) => { const st = steps.find((x) => !x.shown && x.at <= s); if (st) { st.shown = true; set(st.text); mt(st.text); } };
  apply(0);
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const el = $('#livesec'); if (el) el.textContent = ` · ${s}s`;
    for (const st of steps) if (!st.shown && st.at <= s) { st.shown = true; set(st.text); mt(st.text); }
  }, 500);
  return { set, mt, stop: () => clearInterval(tick) };
}

function paintBuild(files) {
  const bx = $('#livebuild');
  if (!bx) return;
  bx.hidden = !files.length;
  if (!files.length) return;
  const done = files.filter((f) => f.done).length;
  bx.innerHTML = `<div class="build-h">${icon('code', 'sm')}<b>در حال ساخت پروژه</b><span>${fa(done)} از ${fa(files.length)} فایل</span></div>` +
    files.map((f) => `<div class="bfile ${f.done ? 'done' : 'act'}"><div class="bf-h">${f.done ? icon('check', 'sm') : '<i class="spin" style="width:14px;height:14px"></i>'}<span class="nm ltr">${esc(f.path)}</span><span class="ln">${fa(f.lines)} خط</span></div>${f.done ? '' : `<pre class="tail ltr">${esc(f.tail.join('\n'))}</pre>`}</div>`).join('');
}

// ---------- automatic image/video intent ----------
const CODE_AR = /(کد|سایت|وب‌?سایت|برنامه|پایتون|ربات|فایل|دیتابیس|تابع|پروژه|لندینگ|اپلیکیشن)/;
const CODE_EN = /\b(code|html|css|javascript|js|react|api|script|bot|app|website|svg|sql|function|python|node)\b/i;
function detectMedia(t) {
  if (t.length > 420 || CODE_AR.test(t) || CODE_EN.test(t)) return null;
  if (!/(بساز|بسازی|بکش|بکشی|درست کن|تولید کن|طراحی کن|خلق کن|ایجاد کن|generate|create|make|draw|render|design|produce)/i.test(t)) return null;
  if (/(ویدیو|ویدئو|کلیپ|انیمیشن|video|clip|animation|footage)/i.test(t)) return 'video';
  if (/(عکس|تصویر|پوستر|لوگو|وال‌?\s?پیپر|آیکون|نقاشی|بنر|image|picture|photo|poster|logo|wallpaper|illustration|artwork|banner|icon)/i.test(t)) return 'image';
  return null;
}

let creditT;
function setBusy(b) { S.busy = b; S.syncSend?.(); if (!b) { clearTimeout(creditT); creditT = setTimeout(() => loadCredit(true), 1500); } }

async function sendMessage() {
  if (S.busy) return;
  const inp = $('#input');
  const content = inp.value.trim();
  if (S.pending.some((p) => !p.id)) return toast('پیوست‌ها هنوز در حال بارگذاری‌اند', true);
  const atts = S.pending.map(({ id, name, mime, size }) => ({ id, name, mime, size }));
  if (!content && !atts.length) return;
  if (!S.settings?.has_key) { toast('اول API را در بخش «اتصال» وصل کن', true); location.hash = '#/settings'; return; }

  let mode = S.mode;
  if (mode === 'chat' && S.settings.auto_media !== false && content && !atts.length) {
    const g = detectMedia(content);
    if (g === 'image' && S.settings.image_model) { mode = 'image'; toast('با مدل تصویر ساخته می‌شود', false, 2200); }
    else if (g === 'video' && S.settings.video_model) { mode = 'video'; toast('با مدل ویدیو ساخته می‌شود', false, 2200); }
    else if (g && !S.hintedMedia) { S.hintedMedia = true; toast(g === 'image' ? 'برای ساخت عکس، در «اتصال» یک مدل تصویر انتخاب کن' : 'برای ساخت ویدیو، در «اتصال» مدل ویدیو را وارد کن', false, 6000); }
  }
  const model = mode === 'image' ? S.settings.image_model : mode === 'video' ? S.settings.video_model : S.chatModel;
  if (!model) { toast(mode === 'image' ? 'یک مدل تصویر انتخاب کن' : mode === 'video' ? 'یک مدل ویدیو انتخاب کن' : 'یک مدل انتخاب کن', true); return pickModel(mode); }

  let conv;
  try { conv = await ensureConv(); } catch (e) { return toast(e.message, true); }
  inp.value = ''; inp.style.height = 'auto';
  S.pending = []; renderChips();
  const userMsg = { id: 'tmp' + Date.now(), role: 'user', content, attachments: atts, created_at: Date.now() };
  S.messages.push(userMsg);
  renderThread();
  $('#thread').insertAdjacentHTML('beforeend', liveShell(model, mode));
  applyTheme(model);
  scrollEnd(true);
  S.abort = new AbortController();
  setBusy(true);
  try {
    if (mode === 'image') await runImage(conv, content, atts, model, userMsg);
    else if (mode === 'video') await runVideo(conv, content, model, userMsg);
    else await runStream(conv, { content, attachments: atts.map((a) => a.id), model, fast: S.fast }, model);
  } catch (e) {
    console.error(e); toast(e.message || 'خطای غیرمنتظره', true);
  } finally {
    setBusy(false); S.abort = null; $('#live')?.remove(); loadConvs(); updateModelBtn();
  }
}

async function regenerate() {
  if (S.busy || !S.conv) return;
  const last = S.messages.at(-1);
  if (last?.role === 'assistant') S.messages.pop();
  renderThread();
  const model = S.chatModel;
  $('#thread').insertAdjacentHTML('beforeend', liveShell(model, 'chat'));
  scrollEnd(true);
  S.abort = new AbortController();
  setBusy(true);
  try { await runStream(S.conv, { regenerate: true, model }, model); }
  catch (e) { console.error(e); toast(e.message || 'خطای غیرمنتظره', true); }
  finally { setBusy(false); S.abort = null; $('#live')?.remove(); }
}

async function runImage(conv, prompt, atts, model, userMsg) {
  const enh = S.img.enhance && !atts.length;
  const live = startLive([
    { at: 0, text: enh ? 'بهبود هوشمند پرامپت' : 'ارسال به مدل تصویر' }, { at: 6, text: 'ارسال به مدل تصویر' },
    { at: 14, text: 'در حال رندر و ریزه‌کاری' }, { at: 70, text: 'هنوز در حال ساخت؛ بعضی مدل‌ها کند هستند' },
  ]);
  try {
    const r = await api('POST', '/api/image', { conv_id: conv.id, prompt, model, attachments: atts.map((a) => a.id), aspect: S.img.aspect, style: S.img.style, enhance: S.img.enhance, count: S.img.count }, { signal: S.abort.signal });
    S.messages.pop();
    S.messages.push(r.user, r.assistant);
    $('#title').textContent = r.title;
    if (S.mode === 'image') S.mode = 'chat';
    renderThread(); scrollEnd(true);
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, true, 7000);
    S.messages.pop(); renderThread();
    const inp = $('#input'); if (inp && !inp.value) { inp.value = prompt; inp.dispatchEvent(new Event('input')); }
  } finally { live.stop(); }
}

async function runVideo(conv, prompt, model, userMsg) {
  const live = startLive([{ at: 0, text: 'ارسال درخواست ویدیو' }, { at: 6, text: 'در حال تولید ویدیو' }]);
  const bar = $('#livebar'); if (bar) bar.hidden = false;
  let r;
  try {
    r = await api('POST', '/api/video', { conv_id: conv.id, prompt, model, seconds: S.vid.seconds, aspect: S.vid.aspect }, { signal: S.abort.signal });
  } catch (e) {
    live.stop();
    if (e.name !== 'AbortError') toast(e.message, true, 7000);
    S.messages.pop(); renderThread();
    const inp = $('#input'); if (inp && !inp.value) { inp.value = prompt; inp.dispatchEvent(new Event('input')); }
    return;
  }
  Object.assign(userMsg, r.user);
  $('#title').textContent = S.conv?.title || $('#title').textContent;
  let fails = 0;
  try {
    for (;;) {
      if (S.abort.signal.aborted) { toast('ساخت ویدیو در پس‌زمینه ادامه دارد. کمی بعد گفتگو را دوباره باز کن.', false, 6000); break; }
      await sleep(3000);
      let j;
      try { j = await api('GET', `/api/video/${r.job_id}`); fails = 0; }
      catch (e) {
        if (e.status === 404) { toast(e.message, true, 7000); break; }
        if (++fails >= 10) { toast('ارتباط با سرور قطع شد. گفتگو را دوباره باز کن.', true); break; }
        continue;
      }
      const pct = Math.max(0, Math.min(100, j.progress || 0));
      const fill = $('#livebar i'); if (fill) fill.style.width = pct + '%';
      live.mt(`در حال تولید ویدیو · ${fa(pct)}٪`); live.set(`ساخت ویدیو · ${fa(pct)}٪`);
      if (j.status === 'done' || j.status === 'error') {
        if (j.message) S.messages.push(j.message);
        if (j.status === 'error') toast(j.error || 'ساخت ویدیو ناموفق بود', true, 8000);
        if (S.mode === 'video') S.mode = 'chat';
        break;
      }
    }
  } finally { live.stop(); renderThread(); scrollEnd(true); }
}

async function runStream(conv, payload, model) {
  const live = startLive([{ at: 0, text: 'در حال آماده‌سازی' }]);
  let text = '', reasoning = '', raf = 0;
  const paint = () => {
    raf = 0;
    const el = $('#livemd');
    if (!el) return;
    const sp = splitLive(text);
    const prose = sp.prose.trim();
    if (prose || sp.files.length) el.innerHTML = prose ? render(sp.prose) : '';
    el.classList.toggle('caret', !!prose);
    paintBuild(sp.files);
    const rb = $('#livereason');
    if (rb && reasoning) {
      rb.hidden = false;
      const body = $('#livereasonb'); body.textContent = reasoning.slice(-1800); body.scrollTop = body.scrollHeight;
      if (text && !rb.dataset.touched) rb.classList.add('collapsed');
    }
    const open = sp.files.find((f) => !f.done);
    live.set(open ? `در حال نوشتن ${open.path}` : text ? `در حال نوشتن پاسخ · ${fa(text.length)} کاراکتر` : reasoning ? 'در حال فکر کردن' : 'در حال آماده‌سازی');
    scrollEnd();
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(paint); };
  let finalMsg = null, err = null, newTitle = null;
  try {
    const res = await fetch(`/api/chat/${conv.id}`, {
      method: 'POST', credentials: 'same-origin', signal: S.abort.signal,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jinx' }, body: JSON.stringify(payload),
    });
    if (res.status === 401) { showLogin(); return; }
    if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `خطا (${res.status})`); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const blk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(blk)?.[1];
        const raw = /^data: (.+)$/m.exec(blk)?.[1];
        if (!ev || !raw) continue;
        let d; try { d = JSON.parse(raw); } catch { continue; }
        if (ev === 'meta') d.memories.forEach((m) => (S.memUsed[m.id] = m.text));
        else if (ev === 'delta') { text += d.text; kick(); }
        else if (ev === 'reasoning') { reasoning += d.text; kick(); }
        else if (ev === 'title') newTitle = d.title;
        else if (ev === 'done') finalMsg = d.message;
        else if (ev === 'memory') toast(`در حافظه ذخیره شد: ${d.saved.map((m) => m.text).join(' | ').slice(0, 90)}`, false, 5000);
        else if (ev === 'error') err = d.message;
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') err = e.message || 'ارتباط قطع شد';
  } finally { live.stop(); }
  if (raf) cancelAnimationFrame(raf);
  if (newTitle) { conv.title = newTitle; $('#title').textContent = newTitle; }
  if (finalMsg) {
    S.messages.push(finalMsg);
  } else if (S.abort?.signal.aborted && text) {
    try { const r = await api('GET', `/api/conversations/${conv.id}`); S.messages = r.messages; } catch {}
  } else if (err) {
    if (!text) { toast(err, true, 7000); }
    try { const r = await api('GET', `/api/conversations/${conv.id}`); S.messages = r.messages; } catch {}
  }
  if (err && text) toast(err, true, 7000);
  renderThread();
  scrollEnd(true);
}

// ---------- model picker ----------
async function loadModels(force) {
  if (S.models && !force) return S.models;
  try {
    S.models = (await api('GET', '/api/models' + (force ? '?refresh=1' : ''))).models;
    S.modelsError = '';
  } catch (e) { S.models = null; S.modelsError = e.message; }
  return S.models;
}

const VIDEO_RE = /sora|veo|video|kling|runway|luma|pika|hailuo|wan[-\d]|seedance|ray-|cogvideo|mochi|ltx/i;
const fmtPrice = (m) => (m.price_in == null ? '' : (m.price_in === 0 && !m.price_out) ? 'رایگان' : `$${+m.price_in.toFixed(2)} / $${+(m.price_out ?? 0).toFixed(2)}`);

async function pickModel(kind) {
  const body = document.createElement('div');
  body.className = 'picker';
  body.innerHTML = `<div class="search">${icon('search')}<input class="input" id="mq" placeholder="جستجو: claude، gemini، gpt، flux…" autocomplete="off" dir="ltr" style="padding-inline-start:38px"></div>
    <div class="bchips" id="bch"></div><div class="mlist" id="ml"><div class="row" style="padding:20px;justify-content:center"><i class="spin"></i></div></div>`;
  const sh = openSheet({ title: kind === 'image' ? 'مدل تولید تصویر' : kind === 'video' ? 'مدل ساخت ویدیو' : 'انتخاب مدل', body, wide: true });
  const list = $('#ml', body), chipsEl = $('#bch', body);
  const models = await loadModels();
  if (!models) { list.innerHTML = `<p style="color:var(--danger);margin:8px">${esc(S.modelsError)}</p><a class="btn primary" href="#/settings" id="goset">رفتن به اتصال</a>`; $('#goset').onclick = sh.close; return; }
  let pool = kind === 'image' ? models.filter((m) => m.image_output) : kind === 'video' ? models.filter((m) => VIDEO_RE.test(m.id)) : models.filter((m) => !m.image_output);
  const fallback = !pool.length;
  if (fallback) pool = models;
  pool = pool.map((m) => ({ ...m, p: prettyModel(m.id, m.name), b: brandOf(m.id) }));
  const cur = modelFor(kind);
  let bf = '';
  const counts = {};
  for (const m of pool) counts[m.b.key] = (counts[m.b.key] || 0) + 1;
  const order = Object.keys(counts).sort((a, b) => (a === 'other') - (b === 'other') || counts[b] - counts[a]);
  const paintChips = () => {
    chipsEl.innerHTML = `<button type="button" class="bchip${bf ? '' : ' on'}" data-b="">همه <em>${fa(pool.length)}</em></button>` +
      order.map((k) => { const m = pool.find((x) => x.b.key === k); return `<button type="button" class="bchip${bf === k ? ' on' : ''}" data-b="${k}" style="--bc:${m.b.accent}">${badge(m.id, 'xs')}${esc(m.b.name)}<em>${fa(counts[k])}</em></button>`; }).join('');
  };
  const paint = () => {
    const q = $('#mq', body).value.trim().toLowerCase();
    const rows = pool.filter((m) => (!bf || m.b.key === bf) && (!q || `${m.id} ${m.name} ${m.p.name} ${m.b.name} ${m.b.maker}`.toLowerCase().includes(q)));
    const groups = {};
    for (const m of rows.slice(0, 300)) (groups[m.b.key] ||= []).push(m);
    const html = order.filter((k) => groups[k]).map((k) => {
      const g = groups[k].sort((a, b) => b.p.name.localeCompare(a.p.name, 'en', { numeric: true }));
      const b = g[0].b;
      return `<div class="mgroup"><div class="mg-h">${badge(g[0].id, 'sm')}<b>${esc(b.name)}</b><span>${esc(b.maker)}</span><em>${fa(g.length)}</em></div>${g.map((m) => `<button class="mrow${m.id === cur ? ' on' : ''}" type="button" data-id="${esc(m.id)}" style="--bc:${m.b.accent}">
        <span class="mr-main"><b>${esc(m.p.name)}</b>${m.p.tags.map((t) => `<i class="tg">${esc(t)}</i>`).join('')}</span>
        <span class="mr-id ltr">${esc(m.id)}</span><span class="mr-meta ltr">${m.ctx ? Math.round(m.ctx / 1000) + 'K' : ''}${fmtPrice(m) ? ' · ' + fmtPrice(m) : ''}</span>${m.id === cur ? icon('check', 'sm') : ''}</button>`).join('')}</div>`;
    }).join('');
    const exact = pool.some((m) => m.id.toLowerCase() === q);
    const custom = q && !exact ? `<button class="mrow custom" type="button" data-id="${esc($('#mq', body).value.trim())}">${icon('plus', 'sm')}<span class="mr-main"><b>استفاده از «${esc($('#mq', body).value.trim())}»</b></span><span class="mr-id">نام دستی مدل</span></button>` : '';
    const note = fallback && kind !== 'chat' ? `<p class="mnote">${kind === 'video' ? 'این سرویس مدل ویدیویی در فهرستش نشان نمی‌دهد؛ نام مدل را دستی بنویس (مثلا sora-2).' : 'مدل تصویری شناسایی نشد؛ همه مدل‌ها نشان داده شده‌اند.'}</p>` : '';
    list.innerHTML = note + (html || (custom ? '' : '<p style="color:var(--ink-3);text-align:center">مدلی پیدا نشد</p>')) + custom;
  };
  paintChips(); paint();
  $('#mq', body).oninput = paint;
  chipsEl.onclick = (e) => { const b = e.target.closest('[data-b]'); if (!b) return; bf = b.dataset.b; paintChips(); paint(); };
  if (!coarse) $('#mq', body).focus();
  list.onclick = async (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const id = b.dataset.id;
    if (kind === 'image') { S.settings.image_model = id; api('PUT', '/api/settings', { image_model: id }).catch(() => {}); }
    else if (kind === 'video') { S.settings.video_model = id; api('PUT', '/api/settings', { video_model: id }).catch(() => {}); }
    else {
      S.chatModel = id;
      if (!S.settings.default_model) { S.settings.default_model = id; api('PUT', '/api/settings', { default_model: id }).catch(() => {}); }
      if (S.conv) api('PATCH', `/api/conversations/${S.conv.id}`, { model: id }).catch(() => {});
    }
    updateModelBtn(); sh.close();
  };
}

// ---------- memory ----------
async function viewMemory() {
  $('#title').textContent = 'حافظه';
  const v = $('#view');
  v.innerHTML = '<div class="page"><div class="wrap" id="mwrap"></div></div>';
  try { S.memories = (await api('GET', '/api/memories')).memories; } catch (e) { return toast(e.message, true); }
  paintMemory();
}

function paintMemory() {
  const w = $('#mwrap');
  if (!w) return;
  const all = S.memories;
  const f = S.memFilter;
  const shown = all.filter((m) => f === 'all' || (f === 'auto' && m.source === 'auto') || (f === 'manual' && m.source !== 'auto') || (f === 'pin' && m.pinned));
  const q = ($('#mq2')?.value || '').trim();
  const list = q ? shown.filter((m) => m.text.includes(q)) : shown;
  w.innerHTML = `<div class="page-title"><h2>حافظه شخصی</h2><p>هرچه اینجا روشن باشد، پیش از هر پیام برای مدل فرستاده می‌شود. حافظه به مدل وابسته نیست و با هر مدلی کار می‌کند.</p></div>
    <div class="stat"><div><b>${fa(all.length)}</b><span>خاطره</span></div><div><b>${fa(all.filter((m) => m.source === 'auto').length)}</b><span>ساخته‌شده خودکار</span></div><div><b>${fa(all.filter((m) => m.pinned).length)}</b><span>سنجاق‌شده</span></div></div>
    <div class="card"><div class="row" style="flex-wrap:nowrap"><input class="input" id="newmem" placeholder="چیزی که باید همیشه یادش بماند" maxlength="500"><button class="btn primary" type="button" id="addmem">افزودن</button></div></div>
    <div class="card handoff"><h3>${icon('layers', 'sm')} بسته‌ی انتقال حافظه</h3><p style="color:var(--ink-3);font-size:14px;margin:0 0 4px">همه‌چیز درباره‌ی تو و کارهایی که با هم کرده‌اید در یک فایل، تا بتوانی بکاپ بگیری یا به هر هوش مصنوعی دیگری بدهی.</p>
      <div class="row"><a class="btn primary" href="/api/handoff?format=md" download>${icon('download', 'sm')} دانلود Markdown</a><a class="btn" href="/api/handoff?format=json" download>${icon('download', 'sm')} JSON</a><button class="btn" type="button" id="hbrief">${icon('spark', 'sm')} خلاصه‌ی هوشمند</button><button class="btn" type="button" id="himp">${icon('plus', 'sm')} وارد کردن حافظه</button></div></div>
    <div class="row sp"><div class="filters">${[['all', 'همه'], ['auto', 'خودکار'], ['manual', 'دستی'], ['pin', 'سنجاق‌شده']].map(([k, l]) => `<button type="button" data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="search">${icon('search')}<input id="mq2" placeholder="جستجو در حافظه" value="${esc(q)}"></div>
    <div style="display:flex;flex-direction:column;gap:12px">${list.map((m) => `<div class="mem${m.enabled ? '' : ' off'}${m.pinned ? ' pin' : ''}" data-id="${m.id}"><div class="txt"><p dir="auto">${esc(m.text)}</p><div class="row"><span class="pill ${m.source === 'auto' ? 'jade' : ''}">${m.source === 'auto' ? 'خودکار' : 'دستی'}</span>${m.pinned ? '<span class="pill gold">سنجاق</span>' : ''}<span class="pill">${esc(m.tag)}</span></div></div>
      <div class="side-a"><button class="icon-btn" type="button" data-act="pin" aria-label="سنجاق" title="سنجاق">${icon('pin', 'sm')}</button><button class="icon-btn" type="button" data-act="edit" aria-label="ویرایش">${icon('edit', 'sm')}</button><button class="icon-btn" type="button" data-act="del" aria-label="حذف">${icon('trash', 'sm')}</button>
      <button class="switch" type="button" role="switch" aria-checked="${m.enabled}" data-act="toggle" aria-label="فعال"></button></div></div>`).join('') || '<p style="text-align:center;color:var(--ink-3);padding:30px 0">چیزی اینجا نیست.</p>'}</div>`;
  $('#hbrief').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; toast('در حال آماده‌سازی', false, 2500);
    try {
      const r = await api('POST', '/api/handoff/briefing');
      const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); a.download = name; a.click(); };
      const ta = document.createElement('textarea'); ta.className = 'textarea'; ta.readOnly = true; ta.value = r.markdown; ta.style.cssText = 'min-height:46vh;direction:auto;font-family:var(--mono);font-size:13px'; ta.dir = 'auto';
      openSheet({ title: 'خلاصه‌ی هوشمند برای هوش مصنوعی دیگر', body: ta, wide: true, footer: (f, close) => {
        f.innerHTML = `<button class="btn" type="button" data-c>${icon('copy', 'sm')} کپی</button><button class="btn primary" type="button" data-d>${icon('download', 'sm')} دانلود</button>`;
        $('[data-c]', f).onclick = () => { navigator.clipboard?.writeText(r.markdown); toast('کپی شد'); };
        $('[data-d]', f).onclick = () => dl('jinx-briefing.md', r.markdown);
      } });
    } catch (er) { toast(er.message, true); }
    b.disabled = false;
  };
  $('#himp').onclick = () => {
    const ta = document.createElement('textarea'); ta.className = 'textarea'; ta.style.minHeight = '34vh'; ta.dir = 'auto';
    ta.placeholder = '- ...\n- ...';
    const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.txt,.md,.json,text/*,application/json'; fi.style.margin = '8px 0';
    fi.onchange = async () => { if (fi.files[0]) ta.value = await fi.files[0].text(); };
    const wrap = document.createElement('div'); wrap.append(fi, ta);
    openSheet({ title: 'وارد کردن حافظه', body: wrap, footer: (f, close) => {
      f.innerHTML = `<button class="btn" type="button" data-no>انصراف</button><button class="btn primary" type="button" data-yes>افزودن</button>`;
      $('[data-no]', f).onclick = close;
      $('[data-yes]', f).onclick = async () => { try { const r = await api('POST', '/api/memories/import', { text: ta.value }); close(); toast(`${fa(r.added)} خاطره`); S.memories = (await api('GET', '/api/memories')).memories; paintMemory(); } catch (er) { toast(er.message, true); } };
    } });
  };
  const add = async () => {
    const t = $('#newmem').value.trim();
    if (!t) return;
    try { const r = await api('POST', '/api/memories', { text: t }); S.memories.unshift(r.memory); paintMemory(); } catch (e) { toast(e.message, true); }
  };
  $('#addmem').onclick = add;
  $('#newmem').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  $$('[data-f]', w).forEach((b) => (b.onclick = () => { S.memFilter = b.dataset.f; paintMemory(); }));
  $('#mq2').oninput = () => { const pos = $('#mq2').selectionStart; paintMemory(); const el = $('#mq2'); el.focus(); el.setSelectionRange(pos, pos); };
  $$('[data-act]', w).forEach((b) => (b.onclick = async () => {
    const card = b.closest('.mem');
    const m = S.memories.find((x) => x.id === card.dataset.id);
    try {
      if (b.dataset.act === 'toggle') { m.enabled = !m.enabled; await api('PATCH', `/api/memories/${m.id}`, { enabled: m.enabled }); }
      else if (b.dataset.act === 'pin') { m.pinned = !m.pinned; await api('PATCH', `/api/memories/${m.id}`, { pinned: m.pinned }); }
      else if (b.dataset.act === 'edit') { const v = await promptDialog('ویرایش خاطره', m.text); if (v) { m.text = v; await api('PATCH', `/api/memories/${m.id}`, { text: v }); } }
      else if (b.dataset.act === 'del') { if (!(await confirmDialog('این خاطره حذف شود؟', 'حذف'))) return; await api('DELETE', `/api/memories/${m.id}`); S.memories = S.memories.filter((x) => x !== m); }
      paintMemory();
    } catch (e) { toast(e.message, true); }
  }));
}

// ---------- settings ----------
async function viewSettings() {
  $('#title').textContent = 'اتصال';
  const v = $('#view');
  const s = S.settings;
  v.innerHTML = `<div class="page"><div class="wrap">
    <div class="page-title"><h2>اتصال به API</h2><p>هر سرویسی که با فرمت OpenAI کار کند: OpenRouter، OpenAI، DeepSeek، Together و مشابه.</p></div>
    <div class="card"><h3>سرویس</h3>
      <label class="field"><span>آدرس پایه (Base URL)</span><input class="input ltr" id="s_base" value="${esc(s.base_url)}" placeholder="https://openrouter.ai/api/v1" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>کلید API</span><input class="input ltr" id="s_key" type="password" placeholder="${s.has_key ? 'ذخیره شده  ' + esc(s.key_hint) : 'sk-...'}" autocomplete="off" spellcheck="false"><small>${s.has_key ? 'برای تغییر، کلید جدید را وارد کن. ' : ''}کلید فقط روی سرور و رمزنگاری‌شده ذخیره می‌شود و هرگز به مرورگر برنمی‌گردد.</small></label>
      <div class="row"><button class="btn primary" type="button" id="s_save">ذخیره</button><button class="btn" type="button" id="s_test">${icon('shield', 'sm')} تست اتصال</button>${s.has_key ? '<button class="btn danger sm" type="button" id="s_clear">حذف کلید</button>' : ''}</div>
      <div class="steps" id="s_steps"></div></div>
    <div class="card" id="profcard"></div>
    <div class="card"><h3>مدل‌ها</h3>
      <label class="field"><span>مدل پیش‌فرض گفتگو</span><input class="input ltr" id="s_dm" list="mdl" value="${esc(s.default_model)}" placeholder="مثلا anthropic/claude-sonnet-4" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>مدل تولید تصویر</span><input class="input ltr" id="s_im" list="mdl" value="${esc(s.image_model)}" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>مدل ساخت ویدیو (مثلا sora-2؛ سرویس باید مسیر /videos سازگار با OpenAI داشته باشد)</span><input class="input ltr" id="s_vm" list="mdl" value="${esc(s.video_model)}" placeholder="sora-2" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>مدل حافظه و خلاصه‌سازی (اختیاری، ارزان‌تر بهتر است)</span><input class="input ltr" id="s_mm" list="mdl" value="${esc(s.memory_model)}" placeholder="خالی = همان مدل گفتگو" autocapitalize="off" spellcheck="false"></label>
      <datalist id="mdl"></datalist>
      <div class="row"><button class="btn sm" type="button" id="s_pick">${icon('search', 'sm')} انتخاب از فهرست مدل‌ها</button><button class="btn sm" type="button" id="s_refresh">${icon('refresh', 'sm')} به‌روزرسانی فهرست</button></div></div>
    <div class="card"><h3>حافظه و رفتار</h3>
      <div class="row sp"><div><b>حافظه خودکار</b><div style="color:var(--ink-3);font-size:14px">بعد از هر گفتگو، موارد ماندگار را خودش ذخیره می‌کند.</div></div><button class="switch" type="button" role="switch" id="s_auto" aria-checked="${s.memory_auto}" aria-label="حافظه خودکار"></button></div>
      <div class="row sp"><div><b>تشخیص خودکار عکس و ویدیو</b><div style="color:var(--ink-3);font-size:14px">وقتی بنویسی «یه عکس خفن بساز»، خودش با مدل تصویر یا ویدیو می‌سازد.</div></div><button class="switch" type="button" role="switch" id="s_am" aria-checked="${s.auto_media}" aria-label="تشخیص خودکار"></button></div>
      <label class="field"><span>دستور سیستمی شخصی (روی همه گفتگوها اعمال می‌شود)</span><textarea class="textarea" id="s_sys" maxlength="4000" placeholder="مثلا: همیشه کد را کامل و آماده کپی بده.">${esc(s.system_prompt)}</textarea></label>
      <label class="field"><span>حجم متن ارسالی به مدل (کاراکتر) </span><input class="input ltr" id="s_ctx" type="number" min="8000" max="600000" step="1000" value="${s.context_chars}"><small>پیام‌های قدیمی‌تر از این حد، خودکار خلاصه می‌شوند و چیزی گم نمی‌شود.</small></label>
      <div><button class="btn primary" type="button" id="s_save2">ذخیره</button></div></div>
    <div class="card"><h3>تنظیمات سیستمی</h3>
      <label class="field"><span>دمای پاسخ (۰ تا ۲، خالی = پیش‌فرض مدل)</span><input class="input ltr" id="s_temp" type="number" min="0" max="2" step="0.1" value="${esc(s.temperature)}" placeholder="پیش‌فرض"><small>عدد کمتر یعنی دقیق‌تر، عدد بیشتر یعنی خلاق‌تر.</small></label>
      <label class="field"><span>سقف طول پاسخ (توکن، ۰ = خودکار)</span><input class="input ltr" id="s_mt" type="number" min="0" max="200000" step="100" value="${s.max_tokens}"></label>
      <label class="field"><span>مهلت پاسخ سرویس (ثانیه)</span><input class="input ltr" id="s_to" type="number" min="15" max="900" step="5" value="${s.request_timeout}"><small>اگر مدل‌های کند را استفاده می‌کنی این عدد را بیشتر کن.</small></label>
      <label class="field"><span>تعداد پشتیبان‌های نگهداری‌شده</span><input class="input ltr" id="s_bk" type="number" min="3" max="60" value="${s.backup_keep}"></label>
      <label class="field"><span>مدت اعتبار ورود (روز)</span><input class="input ltr" id="s_sd" type="number" min="1" max="90" value="${s.session_days}"><small>روی ورودهای جدید اعمال می‌شود.</small></label>
      <div><button class="btn primary" type="button" id="s_save3">ذخیره</button></div>
      <div id="s_sys_info" class="steps"></div></div>
    <div class="card"><h3>داده‌ها و پشتیبان</h3><p class="sub">پشتیبان خودکار هر ۶ ساعت روی سرور گرفته می‌شود (۱۴ روز اخیر). برای امنیت واقعی، گاهی یک نسخه روی گوشی خودت هم نگه دار.</p>
      <div class="row"><a class="btn" href="/api/export">${icon('download', 'sm')} خروجی JSON</a><a class="btn" href="/api/backup">${icon('db', 'sm')} دانلود دیتابیس</a><button class="btn" type="button" id="s_imp">بازگردانی از JSON</button><input type="file" id="s_impf" accept="application/json,.json" hidden></div>
      <div class="row"><button class="btn danger sm" type="button" id="s_all">${icon('logout', 'sm')} خروج از همه دستگاه‌ها</button></div></div>
  </div></div>`;

  const paintProfiles = () => {
    const list = S.settings.profiles || [];
    const box = $('#profcard');
    box.innerHTML = `<h3>اتصال‌های ذخیره‌شده</h3><p style="color:var(--ink-3);font-size:14px;margin:0 0 6px">هر کلیدی که ذخیره کنی اینجا نگه داشته می‌شود (رمزنگاری‌شده روی سرور). می‌توانی بین کلیدها جابه‌جا شوی یا هرکدام را حذف کنی و کلید تازه بزنی.</p>` +
      (list.length ? list.map((x) => `<div class="prof${x.active ? ' on' : ''}" data-pid="${x.id}"><div class="pi"><b data-notr>${esc(x.name)}</b><small class="ltr">${esc(x.base_url.replace(/^https?:\/\//, ''))} · ${esc(x.hint)}</small></div>
        ${x.active ? '<span class="pill jade">فعال</span>' : `<button class="btn sm" type="button" data-pa="act">فعال‌سازی</button>`}
        <button class="icon-btn" type="button" data-pa="ren" aria-label="تغییر نام">${icon('edit', 'sm')}</button><button class="icon-btn" type="button" data-pa="del" aria-label="حذف">${icon('trash', 'sm')}</button></div>`).join('')
        : '<p style="color:var(--ink-3)">هنوز اتصالی ذخیره نشده. کلید را وارد و ذخیره کن.</p>');
    box.onclick = async (e) => {
      const b = e.target.closest('[data-pa]'); if (!b) return;
      const id = b.closest('[data-pid]').dataset.pid, act = b.dataset.pa;
      try {
        if (act === 'act') { S.settings = await api('POST', `/api/profiles/${id}/activate`); S.models = null; updateConn(); loadCredit(true); toast('ذخیره شد'); viewSettings(); }
        else if (act === 'ren') { const cur = list.find((x) => x.id === id); const v = await promptDialog('تغییر نام', cur.name); if (v) { S.settings = await api('PATCH', `/api/profiles/${id}`, { name: v }); paintProfiles(); } }
        else if (await confirmDialog('این اتصال و کلیدش حذف شود؟', 'حذف')) { S.settings = await api('DELETE', `/api/profiles/${id}`); S.models = null; updateConn(); loadCredit(true); viewSettings(); }
      } catch (er) { toast(er.message, true); }
    };
  };
  paintProfiles();
  const val = (id) => $(id).value.trim();
  const saveAll = async (extra = {}) => {
    const body = { base_url: val('#s_base'), default_model: val('#s_dm'), image_model: val('#s_im'), video_model: val('#s_vm'), auto_media: $('#s_am').getAttribute('aria-checked') === 'true', memory_model: val('#s_mm'), system_prompt: $('#s_sys').value, memory_auto: $('#s_auto').getAttribute('aria-checked') === 'true', context_chars: Number($('#s_ctx').value) || 120000, temperature: $('#s_temp').value.trim(), max_tokens: Number($('#s_mt').value) || 0, request_timeout: Number($('#s_to').value) || 60, backup_keep: Number($('#s_bk').value) || 14, session_days: Number($('#s_sd').value) || 30, ...extra };
    const k = $('#s_key').value.trim();
    if (k) body.api_key = k;
    S.settings = await api('PUT', '/api/settings', body);
    S.models = null;
    applyTheme(S.chatModel || S.settings.default_model);
    $('#s_key').value = '';
    updateConn();
    return S.settings;
  };
  $('#s_am').onclick = (e) => e.currentTarget.setAttribute('aria-checked', e.currentTarget.getAttribute('aria-checked') !== 'true');
  $('#s_auto').onclick = (e) => e.currentTarget.setAttribute('aria-checked', e.currentTarget.getAttribute('aria-checked') !== 'true');
  const btnSave = async (e) => { const b = e.currentTarget; b.disabled = true; try { await saveAll(); toast('ذخیره شد'); viewSettings(); } catch (er) { toast(er.message, true); } b.disabled = false; };
  $('#s_save').onclick = btnSave; $('#s_save2').onclick = btnSave; $('#s_save3').onclick = btnSave;
  const fmtB = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const loadSys = async () => {
    const box = $('#s_sys_info'); if (!box) return;
    try {
      const y = await api('GET', '/api/system');
      const row = (k, v) => `<div class="step"><div>${esc(k)}<small class="ltr">${esc(v)}</small></div></div>`;
      box.innerHTML = row('نسخه / Node', `${y.version} / ${y.node}`) + row('زمان فعال بودن', `${Math.floor(y.uptime_s / 3600)}h ${Math.floor(y.uptime_s % 3600 / 60)}m`) +
        row('مسیر داده‌ها', y.data_dir) + row('دیتابیس', fmtB(y.db_bytes)) + row('فایل‌های آپلود', `${y.uploads.count} / ${fmtB(y.uploads.bytes)}`) +
        row('پشتیبان‌ها', y.backups.length ? y.backups.map((b) => `${b.name} (${fmtB(b.size)})`).join(' | ') : 'هنوز نیست') +
        y.warnings.map((w) => `<p style="color:var(--danger);margin:4px 0">${esc(w)}</p>`).join('') +
        '<div class="row"><button class="btn sm" type="button" id="s_bknow">پشتیبان‌گیری همین حالا</button></div>';
      $('#s_bknow').onclick = async (e) => { e.currentTarget.disabled = true; try { await api('POST', '/api/system/backup'); toast('پشتیبان ساخته شد'); loadSys(); } catch (er) { toast(er.message, true); } };
    } catch (er) { box.innerHTML = `<p style="color:var(--danger)">${esc(er.message)}</p>`; }
  };
  loadSys();
  $('#s_clear')?.addEventListener('click', async () => { if (await confirmDialog('کلید API حذف شود؟', 'حذف')) { S.settings = await api('PUT', '/api/settings', { clear_key: true }); S.models = null; updateConn(); viewSettings(); } });
  $('#s_test').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    $('#s_steps').innerHTML = '<div class="step"><i class="spin"></i><div>در حال تست...</div></div>';
    try {
      const r = await api('POST', '/api/settings/test', { base_url: val('#s_base'), api_key: $('#s_key').value.trim() || undefined, model: val('#s_dm') || undefined });
      $('#s_steps').innerHTML = r.steps.map((st) => `<div class="step"><span class="ic ${st.ok ? 'ok' : 'no'}">${icon(st.ok ? 'check' : 'x', 'sm')}</span><div>${esc(st.name)}<small>${esc(st.detail)}${st.ok ? ` · ${fa(st.ms)}ms` : ''}</small></div></div>`).join('') +
        `<div class="pill ${r.ok ? 'jade' : ''}" style="align-self:flex-start;margin-top:6px">${r.ok ? 'اتصال کامل برقرار است' : 'اتصال برقرار نشد'}</div>`;
    } catch (er) { $('#s_steps').innerHTML = `<p style="color:var(--danger)">${esc(er.message)}</p>`; }
    b.disabled = false;
  };
  const fillList = async (force) => {
    const m = await loadModels(force);
    if (m) $('#mdl').innerHTML = m.slice(0, 600).map((x) => `<option value="${esc(x.id)}">`).join('');
    else if (force) toast(S.modelsError, true);
    else $('#s_refresh')?.focus?.();
    return m;
  };
  if (s.has_key) fillList(false);
  $('#s_refresh').onclick = async () => { if (!s.has_key) return toast('اول کلید را ذخیره کن', true); const m = await fillList(true); if (m) toast(`${fa(m.length)} مدل دریافت شد`); };
  $('#s_pick').onclick = async () => { if (!s.has_key) return toast('اول کلید را ذخیره کن', true); await pickModel('chat'); $('#s_dm').value = S.settings.default_model || S.chatModel; };
  $('#s_imp').onclick = () => $('#s_impf').click();
  $('#s_impf').onchange = async (e) => {
    try { const j = JSON.parse(await e.target.files[0].text()); const r = await api('POST', '/api/import', j); toast(`وارد شد: ${fa(r.imported.conversations)} گفتگو، ${fa(r.imported.memories)} خاطره`); loadConvs(); }
    catch (er) { toast(er.message || 'فایل معتبر نیست', true); }
  };
  $('#s_all').onclick = async () => { if (await confirmDialog('همه نشست‌ها بسته می‌شوند و باید دوباره وارد شوی.', 'خروج', false)) { await api('POST', '/api/logout-all'); location.reload(); } };
}

// ---------- usage ----------
async function viewUsage() {
  $('#title').textContent = 'مصرف';
  const v = $('#view');
  v.innerHTML = '<div class="page"><div class="wrap" id="uwrap"></div></div>';
  let u;
  try { u = await api('GET', '/api/usage'); } catch (e) { return toast(e.message, true); }
  const tok = (r) => (r.prompt_tokens || 0) + (r.completion_tokens || 0);
  const total = u.rows.reduce((n, r) => n + tok(r), 0);
  const cost = u.rows.reduce((n, r) => n + (r.cost || 0), 0);
  const max = Math.max(1, ...u.rows.map(tok));
  const anyEst = u.rows.some((r) => r.estimated);
  const cr = await loadCredit(true);
  const creditCard = cr?.connected && cr.supported ? `<div class="hero credit-hero"><span>اعتبار باقی‌مانده</span><b class="ltr">${cr.unlimited && cr.remaining == null ? '∞' : money(cr.remaining, cr.currency)}</b>${creditPct(cr) != null ? `<div class="credit-bar big"><i style="width:${creditPct(cr).toFixed(1)}%"></i></div>` : ''}<span>${cr.total != null ? `کل اعتبار <span class="ltr">${money(cr.total, cr.currency)}</span> · ` : ''}${cr.used != null ? `مصرف‌شده <span class="ltr">${money(cr.used, cr.currency)}</span>` : ''}</span></div>` : `<div class="notice">${icon('shield')}<span>سرویس شما موجودی را اعلام نمی‌کند</span></div>`;
  $('#uwrap').innerHTML = `<div class="page-title"><h2>مصرف ۳۰ روز اخیر</h2><p>${anyEst ? 'بعضی اعداد تخمینی‌اند چون سرویس مقصد مصرف را گزارش نکرده.' : 'اعداد از گزارش خود سرویس مقصد هستند.'}</p></div>
    ${creditCard}
    <div class="hero"><span>هزینه گزارش‌شده توسط سرویس</span><b>${cost ? '$' + cost.toFixed(4) : '—'}</b><span>${fa(total)} توکن در ${fa(u.rows.length)} مدل</span></div>
    <div class="stat"><div><b>${fa(u.conversations)}</b><span>گفتگو</span></div><div><b>${fa(u.memories)}</b><span>خاطره</span></div><div><b>${fa(u.rows.reduce((n, r) => n + r.calls, 0))}</b><span>درخواست</span></div></div>
    <div class="card">${u.rows.length ? u.rows.map((r) => `<div style="display:flex;flex-direction:column;gap:6px"><div class="row sp"><b class="ltr" style="font-size:14.5px">${esc(r.model)}</b><span style="color:var(--ink-3);font-size:13px">${fa(tok(r))} توکن${r.cost ? ' · <span class="ltr">$' + r.cost.toFixed(4) + '</span>' : ''}</span></div><div class="bar"><i style="width:${Math.max(3, (tok(r) / max) * 100)}%"></i></div></div>`).join('') : '<p style="color:var(--ink-3);text-align:center;margin:0">هنوز مصرفی ثبت نشده.</p>'}</div>`;
}

// ---------- boot ----------
async function boot() {
  try {
    await api('GET', '/api/me');
  } catch { $('#boot').classList.add('done'); showLogin(); return; }
  S.settings = await api('GET', '/api/settings');
  shell();
  updateConn();
  loadCredit();
  loadConvs();
  window.addEventListener('hashchange', () => route().catch((e) => { console.error(e); toast('خطا در نمایش صفحه', true); }));
  await route();
  $('#boot').classList.add('done');
}
window.__appReady = true;
startI18n();
boot().catch((e) => { console.error(e); $('#boot').classList.add('done'); toast('خطا در بارگذاری برنامه', true); });
