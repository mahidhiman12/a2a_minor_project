// Presentation board: fills device frames from <template>s, scales desktop frames, switches tabs and theme.
(function () {
  document.querySelectorAll('[data-tpl]').forEach(function (f) {
    var t = document.getElementById(f.dataset.tpl);
    var s = f.querySelector('.screen');
    s.appendChild(t.content.cloneNode(true));
    if (f.dataset.state) s.classList.add(f.dataset.state);
  });
  function fit() {
    document.querySelectorAll('.frame-desktop').forEach(function (f) {
      var vp = f.querySelector('.viewport'), s = f.querySelector('.screen');
      if (!f.offsetWidth) return;
      var k = Math.min(1, f.clientWidth / 1440);
      s.style.transform = 'scale(' + k + ')';
      vp.style.height = (f.dataset.h ? +f.dataset.h : s.offsetHeight) * k + 'px';
    });
  }
  var tabs = document.querySelectorAll('.bd-tabs [data-tab]');
  function show(id) {
    tabs.forEach(function (b) { b.classList.toggle('on', b.dataset.tab === id); b.setAttribute('aria-selected', b.dataset.tab === id); });
    document.querySelectorAll('.bd-wrap').forEach(function (w) { w.classList.toggle('on', w.id === id); });
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    requestAnimationFrame(fit);
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });
  var themeBtns = document.querySelectorAll('[data-theme-set]');
  themeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      themeBtns.forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelectorAll('.hifi .screen').forEach(function (s) { s.setAttribute('data-theme', b.dataset.themeSet); });
    });
  });
  var start = (location.hash || '').slice(1);
  show(document.getElementById(start) ? start : (tabs[1] || tabs[0]).dataset.tab);
  window.addEventListener('resize', fit);
  if (document.fonts) document.fonts.ready.then(fit);
  setTimeout(fit, 300);
})();
