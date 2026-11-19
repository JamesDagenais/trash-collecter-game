/*
 * Game state + pure game logic.
 * No DOM and no localStorage in here, so it all runs (and is tested) in Node.
 *
 * PUBLIC API (TrashGame.State). Other modules depend on these names and
 * signatures. Change the internals freely, but keep the signatures.
 *
 *   createState()                 -> fresh state (shape documented below)
 *   getUpgrade(id), owned(state, id)
 *   upgradeCost(upgrade, owned)   -> € price of the copy after `owned` copies
 *   nextCost(state, id)
 *   canAfford(state, id), buy(state, id) -> bool
 *   trashPerTap(state), trashPerSecond(state)   (zone multiplier included)
 *   tap(state, rng = Math.random) -> TapResult { trash, money, pfand }
 *        trash: trash picked up; money: € earned from that trash;
 *        pfand: bonus € from a Pfand bottle on this tap (0 if none)
 *   tick(state, dtSeconds)        -> trash collected passively
 *   awayProgress(state, seconds)  -> { seconds, trash, money } credited for time
 *        away (tab hidden / game closed): OFFLINE_RATE of passive income,
 *        capped at OFFLINE_MAX_SECONDS. Taps and Pfand don't happen while away.
 *   pfandValue(state)             -> € a bottle is worth right now:
 *        PFAND_TAPS_WORTH taps of money + PFAND_SECONDS_WORTH seconds of
 *        passive income, both in the current zone
 *   getZone(id), currentZone(state), isZoneUnlocked(state, id)
 *   nextZone(state)               -> the next locked zone, or null
 *   canUnlockZone(state, id), unlockZone(state, id) -> bool (also moves you there)
 *   travelTo(state, id)           -> bool (only to unlocked zones)
 *   currentTool(state)            -> best tap upgrade owned, or the trash pick
 *   owned / isZoneUnlocked only count OWN, valid entries, so ids like
 *   'constructor' or '__proto__' are never owned or unlocked.
 *
 * STATE SHAPE (also the save format; see save.js):
 *   trash, money, totalMoneyEarned, taps          numbers
 *   upgrades: { [upgradeId]: countOwned }
 *   zone: currentZoneId
 *   zonesUnlocked: { [zoneId]: true }
 *   pfandBottles, pfandMoney                     numbers (lifetime)
 *   startedAt, lastSaved                         ms timestamps
 *   saveRev                                      save revision (see save.js)
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  TrashGame.CONFIG = Object.freeze({
    BASE_TRASH_PER_TAP: 1, // the starting trash pick
    MONEY_PER_TRASH: 1, // € earned per piece of trash collected
    DEFAULT_COST_GROWTH: 1.15,
    // A Pfand bottle is worth PFAND_TAPS_WORTH taps' worth of money PLUS
    // PFAND_SECONDS_WORTH seconds of passive income (both at the current zone's
    // multiplier), so it stays a noticeable bonus late game, when most income
    // is passive. See docs/economy.md.
    PFAND_TAPS_WORTH: 8,
    PFAND_SECONDS_WORTH: 2,
    // Away progress: passive helpers keep working at half speed while you're
    // gone, for at most 2 hours.
    OFFLINE_RATE: 0.5,
    OFFLINE_MAX_SECONDS: 2 * 60 * 60,
    MAX_OWNED: 1e6, // per upgrade; keeps counts far from float-precision trouble
  });

  function createState() {
    const upgrades = {};
    for (const u of TrashGame.UPGRADES) upgrades[u.id] = 0;
    const firstZone = TrashGame.ZONES[0].id;
    return {
      trash: 0,
      money: 0,
      totalMoneyEarned: 0,
      taps: 0,
      upgrades,
      zone: firstZone,
      zonesUnlocked: { [firstZone]: true },
      pfandBottles: 0,
      pfandMoney: 0,
      startedAt: Date.now(),
      lastSaved: null,
      saveRev: 0,
    };
  }

  // ---- Upgrades --------------------------------------------------------

  function getUpgrade(id) {
    return TrashGame.UPGRADES.find((u) => u.id === id) || null;
  }

  const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);

  function owned(state, id) {
    if (!hasOwn(state.upgrades, id)) return 0; // e.g. 'constructor' is not an upgrade
    const n = state.upgrades[id];
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  }

  function upgradeCost(upgrade, ownedCount) {
    const growth = upgrade.costGrowth || TrashGame.CONFIG.DEFAULT_COST_GROWTH;
    // Floats can't hold 1.15 exactly, so prices past ~€10 trillion may differ by €1
    // from exact math. Harmless: the shown price and the buy check use this same number.
    return Math.ceil(upgrade.baseCost * Math.pow(growth, ownedCount));
  }

  function nextCost(state, id) {
    const u = getUpgrade(id);
    return u ? upgradeCost(u, owned(state, id)) : Infinity;
  }

  function canAfford(state, id) {
    return state.money >= nextCost(state, id);
  }

  function buy(state, id) {
    if (!getUpgrade(id)) return false;
    if (owned(state, id) >= TrashGame.CONFIG.MAX_OWNED) return false;
    const cost = nextCost(state, id);
    if (state.money < cost) return false;
    state.money -= cost;
    state.upgrades[id] = owned(state, id) + 1;
    return true;
  }

  function currentTool(state) {
    let best = null;
    for (const u of TrashGame.UPGRADES) {
      if (u.trashPerTap > 0 && owned(state, u.id) > 0) best = u;
    }
    return best || { id: 'trash_pick', name: 'Trash Pick', icon: '🥢' };
  }

  // ---- Zones -----------------------------------------------------------

  function getZone(id) {
    return TrashGame.ZONES.find((z) => z.id === id) || null;
  }

  function currentZone(state) {
    return getZone(state.zone) || TrashGame.ZONES[0];
  }

  function isZoneUnlocked(state, id) {
    return !!getZone(id) && hasOwn(state.zonesUnlocked, id) && state.zonesUnlocked[id] === true;
  }

  function nextZone(state) {
    return TrashGame.ZONES.find((z) => !isZoneUnlocked(state, z.id)) || null;
  }

  function canUnlockZone(state, id) {
    const next = nextZone(state);
    return !!next && next.id === id && state.money >= next.unlockCost;
  }

  function unlockZone(state, id) {
    if (!canUnlockZone(state, id)) return false;
    state.money -= getZone(id).unlockCost;
    state.zonesUnlocked[id] = true;
    state.zone = id;
    return true;
  }

  function travelTo(state, id) {
    if (!getZone(id) || !isZoneUnlocked(state, id)) return false;
    state.zone = id;
    return true;
  }

  // ---- Income ----------------------------------------------------------

  function trashPerTap(state) {
    let total = TrashGame.CONFIG.BASE_TRASH_PER_TAP;
    for (const u of TrashGame.UPGRADES) total += u.trashPerTap * owned(state, u.id);
    return total * currentZone(state).trashMultiplier;
  }

  function trashPerSecond(state) {
    let total = 0;
    for (const u of TrashGame.UPGRADES) total += u.trashPerSecond * owned(state, u.id);
    return total * currentZone(state).trashMultiplier;
  }

  function pfandValue(state) {
    const C = TrashGame.CONFIG;
    return (trashPerTap(state) * C.PFAND_TAPS_WORTH + trashPerSecond(state) * C.PFAND_SECONDS_WORTH) * C.MONEY_PER_TRASH;
  }

  function earn(state, amount) {
    state.money += amount;
    state.totalMoneyEarned += amount;
  }

  /** Adds trash and pays out money for it. Returns the money earned. */
  function collect(state, trash) {
    if (!(trash > 0)) return 0;
    const money = trash * TrashGame.CONFIG.MONEY_PER_TRASH;
    state.trash += trash;
    earn(state, money);
    return money;
  }

  function tap(state, rng = Math.random) {
    state.taps += 1;
    const trash = trashPerTap(state);
    const money = collect(state, trash);
    let pfand = 0;
    if (rng() < currentZone(state).pfandChance) {
      pfand = pfandValue(state);
      earn(state, pfand);
      state.pfandBottles += 1;
      state.pfandMoney += pfand;
    }
    return { trash, money, pfand };
  }

  function tick(state, dtSeconds) {
    if (!(dtSeconds > 0)) return 0;
    const trash = trashPerSecond(state) * dtSeconds;
    collect(state, trash);
    return trash;
  }

  function awayProgress(state, seconds) {
    const capped = Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 0, TrashGame.CONFIG.OFFLINE_MAX_SECONDS);
    const trash = trashPerSecond(state) * capped * TrashGame.CONFIG.OFFLINE_RATE;
    const money = collect(state, trash);
    return { seconds: capped, trash: money > 0 ? trash : 0, money };
  }

  TrashGame.State = {
    createState,
    getUpgrade,
    owned,
    upgradeCost,
    nextCost,
    canAfford,
    buy,
    currentTool,
    getZone,
    currentZone,
    isZoneUnlocked,
    nextZone,
    canUnlockZone,
    unlockZone,
    travelTo,
    trashPerTap,
    trashPerSecond,
    pfandValue,
    collect,
    tap,
    tick,
    awayProgress,
  };
})(typeof window !== 'undefined' ? window : globalThis);
