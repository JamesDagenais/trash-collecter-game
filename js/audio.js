/*
 * Sound effects.
 *
 * INTERFACE:
 *   TrashGame.Sound.init({ toggleButton })  // the #soundToggle footer button
 *   TrashGame.Sound.play(name)              // 'tap' | 'pfand' | 'buy' | 'zone'; unknown names are ignored
 *   TrashGame.Sound.isMuted() / setMuted(bool)
 *
 * Must never throw: audio can be unavailable or blocked until the first user gesture.
 *
 * STARTER IMPLEMENTATION (silent): the Juice workstream replaces this.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  let muted = false;

  TrashGame.Sound = {
    init({ toggleButton }) {
      if (toggleButton) toggleButton.textContent = '🔇 Sound (coming soon)';
    },
    play() {},
    isMuted: () => muted,
    setMuted(m) {
      muted = !!m;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
