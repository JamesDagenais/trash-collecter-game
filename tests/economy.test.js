/*
 * Economy math: costs, buying, income, tap/tick, Pfand and zones.
 * Expectations are computed independently from the data, never hard-coded.
 */
'use strict';
const assert = require('assert');
const { test, skip, approx, enterZone, growthOf } = require('./lib/harness');

const ALWAYS = () => 0; // rng: always finds a Pfand bottle (if the zone has any chance)
const NEVER = () => 0.999999; // rng: never finds one (unless pfandChance is ~1)

const firstTap = (T) => T.UPGRADES.find((u) => u.trashPerTap > 0);
const firstPassive = (T) => T.UPGRADES.find((u) => u.trashPerSecond > 0);
const expectedCost = (T, u, n) => Math.ceil(u.baseCost * Math.pow(growthOf(T, u), n));

// ---- cost -------------------------------------------------------------------

test('upgradeCost = ceil(baseCost * growth^n) for every upgrade, n = 0..150', (T) => {
  for (const u of T.UPGRADES) {
    for (let n = 0; n <= 150; n++) {
      assert.strictEqual(T.State.upgradeCost(u, n), expectedCost(T, u, n), `${u.id} at n=${n}`);
    }
  }
});

test('costs are whole euros, rounded UP, and never below the exact price', (T) => {
  for (const u of T.UPGRADES) {
    for (let n = 0; n <= 60; n++) {
      const exact = u.baseCost * Math.pow(growthOf(T, u), n);
      const c = T.State.upgradeCost(u, n);
      assert(Number.isInteger(c), `${u.id} n=${n}: ${c} is not an integer`);
      assert(c >= exact && c - exact < 1, `${u.id} n=${n}: ${c} is not ceil(${exact})`);
    }
  }
});

test('the first copy costs ceil(baseCost)', (T) => {
  for (const u of T.UPGRADES) assert.strictEqual(T.State.upgradeCost(u, 0), Math.ceil(u.baseCost), u.id);
});

test('costs strictly increase with every copy owned', (T) => {
  for (const u of T.UPGRADES) {
    let prev = -Infinity;
    for (let n = 0; n <= 150; n++) {
      const c = T.State.upgradeCost(u, n);
      assert(c > prev, `${u.id}: copy ${n + 1} costs ${c}, not more than copy ${n} (${prev})`);
      prev = c;
    }
  }
});

test('nextCost(state, id) follows the owned count; unknown id is Infinity', (T) => {
  const s = T.State.createState();
  for (const u of T.UPGRADES) {
    for (const n of [0, 1, 7, 33]) {
      s.upgrades[u.id] = n;
      assert.strictEqual(T.State.nextCost(s, u.id), expectedCost(T, u, n), `${u.id} owned=${n}`);
    }
  }
  assert.strictEqual(T.State.nextCost(s, 'definitely_not_an_upgrade'), Infinity);
});

test('buying deducts exactly nextCost and adds one copy, many times in a row', (T) => {
  const S = T.State;
  for (const u of T.UPGRADES) {
    const s = S.createState();
    let spent = 0;
    s.money = 0;
    for (let n = 0; n < 25; n++) {
      const cost = S.nextCost(s, u.id);
      assert.strictEqual(cost, expectedCost(T, u, n));
      s.money += cost; // exactly enough
      spent += cost;
      const before = s.money;
      assert(S.buy(s, u.id), `${u.id}: buy #${n + 1} with exactly enough money failed`);
      assert.strictEqual(s.money, before - cost, `${u.id}: money after buy #${n + 1}`);
      assert.strictEqual(S.owned(s, u.id), n + 1);
    }
    assert.strictEqual(s.money, 0, `${u.id}: should have spent exactly what was added (${spent})`);
  }
});

