/*
 * Zero-dependency tests. Run with:  node tests/run.js
 * Validates the upgrades contract plus core game logic and save/load.
 */
'use strict';
const assert = require('assert');
const path = require('path');

for (const f of ['upgrades.js', 'state.js', 'save.js']) {
  require(path.join(__dirname, '..', 'js', f));
}
const { UPGRADES, State, Save, CONFIG } = globalThis.TrashGame;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n    ' + e.message);
  }
}

function memoryStore() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => (data[k] = String(v)),
    removeItem: (k) => delete data[k],
    data,
  };
}

console.log('Upgrades contract');

test('UPGRADES is a non-empty array', () => {
  assert(Array.isArray(UPGRADES) && UPGRADES.length > 0);
});

test('every upgrade has valid required fields', () => {
  for (const u of UPGRADES) {
    const where = `upgrade "${u.id}"`;
    assert(typeof u.id === 'string' && /^[a-z][a-z0-9_]*$/.test(u.id), `${where}: id must be snake_case`);
    for (const k of ['name', 'description', 'icon']) {
      assert(typeof u[k] === 'string' && u[k].length > 0, `${where}: ${k} must be a non-empty string`);
    }
    assert(Number.isFinite(u.baseCost) && u.baseCost > 0, `${where}: baseCost must be > 0`);
    assert(Number.isFinite(u.trashPerTap) && u.trashPerTap >= 0, `${where}: trashPerTap must be >= 0`);
    assert(Number.isFinite(u.trashPerSecond) && u.trashPerSecond >= 0, `${where}: trashPerSecond must be >= 0`);
    assert(u.trashPerTap > 0 || u.trashPerSecond > 0, `${where}: must give trashPerTap or trashPerSecond`);
    if (u.costGrowth !== undefined) {
      assert(Number.isFinite(u.costGrowth) && u.costGrowth > 1, `${where}: costGrowth must be > 1`);
    }
  }
});

test('ids are unique', () => {
  const ids = UPGRADES.map((u) => u.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('sorted by baseCost', () => {
  for (let i = 1; i < UPGRADES.length; i++) {
    assert(UPGRADES[i].baseCost >= UPGRADES[i - 1].baseCost, `${UPGRADES[i].id} is out of order`);
  }
});

test('data is frozen', () => {
  assert(Object.isFrozen(UPGRADES) && UPGRADES.every(Object.isFrozen));
});

console.log('Game logic');

test('new game starts at zero with a bare trash pick', () => {
  const s = State.createState();
  assert.strictEqual(s.trash, 0);
  assert.strictEqual(s.money, 0);
  assert.strictEqual(State.trashPerTap(s), CONFIG.BASE_TRASH_PER_TAP);
  assert.strictEqual(State.trashPerSecond(s), 0);
  assert.strictEqual(State.currentTool(s).id, 'trash_pick');
  for (const u of UPGRADES) assert.strictEqual(s.upgrades[u.id], 0);
});

test('tap collects trash and earns money', () => {
  const s = State.createState();
  State.tap(s);
  State.tap(s);
  assert.strictEqual(s.taps, 2);
  assert.strictEqual(s.trash, 2 * CONFIG.BASE_TRASH_PER_TAP);
  assert.strictEqual(s.money, 2 * CONFIG.BASE_TRASH_PER_TAP * CONFIG.MONEY_PER_TRASH);
});

test('cannot buy without money', () => {
  const s = State.createState();
  assert.strictEqual(State.buy(s, UPGRADES[0].id), false);
  assert.strictEqual(s.upgrades[UPGRADES[0].id], 0);
});

test('buying deducts cost, raises next price and boosts output', () => {
  const s = State.createState();
  const broom = State.getUpgrade('broom');
  s.money = 1000;
  assert(State.buy(s, 'broom'));
  assert.strictEqual(s.money, 1000 - broom.baseCost);
  assert.strictEqual(s.upgrades.broom, 1);
  assert(State.nextCost(s, 'broom') > broom.baseCost);
  assert.strictEqual(State.trashPerTap(s), CONFIG.BASE_TRASH_PER_TAP + broom.trashPerTap);
  assert.strictEqual(State.currentTool(s).id, 'broom');
});

test('cost formula is baseCost * growth^owned, rounded up', () => {
  const u = UPGRADES[0];
  const g = u.costGrowth || CONFIG.DEFAULT_COST_GROWTH;
  for (let n = 0; n < 20; n++) {
    assert.strictEqual(State.upgradeCost(u, n), Math.ceil(u.baseCost * Math.pow(g, n)));
  }
});

test('tick adds passive income', () => {
  const s = State.createState();
  const auto = UPGRADES.find((u) => u.trashPerSecond > 0);
  s.upgrades[auto.id] = 2;
  State.tick(s, 3);
  assert(Math.abs(s.trash - auto.trashPerSecond * 2 * 3) < 1e-9);
  State.tick(s, -5);
  State.tick(s, NaN);
  assert(Math.abs(s.trash - auto.trashPerSecond * 2 * 3) < 1e-9);
});

test('unknown upgrade ids are rejected', () => {
  const s = State.createState();
  s.money = 1e12;
  assert.strictEqual(State.buy(s, 'nope'), false);
  assert.strictEqual(s.money, 1e12);
});

console.log('Save / load');

test('round-trips state', () => {
  const store = memoryStore();
  const s = State.createState();
  s.money = 123.5;
  s.trash = 999;
  s.upgrades.broom = 4;
  assert(Save.save(s, store));
  const loaded = Save.load(store);
  assert.strictEqual(loaded.money, 123.5);
  assert.strictEqual(loaded.trash, 999);
  assert.strictEqual(loaded.upgrades.broom, 4);
  assert(loaded.lastSaved > 0);
});

test('missing or corrupt save gives a fresh game', () => {
  const store = memoryStore();
  assert.strictEqual(Save.load(store).money, 0);
  store.setItem(Save.SAVE_KEY, '{not json');
  assert.strictEqual(Save.load(store).money, 0);
});

test('bad values are discarded, unknown upgrades dropped, new upgrades default to 0', () => {
  const store = memoryStore();
  const broomless = { money: -5, trash: 'lots', upgrades: { broom: 2.7, removed_thing: 9 } };
  store.setItem(Save.SAVE_KEY, JSON.stringify({ version: 1, state: broomless }));
  const s = Save.load(store);
  assert.strictEqual(s.money, 0);
  assert.strictEqual(s.trash, 0);
  assert.strictEqual(s.upgrades.broom, 2);
  assert(!('removed_thing' in s.upgrades));
  assert.strictEqual(s.upgrades.recycling_yard, 0);
});

test('clear removes the save', () => {
  const store = memoryStore();
  Save.save(State.createState(), store);
  Save.clear(store);
  assert.strictEqual(store.getItem(Save.SAVE_KEY), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
