/*
 * Data contracts: UPGRADES, ZONES, CONFIG and the State/Save public API.
 * Written against the rules in README.md / the data file headers, never
 * against today's specific entries.
 */
'use strict';
const assert = require('assert');
const { test } = require('./lib/harness');

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

function assertOneEmoji(icon, where) {
  assert(typeof icon === 'string' && icon.length > 0, `${where}: icon must be a non-empty string`);
  assert(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(icon), `${where}: icon "${icon}" must be an emoji`);
  if (segmenter) {
    const n = [...segmenter.segment(icon)].length;
    assert.strictEqual(n, 1, `${where}: icon "${icon}" must be ONE emoji (got ${n} graphemes)`);
  }
}

function assertText(obj, keys, where) {
  for (const k of keys) {
    assert(typeof obj[k] === 'string' && obj[k].trim().length > 0, `${where}: ${k} must be a non-empty string`);
  }
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// ---- UPGRADES ---------------------------------------------------------------

test('UPGRADES is a non-empty array', (T) => {
  assert(Array.isArray(T.UPGRADES) && T.UPGRADES.length > 0);
});

test('upgrade ids are snake_case strings', (T) => {
  for (const u of T.UPGRADES) assert(typeof u.id === 'string' && SNAKE.test(u.id), `bad id ${JSON.stringify(u.id)}`);
});

test('upgrade ids are unique', (T) => {
  const ids = T.UPGRADES.map((u) => u.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(dupes, [], 'duplicate ids: ' + dupes.join(', '));
});

test('upgrade text fields are non-empty strings and icon is one emoji', (T) => {
  for (const u of T.UPGRADES) {
    assertText(u, ['name', 'description'], `upgrade "${u.id}"`);
    assertOneEmoji(u.icon, `upgrade "${u.id}"`);
  }
});

test('upgrade numbers: baseCost > 0, trashPerTap >= 0, trashPerSecond >= 0', (T) => {
  for (const u of T.UPGRADES) {
    const where = `upgrade "${u.id}"`;
    assert(isNum(u.baseCost) && u.baseCost > 0, `${where}: baseCost must be a finite number > 0 (got ${u.baseCost})`);
    assert(isNum(u.trashPerTap) && u.trashPerTap >= 0, `${where}: trashPerTap must be a finite number >= 0 (got ${u.trashPerTap})`);
    assert(isNum(u.trashPerSecond) && u.trashPerSecond >= 0, `${where}: trashPerSecond must be a finite number >= 0 (got ${u.trashPerSecond})`);
  }
});

test('every upgrade has at least one effect', (T) => {
  for (const u of T.UPGRADES) assert(u.trashPerTap > 0 || u.trashPerSecond > 0, `upgrade "${u.id}" does nothing`);
});

test('optional costGrowth is a finite number > 1', (T) => {
  for (const u of T.UPGRADES) {
    if (u.costGrowth === undefined) continue;
    assert(isNum(u.costGrowth) && u.costGrowth > 1, `upgrade "${u.id}": costGrowth must be > 1 (got ${u.costGrowth})`);
  }
});

test('UPGRADES is sorted by baseCost', (T) => {
  for (let i = 1; i < T.UPGRADES.length; i++) {
    const a = T.UPGRADES[i - 1];
    const b = T.UPGRADES[i];
    assert(b.baseCost >= a.baseCost, `${b.id} (${b.baseCost}) is listed after ${a.id} (${a.baseCost})`);
  }
});

test('UPGRADES and each entry are frozen', (T) => {
  assert(Object.isFrozen(T.UPGRADES), 'UPGRADES array not frozen');
  for (const u of T.UPGRADES) assert(Object.isFrozen(u), `upgrade "${u.id}" not frozen`);
});

test('there is at least one tap upgrade and one passive upgrade', (T) => {
  assert(T.UPGRADES.some((u) => u.trashPerTap > 0), 'no upgrade gives trashPerTap');
  assert(T.UPGRADES.some((u) => u.trashPerSecond > 0), 'no upgrade gives trashPerSecond');
});

// ---- ZONES ------------------------------------------------------------------

test('ZONES is a non-empty array', (T) => {
  assert(Array.isArray(T.ZONES) && T.ZONES.length > 0);
});

test('zone ids are snake_case and unique', (T) => {
  const ids = T.ZONES.map((z) => z.id);
  for (const id of ids) assert(typeof id === 'string' && SNAKE.test(id), `bad zone id ${JSON.stringify(id)}`);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate zone ids');
});

test('zone text fields are non-empty strings and icon is one emoji', (T) => {
  for (const z of T.ZONES) {
    assertText(z, ['name', 'description'], `zone "${z.id}"`);
    assertOneEmoji(z.icon, `zone "${z.id}"`);
  }
});

test('first zone is free, every other zone costs > 0', (T) => {
  assert.strictEqual(T.ZONES[0].unlockCost, 0, 'first zone unlockCost must be 0');
  for (const z of T.ZONES.slice(1)) assert(isNum(z.unlockCost) && z.unlockCost > 0, `zone "${z.id}": unlockCost must be > 0 (got ${z.unlockCost})`);
});

test('zone trashMultiplier >= 1 and 0 <= pfandChance <= 1', (T) => {
  for (const z of T.ZONES) {
    assert(isNum(z.trashMultiplier) && z.trashMultiplier >= 1, `zone "${z.id}": trashMultiplier must be >= 1 (got ${z.trashMultiplier})`);
    assert(isNum(z.pfandChance) && z.pfandChance >= 0 && z.pfandChance <= 1, `zone "${z.id}": pfandChance must be in [0, 1] (got ${z.pfandChance})`);
  }
});

test('ZONES is sorted by unlockCost', (T) => {
  for (let i = 1; i < T.ZONES.length; i++) {
    const a = T.ZONES[i - 1];
    const b = T.ZONES[i];
    assert(b.unlockCost >= a.unlockCost, `${b.id} (${b.unlockCost}) is listed after ${a.id} (${a.unlockCost})`);
  }
});

test('ZONES and each entry are frozen', (T) => {
  assert(Object.isFrozen(T.ZONES), 'ZONES array not frozen');
  for (const z of T.ZONES) assert(Object.isFrozen(z), `zone "${z.id}" not frozen`);
});

// ---- CONFIG & APIs ------------------------------------------------------------

test('CONFIG is frozen with sane core values', (T) => {
  const C = T.CONFIG;
  assert(C && Object.isFrozen(C), 'CONFIG must exist and be frozen');
  assert(isNum(C.BASE_TRASH_PER_TAP) && C.BASE_TRASH_PER_TAP > 0, 'BASE_TRASH_PER_TAP > 0');
  assert(isNum(C.MONEY_PER_TRASH) && C.MONEY_PER_TRASH > 0, 'MONEY_PER_TRASH > 0');
  assert(isNum(C.DEFAULT_COST_GROWTH) && C.DEFAULT_COST_GROWTH > 1, 'DEFAULT_COST_GROWTH > 1');
});

test('State exposes every documented function', (T) => {
  const api = ['createState', 'getUpgrade', 'owned', 'upgradeCost', 'nextCost', 'canAfford', 'buy', 'trashPerTap', 'trashPerSecond', 'tap', 'tick', 'pfandValue', 'getZone', 'currentZone', 'isZoneUnlocked', 'nextZone', 'canUnlockZone', 'unlockZone', 'travelTo', 'currentTool'];
  const missing = api.filter((k) => typeof T.State[k] !== 'function');
  assert.deepStrictEqual(missing, [], 'missing State functions: ' + missing.join(', '));
});

test('Save exposes save/load/clear and the documented key', (T) => {
  for (const k of ['save', 'load', 'clear']) assert.strictEqual(typeof T.Save[k], 'function', `Save.${k}`);
  // README: the game saves to localStorage["berlinTrashClicker.save"]. Changing it orphans every save.
  assert.strictEqual(T.Save.SAVE_KEY, 'berlinTrashClicker.save');
});

test('createState matches the documented shape', (T) => {
  const s = T.State.createState();
  for (const k of ['trash', 'money', 'totalMoneyEarned', 'taps', 'pfandBottles', 'pfandMoney']) assert.strictEqual(s[k], 0, `${k} starts at 0`);
  assert(isNum(s.startedAt) && s.startedAt > 0, 'startedAt is a timestamp');
  assert.deepStrictEqual(Object.keys(s.upgrades).sort(), T.UPGRADES.map((u) => u.id).sort(), 'one counter per upgrade');
  for (const u of T.UPGRADES) assert.strictEqual(s.upgrades[u.id], 0);
  assert.strictEqual(s.zone, T.ZONES[0].id);
  assert.deepStrictEqual(s.zonesUnlocked, { [T.ZONES[0].id]: true });
});

test('createState returns independent objects', (T) => {
  const a = T.State.createState();
  const b = T.State.createState();
  a.upgrades[T.UPGRADES[0].id] = 5;
  a.zonesUnlocked.someone = true;
  assert.strictEqual(b.upgrades[T.UPGRADES[0].id], 0);
  assert(!('someone' in b.zonesUnlocked));
});

test('getUpgrade / getZone find every entry and return null for unknown ids', (T) => {
  for (const u of T.UPGRADES) assert.strictEqual(T.State.getUpgrade(u.id), u);
  for (const z of T.ZONES) assert.strictEqual(T.State.getZone(z.id), z);
  for (const bad of ['nope', '', undefined, null, '__proto__', 'constructor']) {
    assert.strictEqual(T.State.getUpgrade(bad), null, `getUpgrade(${String(bad)})`);
    assert.strictEqual(T.State.getZone(bad), null, `getZone(${String(bad)})`);
  }
});