test('cannot buy with money = cost - 0.01, can buy at exactly cost', (T) => {
  const S = T.State;
  for (const u of T.UPGRADES) {
    const s = S.createState();
    const cost = S.nextCost(s, u.id);
    s.money = cost - 0.01;
    assert.strictEqual(S.canAfford(s, u.id), false, `${u.id}: canAfford at cost - 0.01`);
    assert.strictEqual(S.buy(s, u.id), false, `${u.id}: buy at cost - 0.01`);
    assert.strictEqual(s.money, cost - 0.01, `${u.id}: money changed on a failed buy`);
    assert.strictEqual(S.owned(s, u.id), 0);
    s.money = cost;
    assert.strictEqual(S.canAfford(s, u.id), true, `${u.id}: canAfford at exactly cost`);
    assert.strictEqual(S.buy(s, u.id), true, `${u.id}: buy at exactly cost`);
    assert.strictEqual(s.money, 0);
    assert.strictEqual(S.owned(s, u.id), 1);
  }
});

test('a fresh game cannot buy anything', (T) => {
  const s = T.State.createState();
  for (const u of T.UPGRADES) {
    assert.strictEqual(T.State.buy(s, u.id), false, u.id);
    assert.strictEqual(s.upgrades[u.id], 0);
  }
});

test('unknown upgrade ids cannot be bought and change nothing', (T) => {
  const s = T.State.createState();
  s.money = 1e15;
  const before = JSON.stringify(s);
  for (const id of ['nope', '', undefined, '__proto__', 'constructor', 'toString']) {
    assert.strictEqual(T.State.buy(s, id), false, String(id));
    assert.strictEqual(T.State.canAfford(s, id), false, String(id));
  }
  assert.strictEqual(JSON.stringify(s), before);
});

test('buying does not change trash or totalMoneyEarned', (T) => {
  const s = T.State.createState();
  s.money = 1e9;
  s.totalMoneyEarned = 1e9;
  s.trash = 42;
  for (const u of T.UPGRADES) T.State.buy(s, u.id);
  assert(s.money < 1e9);
  assert.strictEqual(s.totalMoneyEarned, 1e9);
  assert.strictEqual(s.trash, 42);
});

// ---- income -----------------------------------------------------------------

function randomOwned(T, s, seed) {
  let x = seed;
  for (const u of T.UPGRADES) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s.upgrades[u.id] = x % 13;
  }
}

test('trashPerTap = (BASE + sum trashPerTap*owned) * zone multiplier, in every zone', (T) => {
  const S = T.State;
  for (let seed = 1; seed <= 20; seed++) {
    const s = S.createState();
    randomOwned(T, s, seed);
    const raw = T.CONFIG.BASE_TRASH_PER_TAP + T.UPGRADES.reduce((a, u) => a + u.trashPerTap * s.upgrades[u.id], 0);
    for (const z of T.ZONES) {
      enterZone(s, z);
      approx(S.trashPerTap(s), raw * z.trashMultiplier, `seed ${seed}, zone ${z.id}`);
    }
  }
});

test('trashPerSecond = (sum trashPerSecond*owned) * zone multiplier, no base', (T) => {
  const S = T.State;
  const fresh = S.createState();
  for (const z of T.ZONES) {
    enterZone(fresh, z);
    assert.strictEqual(S.trashPerSecond(fresh), 0, `a fresh game has no passive income (zone ${z.id})`);
  }
  for (let seed = 1; seed <= 20; seed++) {
    const s = S.createState();
    randomOwned(T, s, seed);
    const raw = T.UPGRADES.reduce((a, u) => a + u.trashPerSecond * s.upgrades[u.id], 0);
    for (const z of T.ZONES) {
      enterZone(s, z);
      approx(S.trashPerSecond(s), raw * z.trashMultiplier, `seed ${seed}, zone ${z.id}`);
    }
  }
});

test('each upgrade adds exactly its own effect per copy', (T) => {
  const S = T.State;
  for (const u of T.UPGRADES) {
    const s = S.createState();
    const tap0 = S.trashPerTap(s);
    const sec0 = S.trashPerSecond(s);
    s.upgrades[u.id] = 3;
    const m = S.currentZone(s).trashMultiplier;
    approx(S.trashPerTap(s) - tap0, 3 * u.trashPerTap * m, `${u.id} per tap`);
    approx(S.trashPerSecond(s) - sec0, 3 * u.trashPerSecond * m, `${u.id} per second`);
  }
});

