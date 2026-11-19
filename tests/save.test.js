/*
 * Save / load: round trips, untrusted data, old saves, broken storage.
 * All storage is in-memory (see lib/harness.js).
 */
'use strict';
const assert = require('assert');
const { test, memoryStore, throwingStore } = require('./lib/harness');

function writeRaw(T, store, state, version) {
  store.setItem(T.Save.SAVE_KEY, JSON.stringify({ version: version === undefined ? T.Save.SAVE_VERSION : version, state }));
}

function assertFresh(T, s, where) {
  const f = T.State.createState();
  for (const k of ['trash', 'money', 'totalMoneyEarned', 'taps', 'pfandBottles', 'pfandMoney']) assert.strictEqual(s[k], f[k], `${where}: ${k}`);
  assert.deepStrictEqual(s.upgrades, f.upgrades, `${where}: upgrades`);
  assert.strictEqual(s.zone, f.zone, `${where}: zone`);
  assert.deepStrictEqual(s.zonesUnlocked, f.zonesUnlocked, `${where}: zonesUnlocked`);
}

/** Every loaded state must satisfy these, whatever was in storage. */
function assertValid(T, s, where) {
  for (const k of ['trash', 'money', 'totalMoneyEarned', 'taps', 'pfandBottles', 'pfandMoney']) {
    assert(typeof s[k] === 'number' && Number.isFinite(s[k]) && s[k] >= 0, `${where}: ${k} = ${s[k]}`);
  }
  assert.deepStrictEqual(Object.keys(s.upgrades).sort(), T.UPGRADES.map((u) => u.id).sort(), `${where}: upgrade keys`);
  for (const u of T.UPGRADES) assert(Number.isInteger(s.upgrades[u.id]) && s.upgrades[u.id] >= 0, `${where}: owned ${u.id} = ${s.upgrades[u.id]}`);
  assert(T.ZONES.some((z) => z.id === s.zone), `${where}: zone "${String(s.zone)}" is not a real zone`);
  assert.strictEqual(s.zonesUnlocked[s.zone], true, `${where}: current zone "${String(s.zone)}" is not unlocked`);
  assert.strictEqual(s.zonesUnlocked[T.ZONES[0].id], true, `${where}: first zone must always be unlocked`);
  for (const id of Object.keys(s.zonesUnlocked)) {
    assert(T.ZONES.some((z) => z.id === id), `${where}: unknown zone "${id}" kept`);
    assert.strictEqual(s.zonesUnlocked[id], true, `${where}: zonesUnlocked.${id}`);
  }
}

/** Builds a state that has used every system, through the real game logic. */
function richState(T) {
  const S = T.State;
  const s = S.createState();
  for (let i = 0; i < 37; i++) S.tap(s, i % 3 ? () => 0.999999 : () => 0);
  s.money += 1e7; // plenty to spend
  s.totalMoneyEarned += 1e7;
  T.UPGRADES.forEach((u, i) => {
    for (let n = 0; n < (i % 4) + 1; n++) S.buy(s, u.id);
  });
  if (T.ZONES[1]) {
    s.money += T.ZONES[1].unlockCost;
    s.totalMoneyEarned += T.ZONES[1].unlockCost;
    assert(S.unlockZone(s, T.ZONES[1].id));
  }
  S.tick(s, 12.5);
  s.money += 0.25; // keep a fractional amount
  return s;
}

test('round-trips a rich state exactly (upgrades, zones, Pfand stats)', (T) => {
  const store = memoryStore();
  const s = richState(T);
  assert(s.pfandBottles > 0 && s.pfandMoney > 0, 'fixture has Pfand stats');
  assert(T.Save.save(s, store), 'save returned false');
  assert(typeof s.lastSaved === 'number' && s.lastSaved > 0, 'save stamps lastSaved');
  const loaded = T.Save.load(store);
  assert.deepStrictEqual(loaded, s);
  assert.notStrictEqual(loaded, s);
  assertValid(T, loaded, 'rich');
});

test('save writes { version, state } under SAVE_KEY as JSON', (T) => {
  const store = memoryStore();
  const s = T.State.createState();
  T.Save.save(s, store);
  const keys = Object.keys(store.data);
  assert.deepStrictEqual(keys, [T.Save.SAVE_KEY]);
  const data = JSON.parse(store.data[T.Save.SAVE_KEY]);
  assert.strictEqual(data.version, T.Save.SAVE_VERSION);
  assert.deepStrictEqual(data.state, JSON.parse(JSON.stringify(s)));
});

