/*
 * Bootstrap: load the save, wire input to state, run the loop, autosave.
 * This is the only file that changes state in response to input.
 */
(function () {
  'use strict';
  const { State, Save, UI, Shop, Effects, Sound } = window.TrashGame;
  const Awards = window.TrashGame.Awards;
  const $ = (id) => document.getElementById(id);

  const AUTOSAVE_MS = 10000;
  const MAX_FRAME_SECONDS = 1; // a hitch or frozen tab never awards a big chunk at once
  const AWAY_MIN_SECONDS = 10; // shorter absences aren't worth a "welcome back"
  const ACHIEVEMENT_CHECK_MS = 250;
  const MAX_ACHIEVEMENT_TOASTS = 3; // more at once become one summary toast

  let state = Save.load();
  let lastFrame = performance.now();
  let hiddenAt = null;

  function persist() {
    const ok = Save.save(state);
    if (ok) {
      UI.showSaveStatus('Saved ' + new Date().toLocaleTimeString());
    } else if (Save.lastResult === 'stale') {
      // Another tab (or a Reset there) saved newer progress: switch to it.
      state = Save.load();
      UI.showSaveStatus('Synced with another tab');
    } else {
      UI.showSaveStatus('Saving unavailable');
    }
  }

  /** Unlocks whatever has been earned and celebrates it. quiet: summary only. */
  function checkAchievements(quiet) {
    const fresh = State.checkAchievements(state);
    if (!fresh.length) return;
    const announce = Effects.achievement ? Effects.achievement.bind(Effects) : null;
    const evolutions = fresh.filter((a) => a.evolves);
    if (announce) {
      if (quiet || fresh.length > MAX_ACHIEVEMENT_TOASTS) {
        if (Effects.achievementSummary) Effects.achievementSummary(fresh);
      } else {
        for (const a of fresh) if (!a.evolves) announce(a);
      }
      // Evolutions are big moments: always shown (the newest one if several).
      if (!quiet && evolutions.length && Effects.evolution) {
        const e = evolutions[evolutions.length - 1];
        Effects.evolution(e, State.getUpgrade(e.evolves.upgrade));
      }
    }
    persist();
  }

  /** Credits passive income for time away and says so. */
  function welcomeBack(seconds) {
    if (!(seconds >= AWAY_MIN_SECONDS)) return;
    const result = State.awayProgress(state, seconds);
    if (result.money >= 1 && Effects.welcomeBack) Effects.welcomeBack(result);
  }

  UI.init({
    onTap(event) {
      Effects.tap(State.tap(state), event);
      checkAchievements();
    },
    onReset() {
      if (!confirm('Reset all progress? This cannot be undone.')) return;
      // Save the fresh game OVER the old one (rather than clearing it), with the
      // stored revision, so a stale tab can't write the old game back.
      const rev = Save.storedRev();
      state = State.createState();
      state.saveRev = rev;
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
        checkAchievements();
      }
    },
    onUnlockZone(id) {
      if (State.unlockZone(state, id)) {
        Effects.zoneUnlocked(State.getZone(id));
        persist();
        checkAchievements();
      }
    },
    onTravel(id) {
      if (State.travelTo(state, id)) {
        Effects.travel(State.getZone(id));
        persist();
        checkAchievements();
      }
    },
  });

  Effects.init({ tapButton: $('tapButton'), floatersEl: $('floaters') });
  Sound.init({ toggleButton: $('soundToggle') });
  if (Awards) Awards.init({ el: $('achievements'), tab: $('tabAwards') });

  // Time since the last save counts as time away (the game was closed).
  if (state.lastSaved) welcomeBack((Date.now() - state.lastSaved) / 1000);
  // Older saves (and away progress) may already qualify for achievements.
  checkAchievements(true);
  let lastAchievementCheck = 0;

  function frame(now) {
    requestAnimationFrame(frame); // first, so one bad frame can't stop the game
    const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_SECONDS);
    lastFrame = now;
    State.tick(state, dt);
    if (now - lastAchievementCheck >= ACHIEVEMENT_CHECK_MS) {
      lastAchievementCheck = now;
      checkAchievements();
    }
    UI.render(state);
    Shop.render(state);
    if (Awards) Awards.render(state);
  }
  requestAnimationFrame(frame);

  setInterval(persist, AUTOSAVE_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      persist();
      return;
    }
    if (hiddenAt === null) return;
    // Back again. If another tab played meanwhile, take its progress and only
    // credit the time since IT last saved; otherwise credit our own time away.
    let awayFrom = hiddenAt;
    if (Save.storedRev() > (state.saveRev || 0)) {
      state = Save.load();
      awayFrom = state.lastSaved || Date.now();
    }
    hiddenAt = null;
    lastFrame = performance.now();
    welcomeBack((Date.now() - awayFrom) / 1000);
  });

  window.addEventListener('pagehide', persist);

  // Another tab saved: adopt its progress so the two never overwrite each other.
  window.addEventListener('storage', (e) => {
    if (e.key === Save.SAVE_KEY && e.newValue && Save.storedRev() > (state.saveRev || 0)) {
      state = Save.load();
      UI.showSaveStatus('Synced with another tab');
    }
  });

  // Handy for debugging from the console: TrashGame.debug.state
  window.TrashGame.debug = {
    get state() {
      return state;
    },
  };
})();
