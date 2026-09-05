/* ═══════════════════════════════════════════════════════════════════════════
   MOCK HARNESS — icons, theme, and just enough behaviour that the states in
   these screens can be seen rather than described.

   The icon set is drawn here as one sprite: a single 24px grid, 1.6 stroke,
   round caps and joins, no fills. Emoji and Unicode glyphs are not an icon
   system, and a set assembled from three sources reads as three sets.

   Everything below the sprite is harness, not product. It exists so a
   reviewer can click a tab, flip the theme and watch a gate clear. None of
   it ports.
   ═══════════════════════════════════════════════════════════════════════════ */

const ICONS = {
  /* The mark: three nested arcs, the gathering of folded sheets that makes
     one signature of a book. It is the product name, drawn. */
  quire: '<path d="M12 3.2a8.8 8.8 0 1 0 6.2 15"/><path d="M12 6.9a5.1 5.1 0 1 0 3.6 8.7"/><path d="M12 10.6a1.4 1.4 0 1 0 1 2.4"/><path d="m16.4 16.4 4 4"/>',

  home:     '<path d="M3 10.4 12 3l9 7.4"/><path d="M5.4 9.2V21h13.2V9.2"/>',
  book:     '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3H20v18H5.6A1.6 1.6 0 0 1 4 19.4z"/><path d="M8.2 3v18"/>',
  magazine: '<path d="M4 4h16v16H4z"/><path d="M4 9.2h16"/><path d="M9.4 9.2V20"/>',
  layers:   '<path d="M12 3 3 7.8l9 4.8 9-4.8z"/><path d="M3 12.6 12 17.4l9-4.8"/><path d="M3 16.8 12 21.6l9-4.8"/>',
  sliders:  '<path d="M4 7.5h8"/><path d="M17 7.5h3"/><path d="M4 16.5h3"/><path d="M12 16.5h8"/><circle cx="14.5" cy="7.5" r="2.4"/><circle cx="9.5" cy="16.5" r="2.4"/>',
  image:    '<path d="M3.5 4.5h17v15h-17z"/><path d="m3.5 15.5 4.6-4.6 3.4 3.4 3-3 6 6"/><circle cx="8.6" cy="8.8" r="1.5"/>',
  globe:    '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6"/><path d="M12 3.2a13.5 13.5 0 0 1 0 17.6"/><path d="M12 3.2a13.5 13.5 0 0 0 0 17.6"/>',
  pulse:    '<path d="M3 12.5h4.2L10 4.6l4 15 2.6-7.1H21"/>',
  plug:     '<path d="M9 3v5.4"/><path d="M15 3v5.4"/><path d="M6.2 8.4h11.6v3.2a5.8 5.8 0 0 1-11.6 0z"/><path d="M12 17.4V21"/>',
  chat:     '<path d="M3.6 5.4h16.8v10.6H9.4l-4.2 3.6v-3.6H3.6z"/>',
  skill:    '<path d="M12 3.2 14.4 9l6.2.5-4.7 4 1.4 6-5.3-3.2L6.7 19.5l1.4-6-4.7-4L9.6 9z"/>',
  clip:     '<path d="M17.6 10.4 11 17a3.6 3.6 0 0 1-5.1-5.1l7.2-7.2a2.4 2.4 0 0 1 3.4 3.4l-7.2 7.2a1.2 1.2 0 0 1-1.7-1.7l6.6-6.6"/>',
  send:     '<path d="M12 19.4V5"/><path d="m6.4 10.6 5.6-5.6 5.6 5.6"/>',
  folder:   '<path d="M3.2 6.4h6.1l2.1 2.6h9.4V19.4H3.2z"/>',
  file:     '<path d="M6.2 3h8L19 7.8V21H6.2z"/><path d="M14.2 3v4.8H19"/>',

  chevR: '<path d="m9.5 5.2 6.8 6.8-6.8 6.8"/>',
  chevD: '<path d="m5.2 9.5 6.8 6.8 6.8-6.8"/>',
  chevL: '<path d="m14.5 5.2-6.8 6.8 6.8 6.8"/>',
  arrR:  '<path d="M3.8 12h15.4"/><path d="m13.4 6.2 5.8 5.8-5.8 5.8"/>',
  arrL:  '<path d="M20.2 12H4.8"/><path d="m10.6 6.2-5.8 5.8 5.8 5.8"/>',

  check: '<path d="m4.4 12.4 5.4 5.4L19.6 6.6"/>',
  x:     '<path d="M6 6 18 18"/><path d="M18 6 6 18"/>',
  plus:  '<path d="M12 4.8v14.4"/><path d="M4.8 12h14.4"/>',
  minus: '<path d="M4.8 12h14.4"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.9"/><path d="m20.2 20.2-4.5-4.5"/>',

  play:  '<path d="M7.6 4.6v14.8L19.4 12z"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  redo:  '<path d="M20.2 12a8.2 8.2 0 1 1-2.4-5.8"/><path d="M20.2 4.6v5.2H15"/>',
  stop:  '<path d="M6.5 6.5h11v11h-11z"/>',
  down:  '<path d="M12 4.2v11.2"/><path d="m7.4 11 4.6 4.6L16.6 11"/><path d="M4.8 20h14.4"/>',
  up:    '<path d="M12 19.8V8.6"/><path d="m7.4 13 4.6-4.6L16.6 13"/><path d="M4.8 4h14.4"/>',

  eye:    '<path d="M2.4 12S6.2 5.6 12 5.6 21.6 12 21.6 12 17.8 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.9"/>',
  pencil: '<path d="m4 20 .9-4.3L15.6 5l3.4 3.4L8.3 19.1z"/><path d="m14.2 6.4 3.4 3.4"/>',
  trash:  '<path d="M5 6.6h14"/><path d="M9.4 6.6V4.4h5.2v2.2"/><path d="M6.8 6.6 7.8 20h8.4l1-13.4"/>',
  lock:   '<path d="M5.6 10.8h12.8V20H5.6z"/><path d="M8.6 10.8V8.2a3.4 3.4 0 0 1 6.8 0v2.6"/>',
  clock:  '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.4 2.1"/>',
  alert:  '<path d="M12 3.6 21.4 20H2.6z"/><path d="M12 10v4.4"/><path d="M12 17.1v.1"/>',
  info:   '<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.4"/><path d="M12 7.9v.1"/>',
  dots:   '<circle cx="5.6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.4" cy="12" r="1.3"/>',
  grid:   '<path d="M4 4h6.4v6.4H4z"/><path d="M13.6 4H20v6.4h-6.4z"/><path d="M4 13.6h6.4V20H4z"/><path d="M13.6 13.6H20V20h-6.4z"/>',
  list:   '<path d="M4 6.8h16"/><path d="M4 12h16"/><path d="M4 17.2h16"/>',
  heart:  '<path d="M12 20.2S3.8 15.2 3.8 9.8A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.2 3.2c0 5.4-8.2 10.4-8.2 10.4z"/>',
  drop:   '<path d="M12 3.4c3.4 4 5.6 6.6 5.6 9.4a5.6 5.6 0 0 1-11.2 0c0-2.8 2.2-5.4 5.6-9.4z"/>',
  type:   '<path d="M5 6.4h14"/><path d="M12 6.4V19"/>',
  cpu:    '<path d="M7.4 7.4h9.2v9.2H7.4z"/><path d="M4.6 4.6h14.8v14.8H4.6z"/><path d="M9.6 4.6V2.4"/><path d="M14.4 4.6V2.4"/><path d="M9.6 21.6v-2.2"/><path d="M14.4 21.6v-2.2"/>',

  winMin:  '<path d="M5 12h14"/>',
  winMax:  '<path d="M6 6h12v12H6z"/>',
  winClose:'<path d="M6.5 6.5 17.5 17.5"/><path d="M17.5 6.5 6.5 17.5"/>',
};

