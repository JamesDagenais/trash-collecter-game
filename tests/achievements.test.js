/*
 * Achievements: the data contract, unlocking, bonuses, evolutions, saving.
 * Data-driven: reads TrashGame.ACHIEVEMENTS rather than hard-coding the list.
 */
'use strict';
const assert = require('assert');
const { test, memoryStore, approx, seeded } = require('./lib/harness');

const REQ_TYPES = ['owned', 'ownAll', 'zone', 'allZones', 'stat', 'rate', 'custom'];
const REWARD_TYPES = ['global', 'tap', 'passive', 'pfand', 'perOwned'];
const STATS = ['trash', 'taps', 'money', 'totalMoneyEarned', 'pfandBottles', 'pfandMoney'];

// ---- contract ------------------------------------------------------------

test('achievements: ids are unique snake_case, fields are filled in, list is frozen', (T) => {
  const A = T.ACHIEVEMENTS;
  assert(Array.isArray(A) && A.length >= 100, `lots of achievements (got ${A.length})`);
  assert(Object.isFrozen(A) && A.every(Object.isFrozen));
  assert.strictEqual(new Set(A.map((a) => a.id)).size, A.length);
  const cats = T.ACHIEVEMENT_CATEGORIES.map((c) => c[0]);
  for (const a of A) {
    assert(/^[a-z][a-z0-9_]*$/.test(a.id), a.id);
    for (const k of ['name', 'description', 'icon']) assert(typeof a[k] === 'string' && a[k].length > 0, `${a.id}.${k}`);
    assert(cats.includes(a.category), `${a.id}: category ${a.category}`);
  }
});

test('achievements: every requirement and reward is valid and points at real things', (T) => {
  const ups = new Set(T.UPGRADES.map((u) => u.id));
  const zones = new Set(T.ZONES.map((z) => z.id));
  for (const a of T.ACHIEVEMENTS) {
    const r = a.req;
    assert(REQ_TYPES.includes(r.type), `${a.id}: req.type ${r.type}`);
    if (r.type === 'owned') assert(ups.has(r.upgrade) && Number.isInteger(r.count) && r.count >= 1, a.id);
    if (r.type === 'ownAll') assert(Number.isInteger(r.count) && r.count >= 1, a.id);
    if (r.type === 'zone') assert(zones.has(r.zone), a.id);
    if (r.type === 'stat') assert(STATS.includes(r.stat) && r.amount > 0, a.id);
    if (r.type === 'rate') assert(['perTap', 'perSecond'].includes(r.rate) && r.amount > 0, a.id);
    if (r.type === 'custom') assert.strictEqual(typeof r.test, 'function', a.id);
    if (a.reward) {
      assert(REWARD_TYPES.includes(a.reward.type), `${a.id}: reward ${a.reward.type}`);
      assert(a.reward.pct > 0 && a.reward.pct < 5, `${a.id}: pct`);
      if (a.reward.type === 'perOwned') {
        assert(ups.has(a.reward.upgrade) && ['tap', 'passive'].includes(a.reward.target), a.id);
      }
    }
    if (a.evolves) {
      assert(ups.has(a.evolves.upgrade) && a.evolves.tier >= 1 && a.evolves.name, a.id);
      assert(r.type === 'owned' && r.upgrade === a.evolves.upgrade, `${a.id}: an evolution needs copies of its own upgrade`);
    }
  }
});

test('achievements: every upgrade and every zone after the first has its own', (T) => {
  for (const u of T.UPGRADES) {
    assert(T.ACHIEVEMENTS.some((a) => a.req.type === 'owned' && a.req.upgrade === u.id && a.req.count === 1), `own 1 ${u.id}`);
  }
  for (const z of T.ZONES.slice(1)) assert(T.ACHIEVEMENTS.some((a) => a.req.type === 'zone' && a.req.zone === z.id), z.id);
});

test('evolutions: tiers per upgrade are 1, 2, … in rising rank order', (T) => {
  const byUp = {};
  for (const a of T.ACHIEVEMENTS.filter((x) => x.evolves)) (byUp[a.evolves.upgrade] = byUp[a.evolves.upgrade] || []).push(a);
  assert(Object.keys(byUp).length >= 4, 'several upgrades evolve');
  for (const list of Object.values(byUp)) {
    list.sort((a, b) => a.evolves.tier - b.evolves.tier);
    list.forEach((a, i) => assert.strictEqual(a.evolves.tier, i + 1, a.id));
    for (let i = 1; i < list.length; i++) assert(list[i].req.count > list[i - 1].req.count, list[i].id);
  }
});

