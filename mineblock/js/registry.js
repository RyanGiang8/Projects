// Block/item definitions, crafting recipes, smelting and mining rules.
(function () {
  const MB = window.MB;
  const T = MB.TILES;

  // ---------- Blocks (numeric ids used in chunk data) ----------
  // tiles: {all} or {top,side,bottom,front}; f = per-face [+x,-x,+y,-y,+z,-z]
  const B = (MB.Blocks = {
    1:  { name: "Grass Block", hard: 0.6, tool: "shovel", drops: "dirt",
          tiles: { top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT } },
    2:  { name: "Dirt", hard: 0.5, tool: "shovel", drops: "dirt", tiles: { all: T.DIRT } },
    3:  { name: "Stone", hard: 1.5, tool: "pickaxe", minTier: 1, drops: "cobblestone", tiles: { all: T.STONE } },
    4:  { name: "Cobblestone", hard: 2.0, tool: "pickaxe", minTier: 1, drops: "cobblestone", tiles: { all: T.COBBLE } },
    5:  { name: "Sand", hard: 0.5, tool: "shovel", drops: "sand", tiles: { all: T.SAND } },
    6:  { name: "Water", fluid: true, drops: null, tiles: { all: T.WATER } },
    7:  { name: "Oak Log", hard: 2.0, tool: "axe", drops: "log",
          tiles: { top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP } },
    8:  { name: "Oak Leaves", hard: 0.2, drops: null, tiles: { all: T.LEAVES } },
    9:  { name: "Oak Planks", hard: 2.0, tool: "axe", drops: "planks", tiles: { all: T.PLANKS } },
    10: { name: "Crafting Table", hard: 2.5, tool: "axe", drops: "crafting_table", interactive: "table",
          tiles: { top: T.TABLE_TOP, side: T.TABLE_SIDE, bottom: T.PLANKS, front: T.TABLE_FRONT } },
    11: { name: "Furnace", hard: 3.5, tool: "pickaxe", minTier: 1, drops: "furnace", interactive: "furnace",
          tiles: { top: T.FURNACE_TOP, side: T.FURNACE_SIDE, bottom: T.FURNACE_TOP, front: T.FURNACE_FRONT } },
    12: { name: "Coal Ore", hard: 3.0, tool: "pickaxe", minTier: 1, drops: "coal", tiles: { all: T.COAL_ORE } },
    13: { name: "Iron Ore", hard: 3.0, tool: "pickaxe", minTier: 2, drops: "iron_ore", tiles: { all: T.IRON_ORE } },
    14: { name: "Diamond Ore", hard: 3.0, tool: "pickaxe", minTier: 3, drops: "diamond", tiles: { all: T.DIAMOND_ORE } },
    15: { name: "Bedrock", drops: null, tiles: { all: T.BEDROCK } },
    16: { name: "Torch", hard: 0.05, drops: "torch", torch: true, tiles: { all: T.LOG_SIDE } },
    17: { name: "Glass", hard: 0.3, drops: "glass", glass: true, tiles: { all: T.GLASS } },
  });

  for (const id in B) {
    const d = B[id], t = d.tiles;
    const side = t.all !== undefined ? t.all : t.side;
    const top = t.all !== undefined ? t.all : t.top;
    const bottom = t.all !== undefined ? t.all : (t.bottom !== undefined ? t.bottom : t.top);
    const front = t.front !== undefined ? t.front : side;
    d.f = [side, side, top, bottom, front, front];
  }

  // opaque = fully hides neighboring faces (also used for ambient occlusion)
  MB.OPAQUE = new Uint8Array(32);
  for (const id of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15]) MB.OPAQUE[id] = 1;
  // solid = collides with the player
  MB.SOLID = new Uint8Array(32);
  for (const id in B) if (+id !== 6 && +id !== 16) MB.SOLID[id] = 1;

  // ---------- Items (string ids used in inventory) ----------
  const I = (MB.Items = {
    dirt: { name: "Dirt", block: 2 },
    stone: { name: "Stone", block: 3 },
    cobblestone: { name: "Cobblestone", block: 4 },
    sand: { name: "Sand", block: 5 },
    log: { name: "Oak Log", block: 7 },
    planks: { name: "Oak Planks", block: 9 },
    crafting_table: { name: "Crafting Table", block: 10 },
    furnace: { name: "Furnace", block: 11 },
    glass: { name: "Glass", block: 17 },
    torch: { name: "Torch", block: 16, art: "torch" },
    stick: { name: "Stick", art: "stick" },
    coal: { name: "Coal", art: "coal" },
    iron_ore: { name: "Iron Ore", block: 13 },
    iron_ingot: { name: "Iron Ingot", art: "iron_ingot" },
    diamond: { name: "Diamond", art: "diamond" },
  });

  const TIERS = {
    wooden: { tier: 1, speed: 2, dur: 60 },
    stone: { tier: 2, speed: 4, dur: 132 },
    iron: { tier: 3, speed: 6, dur: 251 },
    diamond: { tier: 4, speed: 8, dur: 1562 },
  };
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  for (const tier in TIERS)
    for (const type of ["pickaxe", "axe", "shovel", "sword"]) {
      I[`${tier}_${type}`] = {
        name: `${cap(tier)} ${cap(type)}`,
        tool: { type, tier: TIERS[tier].tier, speed: TIERS[tier].speed },
        dur: TIERS[tier].dur, stack: 1, art: ["tool", type, tier],
      };
    }

  MB.stackMax = (id) => (I[id] && I[id].stack) || 64;

  // ---------- Crafting recipes ----------
  const R = (MB.Recipes = { shaped: [], shapeless: [] });
  function shaped(pat, out, count) {
    R.shaped.push({ pat, out: { id: out, count: count || 1 } });
    const mir = pat.map((row) => row.slice().reverse());
    if (JSON.stringify(mir) !== JSON.stringify(pat))
      R.shaped.push({ pat: mir, out: { id: out, count: count || 1 } });
  }
  function shapeless(ings, out, count) {
    R.shapeless.push({ ings: ings.slice().sort(), out: { id: out, count: count || 1 } });
  }

  shapeless(["log"], "planks", 4);
  shaped([["planks"], ["planks"]], "stick", 4);
  shaped([["planks", "planks"], ["planks", "planks"]], "crafting_table", 1);
  shaped([["coal"], ["stick"]], "torch", 4);
  shaped([
    ["cobblestone", "cobblestone", "cobblestone"],
    ["cobblestone", null, "cobblestone"],
    ["cobblestone", "cobblestone", "cobblestone"],
  ], "furnace", 1);

  const MATS = { planks: "wooden", cobblestone: "stone", iron_ingot: "iron", diamond: "diamond" };
  for (const m in MATS) {
    const t = MATS[m];
    shaped([[m, m, m], [null, "stick", null], [null, "stick", null]], `${t}_pickaxe`);
    shaped([[m, m], [m, "stick"], [null, "stick"]], `${t}_axe`);
    shaped([[m], ["stick"], ["stick"]], `${t}_shovel`);
    shaped([[m], [m], ["stick"]], `${t}_sword`);
  }

  // grid: array of (stack|null), n = grid width. Returns {id,count} or null.
  MB.matchCraft = function (grid, n) {
    let minR = n, maxR = -1, minC = n, maxC = -1;
    const ids = [];
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const st = grid[r * n + c];
        if (!st) continue;
        ids.push(st.id);
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
    if (maxR < 0) return null;

    const bh = maxR - minR + 1, bw = maxC - minC + 1;
    outer: for (const rec of R.shaped) {
      if (rec.pat.length !== bh || rec.pat[0].length !== bw) continue;
      for (let r = 0; r < bh; r++)
        for (let c = 0; c < bw; c++) {
          const st = grid[(minR + r) * n + (minC + c)];
          const want = rec.pat[r][c];
          if ((st ? st.id : null) !== (want || null)) continue outer;
        }
      return { ...rec.out };
    }
    const sorted = ids.slice().sort();
    outer2: for (const rec of R.shapeless) {
      if (rec.ings.length !== sorted.length) continue;
      for (let i = 0; i < sorted.length; i++)
        if (rec.ings[i] !== sorted[i]) continue outer2;
      return { ...rec.out };
    }
    return null;
  };

  MB.consumeGrid = function (grid) {
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      grid[i].count--;
      if (grid[i].count <= 0) grid[i] = null;
    }
  };

  // ---------- Smelting ----------
  MB.SMELT = { iron_ore: "iron_ingot", sand: "glass", cobblestone: "stone", log: "coal" };
  MB.FUELS = { coal: 40, log: 7.5, planks: 7.5, stick: 2.5, crafting_table: 7.5 };
  MB.SMELT_TIME = 5;

  MB.tickFurnace = function (st, dt) {
    let changed = false;
    const inS = st.in[0], out = st.out[0];
    const res = inS && MB.SMELT[inS.id];
    const canOut = res && (!out || (out.id === res && out.count < MB.stackMax(res)));
    if (st.burn > 0) { st.burn -= dt; changed = true; }
    if (canOut) {
      if (st.burn <= 0) {
        const f = st.fuel[0], bt = f && MB.FUELS[f.id];
        if (bt) {
          f.count--; if (f.count <= 0) st.fuel[0] = null;
          st.burn += bt; st.burnMax = bt; changed = true;
        }
      }
      if (st.burn > 0) {
        st.prog += dt; changed = true;
        if (st.prog >= MB.SMELT_TIME) {
          st.prog = 0;
          inS.count--; if (inS.count <= 0) st.in[0] = null;
          if (out) out.count++; else st.out[0] = { id: res, count: 1 };
        }
      } else if (st.prog) { st.prog = 0; changed = true; }
    } else if (st.prog) { st.prog = 0; changed = true; }
    if (st.burn < 0) st.burn = 0;
    return changed;
  };

  // ---------- Mining rules ----------
  // Returns {time (s), harvest (bool: block yields drops)}
  MB.breakInfo = function (blockId, stack) {
    const def = B[blockId];
    if (!def || def.hard === undefined) return { time: Infinity, harvest: false };
    let speed = 1, matched = false, tier = 0;
    if (stack) {
      const it = I[stack.id];
      if (it && it.tool) {
        tier = it.tool.tier;
        if (it.tool.type === def.tool) { speed = it.tool.speed; matched = true; }
      }
    }
    const harvest = !def.minTier || (matched && tier >= def.minTier);
    const time = harvest ? (def.hard * 1.5) / (matched ? speed : 1) : def.hard * 5;
    return { time, harvest };
  };
})();
