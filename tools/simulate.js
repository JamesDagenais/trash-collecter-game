#!/usr/bin/env node
/*
 * Balance simulator for Berlin Trash Clicker.  Run:  node tools/simulate.js
 *
 * Loads the real game data + logic (js/upgrades.js, js/zones.js, js/state.js)
 * the same way the tests do, then plays a greedy bot:
 *   - taps at a steady rate (--tps, default 4 taps/s = active play)
 *   - always stands in the unlocked zone with the best income for that tap rate
 *   - picks the purchase (next upgrade copy or next zone) that gets it the most
 *     income soonest: minimises  wait-until-affordable + cost / income gained
 *   - buys it as soon as it can afford it
 * It prints when each upgrade and zone is FIRST bought, then a summary.
 *
 * Options:
 *   --tps=N        taps per second (default 4; try 2 for casual, 0 for fully idle)
 *   --minutes=N    how long to play (default 120)
 *   --seed=N       RNG seed for Pfand rolls (default 1)
 *   --all          also print every repeat purchase, not just first copies
 *   --json         print the milestones as JSON (for scripting)
 *
 * Also usable as a module:  require('./tools/simulate').simulate({ tps, minutes, seed })
 */
'use strict';
const path = require('path');

for (const f of ['upgrades.js', 'zones.js', 'state.js', 'achievements.js']) {
  require(path.join(__dirname, '..', 'js', f));
}
const T = globalThis.TrashGame; // read T.UPGRADES / T.ZONES lazily so a tuner can swap them

const DT = 0.1; // seconds per simulation step

// Small deterministic RNG (mulberry32) so runs are repeatable.
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clone(s) {
  return { ...s, upgrades: { ...s.upgrades }, zonesUnlocked: { ...s.zonesUnlocked } };
}

function simulate({ tps = 4, minutes = 120, seed = 1, all = false, noAchievements = false } = {}) {
  const { State, CONFIG } = T;
  const rng = rngFrom(seed);

  /** Expected €/s at this tap rate, split into parts. */
  function income(s) {
    const tap = tps * State.trashPerTap(s) * CONFIG.MONEY_PER_TRASH;
    const passive = State.trashPerSecond(s) * CONFIG.MONEY_PER_TRASH;
    const pfand = tps * State.currentZone(s).pfandChance * State.pfandValue(s);
    return { tap, passive, pfand, total: tap + passive + pfand };
  }

  /** Moves to the unlocked zone with the best income. Returns that income. */
  function bestZone(s) {
    let best = s.zone;
    let bestRate = -1;
    for (const z of T.ZONES) {
      if (!State.isZoneUnlocked(s, z.id)) continue;
      s.zone = z.id;
      const r = income(s).total;
      if (r > bestRate + 1e-9) {
        bestRate = r;
        best = z.id;
      }
    }
    s.zone = best;
    return bestRate;
  }

  function candidates(s) {
    const now = income(s).total;
    const list = [];
    for (const u of T.UPGRADES) {
      const t = clone(s);
      t.upgrades[u.id] = State.owned(t, u.id) + 1;
      list.push({ kind: 'upgrade', id: u.id, name: u.name, cost: State.nextCost(s, u.id), gain: bestZone(t) - now });
    }
    const z = State.nextZone(s);
    if (z) {
      const t = clone(s);
      t.zonesUnlocked[z.id] = true;
      const c = { kind: 'zone', id: z.id, name: z.name, cost: z.unlockCost, gain: bestZone(t) - now };
      // A sidegrade zone (no gain at this tap rate) still has to be bought to reach
      // the next one, so judge it together with the zone after it.
      const after = T.ZONES[T.ZONES.indexOf(z) + 1];
      if (c.gain <= 1e-12 && after) {
        t.zonesUnlocked[after.id] = true;
        c.planCost = z.unlockCost + after.unlockCost;
        c.gain = bestZone(t) - now;
      }
      list.push(c);
    }
    for (const c of list) {
      const planCost = c.planCost || c.cost;
      const wait = Math.max(0, planCost - s.money) / Math.max(now, 1e-9);
      c.payback = c.gain > 1e-12 ? planCost / c.gain : Infinity;
      c.score = wait + c.payback;
    }
    return list.sort((a, b) => a.score - b.score);
  }

  const s = State.createState();
  let time = 0;
  let tapDebt = 0;
  let lastFirst = 0;
  const earned = { tap: 0, passive: 0, pfand: 0 };
  const firstAffordable = {};
  const firsts = [];
  const log = [];
  let doneAt = null;

  while (time < minutes * 60) {
    for (const u of T.UPGRADES) {
      if (!(u.id in firstAffordable) && s.money >= u.baseCost) firstAffordable[u.id] = time;
    }
    const nz = State.nextZone(s);
    if (nz && !(nz.id in firstAffordable) && s.money >= nz.unlockCost) firstAffordable[nz.id] = time;

    // Buy what the greedy plan wants, as long as its top pick is affordable.
    for (;;) {
      const pick = candidates(s)[0];
      if (!pick || (pick.planCost || pick.cost) > s.money) break;
      const ok = pick.kind === 'zone' ? State.unlockZone(s, pick.id) : State.buy(s, pick.id);
      if (!ok) break;
      bestZone(s);
      const ownedNow = pick.kind === 'zone' ? 1 : State.owned(s, pick.id);
      const entry = { t: time, taps: s.taps, zone: s.zone, ...pick, owned: ownedNow, income: income(s) };
      if (ownedNow === 1) {
        entry.gap = time - lastFirst;
        entry.waited = time - (firstAffordable[pick.id] ?? time); // affordable but not worth it yet
        lastFirst = time;
        firsts.push(entry);
      }
      if (ownedNow === 1 || all) log.push(entry);
    }
    if (doneAt === null && firsts.length === T.UPGRADES.length + T.ZONES.length - 1) doneAt = time;

    tapDebt += tps * DT;
    while (tapDebt >= 1) {
      tapDebt -= 1;
      const r = State.tap(s, rng);
      earned.tap += r.money;
      earned.pfand += r.pfand;
    }
    const before = s.money;
    State.tick(s, DT);
    earned.passive += s.money - before;
    if (!noAchievements) State.checkAchievements(s, time * 1000);
    time += DT;
  }
  return { tps, minutes, state: s, log, firsts, earned, doneAt, endIncome: income(s) };
}

