/*
 * Bootstrap: load the save, wire input to state, run the loop, autosave.
 */
(function () {
  'use strict';
  const { State, Save, UI } = window.TrashGame;

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
      const gained = State.tap(state);
      UI.spawnFloater(gained, event);
    },
    onBuy(id) {
      if (State.buy(state, id)) persist();
    },
    onReset() {
      if (!confirm('Reset all progress? This cannot be undone.')) return;
      Save.clear();
      state = State.createState();
      persist();
    },
  });

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
    lastFrame = now;
    State.tick(state, dt);
    UI.render(state);
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