test('tick(dt) adds rate*dt trash and rate*dt*MONEY_PER_TRASH money', (T) => {
  const S = T.State;
  const s = S.createState();
  randomOwned(T, s, 7);
  const auto = firstPassive(T);
  s.upgrades[auto.id] = Math.max(1, s.upgrades[auto.id]);
  let trash = 0;
  for (const dt of [0.016, 1, 2.5, 10, 0.001]) {
    const rate = S.trashPerSecond(s);
    const m0 = s.money;
    const e0 = s.totalMoneyEarned;
    const got = S.tick(s, dt);
    trash += rate * dt;
    approx(got, rate * dt, `tick(${dt}) return value`);
    approx(s.trash, trash, `trash after tick(${dt})`);
    approx(s.money - m0, rate * dt * T.CONFIG.MONEY_PER_TRASH, `money from tick(${dt})`);
    approx(s.totalMoneyEarned - e0, rate * dt * T.CONFIG.MONEY_PER_TRASH, `totalMoneyEarned from tick(${dt})`);
  }
});

test('tick applies the zone multiplier', (T) => {
  const S = T.State;
  const auto = firstPassive(T);
  for (const z of T.ZONES) {
    const s = S.createState();
    s.upgrades[auto.id] = 2;
    enterZone(s, z);
    S.tick(s, 4);
    approx(s.trash, auto.trashPerSecond * 2 * 4 * z.trashMultiplier, `zone ${z.id}`);
  }
});

test('tick ignores negative, NaN, zero, undefined and -Infinity', (T) => {
  const S = T.State;
  const s = S.createState();
  s.upgrades[firstPassive(T).id] = 5;
  const before = JSON.stringify(s);
  for (const dt of [-5, -0.001, NaN, 0, -0, undefined, null, -Infinity]) {
    const r = S.tick(s, dt);
    assert(r === 0 || r === undefined, `tick(${String(dt)}) returned ${r}`);
    assert.strictEqual(JSON.stringify(s), before, `tick(${String(dt)}) changed state`);
  }
});

test('tick with no passive income collects nothing', (T) => {
  const s = T.State.createState();
  assert.strictEqual(T.State.tick(s, 100), 0);
  assert.strictEqual(s.trash, 0);
  assert.strictEqual(s.money, 0);
});

test('totalMoneyEarned tracks all income and is not reduced by purchases', (T) => {
  const S = T.State;
  const s = S.createState();
  let earned = 0;
  for (let i = 0; i < 500; i++) {
    const m0 = s.money;
    S.tap(s, NEVER);
    earned += s.money - m0;
  }
  const u = T.UPGRADES[0];
  while (S.canAfford(s, u.id)) S.buy(s, u.id);
  for (let i = 0; i < 50; i++) {
    const m0 = s.money;
    S.tick(s, 1);
    S.tap(s, ALWAYS);
    earned += s.money - m0;
  }
  approx(s.totalMoneyEarned, earned, 'totalMoneyEarned');
  assert(s.totalMoneyEarned >= s.money);
});

// ---- tap & Pfand --------------------------------------------------------------

test('tap returns { trash, money, pfand } and updates trash, money, taps', (T) => {
  const S = T.State;
  const s = S.createState();
  randomOwned(T, s, 3);
  for (let i = 1; i <= 5; i++) {
    const per = S.trashPerTap(s);
    const t0 = s.trash;
    const m0 = s.money;
    const r = S.tap(s, NEVER);
    for (const k of ['trash', 'money', 'pfand']) assert(typeof r[k] === 'number' && Number.isFinite(r[k]), `result.${k} must be a finite number`);
    approx(r.trash, per, 'result.trash = trashPerTap');
    approx(r.money, per * T.CONFIG.MONEY_PER_TRASH, 'result.money = trash * MONEY_PER_TRASH');
    assert.strictEqual(r.pfand, 0);
    approx(s.trash - t0, per, 'trash added');
    approx(s.money - m0, r.money, 'money added');
    assert.strictEqual(s.taps, i);
  }
});

