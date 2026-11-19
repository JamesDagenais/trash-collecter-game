/*
 * Save migration, multi-tab safety, backups and away progress.
 * v1 prices are a historical fact (Phase 1), so they're spelled out here.
 */
'use strict';
const assert = require('assert');
const { test, memoryStore, approx } = require('./lib/harness');

const V1_COSTS = {
  broom: 15, helpful_neighbour: 60, garbage_bags: 200, pfand_collector: 750, work_gloves: 2000,
  cargo_bike: 6000, handcart: 15000, kiez_crew: 40000, leaf_blower: 120000, sweeper_truck: 400000, recycling_yard: 1500000,
};
const v1Spent = (base, n) => {
  let t = 0;
  for (let k = 0; k < n; k++) t += Math.ceil(base * Math.pow(1.15, k));
  return t;
};
const writeRaw = (T, store, state, version) => store.setItem(T.Save.SAVE_KEY, JSON.stringify({ version, state }));

// ---- v1 -> v2 ------------------------------------------------------------

test('v1 -> v2 refunds every v1 upgrade and zone at v1 prices and resets them', (T) => {
  const store = memoryStore();
  const counts = { broom: 10, helpful_neighbour: 8, garbage_bags: 5, pfand_collector: 4, work_gloves: 2, cargo_bike: 3, handcart: 2, kiez_crew: 1, leaf_blower: 1, sweeper_truck: 1, recycling_yard: 1 };
  writeRaw(T, store, { money: 1000, trash: 5e6, totalMoneyEarned: 5e6, upgrades: counts, zone: 'warschauer_str', zonesUnlocked: { your_kiez: true, warschauer_str: true } }, 1);
  const s = T.Save.load(store);
  let refund = 5000; // the old Warschauer Straße unlock
  for (const [id, n] of Object.entries(counts)) refund += v1Spent(V1_COSTS[id], n);
  assert.strictEqual(s.money, 1000 + refund);
  for (const u of T.UPGRADES) assert.strictEqual(s.upgrades[u.id], 0, u.id);
  assert.strictEqual(s.zone, T.ZONES[0].id);
  assert.deepStrictEqual(s.zonesUnlocked, { [T.ZONES[0].id]: true });
  assert.strictEqual(s.trash, 5e6, 'lifetime trash is kept');
  assert.strictEqual(T.State.trashPerSecond(s), 0, 'no windfall income from re-priced upgrades');
});

test('v1 migration ignores hostile counts and inherited keys', (T) => {
  const store = memoryStore();
  const upgrades = JSON.parse('{"broom": -4, "cargo_bike": "9", "__proto__": {"broom": 99}, "handcart": 1e9}');
  writeRaw(T, store, { money: 0, upgrades, zonesUnlocked: { constructor: true } }, 1);
  const s = T.Save.load(store);
  assert(Number.isFinite(s.money) && s.money > 0, 'handcart refund is capped, finite');
  assert.strictEqual(s.money, v1Spent(15000, 500), 'refunds at most 500 copies');
});

test('a current-version save is not migrated', (T) => {
  const store = memoryStore();
  const id = T.UPGRADES[0].id;
  writeRaw(T, store, { money: 7, upgrades: { [id]: 4 } }, T.Save.SAVE_VERSION);
  const s = T.Save.load(store);
  assert.strictEqual(s.money, 7);
  assert.strictEqual(s.upgrades[id], 4);
});

// ---- backups -------------------------------------------------------------

test('a corrupt save is backed up before a fresh game can overwrite it', (T) => {
  const store = memoryStore();
  store.setItem(T.Save.SAVE_KEY, '{"version":2,"state":{"money":12');
  const s = T.Save.load(store);
  assert.strictEqual(s.money, 0);
  assert.strictEqual(store.getItem(T.Save.BACKUP_KEY), '{"version":2,"state":{"money":12');
});