function sprite() {
  /* The stroke attributes live on each symbol, not on the sprite root. A
     <use> instance inherits from the svg that references it, so attributes
     parked on the sprite wrapper reach nothing and every icon renders as a
     solid black fill. */
  const attrs =
    'fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"';
  const body = Object.entries(ICONS)
    .map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24" ${attrs}>${d}</symbol>`)
    .join('');
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  document.body.prepend(el);
}

/* Theme. Three states, not two: the un-stamped default follows the OS, and
   the toggle has to be able to reach both explicit ends from there. */
function theme() {
  const root = document.documentElement;
  const set = (v) => {
    if (v) { root.setAttribute('data-theme', v); localStorage.setItem('mock-theme', v); }
    else   { root.removeAttribute('data-theme'); localStorage.removeItem('mock-theme'); }
    document.querySelectorAll('[data-theme-btn]').forEach((b) => {
      b.setAttribute('aria-pressed', String((b.dataset.themeBtn || '') === (v || '')));
    });
  };
  try { set(localStorage.getItem('mock-theme')); } catch { set(null); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-btn]');
    if (b) set(b.dataset.themeBtn || null);
  });
}

/* Navigation. The rail, the tiles and the rows in these screens are real
   destinations, not pictures of destinations: a prototype whose chrome does
   not navigate cannot be walked, and walking it is the only way to find out
   whether the flow works.

   Routing lives here rather than in each file so the map is in one place, and
   because it is harness — the app has a router, and these anchors would be
   route calls there. Anything carrying data-go is clickable; a real <a>
   inside one still wins, so a row can hold its own separate link. */