test('a fresh tap earns BASE_TRASH_PER_TAP * MONEY_PER_TRASH', (T) => {
  const s = T.State.createState();
  T.State.tap(s, NEVER);
  T.State.tap(s, NEVER);
  assert.strictEqual(s.taps, 2);
  approx(s.trash, 2 * T.CONFIG.BASE_TRASH_PER_TAP * T.ZONES[0].trashMultiplier);
  approx(s.money, 2 * T.CONFIG.BASE_TRASH_PER_TAP * T.ZONES[0].trashMultiplier * T.CONFIG.MONEY_PER_TRASH);
});

test('tap uses Math.random when no rng is given', (T) => {
  const s = T.State.createState();
  const r = T.State.tap(s);
  assert(r && typeof r.pfand === 'number');
});

test('rng = () => 0 always finds a Pfand bottle worth pfandValue(state) > 0', (T) => {
  const S = T.State;
  const zones = T.ZONES.filter((z) => z.pfandChance > 0);
  if (!zones.length) skip('no zone has pfandChance > 0');
  for (const z of zones) {
    const s = S.createState();
    randomOwned(T, s, 11);
    enterZone(s, z);
    let bottles = 0;
    let pfandMoney = 0;
    for (let i = 0; i < 20; i++) {
      const before = S.pfandValue(s);
      const m0 = s.money;
      const e0 = s.totalMoneyEarned;
      const r = S.tap(s, ALWAYS);
      const after = S.pfandValue(s);
      assert(r.pfand > 0, `zone ${z.id}: no Pfand with rng=0`);
      // pfandValue may be evaluated before or after the tap's own income.
      assert(r.pfand === before || r.pfand === after, `zone ${z.id}: pfand ${r.pfand} != pfandValue ${before}/${after}`);
      bottles++;
      pfandMoney += r.pfand;
      approx(s.money - m0, r.money + r.pfand, 'money gets trash money + Pfand');
      approx(s.totalMoneyEarned - e0, r.money + r.pfand, 'totalMoneyEarned gets trash money + Pfand');
      assert.strictEqual(s.pfandBottles, bottles);
      approx(s.pfandMoney, pfandMoney, 'pfandMoney');
    }
  }
});

test('pfandValue(state) is positive and finite for a fresh game', (T) => {
  const v = T.State.pfandValue(T.State.createState());
  assert(Number.isFinite(v) && v > 0, `pfandValue = ${v}`);
});

test('rng near 1 never finds a Pfand bottle', (T) => {
  const S = T.State;
  for (const z of T.ZONES.filter((zz) => zz.pfandChance < 0.999999)) {
    const s = S.createState();
    enterZone(s, z);
    for (let i = 0; i < 200; i++) assert.strictEqual(S.tap(s, NEVER).pfand, 0, `zone ${z.id}`);
    assert.strictEqual(s.pfandBottles, 0);
    assert.strictEqual(s.pfandMoney, 0);
    approx(s.totalMoneyEarned, s.money);
  }
});

test('Pfand chance is strict: rng() === pfandChance does NOT find a bottle', (T) => {
  const S = T.State;
  for (const z of T.ZONES) {
    const s = S.createState();
    enterZone(s, z);
    assert.strictEqual(S.tap(s, () => z.pfandChance).pfand, 0, `zone ${z.id}: rng = pfandChance (${z.pfandChance})`);
    if (z.pfandChance > 0) {
      const below = z.pfandChance * (1 - 1e-12);
      assert(S.tap(s, () => below).pfand > 0, `zone ${z.id}: rng just below pfandChance should find a bottle`);
    }
  }
});

