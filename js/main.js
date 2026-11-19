/*
 * Bootstrap: load the save, wire input to state, run the loop, autosave.
 * This is the only file that changes state in response to input.
 */
(function () {
  'use strict';
  const { State, Save, UI, Shop, Effects, Sound } = window.TrashGame;
  const $ = (id) => document.getElementById(id);

  const AUTOSAVE_MS = 10000;
  const MAX_FRAME_SECONDS = 1; // don't award a huge chunk after a frozen tab

  let state = Save.load();
  let lastFrame = performance.now();

  function persist() {
    const ok = Save.save(state);
    UI.showSaveStatus(ok ? 'Saved ' + new Date().toLocaleTimeString() : 'Saving unavailable');
  }

  UI.init({
    onTap(event) {
      Effects.tap(State.tap(state), event);
    },
    onReset() {
      if (!confirm('Reset all progress? This cannot be undone.')) return;
      Save.clear();
      state = State.createState();
      persist();
    },
  });

  Shop.init({
    shopEl: $('shop'),
    zonesEl: $('zones'),
    onBuy(id) {
      if (State.buy(state, id)) {
        Effects.purchase(State.getUpgrade(id));
        persist();
      }
    },
    onUnlockZone(id) {
      if (State.unlockZone(state, id)) {
        Effects.zoneUnlocked(State.getZone(id));
        persist();
      }
    },
    onTravel(id) {
      if (State.travelTo(state, id)) {
        Effects.travel(State.getZone(id));
        persist();
      }
    },
  });

  Effects.init({ tapButton: $('tapButton'), floatersEl: $('floaters') });
  Sound.init({ toggleButton: $('soundToggle') });

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
    lastFrame = now;
    State.tick(state, dt);
    UI.render(state);
    Shop.render(state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(persist, AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
  window.addEventListener('pagehide', persist);

  // Handy for debugging from the console: TrashGame.debug.state
  window.TrashGame.debug = {
    get state() {
      return state;
    },
  };
})();