test('a loaded game keeps playing with the same economy', (T) => {
  const store = memoryStore();
  const s = richState(T);
  T.Save.save(s, store);
  const loaded = T.Save.load(store);
  assert.strictEqual(T.State.trashPerTap(loaded), T.State.trashPerTap(s));
  assert.strictEqual(T.State.trashPerSecond(loaded), T.State.trashPerSecond(s));
  for (const u of T.UPGRADES) assert.strictEqual(T.State.nextCost(loaded, u.id), T.State.nextCost(s, u.id));
  assert.strictEqual(T.State.nextZone(loaded), T.State.nextZone(s));
});

test('missing, empty, corrupt or wrong-shaped JSON gives a fresh state', (T) => {
  const store = memoryStore();
  assertFresh(T, T.Save.load(store), 'no save');
  const bad = ['', '{not json', 'null', '42', '"text"', '[]', '{}', 'true', '{"version":1}', '{"version":1,"state":null}', '{"version":1,"state":"x"}', '{"version":1,"state":[1,2]}', '{"version":1,"state":{}}'];
  for (const text of bad) {
    store.setItem(T.Save.SAVE_KEY, text);
    const s = T.Save.load(store);
    assertFresh(T, s, JSON.stringify(text));
    assertValid(T, s, JSON.stringify(text));
  }
});

test('negative, NaN, string, null, boolean and Infinity numbers are discarded', (T) => {
  const store = memoryStore();
  const id0 = T.UPGRADES[0].id;
  const numKeys = ['trash', 'money', 'totalMoneyEarned', 'taps', 'pfandBottles', 'pfandMoney'];
  for (const bad of [-5, -0.5, '100', null, true, [], {}]) {
    const raw = { upgrades: { [id0]: bad } };
    for (const k of numKeys) raw[k] = bad;
    writeRaw(T, store, raw);
    const s = T.Save.load(store);
    assertFresh(T, s, `value ${JSON.stringify(bad)}`);
  }
  // JSON can't encode Infinity/NaN, but 1e999 parses to Infinity.
  const inf = '{"version":1,"state":{' + numKeys.map((k) => `"${k}":1e999`).join(',') + `,"upgrades":{"${id0}":1e999}}}`;
  store.setItem(T.Save.SAVE_KEY, inf);
  assertFresh(T, T.Save.load(store), 'Infinity');
  // NaN only reaches sanitize directly.
  if (typeof T.Save.sanitize === 'function') {
    const raw = { upgrades: { [id0]: NaN } };
    for (const k of numKeys) raw[k] = NaN;
    assertFresh(T, T.Save.sanitize(raw), 'NaN');
    raw.money = Infinity;
    raw.upgrades[id0] = -Infinity;
    assertFresh(T, T.Save.sanitize(raw), '+/-Infinity');
  }
});

test('good values survive next to bad ones', (T) => {
  const store = memoryStore();
  writeRaw(T, store, { money: 50.5, trash: 'lots', taps: 12, pfandBottles: -1, pfandMoney: 3 });
  const s = T.Save.load(store);
  assert.strictEqual(s.money, 50.5);
  assert.strictEqual(s.trash, 0);
  assert.strictEqual(s.taps, 12);
  assert.strictEqual(s.pfandBottles, 0);
  assert.strictEqual(s.pfandMoney, 3);
});

test('fractional owned counts are floored', (T) => {
  const store = memoryStore();
  const upgrades = {};
  T.UPGRADES.forEach((u, i) => (upgrades[u.id] = i + 0.99));
  writeRaw(T, store, { upgrades });
  const s = T.Save.load(store);
  T.UPGRADES.forEach((u, i) => assert.strictEqual(s.upgrades[u.id], i, u.id));
  assertValid(T, s, 'fractional');
});

test('unknown upgrade ids are dropped, missing upgrades default to 0', (T) => {
  const store = memoryStore();
  const first = T.UPGRADES[0].id;
  const last = T.UPGRADES[T.UPGRADES.length - 1].id;
  writeRaw(T, store, { upgrades: { [first]: 2, removed_thing: 9, ['__proto__']: 5, constructor: 3 } });
  const s = T.Save.load(store);
  assert.strictEqual(s.upgrades[first], 2);
  assert(!Object.prototype.hasOwnProperty.call(s.upgrades, 'removed_thing'));
  if (T.UPGRADES.length > 1) assert.strictEqual(s.upgrades[last], 0);
  assertValid(T, s, 'unknown upgrades');
});

test('unknown zone ids are dropped; only === true unlocks', (T) => {
  const store = memoryStore();
  const unlocked = { atlantis: true, [T.ZONES[0].id]: true };
  if (T.ZONES[1]) unlocked[T.ZONES[1].id] = 'yes';
  writeRaw(T, store, { zonesUnlocked: unlocked, zone: 'atlantis' });
  const s = T.Save.load(store);
  assert.deepStrictEqual(s.zonesUnlocked, { [T.ZONES[0].id]: true });
  assert.strictEqual(s.zone, T.ZONES[0].id);
  assertValid(T, s, 'unknown zones');
});