test('Pfand frequency matches pfandChance with a seeded rng', (T) => {
  const { seeded } = require('./lib/harness');
  const S = T.State;
  for (const z of T.ZONES) {
    const s = S.createState();
    enterZone(s, z);
    const rng = seeded(1234);
    const N = 20000;
    for (let i = 0; i < N; i++) S.tap(s, rng);
    const p = z.pfandChance;
    const sd = Math.sqrt((N * p * (1 - p)) || 1);
    assert(Math.abs(s.pfandBottles - N * p) <= 5 * sd + 1, `zone ${z.id}: ${s.pfandBottles} bottles in ${N} taps, expected ~${N * p}`);
  }
});

// ---- zones ------------------------------------------------------------------

function needZones(T, n) {
  if (T.ZONES.length < n) skip(`needs at least ${n} zones`);
}

test('a new game starts in ZONES[0] with only that zone unlocked', (T) => {
  const S = T.State;
  const s = S.createState();
  assert.strictEqual(S.currentZone(s), T.ZONES[0]);
  T.ZONES.forEach((z, i) => assert.strictEqual(S.isZoneUnlocked(s, z.id), i === 0, z.id));
  assert.strictEqual(S.nextZone(s), T.ZONES[1] || null);
});

test('unlocking needs enough money: cost - 0.01 fails, exactly cost works', (T) => {
  needZones(T, 2);
  const S = T.State;
  const z = T.ZONES[1];
  const s = S.createState();
  s.money = z.unlockCost - 0.01;
  assert.strictEqual(S.canUnlockZone(s, z.id), false);
  assert.strictEqual(S.unlockZone(s, z.id), false);
  assert.strictEqual(s.money, z.unlockCost - 0.01);
  assert.strictEqual(S.isZoneUnlocked(s, z.id), false);
  assert.strictEqual(s.zone, T.ZONES[0].id);
  s.money = z.unlockCost;
  assert.strictEqual(S.canUnlockZone(s, z.id), true);
  assert.strictEqual(S.unlockZone(s, z.id), true);
  assert.strictEqual(s.money, 0, 'unlockCost deducted exactly');
  assert.strictEqual(S.isZoneUnlocked(s, z.id), true);
  assert.strictEqual(s.zone, z.id, 'unlocking moves you there');
  assert.strictEqual(S.currentZone(s), z);
});

test('only the NEXT zone can be unlocked, in order, each exactly once', (T) => {
  needZones(T, 2);
  const S = T.State;
  const s = S.createState();
  s.money = 1e300;
  for (let i = 1; i < T.ZONES.length; i++) {
    assert.strictEqual(S.nextZone(s), T.ZONES[i]);
    for (let j = i + 1; j < T.ZONES.length; j++) {
      assert.strictEqual(S.canUnlockZone(s, T.ZONES[j].id), false, `${T.ZONES[j].id} skips ahead`);
      assert.strictEqual(S.unlockZone(s, T.ZONES[j].id), false, `${T.ZONES[j].id} skips ahead`);
      assert.strictEqual(S.isZoneUnlocked(s, T.ZONES[j].id), false);
    }
    for (let j = 0; j < i; j++) assert.strictEqual(S.unlockZone(s, T.ZONES[j].id), false, `${T.ZONES[j].id} already unlocked`);
    const m0 = s.money;
    assert.strictEqual(S.unlockZone(s, T.ZONES[i].id), true, `unlock ${T.ZONES[i].id}`);
    assert.strictEqual(s.money, m0 - T.ZONES[i].unlockCost);
    assert.strictEqual(s.zone, T.ZONES[i].id);
  }
  assert.strictEqual(S.nextZone(s), null, 'all zones unlocked');
  for (const z of T.ZONES) assert.strictEqual(S.canUnlockZone(s, z.id), false);
});

test('unknown zone ids are rejected everywhere', (T) => {
  const S = T.State;
  const s = S.createState();
  s.money = 1e300;
  const before = JSON.stringify(s);
  for (const id of ['nope', '', undefined, null, '__proto__', 'constructor', 'toString']) {
    assert.strictEqual(S.canUnlockZone(s, id), false, `canUnlockZone(${String(id)})`);
    assert.strictEqual(S.unlockZone(s, id), false, `unlockZone(${String(id)})`);
    assert.strictEqual(S.travelTo(s, id), false, `travelTo(${String(id)})`);
    assert.strictEqual(S.isZoneUnlocked(s, id), false, `isZoneUnlocked(${String(id)})`);
  }
  assert.strictEqual(JSON.stringify(s), before);
});

