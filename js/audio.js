/*
 * Sound effects, synthesised with the Web Audio API (no audio files, no network).
 *
 * INTERFACE:
 *   TrashGame.Sound.init({ toggleButton })  // the #soundToggle footer button
 *   TrashGame.Sound.play(name)              // 'tap' | 'pfand' | 'buy' | 'zone'; unknown names are ignored
 *   TrashGame.Sound.isMuted() / setMuted(bool)
 *
 * Extra names used only by effects.js: 'travel'.
 *
 * Must never throw: audio can be unavailable or blocked until the first user gesture.
 * The AudioContext is created (or resumed) lazily on the first user gesture.
 * The mute preference persists in localStorage["berlinTrashClicker.settings"] as
 * JSON ({ "muted": true }). Default: sound on.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  const SETTINGS_KEY = 'berlinTrashClicker.settings';
  const MASTER_VOLUME = 0.3;
  const MAX_VOICES = 6; // simultaneous sounds; extra ones are dropped
  // Minimum gap between two plays of the same sound, so rapid taps don't pile up.
  const MIN_GAP_MS = { tap: 45, pfand: 90, buy: 70, zone: 400, travel: 200 };

  let muted = false;
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let toggleEl = null;
  let unavailable = false;
  const lastPlayed = {};
  let voiceEnds = []; // ctx.currentTime at which each active voice finishes

  // ---- Settings ----------------------------------------------------------

  function readSettings() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeSettings(patch) {
    try {
      if (!root.localStorage) return;
      const next = Object.assign(readSettings(), patch);
      root.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      /* storage full or blocked: the preference just won't stick */
    }
  }

  // ---- Audio context -----------------------------------------------------

  function ensureContext() {
    if (ctx || unavailable) return ctx;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) {
        unavailable = true;
        return null;
      }
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(comp);
      comp.connect(ctx.destination);

      const len = Math.floor(ctx.sampleRate * 0.4);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
      master = null;
      unavailable = true;
    }
    return ctx;
  }

  function unlock() {
    if (muted) return;
    try {
      if (ensureContext() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) {
      /* ignore */
    }
  }

  function listenForGesture() {
    try {
      const opts = { capture: true, passive: true };
      for (const type of ['pointerdown', 'touchstart', 'keydown', 'click']) {
        root.document.addEventListener(type, unlock, opts);
      }
    } catch (e) {
      /* ignore */
    }
  }

  // ---- Synth helpers -----------------------------------------------------

  const rand = (min, max) => min + Math.random() * (max - min);

  /** Gain node with an attack/exponential-decay envelope, connected to `dest`. */
  function envelope(t, peak, attack, decay, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest || master);
    return g;
  }

  function tone({ type = 'sine', freq, freqEnd, t, peak, attack = 0.004, decay, dest }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    osc.connect(envelope(t, peak, attack, decay, dest));
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
    return t + attack + decay;
  }

  function noise({ t, peak, attack = 0.002, decay, filter = 'bandpass', freq, freqEnd, q = 1 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    src.connect(f);
    f.connect(envelope(t, peak, attack, decay));
    const offset = Math.random() * (noiseBuffer.duration - 0.2);
    src.start(t, Math.max(0, offset));
    src.stop(t + attack + decay + 0.05);
    return t + attack + decay;
  }

  /** Glass-like strike: inharmonic sine partials with fast, staggered decays. */
  function clink(t, base, peak) {
    const partials = [
      [1, 1, 0.35],
      [2.76, 0.5, 0.2],
      [5.4, 0.28, 0.1],
      [8.93, 0.14, 0.06],
    ];
    const nyquist = ctx.sampleRate * 0.45;
    let end = t;
    for (const [ratio, amp, decay] of partials) {
      if (base * ratio > nyquist) continue;
      end = Math.max(end, tone({ freq: base * ratio, t, peak: peak * amp, attack: 0.002, decay }));
    }
    noise({ t, peak: peak * 0.4, decay: 0.02, filter: 'highpass', freq: 5000 });
    return end;
  }

  // ---- Sounds ------------------------------------------------------------
  // Each returns the time at which it finishes (for voice counting).

  const SOUNDS = {
    // Soft rustle + little pop with a quick pitch drop.
    tap(t) {
      const p = rand(0.9, 1.12);
      noise({ t, peak: 0.35, decay: 0.06, freq: 2600 * p, freqEnd: 700 * p, q: 0.8 });
      return tone({ type: 'sine', freq: 420 * p, freqEnd: 130 * p, t, peak: 0.35, decay: 0.07 });
    },

    // Bright glass bottle "clink-clink".
    pfand(t) {
      const base = 1760 * rand(0.97, 1.04);
      clink(t, base, 0.32);
      return clink(t + 0.085, base * 1.06, 0.22);
    },

    // Register "ka-ching": a click, then two cheerful notes with a bell on top.
    buy(t) {
      const p = rand(0.98, 1.02);
      noise({ t, peak: 0.3, decay: 0.03, freq: 1800, q: 2 });
      tone({ type: 'triangle', freq: 1046.5 * p, t: t + 0.02, peak: 0.22, decay: 0.09 });
      const t2 = t + 0.11;
      tone({ type: 'triangle', freq: 1568 * p, t: t2, peak: 0.22, decay: 0.28 });
      return clink(t2, 3136 * p, 0.08);
    },

    // Short rising arpeggio, last note held a little longer.
    zone(t) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      let end = t;
      notes.forEach((f, i) => {
        const nt = t + i * 0.1;
        const last = i === notes.length - 1;
        tone({ type: 'triangle', freq: f, t: nt, peak: 0.22, decay: last ? 0.55 : 0.16 });
        end = Math.max(end, tone({ type: 'sine', freq: f * 2, t: nt, peak: 0.06, decay: last ? 0.4 : 0.1 }));
      });
      return end;
    },

    // Gentle whoosh for moving between zones.
    travel(t) {
      noise({ t, peak: 0.18, attack: 0.08, decay: 0.22, freq: 400, freqEnd: 2400, q: 1.2 });
      return tone({ type: 'sine', freq: 660, t: t + 0.12, peak: 0.08, decay: 0.2 });
    },
  };

  function play(name) {
    try {
      if (muted || !Object.prototype.hasOwnProperty.call(SOUNDS, name)) return;
      if (!ensureContext() || !master) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const nowMs = Date.now();
      if (nowMs - (lastPlayed[name] || 0) < (MIN_GAP_MS[name] || 0)) return;

      const t = ctx.currentTime;
      voiceEnds = voiceEnds.filter((end) => end > t);
      // Rare sounds (pfand/zone/buy) may always play; taps respect the voice limit.
      if (voiceEnds.length >= MAX_VOICES && name === 'tap') return;

      lastPlayed[name] = nowMs;
      voiceEnds.push(SOUNDS[name](t + 0.005));
    } catch (e) {
      /* never let audio break the game */
    }
  }

  // ---- Mute toggle -------------------------------------------------------

  function renderToggle() {
    if (!toggleEl) return;
    try {
      toggleEl.textContent = muted ? '🔇 Muted' : '🔊 Sound';
      toggleEl.setAttribute('aria-pressed', String(muted));
      toggleEl.title = muted ? 'Sound is off. Click to turn it on.' : 'Sound is on. Click to mute.';
    } catch (e) {
      /* ignore */
    }
  }

  function setMuted(m) {
    muted = !!m;
    try {
      if (master && ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
      }
    } catch (e) {
      /* ignore */
    }
    writeSettings({ muted });
    renderToggle();
  }

  function init(opts) {
    try {
      const settings = readSettings();
      muted = settings.muted === true;
      toggleEl = (opts && opts.toggleButton) || null;
      renderToggle();
      if (toggleEl) {
        toggleEl.addEventListener('click', () => {
          setMuted(!muted);
          if (!muted) {
            unlock();
            play('tap');
          }
        });
      }
      listenForGesture();
    } catch (e) {
      /* ignore */
    }
  }

  TrashGame.Sound = {
    init,
    play,
    isMuted: () => muted,
    setMuted,
  };
})(typeof window !== 'undefined' ? window : globalThis);
