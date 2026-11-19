/*
 * UPGRADES DATA FILE — the contract.
 * ===================================
 * Every system (game logic, UI, save/load, and any future feature work)
 * reads upgrades ONLY from this list. Add, rebalance, or reorder upgrades
 * here; no other file should hard-code upgrade names, costs or effects.
 *
 * Each entry MUST have:
 *   id             string   Unique, stable, snake_case. Used as the save-file key,
 *                           so never rename an id once shipped (add a new one instead).
 *   name           string   Display name.
 *   description    string   One short flavour line for the shop.
 *   icon           string   A single emoji shown in the shop.
 *   baseCost       number   Price in € of the FIRST copy (> 0).
 *   trashPerTap    number   Trash added to every tap, per copy owned (>= 0).
 *   trashPerSecond number   Trash collected automatically, per copy owned (>= 0).
 *
 * Optional:
 *   costGrowth     number   Price multiplier per copy owned (> 1).
 *                           Defaults to TrashGame.CONFIG.DEFAULT_COST_GROWTH.
 *
 * Price of the next copy = baseCost * costGrowth ^ owned  (see state.js).
 * Every upgrade should give at least one of trashPerTap / trashPerSecond.
 * Keep the list sorted by baseCost; the shop renders it in this order.
 *
 * The player always starts with a bare trash pick, worth
 * CONFIG.BASE_TRASH_PER_TAP. It's the starting tool, not an upgrade.
 *
 * Design (see docs/economy.md; tune with `node tools/simulate.js`):
 *   - Tap tools are the ladder trash pick -> Old Broom -> Bin Bags -> Push Cart
 *     -> Street Sweeper. Everything else is passive help.
 *   - Each tier costs ~2.5-6x the previous one. At 4 taps/s a tap tool pays for
 *     itself faster than the helpers around it (it only works while you tap).
 *   - Later tiers pay back more slowly, so the game stretches out: first buy
 *     after ~15 taps, a new item every ~0.5-2 min for the first 10 minutes,
 *     every ~3-7 min late, and everything bought once after ~45 min at 4 taps/s.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  TrashGame.UPGRADES = Object.freeze([
    // ---- Your Kiez: the first few minutes ----------------------------------
    {
      id: 'broom',
      name: 'Old Broom',
      description: 'Found leaning on a Späti wall. Missing a few bristles.',
      icon: '🧹',
      baseCost: 15,
      trashPerTap: 1,
      trashPerSecond: 0,
    },
    {
      id: 'helpful_neighbour',
      name: 'Helpful Neighbour',
      description: 'Frau Schulz from the Vorderhaus sweeps the Hinterhof while her coffee brews.',
      icon: '🧑‍🦳',
      baseCost: 100,
      trashPerTap: 0,
      trashPerSecond: 5,
    },
    {
      id: 'garbage_bags',
      name: 'Bin Bags',
      description: 'A roll of extra-strong bags. Fewer trips to the Hinterhof bins.',
      icon: '🛍️',
      baseCost: 500,
      trashPerTap: 4,
      trashPerSecond: 0,
    },
    {
      id: 'pfand_collector',
      name: 'Pfand Collector',
      description: 'Knows every bottle on the Admiralbrücke by name.',
      icon: '🍾',
      baseCost: 2500,
      trashPerTap: 0,
      trashPerSecond: 30,
    },
    // ---- Görli and Tempelhof: wheels and crews -----------------------------
    {
      id: 'cargo_bike',
      name: 'Cargo Bike',
      description: 'A Lastenrad stacked with bins. Very Kreuzberg.',
      icon: '🚲',
      baseCost: 12000,
      trashPerTap: 0,
      trashPerSecond: 75,
    },
    {
      id: 'handcart',
      name: 'Push Cart',
      description: 'An orange push cart with a broom holder. Rattles over every cobblestone.',
      icon: '🛒',
      baseCost: 50000,
      trashPerTap: 90,
      trashPerSecond: 0,
    },
    {
      id: 'kiez_crew',
      name: 'Kiez Cleanup Crew',
      description: 'Neighbours with grabbers and gloves, every Saturday, rain or shine.',
      icon: '👷',
      baseCost: 200000,
      trashPerTap: 0,
      trashPerSecond: 500,
    },
    {
      id: 'spaeti_alliance',
      name: 'Späti Alliance',
      description: 'Every Späti on the block sweeps its own stretch of pavement. Club-Mate for volunteers.',
      icon: '🏪',
      baseCost: 800000,
      trashPerTap: 0,
      trashPerSecond: 1300,
    },
    // ---- The city wakes up: night shifts, boats, machines ------------------
    {
      id: 'night_shift',
      name: 'U-Bahn Night Shift',
      description: 'Clears the U8 platforms between the last train and the first.',
      icon: '🚇',
      baseCost: 3500000,
      trashPerTap: 0,
      trashPerSecond: 4000,
    },
    {
      id: 'spree_boat',
      name: 'Spree Skimmer Boat',
      description: 'Fishes bottles, bikes and the odd e-scooter out of the Spree.',
      icon: '🚤',
      baseCost: 15000000,
      trashPerTap: 0,
      trashPerSecond: 12000,
    },
    {
      id: 'sweeper_truck',
      name: 'Street Sweeper',
      description: 'Bright orange, brushes spinning. Eats Kottbusser Tor for breakfast.',
      icon: '🚛',
      baseCost: 80000000,
      trashPerTap: 20000,
      trashPerSecond: 0,
    },
    // ---- Late game: the whole city works for you ---------------------------
    {
      id: 'ringbahn_train',
      name: 'Ringbahn Cleaning Train',
      description: 'Loops the whole Ring every hour and never misses a platform.',
      icon: '🚆',
      baseCost: 200000000,
      trashPerTap: 0,
      trashPerSecond: 90000,
    },
    {
      id: 'recycling_yard',
      name: 'Recycling Yard',
      description: 'Your own Recyclinghof. The trash comes to you now.',
      icon: '♻️',
      baseCost: 1200000000,
      trashPerTap: 0,
      trashPerSecond: 400000,
    },
    {
      id: 'orange_fleet',
      name: 'Orange Fleet',
      description: 'A whole depot of orange trucks. Every Bezirk, every morning.',
      icon: '🏭',
      baseCost: 4000000000,
      trashPerTap: 0,
      trashPerSecond: 1000000,
    },
  ].map(Object.freeze));
})(typeof window !== 'undefined' ? window : globalThis);