// ---- unlocking -----------------------------------------------------------

test('a fresh game has none; buying an upgrade unlocks its first rank once', (T) => {
  const S = T.State;
  const s = S.createState();
  assert.deepStrictEqual(S.checkAchievements(s), []);
  assert.strictEqual(S.achievementCount(s), 0);
  const u = T.UPGRADES[0];
  s.money = S.nextCost(s, u.id);
  assert(S.buy(s, u.id));
  const got = S.checkAchievements(s, 1234).map((a) => a.id);
  assert(got.includes('own_' + u.id + '_1'), got.join());
  assert.strictEqual(s.achievements['own_' + u.id + '_1'], 1234, 'timestamp stored');
  assert.deepStrictEqual(S.checkAchievements(s), [], 'nothing unlocks twice');
});

test('each requirement type unlocks exactly when it is met', (T) => {
  const S = T.State;
  for (const a of T.ACHIEVEMENTS.filter((x) => x.req.type === 'stat')) {
    const s = S.createState();
    s[a.req.stat] = a.req.amount * 0.999;
    assert(!S.checkAchievements(s).some((x) => x.id === a.id), `${a.id} too early`);
    s[a.req.stat] = a.req.amount;
    assert(S.checkAchievements(s).some((x) => x.id === a.id), `${a.id} at the threshold`);
  }
  const z = T.ZONES[1];
  const s = S.createState();
  s.money = z.unlockCost;
  assert(S.unlockZone(s, z.id));
  assert(S.checkAchievements(s).some((x) => x.id === 'zone_' + z.id));
  const all = S.createState();
  for (const zz of T.ZONES) all.zonesUnlocked[zz.id] = true;
  assert(S.checkAchievements(all).some((x) => x.req.type === 'allZones'));
});

test('rate achievements use the real per-tap / per-second numbers', (T) => {
  const S = T.State;
  const a = T.ACHIEVEMENTS.filter((x) => x.req.type === 'rate' && x.req.rate === 'perSecond').sort((x, y) => x.req.amount - y.req.amount)[0];
  const helper = T.UPGRADES.find((u) => u.trashPerSecond > 0);
  const s = S.createState();
  s.upgrades[helper.id] = Math.ceil(a.req.amount / helper.trashPerSecond);
  assert(S.trashPerSecond(s) >= a.req.amount);
  assert(S.checkAchievements(s).some((x) => x.id === a.id));
});

test('a throwing custom test never breaks the check', (T) => {
  const S = T.State;
  T.ACHIEVEMENTS = Object.freeze([{ id: 'boom', name: 'b', description: 'b', icon: 'x', category: 'special', req: { type: 'custom', test: () => { throw new Error('x'); } } }]);
  const s = S.createState();
  assert.deepStrictEqual(S.checkAchievements(s), []);
});

// ---- bonuses -------------------------------------------------------------

test('every achievement adds ACHIEVEMENT_BONUS to all trash, plus its own reward', (T) => {
  const S = T.State;
  const s = S.createState();
  const plain = T.ACHIEVEMENTS.filter((a) => !a.reward).slice(0, 3);
  for (const a of plain) assert(S.unlockAchievement(s, a.id));
  approx(S.bonuses(s).global, 1 + 3 * T.CONFIG.ACHIEVEMENT_BONUS);
  approx(S.trashPerTap(s), T.CONFIG.BASE_TRASH_PER_TAP * (1 + 3 * T.CONFIG.ACHIEVEMENT_BONUS));
  const tapOne = T.ACHIEVEMENTS.find((a) => a.reward && a.reward.type === 'tap');
  S.unlockAchievement(s, tapOne.id);
  const b = S.bonuses(s);
  approx(b.global, 1 + 4 * T.CONFIG.ACHIEVEMENT_BONUS);
  approx(b.tap, 1 + tapOne.reward.pct);
  approx(S.trashPerTap(s), T.CONFIG.BASE_TRASH_PER_TAP * b.tap * b.global);
});

test('Pfand rewards raise the bottle value', (T) => {
  const S = T.State;
  const s = S.createState();
  const before = S.pfandValue(s);
  const p = T.ACHIEVEMENTS.find((a) => a.reward && a.reward.type === 'pfand' && a.req.type === 'stat');
  S.unlockAchievement(s, p.id);
  const g = S.bonuses(s).global;
  approx(S.pfandValue(s), before * g * (1 + p.reward.pct));
});

