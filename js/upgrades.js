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
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  TrashGame.UPGRADES = Object.freeze([
    {
      id: 'broom',
      name: 'Old Broom',
      description: 'Found behind a Späti. Missing a few bristles.',
      icon: '🧹',
      baseCost: 15,
      trashPerTap: 1,
      trashPerSecond: 0,
    },
    {
      id: 'helpful_neighbour',
      name: 'Helpful Neighbour',
      description: 'Sweeps the Hinterhof while the coffee brews.',
      icon: '🧑‍🦳',
      baseCost: 60,
      trashPerTap: 0,
      trashPerSecond: 0.5,
    },
    {
      id: 'garbage_bags',
      name: 'Garbage Bags',
      description: 'A roll of extra-strong bags. Fewer trips to the bin.',
      icon: '🛍️',
      baseCost: 200,
      trashPerTap: 3,
      trashPerSecond: 0,
    },
    {
      id: 'pfand_collector',
      name: 'Pfand Collector',
      description: 'Knows every bottle on the Admiralbrücke by name.',
      icon: '🍾',
      baseCost: 750,
      trashPerTap: 0,
      trashPerSecond: 4,
    },
    {
      id: 'work_gloves',
      name: 'Heavy-Duty Gloves',
      description: 'Grab broken glass and kebab wrappers without worry.',
      icon: '🧤',
      baseCost: 2000,
      trashPerTap: 10,
      trashPerSecond: 0,
    },
    {
      id: 'cargo_bike',
      name: 'Cargo Bike',
      description: 'A Lastenrad full of bins. Very Kreuzberg.',
      icon: '🚲',
      baseCost: 6000,
      trashPerTap: 0,
      trashPerSecond: 20,
    },
    {
      id: 'handcart',
      name: 'Handcart',
      description: 'Big wheels for cobblestones and big hauls.',
      icon: '🛒',
      baseCost: 15000,
      trashPerTap: 40,
      trashPerSecond: 0,
    },
    {
      id: 'kiez_crew',
      name: 'Kiez Cleanup Crew',
      description: 'Volunteers clearing out the whole neighbourhood every Saturday.',
      icon: '👷',
      baseCost: 40000,
      trashPerTap: 0,
      trashPerSecond: 100,
    },
    {
      id: 'leaf_blower',
      name: 'Leaf Blower',
      description: 'Loud, effective, and hated by everyone at 7am.',
      icon: '🍂',
      baseCost: 120000,
      trashPerTap: 200,
      trashPerSecond: 0,
    },
    {
      id: 'sweeper_truck',
      name: 'Street Sweeper Truck',
      description: 'An orange beast that eats Kottbusser Tor for breakfast.',
      icon: '🚛',
      baseCost: 400000,
      trashPerTap: 0,
      trashPerSecond: 600,
    },
    {
      id: 'recycling_yard',
      name: 'Recycling Yard',
      description: 'Your own Recyclinghof. The trash comes to you now.',
      icon: '♻️',
      baseCost: 1500000,
      trashPerTap: 0,
      trashPerSecond: 3000,
    },
  ].map(Object.freeze));
})(typeof window !== 'undefined' ? window : globalThis);