// ---- CLI ---------------------------------------------------------------

function clock(sec) {
  const m = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function fmt(n) {
  if (n < 1e3) return n.toFixed(n < 10 ? 1 : 0);
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let i = -1;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return n.toFixed(n < 10 ? 2 : 1) + units[i];
}

function report(r) {
  const { State } = T;
  const s = r.state;
  console.log(`Greedy bot, ${r.tps} taps/s, ${r.minutes} min. (${T.UPGRADES.length} upgrades, ${T.ZONES.length} zones)\n`);
  console.log('   time    gap  waited   taps  bought                             cost   €/s after  tap/passive/pfand  zone');
  for (const e of r.log) {
    const label = (e.kind === 'zone' ? '[ZONE] ' + e.name : e.name + (e.owned > 1 ? ` #${e.owned}` : '')).padEnd(32);
    const inc = e.income;
    const pct = (x) => String(Math.round((100 * x) / inc.total));
    const first = e.gap !== undefined;
    console.log(
      [
        clock(e.t).padStart(7),
        (first ? clock(e.gap) : '').padStart(6),
        (first ? clock(e.waited) : '').padStart(7),
        String(e.taps).padStart(6),
        ' ' + label,
        fmt(e.cost).padStart(8),
        fmt(inc.total).padStart(10),
        `${pct(inc.tap)}/${pct(inc.passive)}/${pct(inc.pfand)}`.padStart(18),
        ' ' + e.zone,
      ].join(' '),
    );
  }
  const total = r.earned.tap + r.earned.passive + r.earned.pfand;
  const pc = (x) => Math.round((100 * x) / total) + '%';
  const missing = T.UPGRADES.filter((u) => State.owned(s, u.id) === 0).map((u) => u.name);
  const locked = T.ZONES.filter((z) => !State.isZoneUnlocked(s, z.id)).map((z) => z.name);
  const gaps = r.firsts
    .slice(1)
    .map((f) => f.gap)
    .sort((a, b) => a - b);
  console.log('\nSummary');
  console.log(`  Everything bought at least once: ${r.doneAt === null ? 'not within ' + r.minutes + ' min' : clock(r.doneAt)}`);
  if (gaps.length) console.log(`  Gap between new things: median ${clock(gaps[Math.floor(gaps.length / 2)])}, max ${clock(gaps[gaps.length - 1])}`);
  console.log(`  Earned €${fmt(total)}: taps ${pc(r.earned.tap)}, passive ${pc(r.earned.passive)}, Pfand ${pc(r.earned.pfand)}`);
  const v = State.pfandValue(s);
  console.log(
    `  Pfand: ${s.pfandBottles} bottles, avg €${fmt(s.pfandBottles ? s.pfandMoney / s.pfandBottles : 0)}; one is now worth €${fmt(v)} = ${(v / Math.max(r.endIncome.total, 1e-9)).toFixed(1)} s of income`,
  );
  console.log(`  End income €${fmt(r.endIncome.total)}/s in ${State.currentZone(s).name}`);
  console.log(`  Owned: ${T.UPGRADES.map((u) => `${u.id} ${State.owned(s, u.id)}`).join(', ')}`);
  if (missing.length || locked.length) console.log(`  Never bought: ${missing.concat(locked).join(', ')}`);
}

if (require.main === module) {
  // Accepts --tps=8 and --tps 8. Flags (--all, --json) take no value.
  const FLAGS = new Set(['all', 'json', 'no-achievements']);
  const VALUES = new Set(['tps', 'minutes', 'seed']);
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[i]);
    const key = m && m[1];
    if (!m || !(FLAGS.has(key) || VALUES.has(key))) {
      console.error(`Unknown argument "${argv[i]}". Use --tps N, --minutes N, --seed N, --all, --json, --no-achievements.`);
      process.exit(2);
    }
    if (FLAGS.has(key)) args[key] = true;
    else {
      const v = m[2] !== undefined ? m[2] : argv[++i];
      if (v === undefined || !Number.isFinite(Number(v))) {
        console.error(`--${key} needs a number`);
        process.exit(2);
      }
      args[key] = v;
    }
  }
  const r = simulate({
    tps: args.tps !== undefined ? Number(args.tps) : 4,
    minutes: Number(args.minutes || 120),
    seed: Number(args.seed || 1),
    all: !!args.all,
    noAchievements: !!args['no-achievements'],
  });
  if (args.json) {
    console.log(JSON.stringify(r.firsts.map((f) => ({ t: Math.round(f.t), taps: f.taps, kind: f.kind, id: f.id, cost: f.cost })), null, 2));
  } else {
    report(r);
  }
}

module.exports = { simulate, report };
