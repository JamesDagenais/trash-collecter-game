/*
 * Save / load with localStorage.
 * A save is { version, state }. Loading merges onto a fresh state, so new
 * fields and new upgrades added later still load from old saves.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  const SAVE_KEY = 'berlinTrashClicker.save';
  const SAVE_VERSION = 1;

  function storage(custom) {
    if (custom) return custom;
    try {
      return root.localStorage || null;
    } catch (e) {
      return null; // blocked (private mode, sandboxed iframe, ...)
    }
  }

  function isNum(n) {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0;
  }

  /** Builds a valid state from untrusted saved data. */
  function sanitize(raw) {
    const state = TrashGame.State.createState();
    if (!raw || typeof raw !== 'object') return state;

    for (const key of ['trash', 'money', 'totalMoneyEarned', 'taps', 'pfandBottles', 'pfandMoney', 'startedAt', 'lastSaved']) {
      if (isNum(raw[key])) state[key] = raw[key];
    }
    if (raw.zonesUnlocked && typeof raw.zonesUnlocked === 'object') {
      for (const z of TrashGame.ZONES) {
        if (raw.zonesUnlocked[z.id] === true) state.zonesUnlocked[z.id] = true;
      }
    }
    if (typeof raw.zone === 'string' && state.zonesUnlocked[raw.zone]) state.zone = raw.zone;
    if (raw.upgrades && typeof raw.upgrades === 'object') {
      for (const id of Object.keys(state.upgrades)) {
        const n = raw.upgrades[id];
        if (isNum(n)) state.upgrades[id] = Math.floor(n);
      }
      // Upgrade ids no longer in UPGRADES are dropped.
    }
    return state;
  }

  function save(state, store) {
    const s = storage(store);
    if (!s) return false;
    try {
      state.lastSaved = Date.now();
      s.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Returns the saved state, or a fresh one if there's no usable save. */
  function load(store) {
    const s = storage(store);
    if (!s) return TrashGame.State.createState();
    try {
      const text = s.getItem(SAVE_KEY);
      if (!text) return TrashGame.State.createState();
      const data = JSON.parse(text);
      // Migrations for future versions go here, keyed on data.version.
      return sanitize(data && data.state);
    } catch (e) {
      return TrashGame.State.createState();
    }
  }

  function clear(store) {
    const s = storage(store);
    if (!s) return;
    try {
      s.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  TrashGame.Save = { SAVE_KEY, SAVE_VERSION, save, load, clear, sanitize };
})(typeof window !== 'undefined' ? window : globalThis);
