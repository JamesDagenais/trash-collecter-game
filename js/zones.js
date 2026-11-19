/*
 * ZONES DATA FILE — contract (same rules as upgrades.js).
 * =======================================================
 * Zones are Berlin neighbourhoods you clean. You start in the first zone.
 * Zones unlock IN ORDER, each for a one-time € price. Unlocking a zone moves
 * you there, and you can move back to any unlocked zone for free.
 *
 * Each entry MUST have:
 *   id              string  Unique, stable snake_case. Used as a save key; never rename.
 *   name            string  Display name, e.g. "Görlitzer Park".
 *   description     string  One short flavour line.
 *   icon            string  A single emoji.
 *   unlockCost      number  One-time € price (the first zone must be 0, the rest > 0).
 *   trashMultiplier number  Multiplies BOTH trash per tap and trash per second while
 *                           you're in this zone (>= 1).
 *   pfandChance     number  Chance (0..1) that a tap also finds a Pfand bottle
 *                           (bonus money, see State.pfandValue).
 *
 * Keep the list sorted by unlockCost.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  // PLACEHOLDER VALUES. The Economy workstream owns the real list and balance.
  TrashGame.ZONES = Object.freeze([
    {
      id: 'your_kiez',
      name: 'Your Kiez',
      description: 'The street outside your Altbau. Cigarette butts everywhere.',
      icon: '🏠',
      unlockCost: 0,
      trashMultiplier: 1,
      pfandChance: 0.02,
    },
    {
      id: 'warschauer_str',
      name: 'Warschauer Straße',
      description: 'Friday night left a lot behind.',
      icon: '🌉',
      unlockCost: 5000,
      trashMultiplier: 2,
      pfandChance: 0.04,
    },
  ].map(Object.freeze));
})(typeof window !== 'undefined' ? window : globalThis);
