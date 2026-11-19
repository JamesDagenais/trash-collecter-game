/*
 * Tiny zero-dependency test harness shared by every tests/*.test.js file.
 *
 *   const { test, skip } = require('./lib/harness');
 *   test('does a thing', (T) => { ... });   // T = a FRESH TrashGame namespace
 *
 * Every test gets its own freshly loaded copy of the game modules (see fresh()),
 * so nothing a test does can leak into the next one.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const JS_DIR = path.join(ROOT, 'js');

// The Node-loadable "core" scripts are the ones index.html loads up to and
// including save.js (data -> logic -> save). Reading the order from index.html
// means a new data/logic file added there is picked up automatically.
const FALLBACK_CORE = ['upgrades.js', 'zones.js', 'state.js', 'save.js'];
function coreScripts() {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const srcs = [...html.matchAll(/<script[^>]*\bsrc="js\/([^"]+)"/g)].map((m) => m[1]);
    const end = srcs.indexOf('save.js');
    if (end >= 0) return srcs.slice(0, end + 1);
  } catch (e) {
    /* fall through */
  }
  return FALLBACK_CORE;
}
const CORE = coreScripts();

/** Loads a clean copy of the game's core modules and returns the TrashGame namespace. */
function fresh() {
  delete globalThis.TrashGame;
  for (const f of CORE) {
    const file = require.resolve(path.join(JS_DIR, f));
    delete require.cache[file];
    require(file);
  }
  return globalThis.TrashGame;
}

// ---- registry -------------------------------------------------------------

const tests = [];
let currentFile = null;

function test(name, fn) {
  tests.push({ file: currentFile, name, fn });
}

class Skip extends Error {}
/** Call from inside a test to mark it skipped (e.g. the data has only one zone). */
function skip(reason) {
  throw new Skip(reason);
}

async function runAll(files) {
  for (const f of files) {
    currentFile = path.basename(f);
    require(f);
  }
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let lastFile = null;
  const failures = [];
  for (const t of tests) {
    if (t.file !== lastFile) {
      console.log('\n' + t.file);
      lastFile = t.file;
    }
    try {
      await t.fn(fresh());
      passed++;
      console.log('  ✓ ' + t.name);
    } catch (e) {
      if (e instanceof Skip) {
        skipped++;
        console.log('  - ' + t.name + ' (skipped: ' + e.message + ')');
        continue;
      }
      failed++;
      failures.push({ t, e });
      console.log('  ✗ ' + t.name + '\n      ' + String(e && e.message).split('\n').join('\n      '));
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (${tests.length} tests)`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const { t, e } of failures) console.log(`  ${t.file} > ${t.name}\n${indent((e && e.stack) || String(e), 4)}`);
  }
  return { passed, failed, skipped, total: tests.length };
}

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

// ---- helpers --------------------------------------------------------------

/** In-memory stand-in for localStorage. */
function memoryStore() {
  const data = Object.create(null);
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    data,
  };
}

/** Storage whose every method throws (quota exceeded, blocked, ...). */
function throwingStore() {
  const boom = () => {
    throw new Error('storage unavailable');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative/absolute float comparison. */
function approx(actual, expected, msg, eps = 1e-9) {
  const ok = actual === expected || Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected));
  if (!ok) throw new Error(`${msg || 'approx'}: expected ${expected}, got ${actual}`);
}

/** Puts a state into zone `z` directly (bypasses the price), for income tests. */
function enterZone(state, z) {
  state.zonesUnlocked[z.id] = true;
  state.zone = z.id;
}

function growthOf(T, u) {
  return u.costGrowth || T.CONFIG.DEFAULT_COST_GROWTH;
}

module.exports = { test, skip, runAll, fresh, memoryStore, throwingStore, seeded, approx, enterZone, growthOf, CORE };
