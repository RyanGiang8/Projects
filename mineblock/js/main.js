// Game bootstrap + main loop: rendering, mining, placing, held item, save/load.
(function () {
  const MB = window.MB;
  const $ = (s) => document.querySelector(s);
  const H = MB.WORLD_H, REACH = 4.5, RADIUS = 4;

  // ---------- save / load ----------
  const SAVE_KEY = "mineblock_save_v1";
  let save = null;
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { save = null; }

  const seed = save && save.seed ? save.seed : (Math.random() * 2 ** 31) | 0;

  // ---------- renderer / scene ----------
  const canvas = $("#game");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const SKY = 0x8fc9f2;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 44, 84);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 400);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(0.45, 1, 0.3);
  scene.add(sun);

  // ---------- world / player ----------
  const world = (MB.world = new MB.World(seed));
  if (save && save.edits)
    for (const k in save.edits) world.edits.set(k, save.edits[k]);
  if (save && save.furnaces)
    for (const k in save.furnaces) {
      const f = save.furnaces[k];
      world.furnaces.set(k, { in: [f.in], fuel: [f.fuel], out: [f.out], burn: f.burn || 0, burnMax: f.burnMax || 0, prog: f.prog || 0 });
    }
  scene.add(world.group);

  const player = (MB.player = new MB.Player(world));
  player.spawn.copy(world.findSpawn());
  if (save && save.player) {
    player.pos.set(save.player.x, save.player.y, save.player.z);
    player.yaw = save.player.yaw || 0;
    player.pitch = save.player.pitch || 0;
    player.hp = save.player.hp != null ? save.player.hp : 20;
  } else player.respawn(false);
  player.peakY = player.pos.y;

  if (save && save.inv) {
    MB.inv.hotbar = save.inv.hotbar.map((s) => (s ? { ...s } : null));
    MB.inv.main = save.inv.main.map((s) => (s ? { ...s } : null));
    MB.inv.sel = save.inv.sel || 0;
  }

  world.update(player.pos.x, player.pos.z, 2, Infinity); // warm-up ring

  function doSave() {
    const edits = {};
    for (const [k, v] of world.edits) edits[k] = v;
    const furnaces = {};
    for (const [k, v] of world.furnaces) {
      if (!v.in[0] && !v.fuel[0] && !v.out[0] && v.burn <= 0) continue;
      furnaces[k] = { in: v.in[0], fuel: v.fuel[0], out: v.out[0], burn: v.burn, burnMax: v.burnMax, prog: v.prog };
    }
    const data = {
      seed, edits, furnaces,
      inv: { hotbar: MB.inv.hotbar, main: MB.inv.main, sel: MB.inv.sel },
      player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, hp: player.hp },
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  window.addEventListener("beforeunload", doSave);

  // ---------- sound (tiny webaudio synth) ----------
  let audio = null;
  function sfx(name) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const o = audio.createOscillator(), g = audio.createGain();
      o.connect(g); g.connect(audio.destination);
      const P = {
        break: [110, 55, "square", 0.12, 0.08],
        place: [220, 180, "square", 0.08, 0.06],
        click: [520, 520, "square", 0.03, 0.03],
        craft: [420, 620, "triangle", 0.09, 0.06],
        hurt: [140, 60, "sawtooth", 0.22, 0.1],
        pop: [640, 900, "sine", 0.05, 0.05],
      }[name] || [300, 300, "square", 0.05, 0.04];
      o.type = P[2];
      o.frequency.setValueAtTime(P[0], t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, P[1]), t + P[3]);
      g.gain.setValueAtTime(P[4], t);
      g.gain.exponentialRampToValueAtTime(0.001, t + P[3]);
      o.start(t); o.stop(t + P[3] + 0.02);
    } catch (e) {}
  }
  MB.sfx = sfx;
  MB.onDamage = () => {
    sfx("hurt");
    const el = $("#damageFlash");
    el.style.display = "block";
    setTimeout(() => (el.style.display = "none"), 220);
  };

  // ---------- pointer lock / screens ----------
  const startScreen = $("#startScreen"), pauseScreen = $("#pauseScreen");
  let started = false;

  MB.lockPointer = function () {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => showPause());
    } catch (e) { showPause(); }
  };
  function showPause() {
    if (!started || MB.ui.open) return;
    pauseScreen.classList.remove("hidden");
  }

  // dirt-texture menu backgrounds
  document.querySelectorAll(".fullscreen").forEach((el) => {
    el.style.backgroundImage = `url(${MB.tileDataURL(MB.TILES.DIRT)})`;
  });

  $("#playBtn").addEventListener("click", () => {
    started = true;
    startScreen.classList.add("hidden");
    MB.lockPointer();
    if (!save) MB.toast("Punch a tree! Hold left click to mine.");
  });
  $("#resumeBtn").addEventListener("click", () => {
    pauseScreen.classList.add("hidden");
    MB.lockPointer();
  });
  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("Reset the world and inventory? This cannot be undone.")) return;
    window.removeEventListener("beforeunload", doSave);
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });

  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement) {
      mouseL = mouseR = false;
      if (started && !MB.ui.open) showPause();
    } else {
      pauseScreen.classList.add("hidden");
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    player.yaw -= e.movementX * 0.0024;
    player.pitch -= e.movementY * 0.0024;
    const lim = Math.PI / 2 - 0.01;
    player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
  });

  // ---------- input: mining / placing / hotbar ----------
  let mouseL = false, mouseR = false, placeTimer = 0;
  const locked = () => document.pointerLockElement === canvas;

  document.addEventListener("mousedown", (e) => {
    if (!locked()) return;
    if (e.button === 0) mouseL = true;
    if (e.button === 2) { mouseR = true; placeTimer = 0; tryUse(); }
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouseL = false;
    if (e.button === 2) mouseR = false;
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("wheel", (e) => {
    if (!locked()) return;
    MB.inv.sel = (MB.inv.sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
    MB.renderHotbar(); MB.showItemName(); updateHeld();
  });

  document.addEventListener("keydown", (e) => {
    if (!started) return;
    if (e.code === "KeyE") {
      e.preventDefault();
      if (MB.ui.open) MB.closeScreen(true);
      else if (locked()) MB.openScreen("inv");
    } else if (e.code === "Escape") {
      if (MB.ui.open) MB.closeScreen(true);
    } else if (/^Digit[1-9]$/.test(e.code) && locked()) {
      MB.inv.sel = +e.code.slice(5) - 1;
      MB.renderHotbar(); MB.showItemName(); updateHeld();
    }
  });

  // ---------- block targeting ----------
  let target = null;
  const hlGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
  const highlight = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({ color: 0x111111 }));
  highlight.visible = false;
  scene.add(highlight);

  const crackMat = new THREE.MeshBasicMaterial({ map: MB.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMat);
  crack.visible = false;
  scene.add(crack);

  function updateTarget() {
    const e = player.eyePos(), d = player.lookDir();
    target = locked() && !MB.ui.open ? world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, REACH) : null;
    if (target) {
      highlight.visible = true;
      highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    } else highlight.visible = false;
  }

  // ---------- mining ----------
  const mining = { key: null, prog: 0, need: 1, harvest: true };
  function resetMining() { mining.key = null; mining.prog = 0; crack.visible = false; }

  function updateMining(dt) {
    if (!mouseL || !target || !locked() || MB.ui.open) { resetMining(); return; }
    const key = target.x + "," + target.y + "," + target.z;
    const b = world.getBlock(target.x, target.y, target.z);
    if (!b || b === 6) { resetMining(); return; }
    if (key !== mining.key) {
      const info = MB.breakInfo(b, MB.heldStack());
      mining.key = key; mining.prog = 0;
      mining.need = info.time; mining.harvest = info.harvest;
    }
    if (mining.need === Infinity) { crack.visible = false; return; }
    mining.prog += dt;
    swing = Math.max(swing, 0.18);
    const stage = Math.min(3, Math.floor((mining.prog / mining.need) * 4));
    crackMat.map = MB.crackTex[stage];
    crack.position.copy(highlight.position);
    crack.visible = true;
    if (mining.prog >= mining.need) {
      breakBlock(target.x, target.y, target.z, b);
      resetMining();
    }
  }

  function breakBlock(x, y, z, b) {
    const def = MB.Blocks[b];
    world.setBlock(x, y, z, 0);
    sfx("break");
    spawnParticles(x, y, z, MB.tileColor[def.f[0]]);

    if (def.interactive === "furnace") {
      const key = x + "," + y + "," + z;
      const st = world.furnaces.get(key);
      if (st) {
        for (const arr of [st.in, st.fuel, st.out])
          if (arr[0]) MB.addItem(arr[0].id, arr[0].count, arr[0].dmg);
        world.furnaces.delete(key);
      }
    }

    if (mining.harvest && def.drops) {
      const left = MB.addItem(def.drops, 1);
      if (left) MB.toast("Inventory full!");
      else sfx("pop");
    } else if (!mining.harvest && def.minTier) {
      const tiers = ["", "wooden", "stone", "iron"];
      MB.toast(`Needs a ${tiers[def.minTier]} pickaxe or better to harvest`);
    }

    // tool durability
    const st = MB.heldStack();
    if (st && MB.Items[st.id].tool) {
      st.dmg = (st.dmg || 0) + 1;
      if (st.dmg >= MB.Items[st.id].dur) {
        MB.inv.hotbar[MB.inv.sel] = null;
        MB.toast("Your tool broke!");
        sfx("hurt");
        updateHeld();
      }
      MB.renderHotbar();
    }
    updateTarget();
  }

  // ---------- placing / using ----------
  function tryUse() {
    if (!target || MB.ui.open) return;
    const tb = world.getBlock(target.x, target.y, target.z);
    const tdef = MB.Blocks[tb];
    if (tdef && tdef.interactive) {
      if (tdef.interactive === "table") MB.openScreen("table");
      else MB.openScreen("furnace", target.x + "," + target.y + "," + target.z);
      return;
    }
    const st = MB.heldStack();
    if (!st) return;
    const it = MB.Items[st.id];
    if (!it.block) return;
    const px = target.x + target.nx, py = target.y + target.ny, pz = target.z + target.nz;
    if (py < 1 || py >= H - 1) return;
    const cur = world.getBlock(px, py, pz);
    if (cur !== 0 && cur !== 6) return;
    // don't place a solid block inside the player
    if (MB.SOLID[it.block]) {
      const p = player.pos;
      if (px + 1 > p.x - 0.3 && px < p.x + 0.3 &&
          pz + 1 > p.z - 0.3 && pz < p.z + 0.3 &&
          py + 1 > p.y && py < p.y + 1.8) return;
    }
    world.setBlock(px, py, pz, it.block);
    st.count--;
    if (st.count <= 0) MB.inv.hotbar[MB.inv.sel] = null;
    MB.renderHotbar();
    sfx("place");
    swing = Math.max(swing, 0.25);
    updateHeld();
    updateTarget();
  }

  // ---------- particles ----------
  const particles = [];
  const partGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  function spawnParticles(x, y, z, color) {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color }));
      m.position.set(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3.5 + 1, (Math.random() - 0.5) * 3);
      m.userData.life = 0.55;
      scene.add(m);
      particles.push(m);
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const m = particles[i];
      m.userData.life -= dt;
      if (m.userData.life <= 0) {
        scene.remove(m); m.material.dispose();
        particles.splice(i, 1);
        continue;
      }
      m.userData.v.y -= 9 * dt;
      m.position.addScaledVector(m.userData.v, dt);
      const s = Math.max(0.2, m.userData.life / 0.55);
      m.scale.setScalar(s);
    }
  }

  // ---------- held item ----------
  const heldGroup = new THREE.Group();
  heldGroup.position.set(0.42, -0.42, -0.75);
  camera.add(heldGroup);
  let heldSig = "___", swing = 0, bobT = 0;

  function blockGeo(blockId) {
    const f = MB.Blocks[blockId].f;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const uv = g.attributes.uv;
    // BoxGeometry face order: +x,-x,+y,-y,+z,-z (4 verts each)
    for (let face = 0; face < 6; face++) {
      const t = f[face], tx = t % 16, ty = (t / 16) | 0;
      for (let v = 0; v < 4; v++) {
        const i = face * 4 + v;
        uv.setXY(i, (tx + uv.getX(i)) / 16, (16 - ty - 1 + uv.getY(i)) / 16);
      }
    }
    return g;
  }

  function updateHeld() {
    const st = MB.heldStack();
    const sig = st ? st.id : "none";
    if (sig === heldSig) return;
    heldSig = sig;
    while (heldGroup.children.length) {
      const c = heldGroup.children.pop();
      if (c.geometry) c.geometry.dispose();
    }
    if (!st) return;
    const it = MB.Items[st.id];
    if (it.block && !it.art) {
      const m = new THREE.Mesh(blockGeo(it.block), world.matOpaque2 || (world.matOpaque2 = new THREE.MeshLambertMaterial({ map: MB.atlasTex, alphaTest: 0.5 })));
      m.scale.setScalar(0.34);
      m.rotation.y = Math.PI / 4 + 0.2;
      heldGroup.add(m);
    } else {
      const img = new Image();
      img.src = MB.iconFor(st.id);
      const tex = new THREE.Texture(img);
      img.onload = () => (tex.needsUpdate = true);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
      );
      m.rotation.z = -Math.PI / 5;
      m.rotation.y = -0.35;
      heldGroup.add(m);
    }
  }

  // ---------- torch lights ----------
  const torchLights = [];
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight(0xffc966, 0, 9);
    l.position.set(0, -1000, 0);
    scene.add(l);
    torchLights.push(l);
  }
  let torchTimer = 0;
  function updateTorchLights() {
    const p = player.pos, cand = [];
    for (const ch of world.chunks.values()) {
      if (!ch.group) continue;
      for (const t of ch.torches) {
        const d2 = (t[0] - p.x) ** 2 + (t[2] - p.z) ** 2;
        if (d2 < 900) cand.push([d2, t]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < torchLights.length; i++) {
      if (i < cand.length) {
        torchLights[i].position.set(cand[i][1][0], cand[i][1][1], cand[i][1][2]);
        torchLights[i].intensity = 1.1;
      } else torchLights[i].intensity = 0;
    }
  }

  // ---------- clouds ----------
  const cloudGroup = new THREE.Group();
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 16; i++) {
      const w = 10 + Math.random() * 22, d = 8 + Math.random() * 16;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((Math.random() - 0.5) * 300, 62 + Math.random() * 5, (Math.random() - 0.5) * 300);
      cloudGroup.add(m);
    }
  }
  scene.add(cloudGroup);

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let saveTimer = 0, regenTimer = 0, uiFurnTimer = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const playing = started && locked() && !MB.ui.open;

    player.update(dt, playing);
    world.update(player.pos.x, player.pos.z, RADIUS, 2);

    updateTarget();
    updateMining(dt);

    if (mouseR && playing) {
      placeTimer += dt;
      if (placeTimer > 0.24) { placeTimer = 0; tryUse(); }
    }

    // furnaces tick even when their UI is closed
    let furnChanged = false;
    for (const st of world.furnaces.values())
      if (MB.tickFurnace(st, dt)) furnChanged = true;
    if (MB.ui.open === "furnace") {
      uiFurnTimer += dt;
      if (furnChanged && uiFurnTimer > 0.12) { uiFurnTimer = 0; MB.refreshUI(); }
    }

    // held item bob + swing
    updateHeld();
    if (playing && player.onGround && (player.vel.x || player.vel.z)) bobT += dt * 9;
    if (swing > 0) swing = Math.max(0, swing - dt);
    heldGroup.position.y = -0.42 + Math.sin(bobT) * 0.02 - swing * 0.55;
    heldGroup.rotation.x = -swing * 2.4;
    heldGroup.position.x = 0.42 + Math.cos(bobT * 0.5) * 0.012;

    // torch lights
    torchTimer -= dt;
    if (torchTimer <= 0) { torchTimer = 0.5; updateTorchLights(); }

    // clouds drift
    cloudGroup.position.x += dt * 0.8;
    if (cloudGroup.position.x > 200) cloudGroup.position.x = -200;

    // health regen
    regenTimer += dt;
    if (regenTimer > 4) {
      regenTimer = 0;
      if (player.hp < 20 && playing) { player.hp++; MB.renderHearts(); }
    }

    // underwater overlay
    const eyeB = world.getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
    $("#underwater").style.display = eyeB === 6 ? "block" : "none";

    saveTimer += dt;
    if (saveTimer > 6) { saveTimer = 0; doSave(); }

    player.applyCamera(camera);
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  MB.renderHotbar();
  MB.renderHearts();
  updateHeld();
  frame();
})();