test('saves from a newer or unknown version are backed up and not migrated', (T) => {
  for (const version of [T.Save.SAVE_VERSION + 1, 'two', undefined]) {
    const store = memoryStore();
    const z = T.ZONES[T.ZONES.length - 1].id;
    const text = JSON.stringify({ version, state: { money: 50, zonesUnlocked: { [z]: true } } });
    store.setItem(T.Save.SAVE_KEY, text);
    const s = T.Save.load(store);
    assert.strictEqual(store.getItem(T.Save.BACKUP_KEY), text, `version ${version} backed up`);
    assert.strictEqual(s.money, 50, `version ${version}: no v1 refund applied`);
    assert.strictEqual(s.zonesUnlocked[z], true, `version ${version}: zones not stripped`);
  }
});

test('huge values are clamped to sane, finite numbers', (T) => {
  const store = memoryStore();
  const id = T.UPGRADES[0].id;
  writeRaw(T, store, { money: 1e308, upgrades: { [id]: 1e300 } }, T.Save.SAVE_VERSION);
  const s = T.Save.load(store);
  assert(s.money <= 1e300);
  assert.strictEqual(s.upgrades[id], T.CONFIG.MAX_OWNED);
  assert(Number.isFinite(T.State.trashPerTap(s)));
  s.money = 1e300;
  assert.strictEqual(T.State.buy(s, id), false, 'cannot buy past MAX_OWNED');
});

// ---- multiple tabs -------------------------------------------------------

test('a stale tab cannot overwrite newer progress from another tab', (T) => {
  const store = memoryStore();
  const tabA = T.Save.load(store);
  const tabB = T.Save.load(store);
  tabB.money = 123456;
  assert(T.Save.save(tabB, store));
  tabA.money = 1; // older tab tries to save on close
  assert.strictEqual(T.Save.save(tabA, store), false);
  assert.strictEqual(T.Save.lastResult, 'stale');
  assert.strictEqual(T.Save.load(store).money, 123456);
});

test('after a Reset, a stale tab cannot bring the old game back', (T) => {
  const store = memoryStore();
  const old = T.Save.load(store);
  old.money = 777;
  assert(T.Save.save(old, store));
  const staleTab = T.Save.load(store);
  // Reset in another tab: a fresh state that takes over the stored revision
  const fresh = T.State.createState();
  fresh.saveRev = T.Save.storedRev(store);
  assert(T.Save.save(fresh, store));
  assert.strictEqual(T.Save.save(staleTab, store), false);
  assert.strictEqual(T.Save.load(store).money, 0);
});

test('one tab saving repeatedly keeps working and bumps the revision', (T) => {
  const store = memoryStore();
  const s = T.Save.load(store);
  for (let i = 1; i <= 5; i++) {
    assert(T.Save.save(s, store));
    assert.strictEqual(T.Save.storedRev(store), i);
  }
  assert.strictEqual(T.Save.lastResult, 'ok');
});

// ---- away progress -------------------------------------------------------

test('awayProgress credits OFFLINE_RATE of passive income, capped', (T) => {
  const S = T.State;
  const s = S.createState();
  const auto = T.UPGRADES.find((u) => u.trashPerSecond > 0);
  s.upgrades[auto.id] = 3;
  const rate = S.trashPerSecond(s);
  const r = S.awayProgress(s, 600);
  approx(r.trash, rate * 600 * T.CONFIG.OFFLINE_RATE);
  approx(s.money, r.money);
  assert.strictEqual(r.seconds, 600);
  const capped = S.awayProgress(S.createState(), 1e9);
  assert.strictEqual(capped.seconds, T.CONFIG.OFFLINE_MAX_SECONDS);
  const s2 = S.createState();
  s2.upgrades[auto.id] = 1;
  const r2 = S.awayProgress(s2, 1e9);
  approx(r2.trash, S.trashPerSecond(s2) * T.CONFIG.OFFLINE_MAX_SECONDS * T.CONFIG.OFFLINE_RATE);
});

test('awayProgress ignores bad durations and gives nothing without helpers', (T) => {
  const S = T.State;
  for (const sec of [-5, 0, NaN, Infinity, undefined]) {
    const s = S.createState();
    s.upgrades[T.UPGRADES.find((u) => u.trashPerSecond > 0).id] = 1;
    const r = S.awayProgress(s, sec);
    assert.strictEqual(r.money, 0, `seconds=${sec}`);
  }
  const r = S.awayProgress(S.createState(), 3600);
  assert.strictEqual(r.money, 0);
  assert.strictEqual(r.trash, 0);
});
