/*
 * Shop UI: upgrade panel + zones panel.
 *
 * INTERFACE (main.js depends on it; keep the signatures):
 *   TrashGame.Shop.init({ shopEl, zonesEl, onBuy(upgradeId), onUnlockZone(zoneId), onTravel(zoneId) })
 *   TrashGame.Shop.render(state)   // called EVERY animation frame, so it must be cheap
 *
 * DOM HOOKS (used by browser tests):
 *   each upgrade's buy button has  data-id="<upgradeId>"  and is aria-disabled="true" when unaffordable
 *   (aria-disabled, not `disabled`: the button keeps focus after buying the last
 *   affordable copy, and unaffordable items stay reachable by keyboard / screen reader)
 *   each zone's button has          data-zone="<zoneId>"
 *
 * Read state only through TrashGame.State and data through TrashGame.UPGRADES /
 * TrashGame.ZONES. Never change state here; call the callbacks instead.
 *
 * HOW IT WORKS
 *   init() builds every DOM node once: one row per upgrade, one teaser row, and
 *   one chip per zone. render() only diffs: it compares each value with a
 *   per-node cache and touches the DOM when something actually changed.
 *
 *   Upgrade reveal: an upgrade is shown when it is the first one, is owned, the
 *   previous one is owned, you hold >= REVEAL_FRACTION of its next price, or your
 *   lifetime earnings reached REVEAL_FRACTION of its base price (the last rule
 *   is monotonic, so rows never disappear again after you spend money).
 *   The first hidden upgrade is shown as a "???" teaser with a silhouette icon.
 *
 *   Effects shown on a row are the real gain of buying one more copy: State is
 *   asked for trashPerTap / trashPerSecond on a copy of the state with one more
 *   owned. This includes the zone multiplier and survives economy changes.
 *
 *   Lo-fi look: icons are 16x16 pixel art from TrashGame.Pixel.icon (hand-drawn
 *   for known ids, a pixelated emoji otherwise) and zone cards show a tiny pixel
 *   backdrop from TrashGame.Character.zoneThumb. Both are optional.
 *
 *   Bottom sheet: the same buttons are laid out as a horizontal "shelf" while the
 *   sheet is collapsed (CSS, keyed on html.sheet-open). The shelf keeps the most
 *   useful card in view: the priciest affordable upgrade, else the next goal.
 *
 *   Double-buy guard: only `click` is used (one per tap), held-key repeats are
 *   ignored, and a second trusted click on the same button before the next
 *   render (or within GUARD_MS if frames are paused) is dropped.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const S = () => TrashGame.State;
  const F = () => TrashGame.Format;

  const REVEAL_FRACTION = 0.5;
  const PROGRESS_STEPS = 200; // progress bars are quantised so they don't write every frame
  const GUARD_MS = 150;

  let callbacks = {};
  let lastState = null;
  let frameNo = 0;

  let list = null;
  let rows = [];
  let teaser = null;
  let lastFxKey = null;

  let focusRow = null;
  let refocus = true;

  let track = null;
  let chips = [];
  let zonesRendered = false;

  // ---- helpers -----------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function setAttr(node, name, value) {
    if (value == null) {
      if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) {
      node.setAttribute(name, value);
    }
  }

  function setProgress(fill, cache, ratio) {
    const q = Math.max(0, Math.min(1, Math.floor((ratio || 0) * PROGRESS_STEPS) / PROGRESS_STEPS));
    if (cache.progress === q) return;
    cache.progress = q;
    fill.style.transform = 'scaleX(' + q + ')';
  }

  function rate(n) {
    return F().number(n, n < 1 ? 2 : 1);
  }

  function percent(p) {
    return F().number(p * 100, 1) + '%';
  }

  /** Wraps a button handler with the double-event guard. */
  function guarded(button, handler) {
    let lastFrame = -1;
    let lastTime = 0;
    button.addEventListener('keydown', (e) => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    button.addEventListener('click', (e) => {
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      if (e.isTrusted) {
        const now = performance.now();
        if (lastFrame === frameNo && now - lastTime < GUARD_MS) return;
        lastFrame = frameNo;
        lastTime = now;
      }
      handler(e);
    });
  }

  /** Shows a pixel icon as the background of `node`; falls back to the emoji text. */
  function setIcon(node, key, emoji) {
    const P = TrashGame.Pixel;
    const url = P ? P.icon(key, emoji) : '';
    if (url) {
      node.style.backgroundImage = 'url(' + url + ')';
      node.classList.add('pixel');
      setText(node, '');
    } else {
      node.style.backgroundImage = '';
      node.classList.remove('pixel');
      setText(node, emoji || '');
    }
  }

  function sheetOpen() {
    return document.documentElement.classList.contains('sheet-open');
  }

  function restartAnimation(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // reflow so the animation plays again
    node.classList.add(className);
  }

  // ---- upgrades: build ---------------------------------------------------

  function buildRow(u) {
    const button = el('button', 'upgrade hidden');
    button.type = 'button';
    button.dataset.id = u.id;
    button.setAttribute('aria-disabled', 'true');

    const iconWrap = el('span', 'upgrade-icon');
    iconWrap.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'upgrade-emoji');
    setIcon(icon, u.id, u.icon);
    const count = el('span', 'upgrade-count');
    iconWrap.append(icon, count);

    const body = el('span', 'upgrade-body');
    const name = el('span', 'upgrade-name', u.name);
    const desc = el('span', 'upgrade-desc', u.description);
    const fx = el('span', 'upgrade-effects');
    const fxTap = el('span', 'upgrade-fx upgrade-fx-tap');
    const fxSec = el('span', 'upgrade-fx upgrade-fx-sec');
    fx.append(fxTap, fxSec);
    body.append(name, desc, fx);

    const side = el('span', 'upgrade-side');
    side.setAttribute('aria-hidden', 'true');
    const price = el('span', 'upgrade-price');
    side.append(price);

    const bar = el('span', 'upgrade-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'upgrade-fill');
    bar.append(fill);

    button.append(iconWrap, body, side, bar);

    const row = {
      u,
      button,
      count,
      fxTap,
      fxSec,
      price,
      fill,
      cache: { visible: false, affordable: null, cost: null, owned: null, progress: null, fx: '' },
      fxText: '',
    };

    guarded(button, () => {
      if (lastState && !S().canAfford(lastState, u.id)) return;
      restartAnimation(button, 'bought');
      callbacks.onBuy(u.id);
    });
    button.addEventListener('animationend', (e) => {
      if (e.animationName === 'upgrade-bought') button.classList.remove('bought');
    });
    return row;
  }

  function buildTeaser() {
    const root = el('div', 'upgrade upgrade-teaser hidden');
    const iconWrap = el('span', 'upgrade-icon');
    iconWrap.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'upgrade-emoji');
    iconWrap.append(icon);

    const body = el('span', 'upgrade-body');
    const name = el('span', 'upgrade-name');
    name.append(el('span', 'shop-sr', 'Undiscovered upgrade'));
    const q = el('span', null, '???');
    q.setAttribute('aria-hidden', 'true');
    name.append(q);
    const desc = el('span', 'upgrade-desc');
    body.append(name, desc);

    const bar = el('span', 'upgrade-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'upgrade-fill');
    bar.append(fill);

    root.append(iconWrap, body, bar);
    return { root, icon, desc, fill, target: undefined, cache: { progress: null } };
  }

  // ---- upgrades: render --------------------------------------------------

  function effectsKey(state) {
    let key = state.zone + '|';
    for (const r of rows) key += S().owned(state, r.u.id) + ',';
    return key;
  }

  /** Real gain from buying one more copy, asked from State on a copy of the state. */
  function effectOf(state, u) {
    try {
      const n = S().owned(state, u.id);
      const upgrades = Object.assign({}, state.upgrades);
      upgrades[u.id] = n + 1;
      const next = Object.assign({}, state, { upgrades });
      const tap = S().trashPerTap(next) - S().trashPerTap(state);
      const sec = S().trashPerSecond(next) - S().trashPerSecond(state);
      if (tap > 1e-9 || sec > 1e-9) return { tap, sec };
    } catch (e) {
      /* fall back to the raw data below */
    }
    return { tap: u.trashPerTap || 0, sec: u.trashPerSecond || 0 };
  }

  function updateEffects(state) {
    for (const r of rows) {
      const { tap, sec } = effectOf(state, r.u);
      const tapText = tap > 1e-9 ? '+' + rate(tap) + ' / tap' : '';
      const secText = sec > 1e-9 ? '+' + rate(sec) + ' / sec' : '';
      setText(r.fxTap, tapText);
      setText(r.fxSec, secText);
      r.fxTap.hidden = !tapText;
      r.fxSec.hidden = !secText;
      r.fxText = [tapText.replace('/ tap', 'per tap'), secText.replace('/ sec', 'per second')]
        .filter(Boolean)
        .join(', ');
    }
  }

  function renderUpgrades(state) {
    const fxKey = effectsKey(state);
    if (fxKey !== lastFxKey) {
      lastFxKey = fxKey;
      updateEffects(state);
    }

    const money = state.money;
    const earned = state.totalMoneyEarned || 0;
    let previousOwned = true;
    let firstHidden = null;
    let bestAffordable = null;
    let nextGoal = null;

    for (const r of rows) {
      const u = r.u;
      const c = r.cache;
      const owned = S().owned(state, u.id);
      const cost = S().nextCost(state, u.id);
      const affordable = S().canAfford(state, u.id);
      const visible =
        previousOwned ||
        owned > 0 ||
        money >= cost * REVEAL_FRACTION ||
        earned >= S().upgradeCost(u, 0) * REVEAL_FRACTION;
      previousOwned = owned > 0;
      if (!visible && !firstHidden) firstHidden = r;

      if (c.visible !== visible) {
        c.visible = visible;
        r.button.classList.toggle('hidden', !visible);
      }
      if (c.affordable !== affordable) {
        c.affordable = affordable;
        setAttr(r.button, 'aria-disabled', affordable ? null : 'true');
        r.button.classList.toggle('affordable', affordable);
      }
      if (c.cost !== cost) {
        c.cost = cost;
        setText(r.price, F().money(cost));
      }
      if (c.owned !== owned) {
        c.owned = owned;
        setText(r.count, owned > 0 ? F().number(owned) : '');
        r.button.classList.toggle('owned', owned > 0);
      }
      if (c.fx !== r.fxText || c.labelCost !== cost || c.labelOwned !== owned) {
        c.fx = r.fxText;
        c.labelCost = cost;
        c.labelOwned = owned;
        setAttr(
          r.button,
          'aria-label',
          `Buy ${u.name} for ${F().money(cost)}. Owned: ${F().number(owned)}.` + (r.fxText ? ` Gives ${r.fxText}.` : '')
        );
      }
      if (visible) {
        setProgress(r.fill, c, affordable ? 1 : money / cost);
        if (affordable) bestAffordable = r;
        else if (!nextGoal) nextGoal = r;
      }
    }

    renderTeaser(state, firstHidden);
    focusShelf(bestAffordable || nextGoal);
  }

  /** Scrolls the collapsed shelf so `row` is in view (only when the focus changes). */
  function focusShelf(row) {
    if (row === focusRow && !refocus) return;
    focusRow = row;
    refocus = false;
    if (!row || sheetOpen() || !list) return;
    const view = list.clientWidth;
    if (!view || list.scrollWidth <= view) return;
    const b = row.button;
    const left = b.offsetLeft - list.offsetLeft;
    const right = left + b.offsetWidth;
    let target = list.scrollLeft;
    if (right + 24 > target + view) target = right + 24 - view;
    if (left - 12 < target) target = left - 12;
    target = Math.max(0, Math.min(target, list.scrollWidth - view));
    if (Math.abs(target - list.scrollLeft) < 1) return;
    if (list.scrollTo) list.scrollTo({ left: target, behavior: 'smooth' });
    else list.scrollLeft = target;
  }

  function renderTeaser(state, target) {
    if (teaser.target !== target) {
      teaser.target = target;
      teaser.root.classList.toggle('hidden', !target);
      if (target) {
        list.insertBefore(teaser.root, target.button);
        setIcon(teaser.icon, target.u.id, target.u.icon);
        const at = S().upgradeCost(target.u, 0) * REVEAL_FRACTION;
        teaser.threshold = at;
        setText(teaser.desc, `Something new turns up at ${F().money(at)} earned.`);
      }
    }
    if (target) setProgress(teaser.fill, teaser.cache, (state.totalMoneyEarned || 0) / teaser.threshold);
  }

  // ---- zones -------------------------------------------------------------

  function perkText(z) {
    const parts = ['×' + F().number(z.trashMultiplier, 2) + ' trash'];
    if (z.pfandChance > 0) parts.push('Pfand ' + percent(z.pfandChance));
    return parts.join(' · ');
  }

  function perkLabel(z) {
    let text = F().number(z.trashMultiplier, 2) + ' times trash';
    if (z.pfandChance > 0) text += ', ' + percent(z.pfandChance) + ' Pfand chance per tap';
    return text;
  }

  function buildChip(z) {
    const button = el('button', 'zone');
    button.type = 'button';
    button.dataset.zone = z.id;

    const top = el('span', 'zone-top');
    top.setAttribute('aria-hidden', 'true');
    const icon = el('span', 'zone-icon');
    const tag = el('span', 'zone-tag');
    const thumb = el('span', 'zone-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    try {
      const url = TrashGame.Character && TrashGame.Character.zoneThumb(z.id, 56, 30);
      if (url) thumb.style.backgroundImage = 'url(' + url + ')';
    } catch (e) {
      /* no picture, no problem */
    }
    thumb.append(tag);
    top.append(icon);
    const name = el('span', 'zone-name');
    name.setAttribute('aria-hidden', 'true');
    const perk = el('span', 'zone-perk');
    perk.setAttribute('aria-hidden', 'true');
    const bar = el('span', 'zone-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'zone-fill');
    bar.append(fill);
    button.append(thumb, top, name, perk, bar);

    const chip = { z, button, icon, tag, name, perk, fill, mode: null, affordable: null, cache: { progress: null } };
    guarded(button, () => {
      if (!lastState) return;
      if (chip.mode === 'unlocked') callbacks.onTravel(z.id);
      else if (chip.mode === 'next' && S().canUnlockZone(lastState, z.id)) callbacks.onUnlockZone(z.id);
    });
    return chip;
  }

  function applyMode(chip, mode) {
    const { z, button } = chip;
    chip.mode = mode;
    chip.affordable = null;
    button.classList.remove('affordable');
    for (const m of ['current', 'unlocked', 'next', 'locked']) button.classList.toggle('is-' + m, m === mode);
    button.classList.toggle('current', mode === 'current'); // legacy hook from the starter shop
    const known = mode !== 'locked';
    setText(chip.icon, known ? z.icon : '');
    setText(chip.name, known ? z.name : '???');
    setText(chip.perk, known ? perkText(z) : 'Unlock earlier zones');
    if (z.description && known) setAttr(button, 'title', z.description);
    else setAttr(button, 'title', null);

    setAttr(button, 'aria-current', mode === 'current' ? 'true' : null);
    setAttr(button, 'aria-disabled', mode === 'current' || mode === 'locked' || mode === 'next' ? 'true' : null);
    if (mode === 'current') {
      setText(chip.tag, 'Here');
      setAttr(button, 'aria-label', `${z.name}, you are here. ${perkLabel(z)}.`);
    } else if (mode === 'unlocked') {
      setText(chip.tag, 'Go');
      setAttr(button, 'aria-label', `Travel to ${z.name}. ${perkLabel(z)}.`);
    } else if (mode === 'next') {
      setText(chip.tag, F().money(z.unlockCost));
      setAttr(button, 'aria-label', `Unlock ${z.name} for ${F().money(z.unlockCost)}. ${perkLabel(z)}.`);
    } else {
      setText(chip.tag, '');
      setAttr(button, 'aria-label', 'Locked zone. Unlock the zones before it first.');
    }
  }

  /** Scrolls the zone row so `want` chips are in view; the first one wins if they don't all fit. */
  function scrollChipsIntoView(want, smooth) {
    if (track.scrollWidth <= track.clientWidth) return;
    const pad = 16;
    const view = track.clientWidth;
    let target = track.scrollLeft;
    for (let i = want.length - 1; i >= 0; i--) {
      const chip = want[i];
      if (!chip) continue;
      const left = chip.button.offsetLeft;
      const right = left + chip.button.offsetWidth;
      if (right + pad > target + view) target = right + pad - view;
      if (left - pad < target) target = left - pad;
    }
    target = Math.max(0, Math.min(target, track.scrollWidth - view));
    if (Math.abs(target - track.scrollLeft) < 1) return;
    if (smooth && track.scrollTo) track.scrollTo({ left: target, behavior: 'smooth' });
    else track.scrollLeft = target;
  }

  function renderZones(state) {
    const next = S().nextZone(state);
    let changed = false;
    let currentChip = null;
    let nextChip = null;
    for (const chip of chips) {
      const z = chip.z;
      let mode;
      if (z.id === state.zone) mode = 'current';
      else if (S().isZoneUnlocked(state, z.id)) mode = 'unlocked';
      else if (next && next.id === z.id) mode = 'next';
      else mode = 'locked';
      if (chip.mode !== mode) {
        applyMode(chip, mode);
        changed = true;
      }
      if (mode === 'current') currentChip = chip;
      if (mode === 'next') {
        nextChip = chip;
        const affordable = S().canUnlockZone(state, z.id);
        if (chip.affordable !== affordable) {
          chip.affordable = affordable;
          setAttr(chip.button, 'aria-disabled', affordable ? null : 'true');
          chip.button.classList.toggle('affordable', affordable);
          setText(chip.tag, F().money(z.unlockCost));
        }
        setProgress(chip.fill, chip.cache, affordable ? 1 : state.money / z.unlockCost);
      }
    }
    if (changed) {
      const smooth = zonesRendered;
      zonesRendered = true;
      scrollChipsIntoView([currentChip, nextChip], smooth);
    }
  }

  // ---- public ------------------------------------------------------------

  function init({ shopEl, zonesEl, onBuy, onUnlockZone, onTravel }) {
    callbacks = { onBuy, onUnlockZone, onTravel };

    shopEl.textContent = '';
    list = el('div', 'upgrade-list');
    rows = TrashGame.UPGRADES.map(buildRow);
    teaser = buildTeaser();
    for (const r of rows) list.appendChild(r.button);
    list.appendChild(teaser.root);
    shopEl.appendChild(list);
    lastFxKey = null;

    zonesEl.textContent = '';
    track = el('div', 'zone-track');
    chips = TrashGame.ZONES.map(buildChip);
    zonesRendered = false;
    for (const c of chips) track.appendChild(c.button);
    zonesEl.appendChild(track);

    focusRow = null;
    refocus = true;
    if (!listening) {
      listening = true;
      root.addEventListener('trashgame:sheet', () => {
        refocus = true;
        zonesRendered = false;
        for (const c of chips) c.mode = null; // re-run the chip scroll for the new layout
      });
    }
  }
  let listening = false;

  function render(state) {
    if (!list) return;
    lastState = state;
    frameNo++;
    renderUpgrades(state);
    renderZones(state);
  }

  TrashGame.Shop = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
