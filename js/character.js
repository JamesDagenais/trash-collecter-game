/*
 * The street scene: the hero with his litter picker, the zone backdrop, and every
 * owned upgrade drawn into the picture. Pixel art on one <canvas>.
 *
 * INTERFACE (used by ui.js, effects.js, shop.js):
 *   TrashGame.Character.init({ canvas, stage })   canvas is drawn at low resolution and
 *        scaled up with image-rendering: pixelated; stage is the element it fills.
 *   TrashGame.Character.render(state)    call every frame. Cheap: it only redraws the
 *        canvas when something visible changed (animation frame, owned set, zone, size).
 *   TrashGame.Character.pick({ pfand })  play the "spear a piece of trash" animation.
 *        Rapid taps queue (max QUEUE_MAX) and the loop speeds up instead of piling up.
 *   TrashGame.Character.anchor()         -> { x, y } client coordinates of the trash
 *        the hero is about to spear (floaters rise from there), or null.
 *   TrashGame.Character.zoneThumb(zoneId, w, h) -> data: URL of a small zone backdrop.
 *
 * VISUALS is the single mapping table from upgrade id -> how it shows up in the
 * scene, and ZONE_SCENES from zone id -> backdrop. Unknown ids simply add nothing;
 * unknown zones get a generic street. Reads state only; never changes it.
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});
  const P = () => TrashGame.Pixel;

  const QUEUE_MAX = 2;
  const TARGET_W = 96; // art pixels across a phone-width stage
  const TARGET_H = 118; // minimum art pixels of height before we shrink the pixel size

  // ---- small utils -------------------------------------------------------

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ri = (r, a, b) => Math.floor(a + r() * (b - a + 1));
  const pickOf = (r, arr) => arr[Math.floor(r() * arr.length)];

  /** Depth rows: buildings stand on the horizon, vehicles use the road row just
   * in front of it, helpers stand on the sidewalk row, the hero on the floor. */
  function horizon(H, floor) {
    return floor - Math.max(8, Math.round(H * 0.3));
  }

  // ---- backdrop painters ---------------------------------------------------
  // Each painter gets (ctx, g) where g = { W, H, hz (horizon y), floor (feet y), r (seeded rng) }.

  function sky(ctx, g, bands, opts) {
    const { rect, dither } = P();
    const n = bands.length;
    const bh = g.hz / n;
    for (let i = 0; i < n; i++) {
      const y0 = Math.floor(i * bh);
      rect(ctx, 0, y0, g.W, Math.ceil(bh) + 1, bands[i]);
      if (i > 0) dither(ctx, 0, y0, g.W, 2, bands[i - 1], null);
    }
    opts = opts || {};
    if (opts.stars) {
      for (let i = 0; i < opts.stars; i++) {
        const x = ri(g.r, 0, g.W - 1);
        const y = ri(g.r, 1, Math.floor(g.hz * 0.45));
        P().px(ctx, x, y, g.r() < 0.3 ? '#fff3c8' : '#cbb8d6');
      }
    }
    if (opts.moon) {
      const mx = Math.round(g.W * opts.moon), my = Math.max(8, Math.round(g.hz * 0.16));
      P().disc(ctx, mx, my, 4, '#f3e2b8');
      P().disc(ctx, mx + 2, my - 1, 3, bands[0]);
    }
    if (opts.sun) {
      const sx = Math.round(g.W * opts.sun);
      P().disc(ctx, sx, g.hz - 2, 11, '#f0b45a');
      P().disc(ctx, sx, g.hz - 2, 8, '#f7cf7a');
    }
    if (opts.clouds) {
      for (let i = 0; i < opts.clouds; i++) cloud(ctx, ri(g.r, -6, g.W - 10), ri(g.r, 6, Math.floor(g.hz * 0.4)), ri(g.r, 10, 20), opts.cloudColor || bands[Math.min(n - 1, 2)]);
    }
  }

  function cloud(ctx, x, y, w, c) {
    const { rect } = P();
    rect(ctx, x + 2, y, w - 6, 2, c);
    rect(ctx, x, y + 2, w, 2, c);
    rect(ctx, x + 4, y - 2, Math.max(2, w / 3), 2, c);
  }

  function windowsGrid(ctx, g, x, top, w, bottom, lit, pitchX, pitchY) {
    const { rect } = P();
    pitchX = pitchX || 4;
    pitchY = pitchY || 6;
    for (let y = top + 3; y + 3 <= bottom - 2; y += pitchY) {
      for (let wx = x + 2; wx + 2 <= x + w - 1; wx += pitchX) {
        const on = g.r() < lit;
        rect(ctx, wx, y, 2, 3, on ? '#f2c76b' : '#2a2238');
        if (on && g.r() < 0.4) rect(ctx, wx, y, 2, 1, '#ffe7a6');
      }
    }
  }

  function building(ctx, g, x, w, h, body, shade, lit, opts) {
    const { rect } = P();
    const top = g.hz - h;
    rect(ctx, x, top, w, h, body);
    rect(ctx, x + w - 2, top, 2, h, shade);
    rect(ctx, x - 1, top - 1, w + 2, 2, shade); // cornice
    if (opts && opts.roof) rect(ctx, x + 2, top - 3, w - 4, 2, shade);
    windowsGrid(ctx, g, x, top, w - 1, g.hz - 6, lit);
    if (opts && opts.door) rect(ctx, x + Math.floor(w / 2) - 2, g.hz - 6, 4, 6, '#2a1d22');
  }

  function skylineBack(ctx, g, color, minH, maxH) {
    const { rect } = P();
    let x = -4;
    while (x < g.W) {
      const w = ri(g.r, 8, 18);
      const h = ri(g.r, minH, maxH);
      rect(ctx, x, g.hz - h, w, h, color);
      if (g.r() < 0.3) rect(ctx, x + 2, g.hz - h - 3, 1, 3, color); // chimney/antenna
      x += w;
    }
  }

  function tree(ctx, g, x, base, r, dark, light) {
    const { rect, disc, dither } = P();
    rect(ctx, x - 1, base - r - 4, 2, r + 4, '#3e2a22');
    disc(ctx, x, base - r - 5, r, dark);
    disc(ctx, x - 1, base - r - 6, Math.max(2, r - 2), light);
    dither(ctx, x - r + 1, base - r - 3, r * 2 - 2, 2, dark, null);
  }

  function lamp(ctx, g, x, base, h) {
    const { rect, dither, draw } = P();
    rect(ctx, x, base - h, 1, h, '#2a2238');
    rect(ctx, x - 1, base - 2, 3, 2, '#2a2238');
    dither(ctx, x - 6, base - h + 1, 13, 7, null, 'rgba(255,216,107,0.35)');
    draw(ctx, 'lamp', x - 3, base - h - 2);
  }

  function fernsehturm(ctx, g, x, base, h) {
    const { rect, disc, dither } = P();
    const ballY = Math.round(base - h * 0.66);
    const r = Math.max(3, Math.round(h * 0.075));
    // shaft
    rect(ctx, x - 1, ballY, 3, base - ballY, '#b9b4c4');
    rect(ctx, x + 1, ballY, 1, base - ballY, '#8d879c');
    rect(ctx, x - 2, base - 6, 5, 6, '#8d879c');
    // ball
    disc(ctx, x, ballY, r, '#c9c4d2');
    dither(ctx, x - r, ballY, r * 2 + 1, 1, '#8d879c', null);
    rect(ctx, x - r + 1, ballY + 1, r * 2 - 1, 1, '#f2c76b'); // lit restaurant ring
    rect(ctx, x, ballY - r - Math.round(h * 0.1), 1, Math.round(h * 0.1), '#b9b4c4');
    // antenna, red/white
    const aTop = Math.round(base - h);
    for (let y = aTop; y < ballY - r - Math.round(h * 0.1); y++) P().px(ctx, x, y, (y >> 1) % 2 ? '#c4473a' : '#f3e7cf');
    P().px(ctx, x, aTop - 1, '#ff6b5a');
  }

  function groundBase(ctx, g, top, bottom) {
    const { rect } = P();
    rect(ctx, 0, g.hz, g.W, g.H - g.hz, top);
    rect(ctx, 0, g.floor - 3, g.W, g.H - g.floor + 3, bottom);
  }

  function sidewalk(ctx, g, slab, line, curb) {
    const { rect, dither } = P();
    const road = Math.max(3, Math.round((g.floor - g.hz) * 0.25));
    rect(ctx, 0, g.hz, g.W, road, '#2d2a36'); // the road
    dither(ctx, 0, g.hz, g.W, 1, '#3d3946', null);
    for (let x = 2; x < g.W; x += 10) rect(ctx, x, g.hz + Math.floor(road / 2), 5, 1, '#6d6676');
    const kerb = g.hz + road;
    rect(ctx, 0, kerb, g.W, 2, curb);
    rect(ctx, 0, kerb + 2, g.W, g.H - kerb - 2, slab);
    // mosaic cobbles near the curb, big slabs in the middle (very Berlin)
    dither(ctx, 0, kerb + 2, g.W, 3, line, null);
    for (let y = kerb + 6; y < g.H; y += 7) {
      rect(ctx, 0, y, g.W, 1, line);
      const off = ((y - g.hz) / 7) % 2 ? 0 : 6;
      for (let x = off; x < g.W; x += 12) rect(ctx, x, y, 1, 7, line);
    }
  }

  const ZONE_SCENES = {
    your_kiez: {
      trash: ['t_can', 't_mate', 't_paper', 't_cup', 't_chips'],
      paint(ctx, g) {
        sky(ctx, g, ['#2b1e3a', '#43294f', '#6b3f5f', '#a45e5e'], { stars: 14, moon: 0.82, clouds: 2, cloudColor: '#5a3758' });
        skylineBack(ctx, g, '#3a2645', Math.round(g.hz * 0.45), Math.round(g.hz * 0.7));
        const cols = [['#b5835a', '#8a5f40'], ['#8a6a8a', '#644a66'], ['#6f8f86', '#4f6a64'], ['#c09a6a', '#94714a'], ['#9a5b4e', '#733f38']];
        let x = -3;
        let i = 0;
        while (x < g.W) {
          const w = ri(g.r, 22, 30);
          const h = Math.round(g.hz * (0.5 + g.r() * 0.22));
          const c = cols[(i + ri(g.r, 0, 1)) % cols.length];
          building(ctx, g, x, w, h, c[0], c[1], 0.38, { door: i % 2 === 1, roof: g.r() < 0.5 });
          if (i === 1) {
            // a bit of graffiti on the ground floor
            P().line(ctx, x + 3, g.hz - 4, x + 8, g.hz - 7, '#3fa06a', 1);
            P().line(ctx, x + 8, g.hz - 7, x + 11, g.hz - 3, '#e2ac45', 1);
          }
          x += w + 1;
          i++;
        }
        sidewalk(ctx, g, '#77707f', '#5d576c', '#a39cab');
        lamp(ctx, g, Math.round(g.W * 0.7), g.hz + Math.max(4, Math.round((g.floor - g.hz) * 0.3)), Math.round(g.hz * 0.45));
      },
    },
    goerli: {
      trash: ['t_pizza', 't_cup', 't_can', 't_mate', 't_chips'],
      paint(ctx, g) {
        sky(ctx, g, ['#253349', '#3b5568', '#68827a', '#bf9460'], { clouds: 4, cloudColor: '#7d8f88' });
        skylineBack(ctx, g, '#34465a', Math.round(g.hz * 0.3), Math.round(g.hz * 0.5));
        const n = Math.max(5, Math.round(g.W / 16));
        for (let i = 0; i < n; i++) {
          const x = Math.round((i + 0.3 + g.r() * 0.4) * (g.W / n));
          tree(ctx, g, x, g.hz + 2, ri(g.r, Math.max(4, Math.round(g.hz * 0.1)), Math.max(6, Math.round(g.hz * 0.17))), '#2c5546', '#43663b');
        }
        P().rect(ctx, 0, g.hz, g.W, g.H - g.hz, '#4f7a3e');
        P().dither(ctx, 0, g.hz, g.W, g.H - g.hz, '#43663b', null);
        // dirt path where the hero stands
        P().rect(ctx, 0, g.floor - 7, g.W, 9, '#8a6a4a');
        P().dither(ctx, 0, g.floor - 7, g.W, 1, '#4f7a3e', null);
        P().dither(ctx, 0, g.floor + 1, g.W, 1, '#4f7a3e', null);
        // bench
        const bx = Math.round(g.W * 0.08);
        P().rect(ctx, bx, g.hz + 2, 14, 2, '#8f5f3c');
        P().rect(ctx, bx, g.hz - 1, 14, 2, '#8f5f3c');
        P().rect(ctx, bx + 1, g.hz + 4, 1, 3, '#2a2238');
        P().rect(ctx, bx + 12, g.hz + 4, 1, 3, '#2a2238');
      },
    },
    tempelhofer_feld: {
      trash: ['t_cup', 't_can', 't_paper', 't_chips', 't_mate'],
      paint(ctx, g) {
        g.hz = Math.round(g.hz + (g.floor - g.hz) * 0.15);
        sky(ctx, g, ['#3a2a4a', '#633b5c', '#a85a58', '#dc9450'], { sun: 0.62, clouds: 3, cloudColor: '#c27860' });
        // kites
        P().draw(ctx, 'kite', Math.round(g.W * 0.18), Math.round(g.hz * 0.2));
        P().dither(ctx, Math.round(g.W * 0.18) + 3, Math.round(g.hz * 0.2) + 7, 1, 10, '#2a2238', null);
        P().draw(ctx, 'kite', Math.round(g.W * 0.86), Math.round(g.hz * 0.33));
        // the old terminal: long and low
        const tx = Math.round(g.W * 0.02), tw = Math.round(g.W * 0.45);
        P().rect(ctx, tx, g.hz - 7, tw, 7, '#6a5a6e');
        P().rect(ctx, tx, g.hz - 8, tw, 1, '#4a3c52');
        for (let x = tx + 2; x < tx + tw - 2; x += 3) P().rect(ctx, x, g.hz - 5, 1, 2, '#f2c76b');
        // radar tower with its ball
        const rx = Math.round(g.W * 0.4);
        P().rect(ctx, rx, g.hz - 18, 2, 11, '#6a5a6e');
        P().disc(ctx, rx + 1, g.hz - 21, 3, '#e8e0ec');
        // grass + runway in perspective
        P().rect(ctx, 0, g.hz, g.W, g.H - g.hz, '#6d7a3e');
        P().dither(ctx, 0, g.hz, g.W, 2, '#8a8a4a', null);
        const mid = g.W / 2;
        for (let y = g.hz + 1; y < g.H; y++) {
          const t = (y - g.hz) / (g.H - g.hz);
          const half = 6 + t * g.W * 0.75;
          P().rect(ctx, mid - half, y, half * 2, 1, '#5d576c');
          if (((y - g.hz) >> 1) % 3 === 0) P().rect(ctx, mid - 1 - t * 2, y, 2 + t * 4, 1, '#f3e7cf');
        }
      },
    },
    mauerpark: {
      trash: ['pfand', 't_can', 't_cup', 't_mate', 't_flyer'],
      paint(ctx, g) {
        sky(ctx, g, ['#2e4a63', '#466c84', '#79999a', '#d0b278'], { clouds: 4, cloudColor: '#a9b8b0' });
        // the hill with the big swing
        P().disc(ctx, Math.round(g.W * 0.82), g.hz + 12, 30, '#4f7a3e');
        const sx = Math.round(g.W * 0.82), sy = g.hz - 17;
        P().line(ctx, sx - 6, sy + 12, sx, sy, '#2a2238', 1);
        P().line(ctx, sx + 6, sy + 12, sx, sy, '#2a2238', 1);
        P().line(ctx, sx - 2, sy, sx - 4, sy + 8, '#2a2238', 1);
        P().rect(ctx, sx - 6, sy + 8, 4, 1, '#c4473a');
        tree(ctx, g, Math.round(g.W * 0.62), g.hz - 2, 7, '#2c5546', '#43663b');
        // the Wall, covered in graffiti
        const wx = -2, ww = Math.round(g.W * 0.7), wh = 13;
        P().rect(ctx, wx, g.hz - wh, ww, wh, '#bdb6c4');
        P().rect(ctx, wx, g.hz - wh - 2, ww, 2, '#8d879c');
        for (let x = wx; x < wx + ww; x += 9) P().rect(ctx, x, g.hz - wh, 1, wh, '#9c95a6');
        const tags = ['#c4473a', '#3fa06a', '#e2ac45', '#4a76b5', '#6a4072', '#ee7a22'];
        for (let i = 0; i < ww / 5; i++) {
          const x = ri(g.r, wx + 1, wx + ww - 6), y = ri(g.r, g.hz - wh + 2, g.hz - 4);
          const c = pickOf(g.r, tags);
          if (g.r() < 0.5) P().rect(ctx, x, y, ri(g.r, 2, 5), ri(g.r, 2, 4), c);
          else P().line(ctx, x, y, x + ri(g.r, 2, 6), y + ri(g.r, -3, 3), c, 1);
        }
        // amphitheatre steps (karaoke!)
        P().rect(ctx, 0, g.hz, g.W, g.H - g.hz, '#8a7a5a');
        P().dither(ctx, 0, g.hz, g.W, g.H - g.hz, '#7a6a4c', null);
        for (let i = 0; i < 3; i++) P().rect(ctx, 0, g.hz + 1 + i * 3, Math.round(g.W * 0.3) - i * 6, 2, '#a39cab');
        P().rect(ctx, 0, g.floor - 6, g.W, g.H - g.floor + 6, '#9a8a62');
      },
    },
    raw_gelaende: {
      trash: ['t_glass', 't_can', 't_mate', 't_flyer'],
      paint(ctx, g) {
        sky(ctx, g, ['#130f1d', '#1f162b', '#33223f', '#4f2f48'], { stars: 30, moon: 0.2 });
        // brick halls
        let x = -2;
        let i = 0;
        while (x < g.W) {
          const w = ri(g.r, 26, 36), h = Math.round(g.hz * (0.35 + g.r() * 0.15));
          const top = g.hz - h;
          P().rect(ctx, x, top, w, h, '#6e3530');
          for (let y = top + 1; y < g.hz; y += 2) for (let bx = x + ((y >> 1) % 2) * 2; bx < x + w; bx += 4) P().px(ctx, bx, y, '#5a2a28');
          P().rect(ctx, x, top - 2, w, 2, '#3e1e22');
          for (let wx = x + 3; wx < x + w - 4; wx += 6) {
            P().rect(ctx, wx, top + 4, 3, 5, '#f2c76b');
            P().px(ctx, wx, top + 4, '#6e3530');
            P().px(ctx, wx + 2, top + 4, '#6e3530');
          }
          // big graffiti blobs on the lower wall
          const tags = ['#3fa06a', '#e2ac45', '#4a76b5', '#d4705a', '#9fd0c6'];
          for (let k = 0; k < 3; k++) {
            const gx = ri(g.r, x + 1, x + w - 8);
            P().rect(ctx, gx, g.hz - ri(g.r, 6, 9), ri(g.r, 4, 8), ri(g.r, 3, 5), pickOf(g.r, tags));
          }
          x += w + 3;
          i++;
        }
        // the climbing cone
        const cx = Math.round(g.W * 0.78), ch = Math.round(g.hz * 0.6);
        for (let y = 0; y < ch; y++) {
          const half = 4 + Math.round(y * 0.22);
          P().rect(ctx, cx - half, g.hz - ch + y, half * 2, 1, y % 4 === 0 ? '#6a6478' : '#7d778a');
        }
        for (let k = 0; k < 14; k++) P().px(ctx, cx + ri(g.r, -8, 8), g.hz - ri(g.r, 3, ch - 4), pickOf(g.r, ['#e2ac45', '#c4473a', '#3fa06a']));
        // string lights
        for (let lx = 0; lx < g.W; lx++) {
          const ly = Math.round(g.hz * 0.3 + Math.sin((lx / g.W) * Math.PI) * 8);
          P().px(ctx, lx, ly, '#2a2238');
          if (lx % 5 === 2) P().px(ctx, lx, ly + 1, pickOf(g.r, ['#ffd86b', '#ee7a22', '#9fd0c6', '#d4705a']));
        }
        // gravel
        P().rect(ctx, 0, g.hz, g.W, g.H - g.hz, '#4d4656');
        for (let k = 0; k < g.W * 3; k++) P().px(ctx, ri(g.r, 0, g.W), ri(g.r, g.hz, g.H), pickOf(g.r, ['#5d576c', '#3a3442', '#6a6478']));
      },
    },
    warschauer_str: {
      trash: ['pfand', 't_glass', 't_can', 't_flyer'],
      paint(ctx, g) {
        sky(ctx, g, ['#1b1a33', '#2f2649', '#5e3760', '#a35458'], { stars: 18 });
        // the TV tower, far away
        fernsehturm(ctx, g, Math.round(g.W * 0.12), g.hz - 10, Math.round(g.hz * 0.6));
        skylineBack(ctx, g, '#2c2140', Math.round(g.hz * 0.12), Math.round(g.hz * 0.28));
        // Oberbaumbrücke: two brick towers and the arches
        const bx = Math.round(g.W * 0.45), bw = Math.round(g.W * 0.5), by = g.hz - 10;
        P().rect(ctx, bx, by, bw, 4, '#8a3a32');
        for (let x = bx + 2; x < bx + bw - 4; x += 8) P().rect(ctx, x, by + 4, 5, 3, '#8a3a32');
        for (const tx of [bx + Math.round(bw * 0.38), bx + Math.round(bw * 0.58)]) {
          P().rect(ctx, tx - 3, by - 22, 7, 22, '#9a4438');
          P().rect(ctx, tx + 2, by - 22, 2, 22, '#7a3430');
          for (let k = 0; k < 4; k++) P().rect(ctx, tx - 3 + k * 2, by - 24, 1, 2, '#9a4438');
          P().rect(ctx, tx - 1, by - 17, 2, 3, '#f2c76b');
          P().rect(ctx, tx - 1, by - 10, 2, 3, '#f2c76b');
        }
        // the Spree with light reflections
        P().rect(ctx, 0, g.hz - 6, g.W, 6, '#2a3350');
        for (let k = 0; k < 12; k++) P().rect(ctx, ri(g.r, 0, g.W), ri(g.r, g.hz - 5, g.hz - 1), ri(g.r, 2, 4), 1, pickOf(g.r, ['#f2c76b', '#a35458', '#5e6fa0']));
        // bridge deck + railing
        P().rect(ctx, 0, g.hz, g.W, g.H - g.hz, '#4a4452');
        P().dither(ctx, 0, g.hz + 7, g.W, g.H - g.hz - 7, '#433e4c', null);
        P().rect(ctx, 0, g.hz - 9, g.W, 1, '#8d879c');
        P().rect(ctx, 0, g.hz - 5, g.W, 1, '#6a6478');
        for (let x = 1; x < g.W; x += 6) P().rect(ctx, x, g.hz - 9, 1, 9, '#6a6478');
        P().rect(ctx, 0, g.hz, g.W, 2, '#6a6478');
      },
    },
    alexanderplatz: {
      trash: ['t_cup', 't_flyer', 't_can', 't_chips', 't_paper'],
      paint(ctx, g) {
        sky(ctx, g, ['#1d2b45', '#2c4462', '#476883', '#86999f'], { stars: 8, clouds: 2, cloudColor: '#3a5674' });
        skylineBack(ctx, g, '#22314a', Math.round(g.hz * 0.18), Math.round(g.hz * 0.32));
        // Park Inn slab
        const px0 = Math.round(g.W * 0.04), pw = 22, ph = Math.round(g.hz * 0.72);
        P().rect(ctx, px0, g.hz - ph, pw, ph, '#8d93a3');
        P().rect(ctx, px0 + pw - 3, g.hz - ph, 3, ph, '#6a7080');
        for (let y = g.hz - ph + 3; y < g.hz - 3; y += 3) {
          P().rect(ctx, px0 + 1, y, pw - 4, 1, '#3a4256');
          for (let x = px0 + 1; x < px0 + pw - 4; x += 2) if (g.r() < 0.18) P().px(ctx, x, y, '#f2c76b');
        }
        // the Fernsehturm, front and centre
        fernsehturm(ctx, g, Math.round(g.W * 0.72), g.hz, Math.round(g.hz * 0.92));
        // World Clock
        const wx = Math.round(g.W * 0.36);
        P().rect(ctx, wx, g.hz - 12, 1, 12, '#a39cab');
        P().rect(ctx, wx - 4, g.hz - 16, 9, 4, '#e2ac45');
        P().rect(ctx, wx - 4, g.hz - 14, 9, 1, '#a87822');
        P().disc(ctx, wx, g.hz - 19, 1, '#a39cab');
        // plaza tiles
        P().rect(ctx, 0, g.hz, g.W, g.H - g.hz, '#8d879c');
        for (let y = g.hz; y < g.H; y += 4) for (let x = (y >> 2) % 2 ? 0 : 4; x < g.W; x += 8) P().rect(ctx, x, y, 4, 4, '#7d778a');
        // tram wires
        P().rect(ctx, 0, Math.round(g.hz * 0.55), g.W, 1, '#1a1426');
      },
    },
  };
  ZONE_SCENES._default = ZONE_SCENES.your_kiez;

  /** Lastenrad, box in front (left), full of little bins. base = ground y. */
  function cargoBike(ctx, x, base) {
    const { rect, line, disc, px } = P();
    for (const wx of [x + 5, x + 25]) {
      disc(ctx, wx, base - 4, 4, '#1d1626');
      disc(ctx, wx, base - 4, 2, '#8d8799');
      px(ctx, wx, base - 4, '#1d1626');
    }
    // frame
    line(ctx, x + 5, base - 4, x + 15, base - 6, '#1d1626', 2);
    line(ctx, x + 15, base - 6, x + 25, base - 4, '#1d1626', 2);
    line(ctx, x + 15, base - 6, x + 21, base - 12, '#2f7d7a', 2);
    line(ctx, x + 21, base - 12, x + 25, base - 4, '#2f7d7a', 1);
    rect(ctx, x + 19, base - 14, 5, 2, '#1d1626'); // saddle
    line(ctx, x + 14, base - 7, x + 13, base - 16, '#1d1626', 1); // steerer
    rect(ctx, x + 11, base - 17, 5, 1, '#1d1626'); // handlebar
    // wooden box with bins
    rect(ctx, x, base - 15, 13, 9, '#1d1626');
    rect(ctx, x + 1, base - 14, 11, 7, '#8f5f3c');
    rect(ctx, x + 1, base - 11, 11, 1, '#5e3c27');
    rect(ctx, x + 2, base - 18, 3, 4, '#ee7a22');
    rect(ctx, x + 5, base - 17, 3, 3, '#3fa06a');
    rect(ctx, x + 8, base - 18, 3, 4, '#e2ac45');
    rect(ctx, x + 2, base - 19, 9, 1, '#1d1626');
  }

  // ---- the hero ------------------------------------------------------------
  // Pose = where the right hand and the picker tip are, relative to (cx, floor).
  const POSES = {
    idle: { hand: [13, -19], tip: [24, 0] },
    raise: { hand: [14, -26], tip: [28, -8] },
    stab: { hand: [17, -21], tip: [27, 1], lean: 1 },
    lift: { hand: [12, -33], tip: [17, -60] },
    flick: { hand: [10, -35], tip: [4, -62] },
  };
  const PICK_STEPS = [
    ['raise', 45],
    ['stab', 70],
    ['lift', 60],
    ['flick', 70],
  ];

  // ---- VISUALS: upgrade id -> how it shows up ----------------------------
  // z orders the drawing (smaller = further back). draw(ctx, sc, n, t) gets the
  // scene geometry `sc`, the number owned `n` and an animation clock `t` (ms;
  // 0 under reduced motion). `hero` entries change the hero instead of the street.
  // spot(sc) is where the "new!" sparkle shows after buying it.
  const VISUALS = {
    broom: {
      hero: 'broom',
      spot: (sc) => [sc.hx - 3, sc.floor - 10],
    },
    garbage_bags: {
      hero: 'bag',
      spot: (sc) => [sc.hx - 2, sc.hy + 22],
    },
    handcart: {
      hero: 'cart',
      spot: (sc) => [sc.hx - 12, sc.floor - 10],
    },
    helpful_neighbour: {
      z: 30,
      draw(ctx, sc, n, t) {
        const x = 1, base = sc.backFloor;
        const f = Math.floor(t / 300) % 2;
        P().draw(ctx, 'neighbour', x, base - 20);
        // her broom swishes
        const bx = x + 9 + (f ? 2 : 0);
        P().line(ctx, x + 8, base - 8, bx + 3, base - 1, '#8f5f3c', 1);
        P().rect(ctx, bx + 1, base - 1, 5, 2, '#e2ac45');
        if (f && t) P().px(ctx, bx + 7, base - 2, '#a39cab');
      },
      spot: (sc) => [6, sc.backFloor - 22],
    },
    pfand_collector: {
      z: 31,
      draw(ctx, sc, n, t) {
        const bob = t && Math.floor(t / 450) % 2 ? 1 : 0;
        P().draw(ctx, 'pfandguy', sc.W - 16, sc.backFloor - 18 + bob);
      },
      spot: (sc) => [sc.W - 10, sc.backFloor - 20],
    },
    cargo_bike: {
      z: 29,
      draw(ctx, sc) {
        cargoBike(ctx, sc.W - 40, sc.backFloor - 2);
      },
      spot: (sc) => [sc.W - 32, sc.backFloor - 16],
    },
    kiez_crew: {
      z: 22,
      draw(ctx, sc, n, t) {
        const count = Math.min(3, n);
        const base = sc.road + 3;
        for (let i = 0; i < count; i++) {
          const x = Math.round(sc.W * 0.16) + i * 10;
          const bob = t && Math.floor(t / 380 + i) % 2 ? 1 : 0;
          P().draw(ctx, 'crew', x, base - 16 + bob, i % 2 === 1);
          P().line(ctx, x + (i % 2 ? 0 : 9), base - 7, x + (i % 2 ? -2 : 11), base, '#c4bdca', 1);
        }
      },
      spot: (sc) => [Math.round(sc.W * 0.16) + 4, sc.road - 14],
    },
    spaeti_alliance: {
      z: 12,
      draw(ctx, sc, n, t) {
        const x = sc.W - 25;
        P().draw(ctx, 'spaeti', x, sc.hz - 20);
        P().draw(ctx, 'crate', x - 9, sc.hz - 7);
        // the neon flickers now and then
        if (t && Math.floor(t / 130) % 37 === 0) P().rect(ctx, x + 1, sc.hz - 19, 22, 6, 'rgba(29,22,38,0.55)');
      },
      spot: (sc) => [sc.W - 13, sc.hz - 14],
    },
    night_shift: {
      z: 13,
      draw(ctx, sc) {
        P().draw(ctx, 'usign', Math.round(sc.W * 0.3), sc.hz - 16);
      },
      spot: (sc) => [Math.round(sc.W * 0.3) + 4, sc.hz - 12],
    },
    spree_boat: {
      z: 8,
      draw(ctx, sc, n, t) {
        const y = sc.hz - 5;
        P().rect(ctx, 0, y, sc.W, 5, '#2f4a6a');
        P().dither(ctx, 0, y, sc.W, 1, '#5e7fa0', null);
        const span = sc.W + 20;
        const x = t ? Math.round(((t / 90) % span) - 18) : Math.round(sc.W * 0.55);
        P().draw(ctx, 'boat', x, y - 7);
      },
      spot: (sc) => [Math.round(sc.W * 0.6), sc.hz - 8],
    },
    sweeper_truck: {
      z: 20,
      draw(ctx, sc, n, t) {
        const x = sc.W - 33, y = sc.road + 2 - 15;
        P().draw(ctx, 'sweeper', x, y, true);
        // spinning brushes
        const f = t ? Math.floor(t / 90) % 3 : 0;
        const by = y + 13;
        for (const bx of [x + 3, x + 26]) {
          P().rect(ctx, bx, by, 4, 2, '#e2ac45');
          P().px(ctx, bx + f, by + 2, '#e2ac45');
          P().px(ctx, bx + 3 - f, by - 1, '#e2ac45');
        }
        P().px(ctx, x + 4, y + 6, t && Math.floor(t / 400) % 2 ? '#ffd86b' : '#ee7a22'); // beacon
      },
      spot: (sc) => [sc.W - 18, sc.road - 8],
    },
    ringbahn_train: {
      z: 6,
      draw(ctx, sc, n, t) {
        const y = sc.hz - Math.max(14, Math.round(sc.hz * 0.3));
        // viaduct with arches
        P().rect(ctx, 0, y + 8, sc.W, 3, '#5a4a5a');
        P().rect(ctx, 0, y + 7, sc.W, 1, '#3a2e3e');
        for (let x = 0; x < sc.W; x += 12) {
          P().rect(ctx, x, y + 11, 3, sc.hz - y - 11, '#5a4a5a');
          P().rect(ctx, x + 3, y + 11, 9, 1, '#4a3c4a');
        }
        const span = sc.W + 70;
        const period = 6000;
        const x = t ? Math.round(sc.W + 2 - ((t % period) / period) * span) : Math.round(sc.W * 0.2);
        P().draw(ctx, 'train', x, y);
        P().draw(ctx, 'train', x + 32, y);
      },
      spot: (sc) => [Math.round(sc.W * 0.3), sc.hz - Math.max(14, Math.round(sc.hz * 0.3)) + 3],
    },
    recycling_yard: {
      z: 14,
      draw(ctx, sc) {
        P().draw(ctx, 'skip', 0, sc.hz - 8);
        P().draw(ctx, 'skip_b', 11, sc.hz - 7);
      },
      spot: (sc) => [10, sc.hz - 6],
    },
    orange_fleet: {
      z: 18,
      draw(ctx, sc, n, t) {
        const span = sc.W + 60;
        const count = Math.min(3, 1 + Math.floor(n / 2));
        for (let i = 0; i < count; i++) {
          const x = t ? Math.round(((t / 60 + i * 26) % span) - 20) : 6 + i * 26;
          P().draw(ctx, 'minitruck', x, sc.road - 6, true);
        }
      },
      spot: (sc) => [Math.round(sc.W * 0.25), sc.road - 4],
    },
  };

  // ---- module state ----------------------------------------------------------

  let canvas = null;
  let ctx = null;
  let stage = null;
  let sc = null; // scene geometry
  let bg = null; // cached backdrop canvas
  let bgKey = '';
  let oldBg = null; // previous backdrop while fading between zones
  let fadeStart = 0;
  let lastKey = '';
  let owned = {}; // id -> count, as last seen
  let ownedKey = '';
  let zoneId = null;
  let initialised = false;
  let lastStateRef = null;
  const sparkles = []; // { id, until }
  let celebrateUntil = 0;

  // pick animation
  let pick = null; // { start, item, pfand, skipRaise, speed }
  let queue = [];
  const flying = []; // { item, start, from:[x,y], to:[x,y], dur }
  let groundItem = 't_can';
  let landBounceUntil = 0;
  let pfandFaceUntil = 0;

  // idle
  let nextGestureAt = 0;
  let gesture = null; // { kind, start, dur }
  let nextBlinkAt = 0;

  const reduceQuery = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reduceQuery && reduceQuery.matches);

  // ---- geometry ----------------------------------------------------------

  function measure() {
    if (!canvas || !stage) return false;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    if (!cw || !ch) return false;
    const pxSize = Math.max(2, Math.min(cw / TARGET_W, ch / TARGET_H));
    const W = Math.max(60, Math.round(cw / pxSize));
    const H = Math.max(60, Math.round(ch / pxSize));
    if (sc && sc.W === W && sc.H === H) return false;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    if (ctx) ctx.imageSmoothingEnabled = false;
    const floor = H - 5;
    const cx = Math.round(W * 0.47);
    sc = {
      W,
      H,
      floor,
      hz: horizon(H, floor),
      road: 0,
      backFloor: floor - Math.max(9, Math.round(H * 0.09)),
      cx,
      hx: cx - 12, // hero sprite top-left
      hy: floor - 51,
      tx: cx + 26, // where the next piece of trash lies
    };
    bgKey = '';
    lastKey = '';
    return true;
  }

  function sceneFor(id) {
    return ZONE_SCENES[id] || ZONE_SCENES._default;
  }

  function paintBackdrop(target, W, H, id, floorOverride) {
    const c = target.getContext('2d');
    c.imageSmoothingEnabled = false;
    const floor = floorOverride != null ? floorOverride : H - 5;
    const g = { W, H, floor, hz: horizon(H, floor), r: rng(hash(id || 'x')) };
    try {
      sceneFor(id).paint(c, g);
    } catch (e) {
      c.fillStyle = '#2b1e3a';
      c.fillRect(0, 0, W, H);
    }
    // scatter a few bits of trash that stay put
    const pool = sceneFor(id).trash;
    for (let i = 0; i < 3 && floorOverride == null; i++) {
      const x = Math.round((i === 0 ? 0.06 : i === 1 ? 0.36 : 0.93) * W) - 3 + ri(g.r, -2, 2);
      const s = P().sprite(pickOf(g.r, pool));
      if (s) c.drawImage(s.canvas, x, floor - s.h + 2 + ri(g.r, 0, 1));
    }
    return g;
  }

  function ensureBackdrop() {
    const key = zoneId + '|' + sc.W + 'x' + sc.H;
    if (key === bgKey) return;
    const fresh = document.createElement('canvas');
    fresh.width = sc.W;
    fresh.height = sc.H;
    const g = paintBackdrop(fresh, sc.W, sc.H, zoneId);
    sc.hz = g.hz; // some zones move the horizon
    sc.road = sc.hz + Math.max(3, Math.round((sc.floor - sc.hz) * 0.25)); // vehicles' wheels
    if (bg && bgKey && bgKey.split('|')[1] === key.split('|')[1] && !reduced()) {
      oldBg = bg;
      fadeStart = performance.now();
    } else {
      oldBg = null;
    }
    bg = fresh;
    bgKey = key;
    const pool = sceneFor(zoneId).trash;
    groundItem = pool[Math.floor(Math.random() * pool.length)];
  }

  // ---- drawing the hero ------------------------------------------------------

  function currentPose(now) {
    if (!pick) return { name: 'idle', pose: POSES.idle, holding: false };
    const elapsed = (now - pick.start) * pick.speed;
    let acc = 0;
    for (let i = pick.skipRaise ? 1 : 0; i < PICK_STEPS.length; i++) {
      acc += PICK_STEPS[i][1];
      if (elapsed < acc) {
        const name = PICK_STEPS[i][0];
        return { name, pose: POSES[name], holding: name === 'lift' };
      }
    }
    return { name: 'idle', pose: POSES.idle, holding: false };
  }

  function pickDuration(p) {
    let d = 0;
    for (let i = p.skipRaise ? 1 : 0; i < PICK_STEPS.length; i++) d += PICK_STEPS[i][1];
    return d / p.speed;
  }

  function dropTarget() {
    if (owned.handcart > 0) return [sc.hx - 13, sc.floor - 13];
    if (owned.garbage_bags > 0) return [sc.hx - 1, sc.hy + 25];
    return [sc.hx - 12, sc.floor - 15];
  }

  function advancePick(now) {
    if (!pick) return;
    if (now - pick.start < pickDuration(pick)) return;
    // the flick is done: launch the trash toward the bin/bag/cart
    launch(pick.item, now);
    pick = null;
    if (queue.length) startPick(queue.shift(), now, true);
  }

  function launch(item, now) {
    const tip = POSES.flick.tip;
    const from = [sc.cx + tip[0], sc.floor + tip[1]];
    while (flying.length >= 4) flying.shift();
    flying.push({ item, start: now, from, to: dropTarget(), dur: reduced() ? 120 : 280 });
  }

  function startPick(opts, now, chained) {
    const pfand = !!(opts && opts.pfand);
    const backlog = queue.length;
    pick = {
      start: now,
      item: pfand ? 'pfand' : groundItem,
      pfand,
      skipRaise: !!chained,
      speed: backlog > 0 || chained ? 1.8 : 1,
    };
    if (pfand) pfandFaceUntil = now + 900;
    const pool = sceneFor(zoneId).trash;
    groundItem = pool[Math.floor(Math.random() * pool.length)];
  }

  function drawStick(c, hand, tip, item) {
    const { line, rect, draw } = P();
    // grip above the hand, continuing the line away from the tip
    const dx = tip[0] - hand[0], dy = tip[1] - hand[1];
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len, uy = dy / len;
    const gx = hand[0] - ux * 4, gy = hand[1] - uy * 4;
    line(c, gx, gy, tip[0], tip[1], 'k', 3);
    line(c, hand[0], hand[1], tip[0] - ux * 2, tip[1] - uy * 2, 'l', 1);
    line(c, gx, gy, hand[0], hand[1], 'x', 1);
    // the spike
    line(c, tip[0] - ux * 2, tip[1] - uy * 2, tip[0], tip[1], 'W', 1);
    if (item) {
      const s = P().sprite(item);
      if (s) draw(c, item, Math.round(tip[0] - s.w / 2 - ux), Math.round(tip[1] - s.h / 2 - uy));
    }
    return { rect };
  }

  function drawHero(c, now, t) {
    const { draw, line, rect, px } = P();
    const pose = currentPose(now);
    const lean = pose.pose.lean || 0;
    const hx = sc.hx + lean;
    const bob = t && !pick ? (Math.floor(t / 700) % 2 ? 1 : 0) : 0;
    const crouch = lean;
    const hy = sc.hy + bob + crouch;
    const hero = P().sprite('hero');
    if (!hero) return;

    const has = (id) => owned[id] > 0;

    // things behind him
    if (has('garbage_bags')) draw(c, 'binbag', sc.hx - 8, sc.hy + 17 + bob);

    // body: everything but the boots bobs
    c.drawImage(hero.canvas, 0, 0, hero.w, 48, hx, hy, hero.w, 48);
    c.drawImage(hero.canvas, 0, 48, hero.w, 4, sc.hx + lean, sc.hy + 48, hero.w, 4);

    // face overlays
    const g = gesture && now - gesture.start < gesture.dur ? gesture.kind : null;
    const happy = now < celebrateUntil || now < pfandFaceUntil;
    const effort = pose.name === 'stab' || pose.name === 'lift';
    const blinking = t && now >= nextBlinkAt && now < nextBlinkAt + 130;
    const browLift = happy || (g === 'brows' && Math.floor((now - gesture.start) / 160) % 2 === 0) ? -1 : 0;
    const eyeShift = g === 'look' ? (now - gesture.start < gesture.dur / 2 ? -1 : 1) : 0;
    const eyeY = hy + 12;
    // brows
    const by = hy + 10 + browLift;
    if (effort) {
      line(c, hx + 5, by - 1, hx + 9, by + 1, 'B', 1);
      line(c, hx + 18, by - 1, hx + 14, by + 1, 'B', 1);
    } else {
      rect(c, hx + 5, by, 4, 1, 'B');
      rect(c, hx + 15, by, 4, 1, 'B');
    }
    // eyes
    if (now < pfandFaceUntil) {
      for (const ex of [hx + 6, hx + 15]) {
        rect(c, ex, eyeY - 1, 3, 3, 'W');
        rect(c, ex + 1, eyeY, 1, 1, 'k');
      }
    } else if (blinking || g === 'yawn' || effort) {
      rect(c, hx + 6, eyeY + 1, 3, 1, 'k');
      rect(c, hx + 15, eyeY + 1, 3, 1, 'k');
    } else {
      for (const ex of [hx + 6 + eyeShift, hx + 15 + eyeShift]) {
        rect(c, ex, eyeY, 2, 2, 'k');
        px(c, ex + 1, eyeY, 'W');
        rect(c, ex - 1, eyeY - 1, 4, 1, 'S'); // heavy lids = permanent squint
      }
    }
    // moustache + mouth
    const tacheUp = happy || (g === 'tache' && Math.floor((now - gesture.start) / 120) % 2 === 0);
    if (g === 'yawn' || pose.name === 'stab') draw(c, 'mouth_open', hx + 10, hy + 19);
    draw(c, tacheUp ? 'tache_up' : 'tache', hx, hy + 16);

    // left arm: holds the broom, or scratches the beanie
    if (g === 'scratch' && !pick) {
      const s = Math.floor((now - gesture.start) / 140) % 2;
      draw(c, 'hero_arm_up', hx - 1 + s, hy + 8);
    } else {
      if (has('broom')) {
        const bx = hx - 1;
        line(c, bx + 3, hy + 22, bx - 1, sc.floor - 6, 'k', 3);
        line(c, bx + 3, hy + 22, bx - 1, sc.floor - 6, 'c', 1);
        rect(c, bx - 5, sc.floor - 7, 9, 2, 'k');
        rect(c, bx - 6, sc.floor - 5, 11, 5, 'k');
        rect(c, bx - 5, sc.floor - 6, 9, 1, 'Y');
        rect(c, bx - 5, sc.floor - 5, 9, 4, 'y');
        for (let i = 0; i < 4; i++) rect(c, bx - 4 + i * 2, sc.floor - 4, 1, 3, 'Y');
      }
      draw(c, 'hero_fist', hx, hy + 37);
    }

    // right arm + the litter picker
    const hand = [sc.cx + pose.pose.hand[0] + lean, sc.floor + pose.pose.hand[1] + bob];
    const tip = [sc.cx + pose.pose.tip[0], sc.floor + pose.pose.tip[1]];
    const shoulder = [hx + 20, hy + 27];
    line(c, shoulder[0], shoulder[1], hand[0], hand[1], 'k', 4);
    line(c, shoulder[0], shoulder[1], hand[0], hand[1], 'p', 2);
    const item = pick && (pose.name === 'lift' || pose.name === 'flick' || pose.name === 'stab') ? pick.item : null;
    drawStick(c, hand, tip, item);
    draw(c, 'hero_fist', hand[0] - 2, hand[1] - 2);
    // dust puff on the stab
    if (pose.name === 'stab' && t) {
      px(c, tip[0] - 4, tip[1] - 1, 'l');
      px(c, tip[0] + 4, tip[1] - 2, 'l');
      px(c, tip[0] - 3, tip[1] - 3, 'g');
      px(c, tip[0] + 3, tip[1] - 4, 'g');
    }
  }

  function drawDropTarget(c, now) {
    const bounce = now < landBounceUntil ? 1 : 0;
    if (owned.handcart > 0) {
      P().draw(c, 'cart', sc.hx - 23, sc.floor - 16 + bounce, true);
    } else if (!(owned.garbage_bags > 0)) {
      P().draw(c, 'bin', sc.hx - 18, sc.floor - 15 + bounce);
    }
  }

  function drawGroundItem(c, now) {
    // hidden while it's on the spike
    const pose = currentPose(now);
    if (pick && (pose.name === 'lift' || pose.name === 'flick' || pose.name === 'stab')) return;
    const s = P().sprite(groundItem);
    if (s) c.drawImage(s.canvas, sc.tx - Math.floor(s.w / 2), sc.floor - s.h + 1);
  }

  function drawFlying(c, now) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      const k = (now - f.start) / f.dur;
      if (k >= 1) {
        flying.splice(i, 1);
        landBounceUntil = now + 90;
        continue;
      }
      const x = f.from[0] + (f.to[0] - f.from[0]) * k;
      const y = f.from[1] + (f.to[1] - f.from[1]) * k - Math.sin(k * Math.PI) * 14;
      const s = P().sprite(f.item);
      if (s) c.drawImage(s.canvas, Math.round(x - s.w / 2), Math.round(y - s.h / 2));
    }
  }

  function drawSparkles(c, now) {
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const sp = sparkles[i];
      if (now > sp.until) {
        sparkles.splice(i, 1);
        continue;
      }
      const v = VISUALS[sp.id];
      if (!v || !v.spot) continue;
      const [x, y] = v.spot(sc);
      const f = Math.floor((sp.until - now) / 120) % 2;
      const r = f ? 3 : 2;
      P().rect(c, x, y - r, 1, r * 2 + 1, '#fffaf0');
      P().rect(c, x - r, y, r * 2 + 1, 1, '#fffaf0');
      P().px(c, x, y, '#ffd86b');
    }
  }

  // ---- frame -------------------------------------------------------------

  function frameKey(now, t) {
    // Everything that changes the picture, quantised to its animation step.
    let k = ownedKey + '|' + bgKey + '|' + (oldBg ? Math.floor((now - fadeStart) / 70) : '-');
    if (pick) k += '|p' + currentPose(now).name + (now - pick.start > 20 ? 1 : 0);
    if (flying.length) k += '|f' + Math.floor(now / 16);
    if (sparkles.length) k += '|s' + Math.floor(now / 120);
    if (now < landBounceUntil) k += '|b';
    if (now < celebrateUntil || now < pfandFaceUntil) k += '|h';
    if (t) {
      k += '|' + Math.floor(t / 700) % 2; // bob
      k += now >= nextBlinkAt && now < nextBlinkAt + 130 ? '|blink' : '';
      if (gesture && now - gesture.start < gesture.dur) k += '|g' + gesture.kind + Math.floor((now - gesture.start) / 120);
      // street animations
      k += '|' + Math.floor(t / 90);
    }
    return k;
  }

  function updateIdle(now) {
    if (reduced()) return;
    if (!nextBlinkAt || now > nextBlinkAt + 130) nextBlinkAt = now + 2200 + Math.random() * 2800;
    if (!nextGestureAt) nextGestureAt = now + 4000;
    if (now > nextGestureAt && !pick) {
      const kinds = ['brows', 'tache', 'yawn', 'scratch', 'look'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      gesture = { kind, start: now, dur: kind === 'yawn' ? 1300 : 1000 };
      nextGestureAt = now + 6000 + Math.random() * 6000;
    }
    if (pick) gesture = null;
  }

  function syncState(state, now) {
    let key = '';
    const next = {};
    for (const u of TrashGame.UPGRADES || []) {
      const n = (state.upgrades && state.upgrades[u.id]) || 0;
      next[u.id] = n;
      key += n > 0 ? u.id + ',' : '';
    }
    if (key !== ownedKey) {
      if (initialised && state === lastStateRef) {
        for (const id in next) {
          if (next[id] > 0 && !(owned[id] > 0) && VISUALS[id]) sparkles.push({ id, until: now + 900 });
        }
        celebrateUntil = now + 700;
      }
      ownedKey = key;
    }
    owned = next;
    zoneId = state.zone;
    lastStateRef = state;
    initialised = true;
  }

  function render(state) {
    if (!canvas || !state) return;
    try {
      if (!sc) measure();
      if (!sc || !ctx) return;
      const now = performance.now();
      syncState(state, now);
      ensureBackdrop();
      updateIdle(now);
      advancePick(now);
      const t = reduced() ? 0 : now;
      if (oldBg && now - fadeStart > 300) oldBg = null;
      const key = frameKey(now, t);
      if (key === lastKey) return;
      lastKey = key;
      draw(now, t);
    } catch (e) {
      /* the scene must never break the game */
    }
  }

  function draw(now, t) {
    const c = ctx;
    c.drawImage(bg, 0, 0);
    if (oldBg) {
      const step = Math.min(4, Math.floor((now - fadeStart) / 70));
      c.globalAlpha = 1 - step / 4;
      c.drawImage(oldBg, 0, 0);
      c.globalAlpha = 1;
    }
    const layers = [];
    for (const id in owned) {
      const v = VISUALS[id];
      if (owned[id] > 0 && v && v.draw) layers.push({ id, v, z: v.z || 0 });
    }
    layers.sort((a, b) => a.z - b.z);
    for (const { id, v } of layers) {
      try {
        v.draw(c, sc, owned[id], t);
      } catch (e) {
        /* a broken visual just doesn't show */
      }
    }
    drawDropTarget(c, now);
    drawGroundItem(c, now);
    drawHero(c, now, t);
    drawFlying(c, now);
    drawSparkles(c, now);
  }

  // ---- public ------------------------------------------------------------

  function init(opts) {
    canvas = opts && opts.canvas;
    stage = (opts && opts.stage) || (canvas && canvas.parentNode);
    if (!canvas) return;
    // second recycling skips, recoloured
    const S = P().S;
    if (S.skip && !S.skip_b) {
      S.skip_b = S.skip.map((r) => r.replace(/e/g, 'u').replace(/E/g, 'U'));
      S.skip_y = S.skip.map((r) => r.replace(/e/g, 'y').replace(/E/g, 'Y'));
    }
    const remeasure = () => {
      if (measure()) lastKey = '';
    };
    if (root.ResizeObserver) new ResizeObserver(remeasure).observe(stage);
    else root.addEventListener('resize', remeasure);
    measure();
  }

  function pickTrash(opts) {
    if (!sc) return;
    const now = performance.now();
    if (!pick) startPick(opts, now, false);
    else if (queue.length < QUEUE_MAX) queue.push(opts || {});
    else if (opts && opts.pfand) queue[queue.length - 1] = opts; // never lose a bottle
  }

  function anchor() {
    if (!canvas || !sc) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + (sc.tx * r.width) / sc.W, y: r.top + ((sc.floor - 6) * r.height) / sc.H };
  }

  const thumbs = {};
  function zoneThumb(id, w, h) {
    w = w || 48;
    h = h || 28;
    const key = id + w + 'x' + h;
    if (thumbs[key] !== undefined) return thumbs[key];
    let url = '';
    try {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      paintBackdrop(c, w, h, id, h + 4);
      url = c.toDataURL();
    } catch (e) {
      url = '';
    }
    thumbs[key] = url;
    return url;
  }

  TrashGame.Character = { init, render, pick: pickTrash, anchor, zoneThumb, VISUALS, ZONE_SCENES };
})(typeof window !== 'undefined' ? window : globalThis);
