/*
 * Juice: visual feedback (floating numbers, animations).
 *
 * INTERFACE (main.js depends on it; keep the signatures):
 *   TrashGame.Effects.init({ tapButton, floatersEl })
 *   TrashGame.Effects.tap(result, pointerEvent|null)  // result = State.tap() -> { trash, money, pfand }
 *   TrashGame.Effects.purchase(upgrade)               // an entry from UPGRADES, after a successful buy
 *   TrashGame.Effects.zoneUnlocked(zone)              // an entry from ZONES, after a successful unlock
 *   TrashGame.Effects.travel(zone)                    // after moving to an already-unlocked zone
 *
 * Effects only changes the DOM it creates plus CSS classes on tapButton. It never
 * changes game state. Sound is TrashGame.Sound (audio.js); Effects calls it.
 *
 * STARTER IMPLEMENTATION: the Juice workstream replaces this.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const F = () => TrashGame.Format;

  let tapButton = null;
  let floatersEl = null;

  function init(opts) {
    tapButton = opts.tapButton;
    floatersEl = opts.floatersEl;
  }

  function floater(text, event, cls) {
    const f = document.createElement('div');
    f.className = 'floater' + (cls ? ' ' + cls : '');
    f.textContent = text;
    const box = tapButton.getBoundingClientRect();
    const host = floatersEl.getBoundingClientRect();
    const x = event && event.clientX ? event.clientX : box.left + box.width / 2;
    const y = event && event.clientY ? event.clientY : box.top + box.height / 2;
    f.style.left = x - host.left + 'px';
    f.style.top = y - host.top + 'px';
    floatersEl.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
  }

  function tap(result, event) {
    floater('+' + F().number(result.trash, 1), event);
    if (result.pfand > 0) floater('🍾 +' + F().money(result.pfand), null, 'pfand');
    tapButton.classList.remove('bump');
    void tapButton.offsetWidth; // restart the animation
    tapButton.classList.add('bump');
    TrashGame.Sound && TrashGame.Sound.play(result.pfand > 0 ? 'pfand' : 'tap');
  }

  function purchase() {
    TrashGame.Sound && TrashGame.Sound.play('buy');
  }

  function zoneUnlocked() {
    TrashGame.Sound && TrashGame.Sound.play('zone');
  }

  function travel() {}

  TrashGame.Effects = { init, tap, purchase, zoneUnlocked, travel };
})(typeof window !== 'undefined' ? window : globalThis);
