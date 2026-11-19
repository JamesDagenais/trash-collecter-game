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
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
    }
    const tier = Math.min(Math.floor(Math.log10(Math.abs(n)) / 3), SUFFIXES.length - 1);
    return (n / Math.pow(1000, tier)).toFixed(2) + SUFFIXES[tier];
  }

  function money(n) {
    return '€' + number(Math.floor(n));
  }

  TrashGame.Format = { number, money };
})(typeof window !== 'undefined' ? window : globalThis);