test('evolutions rename the upgrade and grow with every copy owned', (T) => {
  const S = T.State;
  const evo = T.ACHIEVEMENTS.find((a) => a.evolves && a.evolves.tier === 1 && a.reward.target === 'tap');
  const id = evo.evolves.upgrade;
  const u = S.getUpgrade(id);
  const s = S.createState();
  s.upgrades[id] = evo.req.count - 1;
  S.checkAchievements(s);
  assert.strictEqual(S.upgradeName(s, id), u.name);
  assert.strictEqual(S.evolutionTier(s, id), 0);
  s.upgrades[id] = evo.req.count;
  assert(S.checkAchievements(s).some((a) => a.id === evo.id));
  assert.strictEqual(S.upgradeName(s, id), evo.evolves.name);
  assert.strictEqual(S.evolutionTier(s, id), 1);
  const tapAt = S.bonuses(s).tap;
  s.upgrades[id] += 10;
  approx(S.bonuses(s).tap - tapAt, 10 * evo.reward.pct, 'each extra copy adds pct');
});

test('bonuses update when achievements unlock (no stale cache)', (T) => {
  const S = T.State;
  const s = S.createState();
  const r0 = S.trashPerTap(s);
  S.unlockAchievement(s, T.ACHIEVEMENTS[0].id);
  assert(S.trashPerTap(s) > r0);
  const r1 = S.trashPerTap(s);
  s.taps = 1e9; // taps achievements give +tap
  S.checkAchievements(s);
  assert(S.trashPerTap(s) > r1);
  assert.strictEqual(S.unlockAchievement(s, 'not_a_real_achievement'), false);
  assert.strictEqual(S.unlockAchievement(s, T.ACHIEVEMENTS[0].id), false, 'already unlocked');
});

test('random play: achievements only ever accumulate and bonuses stay sane', (T) => {
  const S = T.State;
  const rng = seeded(7);
  const s = S.createState();
  let count = 0;
  for (let i = 0; i < 4000; i++) {
    const r = rng();
    if (r < 0.6) S.tap(s, rng);
    else if (r < 0.8) S.tick(s, rng() * 5);
    else if (r < 0.95) {
      const u = T.UPGRADES[Math.floor(rng() * T.UPGRADES.length)];
      S.buy(s, u.id);
    } else {
      const z = S.nextZone(s);
      if (z) S.unlockZone(s, z.id);
    }
    S.checkAchievements(s);
    const n = S.achievementCount(s);
    assert(n >= count, 'never re-locks');
    count = n;
    const b = S.bonuses(s);
    for (const k of ['global', 'tap', 'passive', 'pfand']) assert(Number.isFinite(b[k]) && b[k] >= 1, `${k} ${b[k]}`);
  }
  assert(count > 5, `played long enough to earn some (${count})`);
});

// ---- saving --------------------------------------------------------------

test('achievements survive save/load; junk is dropped', (T) => {
  const S = T.State;
  const store = memoryStore();
  const s = S.createState();
  const [a, b] = T.ACHIEVEMENTS;
  S.unlockAchievement(s, a.id, 111);
  S.unlockAchievement(s, b.id, 222);
  assert(T.Save.save(s, store));
  const loaded = T.Save.load(store);
  assert.deepStrictEqual(loaded.achievements, { [a.id]: 111, [b.id]: 222 });
  approx(S.trashPerTap(loaded), S.trashPerTap(s));

  const raw = JSON.parse(store.getItem(T.Save.SAVE_KEY));
  raw.state.achievements = JSON.parse(`{"${a.id}": "yes", "${b.id}": -5, "gone_away": 5, "constructor": 1, "__proto__": {"x": 1}}`);
  store.setItem(T.Save.SAVE_KEY, JSON.stringify(raw));
  assert.deepStrictEqual(T.Save.load(store).achievements, {});
});

test('a save from before achievements loads with none, then earns them on check', (T) => {
  const S = T.State;
  const store = memoryStore();
  const id = T.UPGRADES[0].id;
  store.setItem(T.Save.SAVE_KEY, JSON.stringify({ version: T.Save.SAVE_VERSION, state: { trash: 5000, taps: 2000, upgrades: { [id]: 12 } } }));
  const s = T.Save.load(store);
  assert.deepStrictEqual(s.achievements, {});
  const got = S.checkAchievements(s).map((a) => a.id);
  assert(got.includes('own_' + id + '_10') && got.includes('own_' + id + '_1'), got.join());
});
