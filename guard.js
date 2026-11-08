// Loaded before the app. Makes sure a broken load or a runtime error never leaves a blank page.
(function () {
  var shown = false;
  function box(msg) {
    if (shown) return; shown = true;
    var boot = document.getElementById('boot'); if (boot) boot.style.display = 'none';
    var d = document.createElement('div');
    d.setAttribute('dir', 'rtl');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fbfcfb;font-family:Vazirmatn,system-ui,sans-serif;z-index:99999;padding:24px;text-align:center';
    d.innerHTML = '<div><h2 style="margin:0 0 8px">مشکلی در بارگذاری پیش آمد</h2><p style="color:#667;margin:0 0 16px"></p><button style="padding:10px 22px;border-radius:12px;border:0;background:#0b6b57;color:#fff;font:inherit;cursor:pointer">بارگذاری دوباره</button></div>';
    d.querySelector('p').textContent = msg;
    d.querySelector('button').onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }
  function soft(msg) {
    var t = document.getElementById('toasts'); if (!t) return;
    var el = document.createElement('div'); el.className = 'toast err'; el.textContent = msg; t.appendChild(el);
    setTimeout(function () { el.remove(); }, 5000);
  }
  // Web fonts are loaded AFTER the app is up and never block rendering (Google Fonts can be slow or filtered).
  window.addEventListener('load', function () {
    setTimeout(function () {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300..800&display=swap';
      document.head.appendChild(l);
    }, 400);
  });
  window.__appReady = false;
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target !== window && e.target.tagName === 'SCRIPT') return box('فایل برنامه بارگذاری نشد. اینترنت را بررسی کن.');
    if (e && e.target && e.target !== window) return; // failed images/fonts are not app errors
    if (window.__appReady) soft('خطای غیرمنتظره؛ اگر تکرار شد صفحه را تازه کن.');
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (window.__appReady && !(e.reason && e.reason.name === 'AbortError')) soft((e.reason && e.reason.message) || 'خطای غیرمنتظره');
  });
  setTimeout(function () { if (!window.__appReady) box('برنامه به‌موقع بالا نیامد.'); }, 12000);
})();