test('travelTo only goes to unlocked zones, is free, and changes the multiplier', (T) => {
  needZones(T, 2);
  const S = T.State;
  const s = S.createState();
  s.upgrades[firstTap(T).id] = 3;
  s.upgrades[firstPassive(T).id] = 2;
  const [z0, z1] = T.ZONES;
  assert.strictEqual(S.travelTo(s, z1.id), false, 'locked zone');
  assert.strictEqual(s.zone, z0.id);
  s.money = z1.unlockCost + 100;
  assert(S.unlockZone(s, z1.id));
  const tapIn1 = S.trashPerTap(s);
  const secIn1 = S.trashPerSecond(s);
  const m = s.money;
  assert.strictEqual(S.travelTo(s, z0.id), true);
  assert.strictEqual(s.zone, z0.id);
  assert.strictEqual(s.money, m, 'travel is free');
  approx(tapIn1 / S.trashPerTap(s), z1.trashMultiplier / z0.trashMultiplier, 'per-tap ratio = multiplier ratio');
  approx(secIn1 / S.trashPerSecond(s), z1.trashMultiplier / z0.trashMultiplier, 'per-second ratio = multiplier ratio');
  assert.strictEqual(S.travelTo(s, z1.id), true);
  approx(S.trashPerTap(s), tapIn1);
  assert.strictEqual(S.isZoneUnlocked(s, z1.id), true, 'still unlocked after travel');
  if (T.ZONES[2]) assert.strictEqual(S.travelTo(s, T.ZONES[2].id), false, 'next locked zone');
});

test('unlocking keeps upgrades and stats', (T) => {
  needZones(T, 2);
  const S = T.State;
  const s = S.createState();
  s.upgrades[T.UPGRADES[0].id] = 4;
  s.trash = 77;
  s.taps = 9;
  s.money = T.ZONES[1].unlockCost;
  s.totalMoneyEarned = s.money;
  assert(S.unlockZone(s, T.ZONES[1].id));
  assert.strictEqual(s.upgrades[T.UPGRADES[0].id], 4);
  assert.strictEqual(s.trash, 77);
  assert.strictEqual(s.taps, 9);
  assert.strictEqual(s.totalMoneyEarned, T.ZONES[1].unlockCost, 'unlocking is not income, and is not subtracted');
});

// ---- current tool -------------------------------------------------------------

test('currentTool: bare pick at start, then the best tap upgrade owned', (T) => {
  const S = T.State;
  const s = S.createState();
  const pick = S.currentTool(s);
  assert(pick && typeof pick.name === 'string' && typeof pick.icon === 'string', 'tool has a name and icon');
  assert(!T.UPGRADES.includes(pick), 'a fresh game uses the starting tool, not an upgrade');
  const taps = T.UPGRADES.filter((u) => u.trashPerTap > 0);
  for (const u of T.UPGRADES.filter((x) => !(x.trashPerTap > 0))) s.upgrades[u.id] = 1;
  assert(!T.UPGRADES.filter((u) => u.trashPerTap > 0).includes(S.currentTool(s)), 'passive helpers are not tools');
  for (const u of taps) {
    s.upgrades[u.id] = 1;
    assert.strictEqual(S.currentTool(s), u, `after owning ${u.id}`);
  }
});

// ---- property test ------------------------------------------------------------

