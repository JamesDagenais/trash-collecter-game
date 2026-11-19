/*
 * Pull-up sheet over the street: the shop ("Gear & Help") and the zones.
 *
 * INTERFACE (used by ui.js):
 *   TrashGame.Sheet.init({ sheet, head, toggle, scrim, tabs: { shop: btn, zones: btn },
 *                          panes: { shop: el, zones: el }, body })
 *   TrashGame.Sheet.open(tab?)  / close() / toggle() / isOpen() / select(tab)
 *
 * Collapsed, the sheet shows its head and one horizontal shelf of cards (quick
 * buy without opening). Open, it slides up over the street and only its body
 * scrolls. Escape, the toggle, the scrim, or a swipe down on the head close it.
 * The open/closed state is the `open` class on the sheet; CSS does the rest.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  let el = null;
  let isOpenNow = false;
  let current = 'shop';
  let drag = null;
  let suppressClick = false;

  function setOpen(open) {
    if (!el) return;
    isOpenNow = !!open;
    el.sheet.classList.toggle('open', isOpenNow);
    document.documentElement.classList.toggle('sheet-open', isOpenNow);
    el.toggle.setAttribute('aria-expanded', String(isOpenNow));
    el.toggle.setAttribute('aria-label', isOpenNow ? 'Close shop' : 'Open shop');
    if (el.body) el.body.scrollTop = 0;
    // let the shop re-centre its shelf after the layout change
    root.dispatchEvent(new CustomEvent('trashgame:sheet', { detail: { open: isOpenNow, tab: current } }));
  }

  function select(tab) {
    if (!el || !el.tabs[tab]) return;
    current = tab;
    for (const name of Object.keys(el.tabs)) {
      const on = name === tab;
      el.tabs[name].setAttribute('aria-selected', String(on));
      el.tabs[name].tabIndex = on ? 0 : -1;
      el.panes[name].hidden = !on;
    }
    if (el.body) el.body.scrollTop = 0;
    root.dispatchEvent(new CustomEvent('trashgame:sheet', { detail: { open: isOpenNow, tab: current } }));
  }

  function open(tab) {
    if (tab) select(tab);
    setOpen(true);
  }
  function close() {
    setOpen(false);
  }
  function toggle() {
    setOpen(!isOpenNow);
  }

  // ---- swipe on the head ---------------------------------------------------

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    let base = 0;
    try {
      base = new DOMMatrixReadOnly(getComputedStyle(el.sheet).transform).m42 || 0;
    } catch (err) {
      base = 0;
    }
    drag = { y: e.clientY, x: e.clientX, id: e.pointerId, moved: false, base };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(e.clientX - drag.x)) drag.moved = true;
    if (!drag.moved) return;
    const h = el.sheet.offsetHeight;
    const peek = el.head.offsetHeight + 1;
    // follow the finger
    const y = Math.max(0, Math.min(h - peek, drag.base + dy));
    el.sheet.classList.add('dragging');
    el.sheet.style.transform = 'translateY(' + y + 'px)';
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const moved = drag.moved;
    drag = null;
    el.sheet.classList.remove('dragging');
    el.sheet.style.transform = '';
    if (!moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (dy < -40) setOpen(true);
    else if (dy > 40) setOpen(false);
  }

  function init(opts) {
    el = opts;
    if (!el || !el.sheet) return;
    el.toggle.addEventListener('click', toggle);
    el.scrim && el.scrim.addEventListener('click', close);
    for (const name of Object.keys(el.tabs)) {
      el.tabs[name].addEventListener('click', () => {
        if (suppressClick) return;
        select(name);
      });
      el.tabs[name].addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const names = Object.keys(el.tabs);
        const i = names.indexOf(name);
        const next = names[(i + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length];
        select(next);
        el.tabs[next].focus();
      });
    }
    // tapping the bare head (grip area) toggles too
    el.head.addEventListener('click', (e) => {
      if (suppressClick || e.target.closest('button')) return;
      toggle();
    });
    el.head.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpenNow) {
        close();
        el.toggle.focus();
      }
    });
    select('shop');
    setOpen(false);
  }

  TrashGame.Sheet = {
    init,
    open,
    close,
    toggle,
    select,
    isOpen: () => isOpenNow,
    tab: () => current,
  };
})(typeof window !== 'undefined' ? window : globalThis);