function router() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) return;
    const go = e.target.closest('[data-go]');
    if (!go) return;
    e.preventDefault();
    window.location.href = go.dataset.go;
  });
  /* Keyboard: a div carrying data-go is not focusable on its own. */
  document.querySelectorAll('div[data-go], span[data-go]').forEach((n) => {
    if (!n.hasAttribute('tabindex')) n.tabIndex = 0;
    n.setAttribute('role', 'link');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const go = e.target.closest?.('[data-go]');
    if (go && !e.target.closest('a[href]')) window.location.href = go.dataset.go;
  });
}

/* Generic control behaviour, by delegation, so no screen file needs script.
     [data-seg]   one pressed button per group
     [data-tabs]  one selected tab, paired to [data-panel] by name
     [data-toast] fires the completion pill
     [data-find]  j / k move, a accepts (the row plays away), i ignores    */
function controls() {
  document.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-seg] button, [data-tabs] .tab');
    if (seg) {
      const group = seg.closest('[data-seg], [data-tabs]');
      const isTab = group.hasAttribute('data-tabs');
      const attr = isTab ? 'aria-selected' : 'aria-pressed';
      group.querySelectorAll(isTab ? '.tab' : 'button').forEach((b) => b.setAttribute(attr, 'false'));
      seg.setAttribute(attr, 'true');
      if (seg.dataset.panel) {
        const scope = group.closest('[data-tabscope]') || document;
        /* Only real panels. The control that did the switching carries the
           same attribute, and hiding the other half of a two-button toggle
           is how this went wrong the first time. */
        scope.querySelectorAll('[data-panel]').forEach((p) => {
          if (p.closest('[data-seg], [data-tabs]')) return;
          p.hidden = p.dataset.panel !== seg.dataset.panel;
        });
      }
      return;
    }
    const t = e.target.closest('[data-toast]');
    if (t) showToast(t.dataset.toast);
  });

  document.addEventListener('keydown', (e) => {
    const list = document.querySelector('[data-find]');
    if (!list || e.metaKey || e.ctrlKey || /input|textarea/i.test(e.target.tagName)) return;
    const items = [...list.querySelectorAll('.finding:not(.going)')];
    if (!items.length) return;
    const at = Math.max(0, items.findIndex((n) => n.getAttribute('aria-current') === 'true'));
    const go = (i) => {
      items.forEach((n) => n.setAttribute('aria-current', 'false'));
      const n = items[Math.max(0, Math.min(items.length - 1, i))];
      n.setAttribute('aria-current', 'true');
      n.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'j') { go(at + 1); e.preventDefault(); }
    if (e.key === 'k') { go(at - 1); e.preventDefault(); }
    if (e.key === 'a' || e.key === 'i') {
      const n = items[at];
      n.classList.add('going');
      showToast(e.key === 'a' ? 'Fix accepted. Nothing was lost.' : 'Left as written.');
      setTimeout(() => { n.remove(); const rest = [...list.querySelectorAll('.finding:not(.going)')]; if (rest[at]) rest[at].setAttribute('aria-current', 'true'); }, 320);
      e.preventDefault();
    }
  });
}

let toastTimer;
function showToast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    /* The toast is the only confirmation a keyboard user gets that an
       accept landed. Announced politely, so it does not interrupt the
       reading they are in the middle of. */
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.innerHTML = `<svg class="tick" aria-hidden="true" width="15" height="15"><use href="#i-check"/></svg><span></span>`;
  el.querySelector('span').textContent = text || 'Done.';
  requestAnimationFrame(() => el.classList.add('on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2800);
}

/* Reveals are the front door only, and the screens opt in per element. */
function reveals() {
  const els = document.querySelectorAll('.reveal');
  if (!els.length || !('IntersectionObserver' in window)) { els.forEach((n) => n.classList.add('in')); return; }
  const io = new IntersectionObserver((rows) => {
    rows.forEach((r) => { if (r.isIntersecting) { r.target.classList.add('in'); io.unobserve(r.target); } });
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach((n) => io.observe(n));
}

sprite();
theme();
router();
controls();
reveals();
