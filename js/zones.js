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
 *
 * Design (see docs/economy.md):
 *   - Each unlock costs ~10-20x the previous one and is a big jump in income.
 *   - Most zones have a 1.5-2% Pfand chance. Mauerpark and Warschauer Straße are
 *     PFAND-RICH: 6% chance but a lower trashMultiplier than the zone before
 *     them. While tapping (~4 taps/s) they earn more than that zone; when you
 *     go idle, the zone before them (Tempelhofer Feld / RAW-Gelände) earns
 *     more. That's the reason to travel back and forth.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  TrashGame.ZONES = Object.freeze([
    {
      id: 'your_kiez',
      name: 'Your Kiez',
      description: 'The street outside your Altbau. Cigarette butts and Späti bottle caps.',
      icon: '🏠',
      unlockCost: 0,
      trashMultiplier: 1,
      pfandChance: 0.02,
    },
    {
      id: 'goerli',
      name: 'Görlitzer Park',
      description: 'Görli after a sunny weekend. Pizza boxes as far as the eye can see.',
      icon: '🌳',
      unlockCost: 10000,
      trashMultiplier: 2,
      pfandChance: 0.02,
    },
    {
      id: 'tempelhofer_feld',
      name: 'Tempelhofer Feld',
      description: 'An old airport runway with a barbecue on every square metre. The wind does the rest.',
      icon: '🛫',
      unlockCost: 200000,
      trashMultiplier: 4,
      pfandChance: 0.015,
    },
    {
      id: 'mauerpark',
      name: 'Mauerpark on a Sunday',
      description: 'Flea market, karaoke and a thousand empty bottles. Pfand paradise if you keep tapping.',
      icon: '🎤',
      unlockCost: 2500000,
      trashMultiplier: 3.5,
      pfandChance: 0.06,
    },
    {
      id: 'raw_gelaende',
      name: 'RAW-Gelände',
      description: 'Graffiti, clubs and the morning after. Mind the broken glass.',
      icon: '🎨',
      unlockCost: 40000000,
      trashMultiplier: 7,
      pfandChance: 0.015,
    },
    {
      id: 'warschauer_str',
      name: 'Warschauer Straße',
      description: 'Friday night on the bridge left bottles everywhere. Pfand paradise if you keep tapping.',
      icon: '🌉',
      unlockCost: 800000000,
      trashMultiplier: 6.5,
      pfandChance: 0.06,
    },
    {
      id: 'alexanderplatz',
      name: 'Alexanderplatz',
      description: 'Under the Fernsehturm the whole city passes through. So does its trash.',
      icon: '🗼',
      unlockCost: 10000000000,
      trashMultiplier: 12,
      pfandChance: 0.02,
    },
  ].map(Object.freeze));
})(typeof window !== 'undefined' ? window : globalThis);
