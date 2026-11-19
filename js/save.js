/*
 * Save / load with localStorage.
 * A save is { version, state }. Loading merges onto a fresh state, so new
 * fields and new upgrades added later still load from old saves.
 *
 * INTERFACE: TrashGame.Save = { SAVE_KEY, BACKUP_KEY, SAVE_VERSION,
 *   save(state, store?) -> bool, load(store?), clear(store?), storedRev(store?),
 *   lastResult, sanitize(rawState), migrate(saveData) }
 *   `store` is optional (defaults to localStorage); anything with
 *   getItem/setItem/removeItem works, which is how the tests run in Node.
 *
 * Multiple tabs: every save carries state.saveRev, bumped on each write.
 *   save() refuses to overwrite a stored save with a HIGHER saveRev than the
 *   state it was given (another tab, or a Reset, got there first); it returns
 *   false and sets Save.lastResult = 'stale', and the caller should reload.
 *   lastResult is one of 'ok' | 'stale' | 'unavailable' | 'error'.
 *
 * Corrupt saves, and saves from an unknown (newer) version, are copied to
 *   BACKUP_KEY before anything overwrites them.
 *
 * Versions:
 *   1  Phase 1 / playtest builds.
 *   2  Economy rework: almost every upgrade changed price and effect, two were
 *      removed and Warschauer Straße moved from zone 2 to zone 6. migrate()
 *      refunds EVERYTHING a v1 player bought at v1 prices and resets their
 *      upgrades and zones, so nobody skips the new curve with old purchases.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  const SAVE_KEY = 'berlinTrashClicker.save';
  const BACKUP_KEY = SAVE_KEY + '.backup';
  const SAVE_VERSION = 2;
  const MAX_AMOUNT = 1e300; // money / trash ceiling, far below Infinity

  // Everything a v1 save could hold, priced as in v1 (cost growth 1.15).
  const V1_UPGRADE_COSTS = {
    broom: 15,
    helpful_neighbour: 60,
    garbage_bags: 200,
    pfand_collector: 750,
    work_gloves: 2000,
    cargo_bike: 6000,
    handcart: 15000,
    kiez_crew: 40000,
    leaf_blower: 120000,
    sweeper_truck: 400000,
    recycling_yard: 1500000,
  };
  const V1_ZONE_COSTS = { warschauer_str: 5000 };
  const V1_COST_GROWTH = 1.15;
  const MAX_REFUNDED_COPIES = 500;

  const api = { lastResult: 'ok' };

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

  /** v1 -> v2: refund every v1 purchase at v1 prices; start upgrades and zones over. */
  function migrateV1(raw) {
    let refund = 0;
    const out = { ...raw, upgrades: {}, zonesUnlocked: {}, zone: undefined };
    if (isObj(raw.upgrades)) {
      for (const id of Object.keys(V1_UPGRADE_COSTS)) {
        const n = raw.upgrades[id];
        if (hasOwn(raw.upgrades, id) && isNum(n)) refund += v1Spent(V1_UPGRADE_COSTS[id], Math.min(Math.floor(n), MAX_REFUNDED_COPIES));
      }
    }
    if (isObj(raw.zonesUnlocked)) {
      for (const id of Object.keys(V1_ZONE_COSTS)) {
        if (hasOwn(raw.zonesUnlocked, id) && raw.zonesUnlocked[id] === true) refund += V1_ZONE_COSTS[id];
      }
    }
    if (Number.isFinite(refund)) out.money = (isNum(raw.money) ? raw.money : 0) + refund;
    return out;
  }

  /**
   * Upgrades saved data { version, state } from any older version to the
   * current one. Returns the (still untrusted) raw state for sanitize().
   */
  function migrate(data) {
    if (!isObj(data) || !isObj(data.state)) return data && data.state;
    const version = data.version;
    let raw = data.state;
    // Unknown versions (missing, not a number, or newer than this build) are
    // loaded as-is; load() has already backed them up.
    if (typeof version !== 'number' || version > SAVE_VERSION) return raw;
    if (version < 2) raw = migrateV1(raw);
    return raw;
  }

  /** Builds a valid state from untrusted saved data. */
  function sanitize(raw) {
    const state = TrashGame.State.createState();
    if (!raw || typeof raw !== 'object') return state;

    for (const key of ['trash', 'money', 'totalMoneyEarned', 'taps', 'pfandBottles', 'pfandMoney', 'startedAt', 'lastSaved', 'saveRev']) {
      if (isNum(raw[key])) state[key] = Math.min(raw[key], MAX_AMOUNT);
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
        if (isNum(n)) state.upgrades[id] = Math.min(Math.floor(n), TrashGame.CONFIG.MAX_OWNED);
      }
      // Upgrade ids no longer in UPGRADES are dropped.
    }
    return state;
  }

  /** saveRev of whatever is stored right now (0 if nothing usable). */
  function storedRev(store) {
    const s = storage(store);
    if (!s) return 0;
    try {
      const data = JSON.parse(s.getItem(SAVE_KEY));
      const rev = data && data.state && data.state.saveRev;
      return isNum(rev) ? rev : 0;
    } catch (e) {
      return 0;
    }
  }

  function save(state, store) {
    const s = storage(store);
    if (!s) return result(false, 'unavailable');
    try {
      const current = storedRev(s);
      const mine = isNum(state.saveRev) ? state.saveRev : 0;
      if (current > mine) return result(false, 'stale');
      state.saveRev = Math.max(current, mine) + 1;
      state.lastSaved = Date.now();
      s.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, state }));
      return result(true, 'ok');
    } catch (e) {
      return result(false, 'error');
    }
  }

  function result(ok, why) {
    api.lastResult = why;
    return ok;
  }

  function backup(s, text) {
    try {
      s.setItem(BACKUP_KEY, text);
    } catch (e) {
      /* nothing more we can do */
    }
  }

  /** Returns the saved state, or a fresh one if there's no usable save. */
  function load(store) {
    const s = storage(store);
    if (!s) return TrashGame.State.createState();
    try {
      const text = s.getItem(SAVE_KEY);
      if (!text) return TrashGame.State.createState();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        backup(s, text); // corrupt: keep a copy before autosave replaces it
        return TrashGame.State.createState();
      }
      if (!isObj(data) || typeof data.version !== 'number' || data.version > SAVE_VERSION) backup(s, text);
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

  TrashGame.Save = Object.assign(api, { SAVE_KEY, BACKUP_KEY, SAVE_VERSION, save, load, clear, storedRev, sanitize, migrate });
})(typeof window !== 'undefined' ? window : globalThis);
