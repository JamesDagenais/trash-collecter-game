/*
 * Juice: visual feedback (floating numbers, debris, toasts, banners).
 *
 * INTERFACE (main.js depends on it; keep the signatures):
 *   TrashGame.Effects.init({ tapButton, floatersEl })
 *   TrashGame.Effects.tap(result, pointerEvent|null)  // result = State.tap() -> { trash, money, pfand }
 *   TrashGame.Effects.purchase(upgrade)               // an entry from UPGRADES, after a successful buy
 *   TrashGame.Effects.zoneUnlocked(zone)              // an entry from ZONES, after a successful unlock
 *   TrashGame.Effects.travel(zone)                    // after moving to an already-unlocked zone
 *
 * Effects only changes the DOM it creates plus CSS classes on tapButton. It never
 * changes game state. Sound is TrashGame.Sound (audio.js); Effects calls it.
 *
 * DOM it creates:
 *   inside #floaters: .floater (numbers) and .debris (particles), both capped
 *   appended to body: .juice-layer holding .juice-toast, .juice-banner, .juice-confetti
 * All animations are transform/opacity only. prefers-reduced-motion turns off
 * particles, confetti and the big motion; the number feedback stays.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const F = () => TrashGame.Format;

  const MAX_FLOATERS = 24;
  const MAX_PARTICLES = 30;
  const MAX_TOASTS = 3;
  const DEBRIS = ['🥤', '📰', '🚬', '🍌', '🧃', '🥫', '🍂'];
  const CONFETTI_COLORS = ['#ff8a00', '#8fd16a', '#ffd23f', '#f1efe6', '#4fc3f7'];

  let tapButton = null;
  let floatersEl = null;
  let layer = null; // full-screen fixed layer for toasts/banners
  let toastBox = null;
  const floaters = []; // live .floater nodes, oldest first
  const particles = []; // live .debris nodes, oldest first
  const toasts = [];
  let banner = null;
  let squashFlip = false;
  let ringFlip = false;
  const RING_CLASSES = ['juice-pfand-a', 'juice-pfand-b', 'juice-power-a', 'juice-power-b'];
  const recentTaps = []; // timestamps, for scaling particles down when tapping fast

  const reduceQuery = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(reduceQuery && reduceQuery.matches);
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function sound(name) {
    try {
      TrashGame.Sound && TrashGame.Sound.play(name);
    } catch (e) {
      /* ignore */
    }
  }

  function init(opts) {
    tapButton = opts.tapButton;
    floatersEl = opts.floatersEl;
    layer = document.createElement('div');
    layer.className = 'juice-layer';
    toastBox = document.createElement('div');
    toastBox.className = 'juice-toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    layer.appendChild(toastBox);
    document.body.appendChild(layer);
  }

  // ---- Node lifecycle ----------------------------------------------------

  /** Adds `node` to `parent`, tracks it in `list` and removes it after its animation. */
  function spawn(node, parent, list, max, lifeMs) {
    while (list.length >= max) kill(list[0], list);
    list.push(node);
    parent.appendChild(node);
    const done = () => kill(node, list);
    node.addEventListener('animationend', (e) => {
      if (e.target === node) done();
    });
    node._juiceTimer = setTimeout(done, lifeMs + 200); // fallback if animationend never fires
  }

  function kill(node, list) {
    clearTimeout(node._juiceTimer);
    const i = list.indexOf(node);
    if (i !== -1) list.splice(i, 1);
    if (node.parentNode) node.parentNode.removeChild(node);
  }

  // ---- Tap ---------------------------------------------------------------

  /** Tap point relative to #floaters. Pointer position, or the button centre. */
  function tapPoint(event) {
    const host = floatersEl.getBoundingClientRect();
    const box = tapButton.getBoundingClientRect();
    const hasPointer = event && typeof event.clientX === 'number' && (event.clientX !== 0 || event.clientY !== 0);
    const x = hasPointer ? event.clientX : box.left + box.width / 2 + rand(-30, 30);
    const y = hasPointer ? event.clientY : box.top + box.height / 2 + rand(-20, 10);
    return {
      x: x - host.left,
      y: y - host.top,
      cx: box.left + box.width / 2 - host.left,
      cy: box.top + box.height / 2 - host.top,
    };
  }

  function floater(text, x, y, cls, lifeMs, icon) {
    const f = document.createElement('div');
    f.className = 'floater' + (cls ? ' ' + cls : '');
    if (icon) {
      // Separate span: the gradient text fill would make a colour emoji transparent.
      const i = document.createElement('span');
      i.className = 'floater-icon';
      i.textContent = icon;
      const v = document.createElement('span');
      v.className = 'floater-value';
      v.textContent = text;
      f.append(i, v);
    } else {
      f.textContent = text;
    }
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    f.style.setProperty('--dx', rand(-28, 28).toFixed(1) + 'px');
    f.style.setProperty('--rot', rand(-8, 8).toFixed(1) + 'deg');
    spawn(f, floatersEl, floaters, MAX_FLOATERS, lifeMs);
  }

  function particle(text, x, y, opts) {
    const p = document.createElement('span');
    p.className = 'debris' + (opts.cls ? ' ' + opts.cls : '');
    p.textContent = text;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.setProperty('--dx', opts.dx.toFixed(1) + 'px');
    p.style.setProperty('--dy', opts.dy.toFixed(1) + 'px');
    p.style.setProperty('--fall', opts.fall.toFixed(1) + 'px');
    p.style.setProperty('--rot', opts.rot.toFixed(0) + 'deg');
    p.style.setProperty('--dur', opts.dur + 'ms');
    spawn(p, floatersEl, particles, MAX_PARTICLES, opts.dur);
  }

  /** Restarts a CSS animation without a forced reflow by swapping between two classes. */
  function retrigger(el, a, b, flip) {
    el.classList.remove(flip ? a : b);
    el.classList.add(flip ? b : a);
  }

  /** Pulses the ring around the tap button. kind: 'pfand' | 'power'. */
  function ring(kind) {
    ringFlip = !ringFlip;
    tapButton.classList.remove(...RING_CLASSES);
    tapButton.classList.add('juice-' + kind + (ringFlip ? '-a' : '-b'));
  }

  function tap(result, event) {
    if (!tapButton || !floatersEl) return;
    try {
      const pt = tapPoint(event);
      const reduced = reducedMotion();

      const now = performance.now();
      recentTaps.push(now);
      while (recentTaps.length && now - recentTaps[0] > 500) recentTaps.shift();
      const fast = recentTaps.length > 4; // more than ~8 taps/s

      floater('+' + F().number(result.trash, 1), pt.x, pt.y - 16, '', 800);

      if (!reduced) {
        const count = fast ? 1 : 3;
        for (let i = 0; i < count; i++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          particle(pick(DEBRIS), pt.x, pt.y, {
            dx: dir * rand(30, 90),
            dy: -rand(40, 95),
            fall: rand(80, 140),
            rot: dir * rand(90, 300),
            dur: Math.round(rand(550, 750)),
          });
        }
      }

      squashFlip = !squashFlip;
      retrigger(tapButton, 'juice-squash-a', 'juice-squash-b', squashFlip);

      if (result.pfand > 0) {
        pfandBurst(result.pfand, pt, reduced);
        sound('pfand');
      } else {
        sound('tap');
      }
    } catch (e) {
      /* effects must never break input */
    }
  }

  function pfandBurst(amount, pt, reduced) {
    floater('+' + F().money(amount), pt.cx + rand(-12, 12), pt.cy - rand(60, 80), 'pfand', 1400, '🍾');
    ring('pfand');
    if (reduced) return;
    // The bottle itself arcs out of the bin, with a few sparkles.
    const dir = Math.random() < 0.5 ? -1 : 1;
    particle('🍾', pt.cx, pt.cy - 20, {
      cls: 'debris-bottle',
      dx: dir * rand(70, 110),
      dy: -rand(110, 150),
      fall: 160,
      rot: dir * 420,
      dur: 1000,
    });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rand(-0.3, 0.3);
      const r = rand(70, 110);
      particle('✨', pt.cx, pt.cy, {
        cls: 'debris-sparkle',
        dx: Math.cos(a) * r,
        dy: Math.sin(a) * r * 0.8 - 20,
        fall: 20,
        rot: rand(-90, 90),
        dur: 700,
      });
    }
  }

  // ---- Toasts, banners ---------------------------------------------------

  function toast(icon, text, key) {
    // Buying the same thing several times in a row bumps a counter instead of stacking toasts.
    const last = toasts[toasts.length - 1];
    if (last && last._key === key && !last.classList.contains('leaving')) {
      last._count += 1;
      last.querySelector('.juice-toast-count').textContent = '×' + last._count;
      retrigger(last, 'juice-bump-a', 'juice-bump-b', last._count % 2 === 0);
      clearTimeout(last._juiceTimer);
      last._juiceTimer = setTimeout(() => dismiss(last), 1600);
      return;
    }
    while (toasts.length >= MAX_TOASTS) kill(toasts[0], toasts);
    const t = document.createElement('div');
    t.className = 'juice-toast';
    t._key = key;
    t._count = 1;
    const i = document.createElement('span');
    i.className = 'juice-toast-icon';
    i.textContent = icon;
    const s = document.createElement('span');
    s.textContent = text;
    const c = document.createElement('span');
    c.className = 'juice-toast-count';
    t.append(i, s, c);
    toasts.push(t);
    toastBox.appendChild(t);
    t._juiceTimer = setTimeout(() => dismiss(t), 1600);
  }

  function dismiss(node) {
    clearTimeout(node._juiceTimer);
    node.classList.add('leaving');
    node._juiceTimer = setTimeout(() => kill(node, toasts), 260);
  }

  function purchase(upgrade) {
    try {
      if (upgrade && layer) toast(upgrade.icon, upgrade.name + ' bought!', upgrade.id);
      if (upgrade && upgrade.trashPerTap > 0 && tapButton) {
        ring('power');
      }
    } catch (e) {
      /* ignore */
    }
    sound('buy');
  }

  function showBanner(zone, big) {
    if (banner) banner.remove();
    const b = document.createElement('div');
    b.className = 'juice-banner' + (big ? ' big' : '');
    b.setAttribute('role', 'status');
    const icon = document.createElement('div');
    icon.className = 'juice-banner-icon';
    icon.textContent = zone.icon;
    const kicker = document.createElement('div');
    kicker.className = 'juice-banner-kicker';
    kicker.textContent = big ? 'New zone unlocked' : 'Now cleaning';
    const title = document.createElement('div');
    title.className = 'juice-banner-title';
    title.textContent = big ? 'Welcome to ' + zone.name + '!' : zone.name;
    b.append(icon, kicker, title);
    if (big && zone.description) {
      const d = document.createElement('div');
      d.className = 'juice-banner-desc';
      d.textContent = zone.description;
      b.append(d);
    }
    layer.appendChild(b);
    banner = b;
    const lifeMs = big ? 2800 : 1400; // matches the CSS animation durations
    const done = () => {
      if (b.parentNode) b.remove();
      if (banner === b) banner = null;
    };
    b.addEventListener('animationend', (e) => {
      if (e.target === b) done();
    });
    setTimeout(done, lifeMs + 300);
  }

  function confetti() {
    const w = root.innerWidth || 390;
    const h = root.innerHeight || 800;
    const box = document.createElement('div');
    box.className = 'juice-confetti';
    for (let i = 0; i < 28; i++) {
      const c = document.createElement('i');
      c.style.left = rand(0, w) + 'px';
      c.style.background = pick(CONFETTI_COLORS);
      c.style.setProperty('--dx', rand(-60, 60).toFixed(0) + 'px');
      c.style.setProperty('--dy', (h * rand(0.6, 1.05)).toFixed(0) + 'px');
      c.style.setProperty('--rot', rand(-720, 720).toFixed(0) + 'deg');
      c.style.animationDelay = rand(0, 350).toFixed(0) + 'ms';
      c.style.animationDuration = rand(1400, 2200).toFixed(0) + 'ms';
      box.appendChild(c);
    }
    layer.insertBefore(box, banner && banner.parentNode === layer ? banner : null); // behind the banner
    setTimeout(() => box.remove(), 2800);
  }

  function zoneUnlocked(zone) {
    try {
      if (zone && layer) {
        showBanner(zone, true);
        if (!reducedMotion()) confetti();
      }
    } catch (e) {
      /* ignore */
    }
    sound('zone');
  }

  function travel(zone) {
    try {
      if (zone && layer) showBanner(zone, false);
    } catch (e) {
      /* ignore */
    }
    sound('travel');
  }

  TrashGame.Effects = { init, tap, purchase, zoneUnlocked, travel };
})(typeof window !== 'undefined' ? window : globalThis);
