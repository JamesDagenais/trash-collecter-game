/*
 * Awards menu: the achievements tab of the pull-up sheet.
 *
 * INTERFACE (main.js depends on it):
 *   TrashGame.Awards.init({ el, tab })   el = #achievements, tab = the sheet's Awards tab button
 *   TrashGame.Awards.render(state)       every frame; does real work only while the tab is
 *                                        showing (at most 4×/s) or when the unlocked count changes
 *   TrashGame.Awards.rewardText(a, state?) -> "+0.5% all trash · Pfand +5%"
 *
 * DOM HOOKS (used by browser tests):
 *   #achievements .award[data-achievement="<id>"], with class "unlocked" once earned
 *   #achievements .awards-count  -> "12 / 145"
 *
 * Reads state through TrashGame.State and data from TrashGame.ACHIEVEMENTS only.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const S = () => TrashGame.State;
  const F = () => TrashGame.Format;

  const REFRESH_MS = 250;

  let host = null;
  let tabEl = null;
  let badgeEl = null;
  let countEl = null;
  let bonusEl = null;
  let filterButtons = {};
  let cards = [];
  let filter = 'all';
  let lastCount = -1;
  let lastRefresh = 0;
  let seenCount = null; // unlocked count the last time the player looked at the tab

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  const pct = (p) => '+' + +(p * 100).toFixed(2) + '%'; // rounded, like the descriptions

  /** What an achievement gives, in words. */
  function rewardText(a, state) {
    const parts = [pct(TrashGame.CONFIG.ACHIEVEMENT_BONUS) + ' all trash'];
    const r = a.reward;
    if (r) {
      if (r.type === 'global') parts.push(pct(r.pct) + ' all trash');
      else if (r.type === 'tap') parts.push(pct(r.pct) + ' per tap');
      else if (r.type === 'passive') parts.push(pct(r.pct) + ' per second');
      else if (r.type === 'pfand') parts.push('Pfand ' + pct(r.pct));
      else if (r.type === 'perOwned') {
        const u = S().getUpgrade(r.upgrade);
        let text = pct(r.pct) + (r.target === 'tap' ? ' per tap' : ' per second') + ' for every ' + (u ? u.name : r.upgrade);
        if (state) text += ' (now ' + pct(r.pct * S().owned(state, r.upgrade)) + ')';
        parts.push(text);
      }
    }
    return parts.join(' · ');
  }

  function iconFor(a) {
    const P = TrashGame.Pixel;
    if (!P) return '';
    const key = a.req && a.req.type === 'owned' && a.category !== 'evolution' ? a.req.upgrade : a.evolves ? a.evolves.upgrade : '';
    try {
      return P.icon(key, a.icon) || '';
    } catch (e) {
      return '';
    }
  }

  // ---- build ---------------------------------------------------------------

  function buildCard(a) {
    const li = el('li', 'award locked');
    li.dataset.achievement = a.id;
    li.dataset.category = a.category;
    if (a.evolves) li.classList.add('evolution');
    const icon = el('span', 'award-icon');
    icon.setAttribute('aria-hidden', 'true');
    const body = el('span', 'award-body');
    const name = el('span', 'award-name');
    const desc = el('span', 'award-desc');
    const reward = el('span', 'award-reward');
    body.append(name, desc, reward);
    const bar = el('span', 'award-bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'award-fill');
    bar.append(fill);
    li.append(icon, body, bar);
    return { a, li, icon, name, desc, reward, fill, unlocked: null, progress: -1, rewardKey: '' };
  }

  function init(opts) {
    host = opts && opts.el;
    tabEl = opts && opts.tab;
    if (!host) return;
    host.innerHTML = '';
    const wrap = el('div', 'awards');

    const summary = el('div', 'awards-summary');
    const trophy = el('span', 'awards-trophy');
    trophy.setAttribute('aria-hidden', 'true');
    countEl = el('span', 'awards-count');
    bonusEl = el('span', 'awards-bonus');
    summary.append(trophy, countEl, bonusEl);

    const filters = el('div', 'awards-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter achievements');
    const cats = [['all', 'All']].concat(TrashGame.ACHIEVEMENT_CATEGORIES || []);
    filterButtons = {};
    for (const [key, label] of cats) {
      const b = el('button', 'awards-filter', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(key === filter));
      b.addEventListener('click', () => setFilter(key));
      filterButtons[key] = b;
      filters.append(b);
    }

    const list = el('ul', 'awards-list');
    cards = (TrashGame.ACHIEVEMENTS || []).map(buildCard);
    for (const c of cards) list.append(c.li);

    wrap.append(summary, filters, list);
    host.append(wrap);

    if (tabEl) {
      badgeEl = el('span', 'tab-badge');
      badgeEl.hidden = true;
      badgeEl.setAttribute('aria-hidden', 'true');
      tabEl.append(badgeEl);
    }
    lastCount = -1;
  }

  function setFilter(key) {
    filter = key;
    for (const k in filterButtons) filterButtons[k].setAttribute('aria-pressed', String(k === key));
    for (const c of cards) c.li.hidden = !(key === 'all' || c.a.category === key);
    if (host && host.closest('.sheet-body')) host.closest('.sheet-body').scrollTop = 0;
  }

  // ---- render --------------------------------------------------------------

  function visible() {
    return !!host && !host.closest('[hidden]') && document.documentElement.classList.contains('sheet-open');
  }

  function updateCard(c, state) {
    const a = c.a;
    const unlocked = S().isAchievementUnlocked(state, a.id);
    if (c.unlocked !== unlocked) {
      c.unlocked = unlocked;
      c.li.classList.toggle('unlocked', unlocked);
      c.li.classList.toggle('locked', !unlocked);
      const hide = a.secret && !unlocked;
      c.li.classList.toggle('secret', hide);
      setText(c.name, hide ? '???' : a.name);
      setText(c.desc, hide ? 'Secret achievement. Keep playing…' : a.description);
      const url = hide ? '' : iconFor(a);
      if (url) {
        c.icon.style.backgroundImage = 'url(' + url + ')';
        c.icon.classList.add('pixel');
        setText(c.icon, '');
      } else {
        c.icon.style.backgroundImage = '';
        c.icon.classList.remove('pixel');
        setText(c.icon, hide ? '?' : a.icon);
      }
      c.li.setAttribute(
        'aria-label',
        (unlocked ? 'Unlocked: ' : 'Locked: ') + (hide ? 'secret achievement' : a.name + '. ' + a.description) + (hide ? '' : ' Reward: ' + rewardText(a) + '.')
      );
    }
    // reward line: live value for evolutions, otherwise static
    const live = a.reward && a.reward.type === 'perOwned';
    const key = a.secret && !unlocked ? 'secret' : live ? String(S().owned(state, a.reward.upgrade)) + unlocked : 'static';
    if (c.rewardKey !== key) {
      c.rewardKey = key;
      setText(c.reward, a.secret && !unlocked ? '' : rewardText(a, unlocked && live ? state : null));
    }
    const p = unlocked ? 1 : a.secret ? 0 : Math.floor(S().achievementProgress(state, a) * 100) / 100;
    if (c.progress !== p) {
      c.progress = p;
      c.fill.style.transform = 'scaleX(' + p + ')';
    }
  }

  function updateSummary(state, count) {
    const total = cards.length;
    setText(countEl, F().number(count) + ' / ' + F().number(total));
    const b = S().bonuses(state);
    const parts = [];
    if (b.global > 1) parts.push(pct(b.global - 1) + ' all trash');
    if (b.tap > 1) parts.push(pct(b.tap - 1) + ' per tap');
    if (b.passive > 1) parts.push(pct(b.passive - 1) + ' per sec');
    if (b.pfand > 1) parts.push('Pfand ' + pct(b.pfand - 1));
    setText(bonusEl, parts.length ? parts.join(' · ') : 'Every achievement: ' + pct(TrashGame.CONFIG.ACHIEVEMENT_BONUS) + ' all trash');
    for (const k in filterButtons) {
      const inCat = k === 'all' ? cards : cards.filter((c) => c.a.category === k);
      const done = inCat.filter((c) => S().isAchievementUnlocked(state, c.a.id)).length;
      const label = (k === 'all' ? 'All' : (TrashGame.ACHIEVEMENT_CATEGORIES.find((x) => x[0] === k) || [k, k])[1]) + ' ' + done + '/' + inCat.length;
      setText(filterButtons[k], label);
    }
  }

  function render(state) {
    if (!host || !state) return;
    const count = S().achievementCount(state);
    if (seenCount === null) seenCount = count; // achievements from before this session aren't "new"
    const showing = visible();
    if (showing) seenCount = count;
    if (badgeEl) {
      const fresh = Math.max(0, count - seenCount);
      badgeEl.hidden = fresh === 0;
      setText(badgeEl, fresh > 99 ? '99+' : String(fresh));
    }
    // Off screen nothing is touched; the first visible frame refreshes everything.
    if (!showing) return;
    const now = performance.now();
    if (count === lastCount && now - lastRefresh < REFRESH_MS) return;
    lastRefresh = now;
    lastCount = count;
    for (const c of cards) updateCard(c, state);
    updateSummary(state, count);
  }

  TrashGame.Awards = { init, render, rewardText };
})(typeof window !== 'undefined' ? window : globalThis);