test('a saved current zone that is not unlocked falls back to ZONES[0]', (T) => {
  const store = memoryStore();
  const target = T.ZONES[T.ZONES.length - 1];
  writeRaw(T, store, { zone: target.id, zonesUnlocked: { [T.ZONES[0].id]: true } });
  const s = T.Save.load(store);
  assert.strictEqual(s.zone, T.ZONES[0].id);
  assertValid(T, s, 'locked zone');
});

test('a saved unlocked current zone is kept', (T) => {
  if (T.ZONES.length < 2) return;
  const store = memoryStore();
  const z = T.ZONES[1];
  writeRaw(T, store, { zone: z.id, zonesUnlocked: { [T.ZONES[0].id]: true, [z.id]: true } });
  const s = T.Save.load(store);
  assert.strictEqual(s.zone, z.id);
  assert.strictEqual(T.State.currentZone(s), z);
});

test('state.zone always ends up a real, unlocked zone', (T) => {
  const store = memoryStore();
  const zones = [undefined, null, 5, '', 'atlantis', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ...T.ZONES.map((z) => z.id)];
  const unlockeds = [undefined, null, 'x', [], {}, { [T.ZONES[0].id]: false }, Object.fromEntries(T.ZONES.map((z) => [z.id, true]))];
  for (const zone of zones) {
    for (const zonesUnlocked of unlockeds) {
      writeRaw(T, store, { zone, zonesUnlocked });
      assertValid(T, T.Save.load(store), `zone=${JSON.stringify(zone)} zonesUnlocked=${JSON.stringify(zonesUnlocked)}`);
    }
  }
});

test('a Phase 1 save (no zone or Pfand fields) loads fine, with v1 purchases refunded', (T) => {
  const store = memoryStore();
  const phase1 = { trash: 500, money: 120.5, totalMoneyEarned: 600, taps: 480, upgrades: { broom: 3 }, startedAt: 1700000000000, lastSaved: 1700000100000 };
  writeRaw(T, store, phase1, 1);
  const s = T.Save.load(store);
  assert.strictEqual(s.trash, 500);
  assert.strictEqual(s.money, 120.5 + 15 + 18 + 20); // 3 v1 brooms at 15 x 1.15^n, rounded up
  assert.strictEqual(s.totalMoneyEarned, 600);
  assert.strictEqual(s.taps, 480);
  for (const u of T.UPGRADES) assert.strictEqual(s.upgrades[u.id], 0, `${u.id} reset by the v1 migration`);
  assert.strictEqual(s.startedAt, 1700000000000);
  assert.strictEqual(s.zone, T.ZONES[0].id);
  assert.deepStrictEqual(s.zonesUnlocked, { [T.ZONES[0].id]: true });
  assert.strictEqual(s.pfandBottles, 0);
  assert.strictEqual(s.pfandMoney, 0);
  assertValid(T, s, 'phase 1');
  // ...and the game keeps working on it
  const r = T.State.tap(s, () => 0.999999);
  assert(r.trash > 0);
});

test('storage that throws on getItem/setItem/removeItem never crashes', (T) => {
  const store = throwingStore();
  const s = T.State.createState();
  s.money = 10;
  assert.strictEqual(T.Save.save(s, store), false, 'save returns false');
  assertFresh(T, T.Save.load(store), 'load from throwing storage');
  assert.doesNotThrow(() => T.Save.clear(store));
});

test('setItem throwing (quota exceeded) returns false but getItem still works', (T) => {
  const store = memoryStore();
  const s = T.State.createState();
  s.money = 77;
  assert(T.Save.save(s, store));
  store.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  s.money = 99;
  assert.strictEqual(T.Save.save(s, store), false);
  assert.strictEqual(T.Save.load(store).money, 77, 'previous save is still loadable');
});

test('clear removes the save and load then gives a fresh state', (T) => {
  const store = memoryStore();
  store.setItem('someOtherKey', 'keep me');
  T.Save.save(richState(T), store);
  T.Save.clear(store);
  assert.strictEqual(store.getItem(T.Save.SAVE_KEY), null);
  assert.strictEqual(store.getItem('someOtherKey'), 'keep me', 'clear only touches its own key');
  assertFresh(T, T.Save.load(store), 'after clear');
  assert.doesNotThrow(() => T.Save.clear(store), 'clearing twice is fine');
});

test('loading does not mutate what is in storage', (T) => {
  const store = memoryStore();
  T.Save.save(richState(T), store);
  const text = store.getItem(T.Save.SAVE_KEY);
  T.Save.load(store);
  assert.strictEqual(store.getItem(T.Save.SAVE_KEY), text);
});
