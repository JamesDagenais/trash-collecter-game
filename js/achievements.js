/*
 * ACHIEVEMENTS DATA FILE: contract (same spirit as upgrades.js / zones.js).
 * =========================================================================
 * Most achievements are GENERATED from UPGRADES and ZONES, so new upgrades and
 * zones get their own automatically. Loaded after state.js (it uses
 * State.upgradeCost to leave out ranks nobody can reach).
 *
 * Each entry has:
 *   id           string  Unique, stable snake_case. Saved; never rename.
 *   name         string  Display name.
 *   description  string  What to do ("Own 25 Old Brooms").
 *   icon         string  One emoji (the menu falls back to it).
 *   category     string  'zones' | 'gear' | 'evolution' | 'trash' | 'income' | 'taps' | 'pfand' | 'special'
 *   req          object  When it unlocks. One of:
 *                  { type: 'owned', upgrade, count }      own >= count of an upgrade
 *                  { type: 'ownAll', count }               own >= count of EVERY upgrade
 *                  { type: 'zone', zone }                  zone unlocked
 *                  { type: 'allZones' }                    every zone unlocked
 *                  { type: 'stat', stat, amount }          state[stat] >= amount
 *                       stat: trash | taps | money | totalMoneyEarned | pfandBottles | pfandMoney
 *                  { type: 'rate', rate, amount }          trashPerTap / trashPerSecond >= amount
 *                       rate: perTap | perSecond
 *                  { type: 'custom', test(state, State) }  anything else (keep it pure)
 *   reward       object? Extra bonus ON TOP of the +CONFIG.ACHIEVEMENT_BONUS (0.5%) to all
 *                trash that EVERY achievement gives. One of:
 *                  { type: 'global',  pct }                 +pct to all trash
 *                  { type: 'tap',     pct }                 +pct to trash per tap
 *                  { type: 'passive', pct }                 +pct to trash per second
 *                  { type: 'pfand',   pct }                 Pfand bottles worth +pct
 *                  { type: 'perOwned', upgrade, target: 'tap'|'passive', pct }
 *                       +pct to target income FOR EVERY COPY of `upgrade` owned
 *                       (this is what keeps evolved upgrades worth buying late)
 *   evolves      object? { upgrade, tier, name } the upgrade takes this name from now on.
 *   secret       bool?   Name and description hidden until unlocked.
 *
 * Ranks: every upgrade gets "own N" achievements for N in RANKS, minus ranks whose
 * copy would cost more than RANK_COST_CAP (unreachable). Evolutions are listed in
 * EVOLUTIONS by hand (they have names) and are always included.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const UP = TrashGame.UPGRADES;
  const ZONES = TrashGame.ZONES;
  const State = TrashGame.State;

  const RANKS = [1, 10, 25, 50, 75, 100, 150, 200];
  const RANK_COST_CAP = 1e13; // € price of the Nth copy; above this, the rank isn't offered
  const RANK_TITLES = {
    1: 'Neuling',
    10: 'Lehrling',
    25: 'Geselle',
    50: 'Meister',
    75: 'Obermeister',
    100: 'Legende',
    150: 'Mythos',
    200: 'Gottheit',
  };

  // Evolutions: at `rank` copies the upgrade takes a new name, and every copy owned
  // adds `bonus / rank` to its income type. So at the evolution rank it's worth
  // +bonus (e.g. +50%), and it keeps growing with every copy you buy after.
  const EVOLUTIONS = {
    broom: [
      { rank: 75, name: 'Kehrmeister Broom', bonus: 0.5 },
      { rank: 150, name: 'Golden Broom', bonus: 1.5 },
    ],
    garbage_bags: [
      { rank: 50, name: 'Industrial Sacks', bonus: 0.5 },
      { rank: 125, name: 'Bottomless Bag', bonus: 1.25 },
    ],
    handcart: [
      { rank: 50, name: 'Turbo Push Cart', bonus: 0.5 },
      { rank: 100, name: 'Golden Push Cart', bonus: 1 },
    ],
    sweeper_truck: [
      { rank: 25, name: 'Night Sweeper', bonus: 0.5 },
      { rank: 60, name: 'Sweeper Mk II', bonus: 1 },
    ],
    helpful_neighbour: [{ rank: 100, name: 'Kiez Legend Frau Schulz', bonus: 0.5 }],
    pfand_collector: [{ rank: 75, name: 'Pfand King', bonus: 0.5 }],
    cargo_bike: [{ rank: 75, name: 'Electric Lastenrad', bonus: 0.5 }],
    kiez_crew: [{ rank: 50, name: 'Kiez Brigade', bonus: 0.5 }],
    spaeti_alliance: [{ rank: 50, name: 'Späti Empire', bonus: 0.5 }],
    night_shift: [{ rank: 40, name: 'Night Shift Union', bonus: 0.5 }],
    spree_boat: [{ rank: 40, name: 'Spree Armada', bonus: 0.5 }],
    ringbahn_train: [{ rank: 30, name: 'Ringbahn Express', bonus: 0.5 }],
    recycling_yard: [{ rank: 25, name: 'Zero-Waste Hub', bonus: 0.5 }],
    orange_fleet: [{ rank: 25, name: 'Orange Armada', bonus: 0.5 }],
  };

  const list = [];
  const add = (a) => list.push(a);
  const big = (n) => {
    const s = ['', 'K', 'M', 'B', 'T'];
    let i = 0;
    while (n >= 1000 && i < s.length - 1) {
      n /= 1000;
      i++;
    }
    return n + s[i];
  };
  const plural = (n, name) => (n === 1 ? 'your first ' + name : n + ' × ' + name);

  // ---- zones -------------------------------------------------------------
  for (const z of ZONES.slice(1)) {
    add({
      id: 'zone_' + z.id,
      name: 'Welcome to ' + z.name,
      description: 'Unlock ' + z.name + '.',
      icon: z.icon,
      category: 'zones',
      req: { type: 'zone', zone: z.id },
    });
  }
  add({
    id: 'all_zones',
    name: 'Ganz Berlin',
    description: 'Unlock every zone.',
    icon: '🗺️',
    category: 'zones',
    req: { type: 'allZones' },
    reward: { type: 'global', pct: 0.05 },
  });

  // ---- gear ranks + evolutions -------------------------------------------
  for (const u of UP) {
    const tapTool = u.trashPerTap > 0;
    const evos = EVOLUTIONS[u.id] || [];
    for (const rank of RANKS) {
      if (evos.some((e) => e.rank === rank)) continue; // the evolution covers it
      if (State.upgradeCost(u, rank - 1) > RANK_COST_CAP) continue;
      add({
        id: 'own_' + u.id + '_' + rank,
        name: u.name + ' · ' + RANK_TITLES[rank],
        description: rank === 1 ? 'Buy ' + plural(1, u.name) + '.' : 'Own ' + plural(rank, u.name) + '.',
        icon: u.icon,
        category: 'gear',
        req: { type: 'owned', upgrade: u.id, count: rank },
      });
    }
    evos.forEach((e, i) => {
      const target = tapTool ? 'tap' : 'passive';
      const pct = e.bonus / e.rank;
      add({
        id: 'evolve_' + u.id + '_' + (i + 1),
        name: e.name,
        description:
          'Own ' + e.rank + ' × ' + u.name + '. ' + (i === 0 ? u.name : EVOLUTIONS[u.id][i - 1].name) + ' evolves: every copy adds +' +
          +(pct * 100).toFixed(2) + '% trash per ' + (target === 'tap' ? 'tap' : 'second') + '.',
        icon: '✨',
        category: 'evolution',
        req: { type: 'owned', upgrade: u.id, count: e.rank },
        reward: { type: 'perOwned', upgrade: u.id, target, pct },
        evolves: { upgrade: u.id, tier: i + 1, name: e.name },
      });
    });
  }
  const ownAllNames = { 1: ['Full Kit', 'Own at least one of every upgrade.'], 10: ['Kiez Kombinat', 'Own 10 of every upgrade.'], 25: ['Berliner Stadtreinigung', 'Own 25 of every upgrade.'], 50: ['Volkseigener Betrieb', 'Own 50 of every upgrade.'] };
  for (const n of [1, 10, 25, 50]) {
    add({
      id: 'own_all_' + n,
      name: ownAllNames[n][0],
      description: ownAllNames[n][1],
      icon: '🧰',
      category: 'gear',
      req: { type: 'ownAll', count: n },
      reward: { type: 'global', pct: n >= 25 ? 0.05 : 0.02 },
    });
  }

  // ---- trash collected ---------------------------------------------------
  const trashNames = [
    [100, 'Erste Tüte', '🛍️'],
    [1e3, 'Kehrwoche', '🧹'],
    [1e4, 'Kiez-Held', '🦸'],
    [1e5, 'Saubermann', '🧼'],
    [1e6, 'Müll-Millionär', '💰'],
    [1e7, 'Sperrmüll-Sultan', '🛋️'],
    [1e8, 'Ordnungsamt-Liebling', '📋'],
    [1e9, 'Berlin glänzt', '✨'],
    [1e10, 'Brandenburg auch', '🌲'],
    [1e11, 'Ganz Deutschland', '🇩🇪'],
    [1e12, 'Planet Sauber', '🌍'],
    [1e13, 'Galaktische Kehrwoche', '🌌'],
  ];
  for (const [amount, name, icon] of trashNames) {
    add({
      id: 'trash_' + big(amount).toLowerCase(),
      name,
      description: 'Collect ' + big(amount) + ' pieces of trash.',
      icon,
      category: 'trash',
      req: { type: 'stat', stat: 'trash', amount },
      reward: amount >= 1e9 ? { type: 'global', pct: 0.02 } : undefined,
    });
  }

  // ---- income ------------------------------------------------------------
  const perSecond = [
    [10, 'Nebenjob'],
    [100, 'Minijob'],
    [1e3, 'Vollzeit'],
    [1e4, 'Mittelstand'],
    [1e5, 'Konzern'],
    [1e6, 'Kombinat'],
    [1e7, 'Treuhand-sized'],
    [1e8, 'Bundesrepublik'],
    [1e9, 'Weltmacht'],
  ];
  for (const [amount, name] of perSecond) {
    add({
      id: 'per_second_' + big(amount).toLowerCase(),
      name,
      description: 'Reach ' + big(amount) + ' trash per second.',
      icon: '⏱️',
      category: 'income',
      req: { type: 'rate', rate: 'perSecond', amount },
      reward: { type: 'passive', pct: 0.01 },
    });
  }
  const perTap = [
    [10, 'Firm Grip'],
    [100, 'Iron Wrist'],
    [1e3, 'Pincer Pro'],
    [1e4, 'Spike Master'],
    [1e5, 'One-Stab Wonder'],
    [1e6, 'The Hand of Berlin'],
    [1e7, 'Picker of Worlds'],
  ];
  for (const [amount, name] of perTap) {
    add({
      id: 'per_tap_' + big(amount).toLowerCase(),
      name,
      description: 'Reach ' + big(amount) + ' trash per tap.',
      icon: '📌',
      category: 'income',
      req: { type: 'rate', rate: 'perTap', amount },
      reward: { type: 'tap', pct: 0.01 },
    });
  }

  // ---- taps --------------------------------------------------------------
  const taps = [
    [100, 'Warm-up', '👆'],
    [1e3, 'Repetitive Stab Injury', '🤕'],
    [5e3, 'Tennis Elbow', '🎾'],
    [1e4, 'Stabby McStabface', '🔱'],
    [25e3, 'Carpal Tunnel Club', '🩹'],
    [5e4, 'Iron Thumb', '👍'],
    [1e5, 'Unstoppable', '🚀'],
  ];
  for (const [amount, name, icon] of taps) {
    add({
      id: 'taps_' + big(amount).toLowerCase(),
      name,
      description: 'Tap ' + big(amount) + ' times.',
      icon,
      category: 'taps',
      req: { type: 'stat', stat: 'taps', amount },
      reward: { type: 'tap', pct: 0.03 },
    });
  }

  // ---- Pfand -------------------------------------------------------------
  const pfand = [
    [1, 'Erste Flasche', 'Find your first Pfand bottle.'],
    [10, 'Pfandsammler', 'Find 10 Pfand bottles.'],
    [50, 'Leergut-Liebhaber', 'Find 50 Pfand bottles.'],
    [100, 'Kiste voll', 'Find 100 Pfand bottles.'],
    [250, 'Automat kaputt', 'Find 250 Pfand bottles.'],
    [500, 'Flaschengeist', 'Find 500 Pfand bottles.'],
    [1000, 'Pfand-Gott', 'Find 1,000 Pfand bottles.'],
  ];
  for (const [amount, name, description] of pfand) {
    add({
      id: 'pfand_' + amount,
      name,
      description,
      icon: '🍾',
      category: 'pfand',
      req: { type: 'stat', stat: 'pfandBottles', amount },
      reward: { type: 'pfand', pct: 0.05 },
    });
  }
  add({
    id: 'pfand_money_1m',
    name: 'Pfandmillionär',
    description: 'Earn €1M from Pfand bottles.',
    icon: '💶',
    category: 'pfand',
    req: { type: 'stat', stat: 'pfandMoney', amount: 1e6 },
    reward: { type: 'pfand', pct: 0.1 },
  });

  // ---- special & secret --------------------------------------------------
  const onlyBrooms = (s) => UP.every((u) => u.id === 'broom' || !(s.upgrades[u.id] > 0));
  add({
    id: 'sparfuchs',
    name: 'Sparfuchs',
    description: 'Have €1B in the bank at once.',
    icon: '🦊',
    category: 'special',
    req: { type: 'stat', stat: 'money', amount: 1e9 },
  });
  add({
    id: 'beginners_luck',
    name: "Beginner's Luck",
    description: 'Find a Pfand bottle within your first 10 taps.',
    icon: '🍀',
    category: 'special',
    secret: true,
    req: { type: 'custom', test: (s) => s.pfandBottles > 0 && s.taps <= 10 },
  });
  add({
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Collect 10K trash owning nothing but brooms.',
    icon: '🧘',
    category: 'special',
    secret: true,
    req: { type: 'custom', test: (s) => s.trash >= 1e4 && onlyBrooms(s) },
    reward: { type: 'tap', pct: 0.1 },
  });
  add({
    id: 'heimweh',
    name: 'Heimweh',
    description: 'Go back to ' + ZONES[0].name + ' after unlocking ' + ZONES[ZONES.length - 1].name + '.',
    icon: '🏡',
    category: 'special',
    secret: true,
    req: { type: 'custom', test: (s, S) => s.zone === ZONES[0].id && S.isZoneUnlocked(s, ZONES[ZONES.length - 1].id) },
  });
  add({
    id: 'couch_potato',
    name: 'Couch Potato',
    description: 'Reach 1K trash per second with fewer than 500 taps.',
    icon: '🛋️',
    category: 'special',
    secret: true,
    req: { type: 'custom', test: (s, S) => s.taps < 500 && S.trashPerSecond(s) >= 1e3 },
  });

  TrashGame.ACHIEVEMENTS = Object.freeze(
    list.map((a) => {
      if (a.reward === undefined) delete a.reward;
      return Object.freeze(a);
    }),
  );
  TrashGame.ACHIEVEMENT_CATEGORIES = Object.freeze([
    ['zones', 'Zones'],
    ['gear', 'Gear'],
    ['evolution', 'Evolutions'],
    ['trash', 'Trash'],
    ['income', 'Income'],
    ['taps', 'Taps'],
    ['pfand', 'Pfand'],
    ['special', 'Special'],
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
