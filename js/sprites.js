/*
 * Pixel-art toolkit + sprite sheet for the lo-fi look. No DOM state, no game state.
 *
 * INTERFACE (used by character.js, shop.js, effects.js):
 *   TrashGame.Pixel.PAL                     palette, one letter -> colour
 *   TrashGame.Pixel.sprite(name)            -> { canvas, w, h } (built once, cached) or null
 *   TrashGame.Pixel.draw(ctx, name, x, y, flip?)   blits a sprite, top-left at x,y
 *   TrashGame.Pixel.rect / px / line / dither / disc    drawing helpers in art pixels
 *   TrashGame.Pixel.icon(key, emoji)        -> data: URL of a 16x16 pixel icon. Uses a
 *        hand-drawn sprite "icon_<key>" when there is one, otherwise pixelates the emoji
 *        onto the palette (so new upgrades still get a lo-fi icon). '' if canvas is missing.
 *
 * Sprites are strings: one character per pixel, '.' is transparent, other letters
 * are keys of PAL. Rows may be shorter than the widest row (padded with '.').
 */
(function (root) {
  'use strict';
  const TrashGame = (root.TrashGame = root.TrashGame || {});

  // Dusky Berlin evening: plum, teal, mustard, BSR orange. Slightly desaturated.
  const PAL = {
    k: '#1d1626', // outline
    K: '#2e2238',
    w: '#f3e7cf', // cream
    W: '#fffaf0',
    s: '#e8b08a', // skin
    S: '#c48a6a',
    r: '#d4705a', // nose / cheeks
    R: '#a84a40',
    b: '#5a3a2a', // beard
    B: '#3e271d',
    h: '#b5683a', // moustache ginger
    H: '#87472a',
    o: '#ee7a22', // hi-vis / BSR orange
    O: '#b4521c',
    y: '#e2ac45', // mustard
    Y: '#a87822',
    t: '#2f7d7a', // teal
    T: '#1f5458',
    p: '#6a4072', // plum
    P: '#44294d',
    n: '#3d5378', // denim
    N: '#283a58',
    g: '#8d8799', // greys
    G: '#5d576c',
    l: '#c4bdca',
    e: '#6e9a4c', // greens
    E: '#43663b',
    c: '#8f5f3c', // wood / kraft
    C: '#5e3c27',
    q: '#d9c29a', // kraft paper
    Q: '#b39d74',
    x: '#c4473a', // red
    X: '#86302c',
    u: '#4a76b5', // blue
    U: '#2c4d82',
    v: '#3fa06a', // bottle green
    V: '#28704a',
    a: '#9fd0c6', // glass / pale teal
    z: '#ffd86b', // lamp glow
  };

  const S = {}; // sprite source strings, by name
  const cache = {};

  // ---- Drawing helpers (coordinates in art pixels) -----------------------

  function rect(ctx, x, y, w, h, c) {
    ctx.fillStyle = PAL[c] || c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function px(ctx, x, y, c) {
    rect(ctx, x, y, 1, 1, c);
  }
  /** Bresenham line with a square brush `size` px wide. */
  function line(ctx, x0, y0, x1, y1, c, size) {
    size = size || 1;
    ctx.fillStyle = PAL[c] || c;
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const o = Math.floor(size / 2);
    for (let i = 0; i < 400; i++) {
      ctx.fillRect(x0 - o, y0 - o, size, size);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** Checkerboard of two colours (c2 may be null for transparent). */
  function dither(ctx, x, y, w, h, c1, c2) {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = (i + j + x + y) % 2 === 0 ? c1 : c2;
        if (c) px(ctx, x + i, y + j, c);
      }
    }
  }
  function disc(ctx, cx, cy, r, c) {
    ctx.fillStyle = PAL[c] || c;
    for (let j = -r; j <= r; j++) {
      const half = Math.floor(Math.sqrt(r * r - j * j + r * 0.6));
      ctx.fillRect(Math.round(cx - half), Math.round(cy + j), half * 2 + 1, 1);
    }
  }

  // ---- Sprites -----------------------------------------------------------

  function build(rows) {
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch !== '.' && ch !== ' ' && PAL[ch]) {
          ctx.fillStyle = PAL[ch];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    return { canvas, w, h };
  }

  function sprite(name) {
    if (cache[name] !== undefined) return cache[name];
    const rows = S[name];
    let built = null;
    try {
      built = rows ? build(rows) : null;
    } catch (e) {
      built = null;
    }
    cache[name] = built;
    return built;
  }

  function flipped(name) {
    const key = name + '~flip';
    if (cache[key] !== undefined) return cache[key];
    const src = sprite(name);
    let out = null;
    if (src) {
      const canvas = document.createElement('canvas');
      canvas.width = src.w;
      canvas.height = src.h;
      const ctx = canvas.getContext('2d');
      ctx.translate(src.w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src.canvas, 0, 0);
      out = { canvas, w: src.w, h: src.h };
    }
    cache[key] = out;
    return out;
  }

  function draw(ctx, name, x, y, flip) {
    const s = flip ? flipped(name) : sprite(name);
    if (s) ctx.drawImage(s.canvas, Math.round(x), Math.round(y));
    return s;
  }

  // ---- Icons -------------------------------------------------------------

  const iconCache = {};
  let palRGB = null;

  function hexRGB(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function nearest(r, g, b) {
    if (!palRGB) palRGB = Object.values(PAL).map(hexRGB);
    let best = palRGB[0];
    let bd = Infinity;
    for (const c of palRGB) {
      const d = (c[0] - r) * (c[0] - r) * 0.3 + (c[1] - g) * (c[1] - g) * 0.59 + (c[2] - b) * (c[2] - b) * 0.11;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Pixelates an emoji to 16x16 on the palette, with a dark outline. */
  function emojiIcon(emoji) {
    const N = 16;
    const big = document.createElement('canvas');
    big.width = big.height = N;
    const bctx = big.getContext('2d', { willReadFrequently: true });
    if (!bctx) return null;
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.font = '13px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    bctx.fillText(emoji, N / 2, N / 2 + 1);
    const img = bctx.getImageData(0, 0, N, N);
    const d = img.data;
    const solid = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const a = d[i * 4 + 3];
      if (a > 110) {
        // un-premultiply-ish and pull toward the palette, slightly desaturated
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        const m = (r + g + b) / 3;
        const c = nearest(r * 0.85 + m * 0.15, g * 0.85 + m * 0.15, b * 0.85 + m * 0.15);
        d[i * 4] = c[0];
        d[i * 4 + 1] = c[1];
        d[i * 4 + 2] = c[2];
        d[i * 4 + 3] = 255;
        solid[i] = 1;
      } else {
        d[i * 4 + 3] = 0;
      }
    }
    const k = hexRGB(PAL.k);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (solid[i]) continue;
        const n = (x > 0 && solid[i - 1]) || (x < N - 1 && solid[i + 1]) || (y > 0 && solid[i - N]) || (y < N - 1 && solid[i + N]);
        if (n) {
          d[i * 4] = k[0];
          d[i * 4 + 1] = k[1];
          d[i * 4 + 2] = k[2];
          d[i * 4 + 3] = 255;
        }
      }
    }
    bctx.putImageData(img, 0, 0);
    return big;
  }

  function icon(key, emoji) {
    const cacheKey = key + '|' + (emoji || '');
    if (iconCache[cacheKey] !== undefined) return iconCache[cacheKey];
    let url = '';
    try {
      const s = key ? sprite('icon_' + key) : null;
      let canvas = s ? s.canvas : null;
      if (!canvas && emoji) canvas = emojiIcon(emoji);
      if (canvas) url = canvas.toDataURL();
    } catch (e) {
      url = '';
    }
    iconCache[cacheKey] = url;
    return url;
  }

  // ---- Sprite art --------------------------------------------------------
  // The hero: a scruffy Berlin guy. Beanie, squint, red nose, walrus moustache,
  // hi-vis vest over a plum hoodie. His right arm + litter picker are drawn in code.
  // Eyes, brows, moustache and mouth are separate overlays so he can emote.
  S.hero = [
    '..........kkkk..........', // 0 pompom
    '.........kyyyyk.........',
    '.........kyYyyk.........',
    '......kkkkkkkkkkkk......', // 3 beanie
    '.....kttTttTttTtttk.....',
    '....kttTttTttTttTttk....',
    '....kttTttTttTttTttk....',
    '...kttTttTttTttTttTtk...',
    '...kTTTTTTTTTTTTTTTTk...', // 8 cuff
    '...kTyTTTTTTTTTTTTyTk...',
    '...ksssssssssssssssSk...', // 10 forehead
    '..kSsssssssssssssssSSk..', // 11 eyes row (overlay)
    '..kSsssssssssssssssSSk..',
    '..kSssssssrrrrsssssSSk..', // 13 nose
    '...ksrrssrrrrWrssrrsk...',
    '...ksssssRrrrrRsssssk...',
    '...kbsbsbsbbbbsbsbsbk...', // 16 stubble / beard
    '...kbbbbbbbbbbbbbbbbk...',
    '....kbbbBbbbbbbBbbbk....',
    '....kbbbbbBbbBbbbbbk....',
    '.....kbbbbbbbbbbbbk.....',
    '......kkbbbbbbbbkk......', // 21
    '.......kkbbbbbbkk.......',
    '....kkkpkkbbbbkkpkkk....', // 23 collar
    '...kpppppkkkkkkpppppk...',
    '..kppoooooowppwoooooppk.', // 25 vest + hood strings
    '.kpppoooooowppwooooopppk',
    '.kpppoooooowppwooooopppk',
    'kppppoooooowppwoooooopk.',
    'kpppkooooooppppooooooOk.',
    'kpppkwwwwwwppppwwwwwwOk.', // 30 reflective
    'kpppklllllkppppkllllllk.',
    'kpppkooooooppppooooooOk.',
    'kpppkooooookpppooooooOk.',
    'kpppkooooookpppooooooOk.',
    'kpppkwwwwwwkpppwwwwwwOk.', // 35 reflective
    'kpppklllllkkpppklllllOk.',
    'kpppkooooookpppooooooOk.',
    'kkkkkkkOOOOkkkkOOOOOkk..', // 38 vest hem
    '.....knnnnnnnnnnnnnnk...', // 39 jeans
    '.....knnNnnnnnnnnNnnk...',
    '.....knnNnnnnnnnnNnnk...',
    '.....knnNnnnkknnnNnnk...',
    '.....knnNnnnkknnnNnnk...',
    '.....knnnNnnkknnNnnnk...',
    '.....knnnNnnkknnNnnnk...',
    '.....kNnnnnNkkNnnnnNk...',
    '.....kNNnnnNkkNnnnNNk...', // 47
    '....kkkkkkkkkkkkkkkkkk..', // 48 boots
    '...kCccccCCkkkCccccCCk..',
    '..kCcccccCCk.kCcccccCCk.',
    '..kkkkkkkkkk.kkkkkkkkkk.', // 51
  ];
  // left arm (screen left) hanging; drawn over the body. hand at the bottom.
  S.hero_arm = [
    '.kk.',
    'kppk',
    'kppk',
    'kppk',
    'kppk',
    'kppk',
    'kppk',
    'kPpk',
    'kPpk',
    'kssk',
    'kssk',
    '.kk.',
  ];
  // arm raised to scratch the beanie (idle gesture)
  S.hero_arm_up = [
    '.kk.',
    'kssk',
    'kssk',
    'kppk',
    'kppk',
    'kppk',
    'kppk',
    'kppk',
    'kppk',
    'kPpk',
    'kPpk',
    '.kk.',
  ];
  S.hero_fist = ['.kk.', 'kssk', 'kSsk', '.kk.'];
  // walrus moustache, drawn at hero (0, 14)
  S.tache = [
    '......kkkkkkkkkkkk......',
    '....kkhhhhhhhhhhhhkk....',
    '...khhhhHhhhhhhHhhhhk...',
    '..khhhHHkkkkkkkkHHhhhk..',
    '..khhHk..........kHhhk..',
    '..khHk............kHhk..',
    '...kk..............kk...',
  ];
  S.tache_up = [
    '......kkkkkkkkkkkk......',
    '...kkkhhhhhhhhhhhhkkk...',
    '..khhhhhHhhhhhhHhhhhhk..',
    '.khhhHHkkkkkkkkkkHHhhhk.',
    '.khhHk............kHhhk.',
    '..kk................kk..',
  ];
  S.mouth_open = ['kkkk', 'kRRk', 'kRxk', '.kk.'];

  // Berlin orange street bin on a post
  S.bin = [
    '.kkkkkkkkkkk.',
    'kOoooooooooOk',
    'kkkkkkkkkkkkk',
    'kOoOoooooOoOk',
    'kOoOoyyyoOoOk',
    'kOoOoooooOoOk',
    'kOoOoooooOoOk',
    'kOoOoooooOoOk',
    'kOoOoooooOoOk',
    '.kOOOOOOOOOk.',
    '..kkkkkkkkk..',
    '.....kgk.....',
    '.....kGk.....',
    '.....kgk.....',
    '.....kGk.....',
    '....kkkkk....',
  ];
  // bin bag slung over the shoulder (drawn behind the hero's left side)
  S.binbag = [
    '......kk.....',
    '.....kPPk....',
    '....kkPPkk...',
    '...kPKPPKPk..',
    '..kPPKKKKPPk.',
    '.kPPKKKKKKPPk',
    'kPPKKKKKKKKPk',
    'kPKKKKKKKKKPk',
    'kPKKKKgKKKKPk',
    'kPKKKKKgKKKPk',
    'kPKKKKKKKKKPk',
    'kPKKKKKKKKPPk',
    '.kPKKKKKKPPk.',
    '..kPPPPPPPk..',
    '...kkkkkkk...',
  ];
  // orange push cart with a grey bin and a broom holder
  S.cart = [
    '..kk..................',
    '..kck.................',
    '...kck..kkkkkkkkkkk...',
    '....kckkgggggggggggk..',
    '.....kckGgggggggggGk..',
    '......kkGgGgggGggGGk..',
    '.....kOkGgGgggGggGGk..',
    'kkkkkkoOkGgGgggGggGk..',
    'koooooooooooooooooook.',
    'kOoooooooooooooooooOk.',
    'kOoowwwwwwwwwwwwwooOk.',
    'kOooooooooooooooooOOk.',
    '.kkkkkkkkkkkkkkkkkkk..',
    '...kkk..........kkk...',
    '..kgGgk........kgGgk..',
    '..kGkGk........kGkGk..',
    '...kkk..........kkk...',
  ];

  // ---- trash on the floor ------------------------------------------------
  S.t_can = ['.kkkk.', 'klxxlk', 'kxwwxk', 'kxxxxk', 'klxxlk', '.kkkk.'];
  S.t_cup = ['kkkkkk', 'kwwwwk', '.kcck.', '.kcck.', '.kwwk.', '..kk..'];
  S.t_pizza = ['kkkkkkkk', 'kqqqqqQk', 'kqxqqqQk', 'kqqqyqQk', 'kQQQQQQk', 'kkkkkkkk'];
  S.t_paper = ['.kkkk..', 'kwlwwk.', 'kwwlwwk', '.kwwlwk', '.kkkkk.'];
  S.t_banana = ['......kk', '.....kyk', 'kk..kyyk', 'kykkyyk.', '.kyyyk..', '..kkk...'];
  S.t_mate = ['..kk..', '.kwwk.', '.kyyk.', 'kyyyyk', 'kywwyk', 'kyyyyk', 'kYyyYk', '.kkkk.'];
  S.t_butt = ['kkkkk', 'kwwyk', 'kkkkk'];
  S.t_chips = ['kkkkkk', 'kuwwuk', 'kuxxuk', 'kuwwuk', 'kkkkkk'];
  S.t_glass = ['.k..k.', 'kak.ak', '.kaak.', 'kaka.k', '.k..k.'];
  S.t_flyer = ['kkkkkk', 'kxxwwk', 'kwwwwk', 'kwlllk', 'kkkkkk'];
  S.pfand = ['.kkk.', '.kvk.', '.kvk.', 'kvvVk', 'kvwVk', 'kvwVk', 'kvvVk', '.kkk.'];

  // ---- helpers & props ---------------------------------------------------
  // Frau Schulz from the Vorderhaus: grey bun, glasses, plum cardigan, broom
  S.neighbour = [
    '...kkk....',
    '..klllk...',
    '.kkkkkkk..',
    '.kllllllk.',
    'kslkwkwlk.',
    'ksssssssk.',
    '.kssrssk..',
    '..kkkkk...',
    '.kpppppk..',
    'kpppwpppk.',
    'kpppwpppk.',
    'kpppwpppk.',
    'kpPpwpPpk.',
    'kspppppsk.',
    '.kttttttk.',
    '.kttttttk.',
    '.kTttttTk.',
    '..kskksk..',
    '..kskksk..',
    '.kkkkkkkk.',
  ];
  // Pfand collector: cap, parka, big blue bag of bottles
  S.pfandguy = [
    '....kkkk......',
    '...kGGGGk.....',
    '..kkkkkkkk....',
    '...kssssk.....',
    '...kskskk.....',
    '...kssssk.....',
    '...kbbbbk.....',
    '..keeeeeek....',
    '.keeeeeeeekkk.',
    '.keeeeeeekavak',
    '.keeeeeekuvavuk',
    '.kseeeeekuuuuuk',
    '..keeeeekuUuUuk',
    '..kNNNNNkuuuuuk',
    '..kNNkNNkkkkkk.',
    '..kNNkNNk.....',
    '..kNNkNNk.....',
    '.kkkkkkkkk....',
  ];
  // crew member: orange vest, cap, grabber
  S.crew = [
    '..kkkk...',
    '.koooook.',
    '.kkkkkk..',
    '.kssssk..',
    '.kskskk..',
    '.kssssk..',
    '..kkkk...',
    '.koooook.',
    'kowwwwwok',
    'koooooook',
    'kowwwwwok',
    'ksooooosk',
    '.kNNNNNk.',
    '.kNNkNNk.',
    '.kNNkNNk.',
    'kkkkkkkkk',
  ];
  // Lastenrad with a wooden box of bins
  S.cargobike = [
    '..kkkkkkkkkkk.................',
    '..kcccccccccck................',
    '..kcCcCcCcCcck.......kkk......',
    '..kckkkkkkkkck.......kGk......',
    '..kcktkokykkck......kk.kk.....',
    '..kccccccccccck....kk...k.....',
    '..kkkkkkkkkkkkk...kk....kkk...',
    '.....kk....kkkkkkkk....kGGGk..',
    '....kGk...kk.....kk.....kk....',
    '..kkkkkkkk..........kkkkkkkk..',
    '.kGk....kGk........kGk....kGk.',
    'kGk..kk..kGk......kGk..kk..kGk',
    'kGk.kGGk.kGk......kGk.kGGk.kGk',
    'kGk..kk..kGk......kGk..kk..kGk',
    '.kGk....kGk........kGk....kGk.',
    '..kkkkkkkk..........kkkkkkkk..',
  ];
  // BSR-style street sweeper truck (brushes animated in code)
  S.sweeper = [
    '..........kkkkkkkkkkkkk.........',
    '.........kaaaakoooooooook.......',
    '........kaaaaakoooooooooOk......',
    '.......kaaaaaakooooooooooOk.....',
    '.......kkkkkkkkoooooooooooOkkkkk',
    '.......koooookooooooooooooooooOk',
    'kkkkkkkkooooookwwwwwwwwwwwwwwwOk',
    'kooooooooooookoooooooooooooooOOk',
    'kOooooooooooooooooooooooooooooOk',
    'kOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOk',
    'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
    '..kkkk..............kkkk........',
    '.kGGGGk............kGGGGk.......',
    '.kGllGk............kGllGk.......',
    '..kkkk..............kkkk........',
  ];
  // Späti kiosk front
  S.spaeti = [
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kzzzzzzzzzzzzzzzzzzzzzzk',
    'kzxxzxxxzxxzzxxzxxzxzzzk',
    'kzxzzxzxzxzxzzxzzxzxzzzk',
    'kzxxzxxxzxxxzzxzzxzxzzzk',
    'kzzxzxzzzxzxzzxzzxzxzzzk',
    'kzxxzxzzzxzxzzxzzxzxzzzk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kxwxwxwxwxwxwxwxwxwxwxwk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kcCkzzzzzzzzzkcCkkzzzzck',
    'kcCkzyvyuyxyzkcCkkzwzzck',
    'kcCkzyvyuyxyzkcCkkzzzzck',
    'kcCkzzzzzzzzzkcCkkzzzzck',
    'kcCkzxvuyvxuzkcCkkzzzzck',
    'kcCkzxvuyvxuzkcCkkzzzzck',
    'kcCkzzzzzzzzzkcCkkzzzzck',
    'kcCkkkkkkkkkkkcCkkzzzzck',
    'kcCccccccccccccCkkzzzzck',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
  ];
  // crate of Club-Mate in front of the Späti
  S.crate = ['kkkkkkkk', 'kykykyyk', 'kyykykyk', 'kkkkkkkk', 'kuuuuuuk', 'kUuuuuUk', 'kkkkkkkk'];
  // U-Bahn sign on a post
  S.usign = [
    'kkkkkkkkk',
    'kuuuuuuuk',
    'kuwuuuwuk',
    'kuwuuuwuk',
    'kuwuuuwuk',
    'kuwuuuwuk',
    'kuuwwwuuk',
    'kuuuuuuuk',
    'kkkkkkkkk',
    '...kgk...',
    '...kGk...',
    '...kgk...',
    '...kGk...',
    '...kgk...',
    '...kGk...',
    '...kgk...',
    '..kkkkk..',
  ];
  // skimmer boat with a net
  S.boat = [
    '.......k..........',
    '.......kk.........',
    '.......kwk........',
    '.......kwwk.......',
    '..kkkkkkkkkkk.....',
    '..kwwwwwwwwwk.....',
    'kkkkkkkkkkkkkkkkkk',
    'kooooooooooooooook',
    '.kOOOOOOOOOOOOOOk.',
    '..kkkkkkkkkkkkkk..',
  ];
  // S-Bahn Ringbahn car (ochre + red)
  S.train = [
    'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
    'kyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyk',
    'kykaakaakyykaakaakyykaakaakyakyk',
    'kykaakaakyykaakaakyykaakaakyakyk',
    'kxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxk',
    'kxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxk',
    'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
    '..kGk.kGk............kGk.kGk....',
  ];
  // recycling skip
  S.skip = [
    'kkkkkkkkkkkk',
    'kEEEEEEEEEEk',
    '.keeeeeeeek.',
    '.keeewweeek.',
    '.keewkkweek.',
    '.keeewweeek.',
    '.keeeeeeeek.',
    '.kkkkkkkkkk.',
  ];
  // little orange truck for the fleet
  S.minitruck = [
    '.....kkkkkkkkkk',
    'kkkk.kooooooook',
    'kakok.koooooook',
    'koook.kowwwwwok',
    'koooookooooooOk',
    'kkkkkkkkkkkkkkk',
    '.kGk......kGk..',
  ];
  // street lamp head (glow drawn in code)
  S.lamp = ['.kkkkk.', 'kGGGGGk', '.kzzzk.', '..kkk..'];
  // kite
  S.kite = ['...k...', '..kxk..', '.kxxxk.', 'kyyxxxk', '.kyyyk.', '..kyk..', '...k...'];

  // ---- hand-drawn 16x16 shop icons (keyed by upgrade / zone id) ----------
  S.icon_broom = [
    '..............kk',
    '.............kck',
    '............kck.',
    '...........kck..',
    '..........kck...',
    '.........kck....',
    '........kck.....',
    '.......kck......',
    '....kkkkk.......',
    '...kyyyyyk......',
    '..kyYyYyyk......',
    '.kyYyYyYyk......',
    'kyYyYyYyk.......',
    'kYyYyYyk........',
    'kkkkkkk.........',
    '................',
  ];
  S.icon_garbage_bags = [
    '......kkkk......',
    '.....kPKKPk.....',
    '......kPPk......',
    '.....kKPPKk.....',
    '....kKKKKKKk....',
    '...kKKKKKKKKk...',
    '..kKKKKKKKKKPk..',
    '..kKKKgKKKKKPk..',
    '.kKKKKKgKKKKKPk.',
    '.kKKKKKKKKKKKPk.',
    '.kKKKKKKKKKKKPk.',
    '.kPKKKKKKKKKPPk.',
    '..kPKKKKKKKPPk..',
    '...kPPPPPPPPk...',
    '....kkkkkkkk....',
    '................',
  ];
  S.icon_handcart = [
    'kk..............',
    'kck.............',
    '.kck.kkkkkkkkk..',
    '..kckkgggggggk..',
    '...kckGgGgGgGk..',
    '..kkokGgGgGgGk..',
    'kkkkkkkkkkkkkkk.',
    'koooooooooooook.',
    'kOowwwwwwwwwwOk.',
    'kOoooooooooooOk.',
    '.kkkkkkkkkkkkk..',
    '..kkk.....kkk...',
    '.kgGgk...kgGgk..',
    '.kGkGk...kGkGk..',
    '..kkk.....kkk...',
    '................',
  ];
  S.icon_sweeper_truck = [
    '................',
    '.....kkkkkkkkkk.',
    '....kaakoooooook',
    '...kaaakoooooook',
    '...kkkkkoooooook',
    'kkkkooookwwwwwok',
    'kooooooooooooook',
    'kOoooooooooooOOk',
    'kOOOOOOOOOOOOOOk',
    'kkkkkkkkkkkkkkkk',
    '.kkk.kyk...kkk..',
    'kgGgkyyyk.kgGgk.',
    'kGkGkyky..kGkGk.',
    '.kkk.y.y...kkk..',
    '................',
    '................',
  ];
  S.icon_pfand = [
    '......kkkk......',
    '......kwwk......',
    '......kvVk......',
    '......kvVk......',
    '.....kkvVkk.....',
    '....kvvvvVVk....',
    '....kvwvvvVk....',
    '....kvwvvvVk....',
    '....kyyyyyyk....',
    '....kywwwwyk....',
    '....kyyyyyyk....',
    '....kvwvvvVk....',
    '....kvvvvvVk....',
    '....kvvvvvVk....',
    '.....kkkkkk.....',
    '................',
  ];
  // moon with a "z" for the welcome-back card
  S.icon_away = [
    '..........kkk...',
    '..........kwk...',
    '.....kkkk..kwk..',
    '...kkyyyk.kkkk..',
    '..kyyyyk........',
    '..kyyyk.........',
    '.kyyyk..........',
    '.kyyyk..........',
    '.kyyyk..........',
    '.kyyyyk.......k.',
    '..kyyyyk....kky.',
    '..kYyyyykkkkyyk.',
    '...kYYyyyyyyyk..',
    '....kkYYYYYkk...',
    '......kkkkk.....',
    '................',
  ];
  S.icon_trash_pick = [
    '..............k.',
    '.............kw.',
    '............kgk.',
    '...........kgk..',
    '..........kgk...',
    '.........kgk....',
    '........kgk.....',
    '.......kgk......',
    '......kgk.......',
    '.....kkk........',
    '....kkkk........',
    '...kkkk.........',
    '..kkkk..........',
    '..kkk...........',
    '................',
    '................',
  ];

  TrashGame.Pixel = { PAL, S, sprite, draw, rect, px, line, dither, disc, icon };
})(typeof window !== 'undefined' ? window : globalThis);
