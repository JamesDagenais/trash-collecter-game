/*
 * Game state + pure game logic.
 * No DOM and no localStorage in here, so it all runs (and is tested) in Node.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  TrashGame.CONFIG = Object.freeze({
    BASE_TRASH_PER_TAP: 1, // the starting trash pick
    MONEY_PER_TRASH: 1, // € earned per piece of trash collected
    DEFAULT_COST_GROWTH: 1.15,
  });

  /** A fresh game. This shape is also what gets saved. */
  function createState() {
    const upgrades = {};
    for (const u of TrashGame.UPGRADES) upgrades[u.id] = 0;
    return {
      trash: 0, // trash collected (lifetime total)
      money: 0, // € you can spend
      totalMoneyEarned: 0,
      taps: 0,
      upgrades, // { [upgradeId]: countOwned }
      startedAt: Date.now(),
      lastSaved: null,
    };
  }

  function getUpgrade(id) {
    return TrashGame.UPGRADES.find((u) => u.id === id) || null;
  }

  function owned(state, id) {
    return state.upgrades[id] || 0;
  }

  function upgradeCost(upgrade, ownedCount) {
    const growth = upgrade.costGrowth || TrashGame.CONFIG.DEFAULT_COST_GROWTH;
    return Math.ceil(upgrade.baseCost * Math.pow(growth, ownedCount));
  }

  function nextCost(state, id) {
    const u = getUpgrade(id);
    return u ? upgradeCost(u, owned(state, id)) : Infinity;
  }

  function trashPerTap(state) {
    let total = TrashGame.CONFIG.BASE_TRASH_PER_TAP;
    for (const u of TrashGame.UPGRADES) total += u.trashPerTap * owned(state, u.id);
    return total;
  }

  function trashPerSecond(state) {
    let total = 0;
    for (const u of TrashGame.UPGRADES) total += u.trashPerSecond * owned(state, u.id);
    return total;
  }

  /** Adds trash, paying out money for it. */
  function collect(state, amount) {
    if (!(amount > 0)) return 0;
    const earned = amount * TrashGame.CONFIG.MONEY_PER_TRASH;
    state.trash += amount;
    state.money += earned;
    state.totalMoneyEarned += earned;
    return amount;
  }

  /** One tap on the trash. Returns the trash collected. */
  function tap(state) {
    state.taps += 1;
    return collect(state, trashPerTap(state));
  }

  /** Advance passive income by dtSeconds. */
  function tick(state, dtSeconds) {
    if (!(dtSeconds > 0)) return 0;
    return collect(state, trashPerSecond(state) * dtSeconds);
  }

  function canAfford(state, id) {
    return state.money >= nextCost(state, id);
  }

  /** Buy one copy. Returns true on success. */
  function buy(state, id) {
    if (!getUpgrade(id)) return false;
    const cost = nextCost(state, id);
    if (state.money < cost) return false;
    state.money -= cost;
    state.upgrades[id] = owned(state, id) + 1;
    return true;
  }

  /** The best tap tool you own, for display ("You're using: ..."). */
  function currentTool(state) {
    let best = null;
    for (const u of TrashGame.UPGRADES) {
      if (u.trashPerTap > 0 && owned(state, u.id) > 0) best = u;
    }
    return best || { id: 'trash_pick', name: 'Trash Pick', icon: '🥢' };
  }

  TrashGame.State = {
    createState,
    getUpgrade,
    owned,
    upgradeCost,
    nextCost,
    trashPerTap,
    trashPerSecond,
    collect,
    tap,
    tick,
    canAfford,
    buy,
    currentTool,
  };
})(typeof window !== 'undefined' ? window : globalThis);
