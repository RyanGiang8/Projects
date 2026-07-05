// Procedural texture atlas + item icons. No external assets — everything is
// painted onto canvases at load time with a deterministic RNG.
(function () {
  const MB = (window.MB = window.MB || {});

  const T = (MB.TILES = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, WATER: 6,
    LOG_SIDE: 7, LOG_TOP: 8, LEAVES: 9, PLANKS: 10, TABLE_TOP: 11, TABLE_SIDE: 12,
    TABLE_FRONT: 13, FURNACE_TOP: 14, FURNACE_SIDE: 15, FURNACE_FRONT: 16,
    COAL_ORE: 17, IRON_ORE: 18, DIAMOND_ORE: 19, BEDROCK: 20, GLASS: 21,
  });

  const TS = 16, DIM = 16; // 16px tiles, 16x16 tile atlas
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = TS * DIM;
  const A = atlas.getContext("2d");
  MB.atlasCanvas = atlas;

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shade(col, f) {
    let r, g, b;
    if (col[0] === "#") {
      const n = parseInt(col.slice(1), 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else {
      const m = col.match(/\d+/g);
      r = +m[0]; g = +m[1]; b = +m[2];
    }
    const cl = (v) => Math.min(255, Math.max(0, Math.round(v * f)));
    return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
  }

  function painter(tile) {
    const ox = (tile % DIM) * TS, oy = ((tile / DIM) | 0) * TS;
    return {
      px(x, y, c) { A.fillStyle = c; A.fillRect(ox + x, oy + y, 1, 1); },
      rect(x, y, w, h, c) { A.fillStyle = c; A.fillRect(ox + x, oy + y, w, h); },
      clear() { A.clearRect(ox, oy, TS, TS); },
    };
  }

  function noisy(tile, base, vary, seed) {
    const p = painter(tile), rnd = mulberry(seed);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++)
        p.px(x, y, shade(base, 1 + (rnd() - 0.5) * vary));
    return p;
  }

  function speckle(tile, color, dark, seed, clusters) {
    const p = painter(tile), rnd = mulberry(seed);
    for (let i = 0; i < clusters; i++) {
      const cx = 2 + Math.floor(rnd() * 12), cy = 2 + Math.floor(rnd() * 12);
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) {
        const x = cx + Math.floor(rnd() * 3) - 1, y = cy + Math.floor(rnd() * 3) - 1;
        p.px(x, y, rnd() < 0.4 ? dark : color);
      }
    }
  }

  // ---- terrain tiles ----
  noisy(T.GRASS_TOP, "#68a03e", 0.28, 11);
  noisy(T.DIRT, "#82593a", 0.3, 12);
  {
    const p = noisy(T.GRASS_SIDE, "#82593a", 0.3, 13);
    const rnd = mulberry(14);
    for (let x = 0; x < TS; x++) {
      const d = 2 + Math.floor(rnd() * 3);
      for (let y = 0; y < d; y++) p.px(x, y, shade("#68a03e", 0.85 + rnd() * 0.35));
    }
  }
  noisy(T.STONE, "#7d7d7d", 0.16, 15);
  {
    const p = noisy(T.COBBLE, "#7f7f7f", 0.2, 16), rnd = mulberry(160);
    for (let gy = 0; gy < 4; gy++)
      for (let gx = 0; gx < 4; gx++) {
        const ox = (gx * 4 + (gy % 2 ? 2 : 0)) % 16;
        const base = shade("#8a8a8a", 0.8 + rnd() * 0.45);
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 3; x++)
            p.px((ox + x) % 16, gy * 4 + y, shade(base, 0.92 + rnd() * 0.2));
        p.px((ox + (rnd() * 3 | 0)) % 16, gy * 4, shade(base, 1.25));
      }
    for (let i = 0; i < 16; i++) p.px((rnd() * 16) | 0, (rnd() * 16) | 0, "#565656");
  }
  noisy(T.SAND, "#dccfa0", 0.14, 17);
  noisy(T.WATER, "#3b5fd0", 0.12, 18);
  {
    const p = noisy(T.LOG_SIDE, "#67492c", 0.12, 19), rnd = mulberry(20);
    for (let x = 0; x < TS; x++) {
      const stripe = x % 4 === 0 || x % 4 === 3;
      for (let y = 0; y < TS; y++)
        if (stripe && rnd() < 0.85) p.px(x, y, shade("#4e361f", 0.9 + rnd() * 0.3));
    }
  }
  {
    const p = noisy(T.LOG_TOP, "#67492c", 0.1, 21);
    const rings = ["#a8834e", "#6b4c2c", "#9c7845", "#5e4023", "#b08a54"];
    for (let r = 0; r < 6; r++) {
      const c = rings[r % rings.length];
      p.rect(2 + r, 2 + r, 12 - 2 * r, 1, c); p.rect(2 + r, 13 - r, 12 - 2 * r, 1, c);
      p.rect(2 + r, 2 + r, 1, 12 - 2 * r, c); p.rect(13 - r, 2 + r, 1, 12 - 2 * r, c);
    }
  }
  {
    const p = noisy(T.LEAVES, "#3d6c20", 0.45, 22), rnd = mulberry(23);
    for (let i = 0; i < 40; i++) p.px((rnd() * 16) | 0, (rnd() * 16) | 0, "#26490f");
    for (let i = 0; i < 14; i++) p.px((rnd() * 16) | 0, (rnd() * 16) | 0, "#5c9436");
  }
  function planksInto(tile, seed) {
    const p = painter(tile), rnd = mulberry(seed);
    for (let board = 0; board < 4; board++) {
      const tone = 0.85 + rnd() * 0.3;
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < TS; x++)
          p.px(x, board * 4 + y, shade("#9c7f4e", tone * (0.92 + rnd() * 0.16)));
      p.rect(0, board * 4 + 3, 16, 1, "#5e4a28");
      const cut = 2 + Math.floor(rnd() * 12);
      p.rect(cut, board * 4, 1, 3, "#6b5530");
    }
    return p;
  }
  planksInto(T.PLANKS, 24);
  {
    const p = planksInto(T.TABLE_TOP, 25);
    p.rect(0, 0, 16, 1, "#5e4a28"); p.rect(0, 15, 16, 1, "#5e4a28");
    p.rect(0, 0, 1, 16, "#5e4a28"); p.rect(15, 0, 1, 16, "#5e4a28");
    p.rect(3, 3, 10, 1, "#3f2f16"); p.rect(3, 12, 10, 1, "#3f2f16");
    p.rect(3, 3, 1, 10, "#3f2f16"); p.rect(12, 3, 1, 10, "#3f2f16");
    p.rect(7, 3, 2, 10, "#3f2f16"); p.rect(3, 7, 10, 2, "#3f2f16");
  }
  {
    const p = planksInto(T.TABLE_SIDE, 26);
    p.rect(0, 0, 16, 3, "#7a6138");
    p.rect(2, 5, 4, 5, "#4e3c1e"); p.rect(3, 6, 2, 3, "#8a6f42");
    p.rect(10, 5, 4, 5, "#4e3c1e"); p.rect(11, 6, 2, 3, "#8a6f42");
  }
  {
    const p = planksInto(T.TABLE_FRONT, 27);
    p.rect(0, 0, 16, 3, "#7a6138");
    p.rect(3, 5, 10, 6, "#4e3c1e"); p.rect(4, 6, 8, 4, "#8a6f42");
    p.rect(6, 6, 1, 4, "#4e3c1e"); p.rect(9, 6, 1, 4, "#4e3c1e");
  }
  function stoneyInto(tile, base, seed) {
    const p = painter(tile), rnd = mulberry(seed);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) p.px(x, y, shade(base, 1 + (rnd() - 0.5) * 0.22));
    p.rect(0, 0, 16, 1, "#4c4c4c"); p.rect(0, 15, 16, 1, "#4c4c4c");
    p.rect(0, 0, 1, 16, "#4c4c4c"); p.rect(15, 0, 1, 16, "#4c4c4c");
    return p;
  }
  stoneyInto(T.FURNACE_TOP, "#6e6e6e", 28);
  stoneyInto(T.FURNACE_SIDE, "#7a7a7a", 29);
  {
    const p = stoneyInto(T.FURNACE_FRONT, "#7a7a7a", 30);
    p.rect(4, 8, 8, 6, "#141414");
    p.rect(4, 8, 8, 1, "#333");
    p.rect(5, 12, 2, 2, "#ff9a2a"); p.rect(9, 13, 2, 1, "#ffce4d");
  }
  noisy(T.COAL_ORE, "#7d7d7d", 0.16, 31); speckle(T.COAL_ORE, "#1e1e1e", "#3c3c3c", 32, 5);
  noisy(T.IRON_ORE, "#7d7d7d", 0.16, 33); speckle(T.IRON_ORE, "#d8a789", "#b07d5d", 34, 5);
  noisy(T.DIAMOND_ORE, "#7d7d7d", 0.16, 35); speckle(T.DIAMOND_ORE, "#3fd9cd", "#8ff2ea", 36, 4);
  {
    const p = painter(T.BEDROCK), rnd = mulberry(37);
    const cs = ["#2c2c2c", "#4a4a4a", "#666", "#383838"];
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) p.px(x, y, cs[(rnd() * cs.length) | 0]);
  }
  {
    const p = painter(T.GLASS); p.clear();
    const c = "#cfe6ea";
    p.rect(0, 0, 16, 1, c); p.rect(0, 15, 16, 1, c);
    p.rect(0, 0, 1, 16, c); p.rect(15, 0, 1, 16, c);
    for (let i = 0; i < 5; i++) p.px(10 + i > 15 ? 15 : 10 + i, 5 - i < 0 ? 0 : 5 - i, "#ffffffaa");
    p.px(3, 10, "#ffffff88"); p.px(4, 11, "#ffffff88"); p.px(12, 3, "#ffffff66");
  }

  // average color per tile (for particles / fallbacks)
  MB.tileColor = {};
  {
    const d = A.getImageData(0, 0, TS * DIM, TS * DIM).data;
    for (const k in T) {
      const t = T[k], ox = (t % DIM) * TS, oy = ((t / DIM) | 0) * TS;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 2; y < 14; y += 3)
        for (let x = 2; x < 14; x += 3) {
          const i = ((oy + y) * TS * DIM + ox + x) * 4;
          if (d[i + 3] < 128) continue;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
      n = n || 1;
      MB.tileColor[t] = ((r / n) << 16) | ((g / n) << 8) | (b / n);
    }
  }

  MB.atlasTex = new THREE.CanvasTexture(atlas);
  MB.atlasTex.magFilter = THREE.NearestFilter;
  MB.atlasTex.minFilter = THREE.NearestFilter;
  MB.atlasTex.generateMipmaps = false;

  // ---- crack (mining progress) textures ----
  MB.crackTex = [];
  for (let s = 0; s < 4; s++) {
    const c = document.createElement("canvas");
    c.width = c.height = TS;
    const g = c.getContext("2d"), rnd = mulberry(90 + s * 7);
    for (let l = 0; l < 3 + s * 3; l++) {
      let x = (rnd() * 16) | 0, y = (rnd() * 16) | 0;
      const len = 4 + ((rnd() * 6) | 0);
      for (let i = 0; i < len; i++) {
        g.fillStyle = rnd() < 0.7 ? "rgba(10,10,10,.85)" : "rgba(30,30,30,.5)";
        g.fillRect(x, y, 1, 1);
        x += rnd() < 0.5 ? 1 : rnd() < 0.5 ? -1 : 0;
        y += rnd() < 0.5 ? 1 : rnd() < 0.5 ? -1 : 0;
        x = Math.max(0, Math.min(15, x)); y = Math.max(0, Math.min(15, y));
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    MB.crackTex.push(tex);
  }

  // ---- tile data URL (used for menu backgrounds etc.) ----
  MB.tileDataURL = function (tile) {
    const c = document.createElement("canvas");
    c.width = c.height = TS;
    c.getContext("2d").drawImage(atlas, (tile % DIM) * TS, ((tile / DIM) | 0) * TS, TS, TS, 0, 0, TS, TS);
    return c.toDataURL();
  };

  // ---- isometric block icon ----
  function isoIcon(topTile, sideTile, frontTile) {
    const c = document.createElement("canvas");
    c.width = c.height = 48;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const k = 22 / 16;
    const src = (t) => [(t % DIM) * TS, ((t / DIM) | 0) * TS];
    function face(tile, a, b, cc, d, e, f, dark) {
      const [sx, sy] = src(tile);
      g.setTransform(a, b, cc, d, e, f);
      g.drawImage(atlas, sx, sy, TS, TS, 0, 0, TS, TS);
      if (dark) { g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, 0, TS, TS); }
    }
    face(topTile, k, 0.5 * k, -k, 0.5 * k, 24, 1, 0);          // top
    face(sideTile, k, 0.5 * k, 0, k, 2, 12, 0.22);             // left
    face(frontTile, k, -0.5 * k, 0, k, 24, 23, 0.38);          // right
    g.setTransform(1, 0, 0, 1, 0, 0);
    return c.toDataURL();
  }

  // ---- pixel-art item icons ----
  function artIcon(rows, pal) {
    const c = document.createElement("canvas");
    c.width = c.height = TS;
    const g = c.getContext("2d");
    for (let y = 0; y < rows.length && y < TS; y++)
      for (let x = 0; x < rows[y].length && x < TS; x++) {
        const ch = rows[y][x];
        if (ch === "." || !pal[ch]) continue;
        g.fillStyle = pal[ch];
        g.fillRect(x, y, 1, 1);
      }
    return c.toDataURL();
  }

  const HANDLE = { h: "#7a5230", H: "#5c3d22" };
  const MATS = {
    wooden: { M: "#8a6a3f", m: "#a98c55" },
    stone: { M: "#8b8b8b", m: "#a8a8a8" },
    iron: { M: "#d6d6d6", m: "#f2f2f2" },
    diamond: { M: "#39d6c8", m: "#8ff5ec" },
  };

  const TOOL_ART = {
    pickaxe: [
      "......mmmmmm....",
      ".....mMMMMMMm...",
      "....mMm....mMM..",
      "....mM......MM..",
      "...mM....hh.MM..",
      "...MM...hh..MM..",
      "...M...hh...mM..",
      "......hh.....M..",
      ".....hh......M..",
      "....hh..........",
      "...hh...........",
      "..hh............",
      ".hh.............",
      "hh..............",
      "................",
      "................",
    ],
    axe: [
      "......mMMm......",
      ".....mMMMMm.....",
      "....mMMMMMm.....",
      "....MMmhhMm.....",
      ".....m.hh.m.....",
      "......hh........",
      ".....hh.........",
      "....hh..........",
      "...hh...........",
      "..hh............",
      ".hh.............",
      "hh..............",
      "................",
      "................",
      "................",
      "................",
    ],
    shovel: [
      "..........mMm...",
      ".........mMMM...",
      "........hMMMm...",
      ".......hhMMm....",
      "......hh.mm.....",
      ".....hh.........",
      "....hh..........",
      "...hh...........",
      "..hh............",
      ".hh.............",
      "hh..............",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
    sword: [
      "............mm..",
      "...........mMm..",
      "..........mMm...",
      ".........mMm....",
      "........mMm.....",
      ".......mMm......",
      "..H...mMm.......",
      "..HH.mMm........",
      "...HHmm.........",
      "..hHHH..........",
      ".hh..HH.........",
      "hh....H.........",
      "................",
      "................",
      "................",
      "................",
    ],
  };

  const ITEM_ART = {
    stick: [
      "................",
      "..........hh....",
      ".........hHh....",
      "........hh......",
      ".......hh.......",
      "......hh........",
      ".....hh.........",
      "....hh..........",
      "...hh...........",
      "..hh............",
      "................",
    ],
    coal: [
      "................",
      "................",
      ".....mmmm.......",
      "....mMMMMm......",
      "...mMMmMMMm.....",
      "...MMMMMMMM.....",
      "...HMMMMmMH.....",
      "....HMMMMH......",
      ".....HHHH.......",
      "................",
    ],
    iron_ingot: [
      "................",
      "................",
      "................",
      "....mmmmmmm.....",
      "...mMMMMMMMm....",
      "..mMMMMMMMMMH...",
      "..MMMMMMMMMHH...",
      "..HHHHHHHHHH....",
      "................",
    ],
    diamond: [
      "................",
      "......mmmm......",
      ".....mMMMMm.....",
      "....mMMMMMMm....",
      "...mMMMMMMMMm...",
      "....HMMMMMMH....",
      ".....HMMMMH.....",
      "......HMMH......",
      ".......HH.......",
      "................",
    ],
    torch: [
      "................",
      ".......ww.......",
      "......wyyw......",
      "......yyyy......",
      ".......hh.......",
      ".......hH.......",
      ".......hh.......",
      ".......hH.......",
      ".......hh.......",
      ".......hH.......",
      "................",
    ],
  };
  const ITEM_PAL = {
    stick: HANDLE,
    coal: { m: "#4a4a4a", M: "#2b2b2b", H: "#151515" },
    iron_ingot: { m: "#f2f2f2", M: "#d4d4d4", H: "#8f8f8f" },
    diamond: { m: "#a5f7f0", M: "#3fd9cd", H: "#1c9d92" },
    torch: { w: "#fff1a8", y: "#ffb625", ...HANDLE },
  };

  const iconCache = {};
  MB.iconFor = function (itemId) {
    if (iconCache[itemId]) return iconCache[itemId];
    const it = MB.Items[itemId];
    let url;
    if (!it) url = "";
    else if (it.art && Array.isArray(it.art)) {
      const [, type, tier] = it.art;
      url = artIcon(TOOL_ART[type], { ...HANDLE, ...MATS[tier] });
    } else if (it.art) {
      url = artIcon(ITEM_ART[it.art], ITEM_PAL[it.art]);
    } else if (it.block) {
      const f = MB.Blocks[it.block].f; // [+x,-x,top,bottom,+z,-z]
      url = isoIcon(f[2], f[0], f[4]);
    } else url = "";
    iconCache[itemId] = url;
    return url;
  };
})();
