/*
 * Save / load with localStorage.
 * A save is { version, state }. Loading merges onto a fresh state, so new
 * fields and new upgrades added later still load from old saves.
 *
 * INTERFACE: TrashGame.Save = { SAVE_KEY, SAVE_VERSION, save(state, store?),
 *   load(store?), clear(store?), sanitize(rawState), migrate(saveData) }
 *   `store` is optional (defaults to localStorage); anything with
 *   getItem/setItem/removeItem works, which is how the tests run in Node.
 *
 * Versions:
 *   1  Phase 1 / playtest builds.
 *   2  Economy rework. Heavy-Duty Gloves (work_gloves) and Leaf Blower
 *      (leaf_blower) were removed, and Warschauer Straße moved from zone 2
 *      (EUR 5,000) to zone 6. migrate() refunds what a v1 player paid for those.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  const SAVE_KEY = 'berlinTrashClicker.save';
  const SAVE_VERSION = 2;

  // What v1 saves could hold that v2 no longer has, priced as in v1.
  const V1_REMOVED_UPGRADES = { work_gloves: 2000, leaf_blower: 120000 }; // baseCost, growth 1.15
  const V1_MOVED_ZONES = { warschauer_str: 5000 }; // unlockCost in v1
  const V1_COST_GROWTH = 1.15;
  const MAX_REFUNDED_COPIES = 500;

  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

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

  /** € paid in total for `count` copies at the v1 price curve. */
  function v1Spent(baseCost, count) {
    let total = 0;
    for (let k = 0; k < count; k++) total += Math.ceil(baseCost * Math.pow(V1_COST_GROWTH, k));
    return total;
  }

  /** v1 -> v2: refund removed upgrades and the old Warschauer Straße unlock. */
  function migrateV1(raw) {
    let refund = 0;
    const out = { ...raw };
    if (isObj(raw.upgrades)) {
      for (const id of Object.keys(V1_REMOVED_UPGRADES)) {
        const n = raw.upgrades[id];
        if (hasOwn(raw.upgrades, id) && isNum(n)) refund += v1Spent(V1_REMOVED_UPGRADES[id], Math.min(Math.floor(n), MAX_REFUNDED_COPIES));
      }
    }
    if (isObj(raw.zonesUnlocked)) {
      const zones = { ...raw.zonesUnlocked };
      for (const id of Object.keys(V1_MOVED_ZONES)) {
        if (hasOwn(zones, id) && zones[id] === true) {
          refund += V1_MOVED_ZONES[id];
          delete zones[id];
          if (raw.zone === id) out.zone = undefined; // back to the first zone
        }
      }
      out.zonesUnlocked = zones;
    }
    if (refund > 0 && Number.isFinite(refund)) out.money = (isNum(raw.money) ? raw.money : 0) + refund;
    return out;
  }

  /**
   * Upgrades saved data { version, state } from any older version to the
   * current one. Returns the (still untrusted) raw state for sanitize().
   */
  function migrate(data) {
    if (!isObj(data) || !isObj(data.state)) return data && data.state;
    const version = typeof data.version === 'number' ? data.version : 1;
    let raw = data.state;
    if (version < 2) raw = migrateV1(raw);
    return raw;
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
    if (typeof raw.zone === 'string' && TrashGame.State.getZone(raw.zone) && TrashGame.State.isZoneUnlocked(state, raw.zone)) {
      state.zone = raw.zone;
    }
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
      return sanitize(migrate(data));
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

  TrashGame.Save = { SAVE_KEY, SAVE_VERSION, save, load, clear, sanitize, migrate };
})(typeof window !== 'undefined' ? window : globalThis);
