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
 *   upgradeName(state, id)        -> display name, after evolutions (e.g. "Golden Broom")
 *   evolutionTier(state, id)      -> 0 (none), 1, 2… highest evolution unlocked
 *   getAchievement(id), isAchievementUnlocked(state, id), achievementCount(state)
 *   achievementProgress(state, a) -> 0..1 (best effort; 0 for custom/secret)
 *   bonuses(state)                -> { global, tap, passive, pfand } total multipliers
 *        from achievements (1 = no bonus); already included in the rates above
 *   checkAchievements(state, now?) -> newly unlocked achievements (array). Call it
 *        after anything that changes state; it's cheap.
 *   unlockAchievement(state, id, now?) -> bool (debugging / tests). Only these two
 *        may write state.achievements: the bonus cache relies on it.
 *   owned / isZoneUnlocked only count OWN, valid entries, so ids like
 *   'constructor' or '__proto__' are never owned or unlocked.
 *
 * STATE SHAPE (also the save format; see save.js):
 *   trash, money, totalMoneyEarned, taps          numbers
 *   upgrades: { [upgradeId]: countOwned }
 *   zone: currentZoneId
 *   zonesUnlocked: { [zoneId]: true }
 *   pfandBottles, pfandMoney                     numbers (lifetime)
 *   achievements: { [achievementId]: unlockedAtMs }
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
    ACHIEVEMENT_BONUS: 0.005, // every achievement: +0.5% to all trash ("Kiez reputation")
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
      achievements: {},
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

  // ---- Achievements ----------------------------------------------------

  const achievementList = () => TrashGame.ACHIEVEMENTS || [];
  let achievementIndex = null;

  function getAchievement(id) {
    if (!achievementIndex || achievementIndex.list !== achievementList()) {
      achievementIndex = { list: achievementList(), byId: new Map(achievementList().map((a) => [a.id, a])) };
    }
    return achievementIndex.byId.get(id) || null;
  }

  function isAchievementUnlocked(state, id) {
    return !!getAchievement(id) && hasOwn(state.achievements, id) && typeof state.achievements[id] === 'number';
  }

  function achievementCount(state) {
    let n = 0;
    for (const id in state.achievements || {}) if (isAchievementUnlocked(state, id)) n++;
    return n;
  }

  // The fixed part of the bonuses only changes when an achievement unlocks, so it
  // is cached per achievements object. checkAchievements / unlockAchievement bump
  // its version; a new object (load, reset) starts a new cache entry. Write to
  // state.achievements only through those two functions.
  const bonusCache = new WeakMap(); // achievements object -> { version, list, b }
  const versions = new WeakMap(); // achievements object -> number

  function bump(obj) {
    versions.set(obj, (versions.get(obj) || 0) + 1);
  }

  function staticBonuses(state) {
    const obj = state.achievements && typeof state.achievements === 'object' ? state.achievements : null;
    const version = obj ? versions.get(obj) || 0 : -1;
    const hit = obj && bonusCache.get(obj);
    if (hit && hit.version === version && hit.list === achievementList()) return hit.b;
    const b = { count: 0, global: 0, tap: 0, passive: 0, pfand: 0, perOwned: [] };
    for (const id of state.achievements ? Object.keys(state.achievements) : []) {
      if (!isAchievementUnlocked(state, id)) continue;
      const a = getAchievement(id);
      b.count++;
      const r = a.reward;
      if (!r) continue;
      if (r.type === 'perOwned') b.perOwned.push(r);
      else if (r.type in b) b[r.type] += r.pct;
    }
    if (obj) bonusCache.set(obj, { version, list: achievementList(), b });
    return b;
  }

  function bonuses(state) {
    const b = staticBonuses(state);
    let tap = b.tap;
    let passive = b.passive;
    for (const r of b.perOwned) {
      const add = r.pct * owned(state, r.upgrade);
      if (r.target === 'tap') tap += add;
      else passive += add;
    }
    return {
      global: 1 + b.count * TrashGame.CONFIG.ACHIEVEMENT_BONUS + b.global,
      tap: 1 + tap,
      passive: 1 + passive,
      pfand: 1 + b.pfand,
    };
  }

  function evolutionTier(state, id) {
    let tier = 0;
    for (const a of achievementList()) {
      if (a.evolves && a.evolves.upgrade === id && a.evolves.tier > tier && isAchievementUnlocked(state, a.id)) tier = a.evolves.tier;
    }
    return tier;
  }

  function upgradeName(state, id) {
    const u = getUpgrade(id);
    if (!u) return '';
    let best = null;
    for (const a of achievementList()) {
      if (a.evolves && a.evolves.upgrade === id && isAchievementUnlocked(state, a.id) && (!best || a.evolves.tier > best.tier)) best = a.evolves;
    }
    return best ? best.name : u.name;
  }

  function reqMet(state, req, rates) {
    switch (req.type) {
      case 'owned':
        return owned(state, req.upgrade) >= req.count;
      case 'ownAll':
        return TrashGame.UPGRADES.every((u) => owned(state, u.id) >= req.count);
      case 'zone':
        return isZoneUnlocked(state, req.zone);
      case 'allZones':
        return TrashGame.ZONES.every((z) => isZoneUnlocked(state, z.id));
      case 'stat':
        return typeof state[req.stat] === 'number' && state[req.stat] >= req.amount;
      case 'rate':
        return (req.rate === 'perTap' ? rates().perTap : rates().perSecond) >= req.amount;
      case 'custom':
        try {
          return !!req.test(state, TrashGame.State);
        } catch (e) {
          return false;
        }
      default:
        return false;
    }
  }

  function checkAchievements(state, now = Date.now()) {
    if (!state.achievements || typeof state.achievements !== 'object') state.achievements = {};
    let cached = null;
    const rates = () => cached || (cached = { perTap: trashPerTap(state), perSecond: trashPerSecond(state) });
    const unlocked = [];
    for (const a of achievementList()) {
      if (hasOwn(state.achievements, a.id)) continue;
      if (reqMet(state, a.req, rates)) {
        state.achievements[a.id] = now;
        unlocked.push(a);
      }
    }
    if (unlocked.length) bump(state.achievements);
    return unlocked;
  }

  /** Unlocks one achievement directly (debugging, tests). Returns true if it was new. */
  function unlockAchievement(state, id, now = Date.now()) {
    if (!getAchievement(id) || isAchievementUnlocked(state, id)) return false;
    if (!state.achievements || typeof state.achievements !== 'object') state.achievements = {};
    state.achievements[id] = now;
    bump(state.achievements);
    return true;
  }

  /** How close you are, 0..1, for the menu's progress bars. */
  function achievementProgress(state, a) {
    if (isAchievementUnlocked(state, a.id)) return 1;
    const r = a.req;
    const frac = (have, need) => Math.max(0, Math.min(1, need > 0 ? have / need : 0));
    switch (r.type) {
      case 'owned':
        return frac(owned(state, r.upgrade), r.count);
      case 'ownAll':
        return frac(Math.min(...TrashGame.UPGRADES.map((u) => owned(state, u.id))), r.count);
      case 'allZones':
        return frac(TrashGame.ZONES.filter((z) => isZoneUnlocked(state, z.id)).length, TrashGame.ZONES.length);
      case 'zone': {
        const z = getZone(r.zone);
        return z && z.unlockCost > 0 ? frac(state.money, z.unlockCost) : 0;
      }
      case 'stat':
        return frac(state[r.stat] || 0, r.amount);
      case 'rate':
        return frac(r.rate === 'perTap' ? trashPerTap(state) : trashPerSecond(state), r.amount);
      default:
        return 0;
    }
  }

  // ---- Income ----------------------------------------------------------

  function trashPerTap(state) {
    let total = TrashGame.CONFIG.BASE_TRASH_PER_TAP;
    for (const u of TrashGame.UPGRADES) total += u.trashPerTap * owned(state, u.id);
    const b = bonuses(state);
    return total * b.tap * b.global * currentZone(state).trashMultiplier;
  }

  function trashPerSecond(state) {
    let total = 0;
    for (const u of TrashGame.UPGRADES) total += u.trashPerSecond * owned(state, u.id);
    if (total === 0) return 0;
    const b = bonuses(state);
    return total * b.passive * b.global * currentZone(state).trashMultiplier;
  }

  function pfandValue(state) {
    const C = TrashGame.CONFIG;
    const base = (trashPerTap(state) * C.PFAND_TAPS_WORTH + trashPerSecond(state) * C.PFAND_SECONDS_WORTH) * C.MONEY_PER_TRASH;
    return base * bonuses(state).pfand;
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
    getAchievement,
    isAchievementUnlocked,
    achievementCount,
    achievementProgress,
    bonuses,
    evolutionTier,
    upgradeName,
    checkAchievements,
    unlockAchievement,
  };
})(typeof window !== 'undefined' ? window : globalThis);
