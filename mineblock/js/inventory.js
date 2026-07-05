// Inventory model + all UI: hotbar, inventory (2x2 craft), crafting table (3x3), furnace.
(function () {
  const MB = window.MB;

  MB.inv = { hotbar: new Array(9).fill(null), main: new Array(27).fill(null), sel: 0 };
  MB.ui = { open: null, grid: null, gridSize: 0, cursor: null, furnaceKey: null };

  // ---------- model ----------
  function addToArray(arr, id, count, dmg) {
    const max = MB.stackMax(id);
    if (max > 1)
      for (const st of arr) {
        if (!st || st.id !== id || st.count >= max) continue;
        const take = Math.min(max - st.count, count);
        st.count += take; count -= take;
        if (!count) return 0;
      }
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]) continue;
      const take = Math.min(max, count);
      arr[i] = { id, count: take };
      if (dmg) arr[i].dmg = dmg;
      count -= take;
      if (!count) return 0;
    }
    return count;
  }

  MB.addItem = function (id, count, dmg) {
    count = count || 1;
    let left = addToArray(MB.inv.hotbar, id, count, dmg);
    if (left) left = addToArray(MB.inv.main, id, left, dmg);
    refresh();
    return left;
  };

  MB.heldStack = () => MB.inv.hotbar[MB.inv.sel];

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const hotbarEl = $("#hotbar"), panelEl = $("#invPanel"), screenEl = $("#invScreen");
  const cursorEl = $("#cursorStack"), tipEl = $("#tooltip"), toastEl = $("#toast");
  const itemNameEl = $("#itemName");

  function slotHTML(sec, idx, cls) {
    return `<div class="slot ${cls || ""}" data-sec="${sec}" data-idx="${idx}"></div>`;
  }
  function gridHTML(sec, n, cols) {
    let h = `<div class="grid g${cols}">`;
    for (let i = 0; i < n; i++) h += slotHTML(sec, i);
    return h + "</div>";
  }

  for (let i = 0; i < 9; i++) hotbarEl.innerHTML += `<div class="slot" data-sec="hb" data-idx="${i}"></div>`;

  function renderStack(el, st) {
    if (!st) { el.innerHTML = ""; return; }
    const it = MB.Items[st.id];
    let h = `<img src="${MB.iconFor(st.id)}" alt="">`;
    if (st.count > 1) h += `<span class="cnt">${st.count}</span>`;
    if (it && it.dur && st.dmg > 0) {
      const f = Math.max(0, 1 - st.dmg / it.dur);
      const col = f > 0.5 ? "#4dde42" : f > 0.25 ? "#ded542" : "#de4242";
      h += `<div class="dur"><i style="width:${Math.round(f * 36)}px;background:${col}"></i></div>`;
    }
    el.innerHTML = h;
  }

  function renderHotbar() {
    const slots = hotbarEl.children;
    for (let i = 0; i < 9; i++) {
      renderStack(slots[i], MB.inv.hotbar[i]);
      slots[i].classList.toggle("sel", i === MB.inv.sel);
    }
  }
  MB.renderHotbar = renderHotbar;

  let nameTimer = null;
  MB.showItemName = function () {
    const st = MB.heldStack();
    itemNameEl.textContent = st ? MB.Items[st.id].name : "";
    itemNameEl.style.opacity = st ? 1 : 0;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => (itemNameEl.style.opacity = 0), 1600);
  };

  // ---------- screens ----------
  function buildScreen(type) {
    let h = "";
    if (type === "inv") {
      h += `<div class="ptitle">Crafting</div>`;
      h += `<div class="craftRow">${gridHTML("craft", 4, 2)}<span class="arrow">➜</span>${slotHTML("result", 0, "result")}</div>`;
    } else if (type === "table") {
      h += `<div class="ptitle">Crafting Table</div>`;
      h += `<div class="craftRow">${gridHTML("craft", 9, 3)}<span class="arrow">➜</span>${slotHTML("result", 0, "result")}</div>`;
    } else if (type === "furnace") {
      h += `<div class="ptitle">Furnace</div>`;
      h += `<div class="furnRow"><div class="furnCol">${slotHTML("fin", 0)}<div class="flame"><i id="flameBar" style="height:0"></i></div>${slotHTML("ffuel", 0)}</div><div class="parrow"><i id="progBar" style="width:0"></i></div>${slotHTML("fout", 0, "result")}</div>`;
    }
    h += `<div class="ptitle">Inventory</div>`;
    h += gridHTML("main", 27, 9);
    h += `<div class="sep"></div>`;
    h += gridHTML("hotbar", 9, 9);
    panelEl.innerHTML = h;
  }

  MB.openScreen = function (type, furnaceKey) {
    if (MB.ui.open) MB.closeScreen(false);
    MB.ui.open = type;
    MB.ui.furnaceKey = furnaceKey || null;
    if (type === "inv") { MB.ui.grid = new Array(4).fill(null); MB.ui.gridSize = 2; }
    else if (type === "table") { MB.ui.grid = new Array(9).fill(null); MB.ui.gridSize = 3; }
    else { MB.ui.grid = null; MB.ui.gridSize = 0; }
    buildScreen(type);
    screenEl.classList.remove("hidden");
    document.exitPointerLock && document.exitPointerLock();
    refresh();
  };

  MB.closeScreen = function (relock) {
    if (!MB.ui.open) return;
    // return crafting grid + cursor contents to the inventory
    if (MB.ui.grid)
      for (let i = 0; i < MB.ui.grid.length; i++) {
        const st = MB.ui.grid[i];
        if (st) MB.addItem(st.id, st.count, st.dmg);
        MB.ui.grid[i] = null;
      }
    if (MB.ui.cursor) {
      MB.addItem(MB.ui.cursor.id, MB.ui.cursor.count, MB.ui.cursor.dmg);
      MB.ui.cursor = null;
    }
    MB.ui.open = null;
    screenEl.classList.add("hidden");
    cursorEl.classList.add("hidden");
    tipEl.classList.add("hidden");
    renderHotbar();
    if (relock && MB.lockPointer) MB.lockPointer();
  };

  function getFurnaceState() {
    return MB.ui.furnaceKey ? MB.world.getFurnace(MB.ui.furnaceKey) : null;
  }

  function secArray(sec) {
    const st = getFurnaceState();
    switch (sec) {
      case "main": return MB.inv.main;
      case "hotbar": case "hb": return MB.inv.hotbar;
      case "craft": return MB.ui.grid;
      case "fin": return st ? st.in : null;
      case "ffuel": return st ? st.fuel : null;
      case "fout": return st ? st.out : null;
    }
    return null;
  }

  function craftResult() {
    if (!MB.ui.grid) return null;
    return MB.matchCraft(MB.ui.grid, MB.ui.gridSize);
  }

  // ---------- rendering ----------
  function refresh() {
    renderHotbar();
    if (!MB.ui.open) return;
    panelEl.querySelectorAll(".slot").forEach((el) => {
      const sec = el.dataset.sec, idx = +el.dataset.idx;
      if (sec === "result") renderStack(el, craftResult());
      else {
        const arr = secArray(sec);
        renderStack(el, arr ? arr[idx] : null);
      }
    });
    renderCursor();
    renderFurnaceBars();
  }
  MB.refreshUI = refresh;

  function renderCursor() {
    const c = MB.ui.cursor;
    if (!c) { cursorEl.classList.add("hidden"); return; }
    cursorEl.classList.remove("hidden");
    cursorEl.innerHTML = `<img src="${MB.iconFor(c.id)}">` + (c.count > 1 ? `<span class="cnt">${c.count}</span>` : "");
  }

  function renderFurnaceBars() {
    if (MB.ui.open !== "furnace") return;
    const st = getFurnaceState();
    const flame = $("#flameBar"), prog = $("#progBar");
    if (!st || !flame) return;
    const f = st.burnMax > 0 ? Math.max(0, st.burn / st.burnMax) : 0;
    flame.style.height = Math.round(f * 100) + "%";
    prog.style.width = Math.round((st.prog / MB.SMELT_TIME) * 100) + "%";
  }
  MB.renderFurnaceBars = renderFurnaceBars;

  // ---------- interaction ----------
  function takeResult(shift) {
    const res = craftResult();
    if (!res) return;
    if (shift) {
      let guard = 0;
      while (guard++ < 64) {
        const r = craftResult();
        if (!r) break;
        if (MB.addItem(r.id, r.count) > 0) break;
        MB.consumeGrid(MB.ui.grid);
      }
    } else {
      const c = MB.ui.cursor;
      if (!c) MB.ui.cursor = { id: res.id, count: res.count };
      else if (c.id === res.id && c.count + res.count <= MB.stackMax(res.id)) c.count += res.count;
      else return;
      MB.consumeGrid(MB.ui.grid);
    }
    MB.sfx && MB.sfx("craft");
    refresh();
  }

  function takeOutput(arr) {
    const st = arr[0];
    if (!st) return;
    const c = MB.ui.cursor;
    if (!c) { MB.ui.cursor = st; arr[0] = null; }
    else if (c.id === st.id) {
      const take = Math.min(MB.stackMax(c.id) - c.count, st.count);
      c.count += take; st.count -= take;
      if (st.count <= 0) arr[0] = null;
    }
    refresh();
  }

  function shiftMove(arr, idx) {
    const st = arr[idx];
    if (!st) return;
    const target = arr === MB.inv.main ? MB.inv.hotbar : MB.inv.main;
    const left = addToArray(target, st.id, st.count, st.dmg);
    arr[idx] = left > 0 ? { ...st, count: left } : null;
    refresh();
  }

  function slotClick(sec, idx, button, shift) {
    if (sec === "result") { takeResult(shift); return; }
    if (sec === "fout") { takeOutput(secArray(sec)); return; }
    const arr = secArray(sec);
    if (!arr) return;
    if (shift && (sec === "main" || sec === "hotbar")) { shiftMove(arr, idx); return; }

    const c = MB.ui.cursor, s = arr[idx];
    if (button === 0) {
      if (!c) { if (s) { MB.ui.cursor = s; arr[idx] = null; } }
      else if (!s) { arr[idx] = c; MB.ui.cursor = null; }
      else if (s.id === c.id && !MB.Items[s.id].tool) {
        const max = MB.stackMax(s.id);
        const take = Math.min(max - s.count, c.count);
        s.count += take; c.count -= take;
        if (c.count <= 0) MB.ui.cursor = null;
      } else { arr[idx] = c; MB.ui.cursor = s; }
    } else {
      if (!c) {
        if (s) {
          const half = Math.ceil(s.count / 2);
          MB.ui.cursor = { ...s, count: half };
          s.count -= half;
          if (s.count <= 0) arr[idx] = null;
        }
      } else if (!s) {
        arr[idx] = { ...c, count: 1 };
        c.count--;
        if (c.count <= 0) MB.ui.cursor = null;
      } else if (s.id === c.id && s.count < MB.stackMax(s.id)) {
        s.count++; c.count--;
        if (c.count <= 0) MB.ui.cursor = null;
      }
    }
    MB.sfx && MB.sfx("click");
    refresh();
  }

  panelEl.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".slot");
    if (!el) return;
    e.preventDefault();
    slotClick(el.dataset.sec, +el.dataset.idx, e.button === 2 ? 2 : 0, e.shiftKey);
  });
  panelEl.addEventListener("contextmenu", (e) => e.preventDefault());

  // tooltip + cursor follow
  document.addEventListener("mousemove", (e) => {
    if (!MB.ui.open) return;
    cursorEl.style.left = e.clientX + "px";
    cursorEl.style.top = e.clientY + "px";
    const el = e.target && e.target.closest ? e.target.closest(".slot") : null;
    let st = null;
    if (el && el.dataset.sec) {
      if (el.dataset.sec === "result") st = craftResult();
      else { const arr = secArray(el.dataset.sec); st = arr && arr[+el.dataset.idx]; }
    }
    if (st && !MB.ui.cursor) {
      tipEl.textContent = MB.Items[st.id].name;
      tipEl.style.left = e.clientX + 14 + "px";
      tipEl.style.top = e.clientY - 24 + "px";
      tipEl.classList.remove("hidden");
    } else tipEl.classList.add("hidden");
  });

  // ---------- toast ----------
  let toastTimer = null;
  MB.toast = function (msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    toastEl.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.style.opacity = 0), 2500);
  };

  // ---------- hearts ----------
  const heartsEl = $("#hearts");
  MB.renderHearts = function () {
    const hp = MB.player ? MB.player.hp : 20;
    let h = "";
    for (let i = 0; i < 10; i++) {
      const v = hp - i * 2;
      h += `<span class="${v >= 2 ? "" : v === 1 ? "half" : "empty"}">♥</span>`;
    }
    heartsEl.innerHTML = h;
  };
})();
