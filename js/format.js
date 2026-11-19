/*
 * Shared number formatting. Every UI module uses these so numbers look the same.
 *   TrashGame.Format.number(n, decimals = 0)  1234 -> "1,234", 1234567 -> "1.23M"
 *   TrashGame.Format.money(n)                 -> "€1,234" (floored)
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  function number(n, decimals = 0) {
    if (!Number.isFinite(n)) return '∞';
    if (Math.abs(n) < 1e6) {
      // Truncate rather than round, so "€14" never shows when you have 14.6 of 15.
      const f = Math.pow(10, decimals);
      const v = Math.floor(n * f + 1e-7) / f; // epsilon: 2.3 * 10 is 22.999…
      return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
    }
    // Pick the tier, then floor to 2 decimals: displayed money never exceeds what
    // you actually have, so "€3.49M" next to a "€3.50M" price is never ambiguous.
    let tier = Math.floor(Math.log10(Math.abs(n)) / 3);
    if (tier >= SUFFIXES.length) return n.toExponential(2).replace('e+', 'e');
    let v = Math.floor((n / Math.pow(1000, tier)) * 100) / 100;
    if (v >= 1000 && tier + 1 < SUFFIXES.length) v = Math.floor((n / Math.pow(1000, ++tier)) * 100) / 100;
    return v.toFixed(2) + SUFFIXES[tier];
  }

  function money(n) {
    return '€' + number(Math.floor(n));
  }

  TrashGame.Format = { number, money };
})(typeof window !== 'undefined' ? window : globalThis);