test('property: 10,000 seeded random actions keep every invariant', (T) => {
  const { seeded } = require('./lib/harness');
  const S = T.State;
  const rng = seeded(20261119);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const s = S.createState();
  const counts = { tap: 0, tick: 0, buy: 0, bought: 0, unlock: 0, unlocked: 0, travel: 0, travelled: 0 };
  let lastTrash = s.trash;

  for (let step = 0; step < 10000; step++) {
    const r = rng();
    let action;
    if (r < 0.45) {
      action = 'tap';
      const res = S.tap(s, rng);
      assert(res.trash >= 0 && res.money >= 0 && res.pfand >= 0, `step ${step}: negative tap result`);
    } else if (r < 0.65) {
      action = 'tick';
      const dt = pick([rng() * 0.05, rng() * 5, rng() * 120, -rng(), NaN, 0]);
      S.tick(s, dt);
    } else if (r < 0.85) {
      action = 'buy';
      // Prefer the most expensive affordable upgrade half the time so the run progresses.
      const affordable = T.UPGRADES.filter((u) => S.canAfford(s, u.id));
      const u = rng() < 0.5 && affordable.length ? affordable[affordable.length - 1] : pick(T.UPGRADES);
      const id = rng() < 0.03 ? 'not_a_real_upgrade' : u.id;
      const cost = S.nextCost(s, id);
      const n0 = S.owned(s, id);
      const m0 = s.money;
      const ok = S.buy(s, id);
      assert.strictEqual(ok, m0 >= cost, `step ${step}: buy(${id}) with ${m0} for ${cost} returned ${ok}`);
      if (ok) {
        counts.bought++;
        assert.strictEqual(s.money, m0 - cost, `step ${step}: buy deducted the wrong amount`);
        assert.strictEqual(S.owned(s, id), n0 + 1);
      } else {
        assert.strictEqual(s.money, m0);
      }
    } else if (r < 0.93) {
      action = 'unlock';
      const z = rng() < 0.7 ? S.nextZone(s) || pick(T.ZONES) : pick(T.ZONES);
      const m0 = s.money;
      const expectOk = S.nextZone(s) === z && m0 >= z.unlockCost;
      const ok = S.unlockZone(s, z.id);
      assert.strictEqual(ok, expectOk, `step ${step}: unlockZone(${z.id})`);
      if (ok) {
        counts.unlocked++;
        assert.strictEqual(s.money, m0 - z.unlockCost);
        assert.strictEqual(s.zone, z.id);
      } else assert.strictEqual(s.money, m0);
    } else {
      action = 'travel';
      const z = pick(T.ZONES);
      const wasUnlocked = S.isZoneUnlocked(s, z.id);
      const z0 = s.zone;
      const m0 = s.money;
      const ok = S.travelTo(s, z.id);
      assert.strictEqual(ok, wasUnlocked, `step ${step}: travelTo(${z.id})`);
      assert.strictEqual(s.zone, ok ? z.id : z0);
      assert.strictEqual(s.money, m0, 'travel is free');
      if (ok) counts.travelled++;
    }
    counts[action]++;

    // invariants
    const at = `step ${step} (${action})`;
    assert(Number.isFinite(s.money) && s.money >= 0, `${at}: money = ${s.money}`);
    assert(Number.isFinite(s.trash) && s.trash >= lastTrash, `${at}: trash went ${lastTrash} -> ${s.trash}`);
    lastTrash = s.trash;
    for (const u of T.UPGRADES) {
      const n = s.upgrades[u.id];
      assert(Number.isInteger(n) && n >= 0, `${at}: owned ${u.id} = ${n}`);
    }
    assert(S.isZoneUnlocked(s, s.zone), `${at}: current zone ${s.zone} is not unlocked`);
    assert.strictEqual(S.currentZone(s).id, s.zone, `${at}: zone id is not a real zone`);
    assert(s.totalMoneyEarned >= s.money - 1e-9 * Math.max(1, s.money), `${at}: totalMoneyEarned ${s.totalMoneyEarned} < money ${s.money}`);
    assert(Number.isFinite(s.totalMoneyEarned), `${at}: totalMoneyEarned not finite`);
    assert(Number.isInteger(s.taps) && s.taps === counts.tap, `${at}: taps counter`);
    assert(s.pfandBottles >= 0 && s.pfandMoney >= 0 && s.pfandMoney <= s.totalMoneyEarned + 1e-6);
  }
  assert(counts.bought > 0, 'the run should have bought at least one upgrade: ' + JSON.stringify(counts));
});
