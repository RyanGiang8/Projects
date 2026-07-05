// Chunked voxel world: seeded terrain generation, meshing, raycasting.
(function () {
  const MB = window.MB;
  const CH = 16, H = 64, SEA = 20;
  MB.WORLD_H = H;

  // ---- deterministic hashes / value noise ----
  function hash2i(x, z, seed) {
    let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1013904223)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function hash3i(x, y, z, seed) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 2246822519) + Math.imul(z, 668265263) + Math.imul(seed, 1013904223)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  function vnoise2(x, z, seed) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = smooth(xf), v = smooth(zf);
    const a = hash2i(xi, zi, seed), b = hash2i(xi + 1, zi, seed);
    const c = hash2i(xi, zi + 1, seed), d = hash2i(xi + 1, zi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm2(x, z, seed, oct) {
    let s = 0, amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      s += vnoise2(x, z, seed + o * 101) * amp;
      tot += amp; amp *= 0.5; x *= 2; z *= 2;
    }
    return s / tot;
  }
  function vnoise3(x, y, z, seed) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
    function lat(dx, dy, dz) { return hash3i(xi + dx, yi + dy, zi + dz, seed); }
    const x00 = lat(0, 0, 0) + (lat(1, 0, 0) - lat(0, 0, 0)) * u;
    const x10 = lat(0, 1, 0) + (lat(1, 1, 0) - lat(0, 1, 0)) * u;
    const x01 = lat(0, 0, 1) + (lat(1, 0, 1) - lat(0, 0, 1)) * u;
    const x11 = lat(0, 1, 1) + (lat(1, 1, 1) - lat(0, 1, 1)) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  // ---- face tables ----
  // corners: [x,y,z,u,v]; dir = outward normal
  const FACES = [
    { dir: [1, 0, 0],  corners: [[1,0,0,0,0],[1,1,0,0,1],[1,1,1,1,1],[1,0,1,1,0]] },
    { dir: [-1, 0, 0], corners: [[0,0,1,0,0],[0,1,1,0,1],[0,1,0,1,1],[0,0,0,1,0]] },
    { dir: [0, 1, 0],  corners: [[0,1,1,0,0],[1,1,1,1,0],[1,1,0,1,1],[0,1,0,0,1]] },
    { dir: [0, -1, 0], corners: [[0,0,0,0,0],[1,0,0,1,0],[1,0,1,1,1],[0,0,1,0,1]] },
    { dir: [0, 0, 1],  corners: [[0,0,1,0,0],[1,0,1,1,0],[1,1,1,1,1],[0,1,1,0,1]] },
    { dir: [0, 0, -1], corners: [[1,0,0,0,0],[0,0,0,1,0],[0,1,0,1,1],[1,1,0,0,1]] },
  ];
  const AO_LEVEL = [1, 0.8, 0.64, 0.5];

  class World {
    constructor(seed) {
      this.seed = seed | 0;
      this.chunks = new Map();          // "cx,cz" -> chunk
      this.edits = new Map();           // "cx,cz" -> { idx: blockId }
      this.furnaces = new Map();        // "x,y,z" -> furnace state
      this.group = new THREE.Group();   // all chunk groups

      this.matOpaque = new THREE.MeshLambertMaterial({
        map: MB.atlasTex, vertexColors: true, alphaTest: 0.5,
      });
      this.matWater = new THREE.MeshLambertMaterial({
        map: MB.atlasTex, vertexColors: true, transparent: true,
        opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
      });
      this.torchStickGeo = new THREE.BoxGeometry(0.125, 0.55, 0.125);
      this.torchStickGeo.translate(0, 0.275, 0);
      this.torchStickGeo._shared = true;
      this.torchTipGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
      this.torchTipGeo.translate(0, 0.58, 0);
      this.torchTipGeo._shared = true;
      this.torchStickMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
      this.torchTipMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
    }

    key(cx, cz) { return cx + "," + cz; }

    heightAt(x, z) {
      const n = fbm2(x * 0.013, z * 0.013, this.seed, 4);
      const h = 15 + Math.pow(n, 1.35) * 26;
      return Math.max(4, Math.min(H - 18, Math.floor(h)));
    }
    treeAt(x, z) { return hash2i(x, z, this.seed ^ 0x5bd1) < 0.016; }

    genChunk(cx, cz) {
      const data = new Uint8Array(CH * CH * H);
      const seed = this.seed;
      for (let z = 0; z < CH; z++)
        for (let x = 0; x < CH; x++) {
          const wx = cx * CH + x, wz = cz * CH + z;
          const h = this.heightAt(wx, wz);
          for (let y = 0; y <= h; y++) {
            let b;
            if (y === 0) b = 15;
            else if (y <= h - 4) {
              b = 3;
              // caves
              if (y >= 6 && y <= h - 6 && vnoise3(wx * 0.11, y * 0.16, wz * 0.11, seed ^ 99) > 0.73) b = 0;
              else {
                const r1 = hash3i(wx, y, wz, seed ^ 1111);
                if (y <= 12 && r1 < 0.0035) b = 14;
                else if (y <= 30 && hash3i(wx, y, wz, seed ^ 2222) < 0.008) b = 13;
                else if (hash3i(wx, y, wz, seed ^ 3333) < 0.010) b = 12;
              }
            } else if (y < h) b = h <= SEA + 1 ? 5 : 2;
            else b = h <= SEA + 1 ? 5 : 1;
            if (b) data[x + z * CH + y * 256] = b;
          }
          for (let y = h + 1; y <= SEA; y++) data[x + z * CH + y * 256] = 6;
        }

      // trees (checked in a margin so canopies cross chunk borders)
      for (let tz = -3; tz < CH + 3; tz++)
        for (let tx = -3; tx < CH + 3; tx++) {
          const wx = cx * CH + tx, wz = cz * CH + tz;
          if (!this.treeAt(wx, wz)) continue;
          const h = this.heightAt(wx, wz);
          if (h <= SEA + 1) continue;
          const trunkH = 4 + Math.floor(hash2i(wx, wz, this.seed ^ 0x77aa) * 3);
          const put = (lx, y, lz, b, onlyAir) => {
            if (lx < 0 || lx >= CH || lz < 0 || lz >= CH || y < 0 || y >= H) return;
            const i = lx + lz * CH + y * 256;
            if (onlyAir && data[i] !== 0) return;
            data[i] = b;
          };
          put(tx, h, tz, 2, false); // dirt under trunk
          for (let y = h + 1; y <= h + trunkH; y++) put(tx, y, tz, 7, false);
          for (let y = h + trunkH - 1; y <= h + trunkH; y++)
            for (let dx = -2; dx <= 2; dx++)
              for (let dz = -2; dz <= 2; dz++) {
                if (dx === 0 && dz === 0 && y <= h + trunkH) continue;
                if (Math.abs(dx) === 2 && Math.abs(dz) === 2 &&
                    hash3i(wx + dx, y, wz + dz, this.seed ^ 0x1eaf) < 0.5) continue;
                put(tx + dx, y, tz + dz, 8, true);
              }
          const ty = h + trunkH + 1;
          for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
              if (Math.abs(dx) + Math.abs(dz) <= 1) put(tx + dx, ty, tz + dz, 8, true);
        }

      // player edits
      const ed = this.edits.get(this.key(cx, cz));
      if (ed) for (const idx in ed) data[idx] = ed[idx];
      return data;
    }

    ensureChunk(cx, cz) {
      const k = this.key(cx, cz);
      let ch = this.chunks.get(k);
      if (!ch) {
        ch = { cx, cz, data: this.genChunk(cx, cz), group: null, torches: [], dirty: false };
        this.chunks.set(k, ch);
      }
      return ch;
    }

    getBlock(x, y, z) {
      if (y < 0 || y >= H) return 0;
      const ch = this.ensureChunk(x >> 4, z >> 4);
      return ch.data[(x & 15) + (z & 15) * CH + y * 256];
    }

    setBlock(x, y, z, id) {
      if (y < 0 || y >= H) return;
      const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
      const ch = this.ensureChunk(cx, cz);
      const idx = lx + lz * CH + y * 256;
      if (ch.data[idx] === id) return;
      ch.data[idx] = id;
      const k = this.key(cx, cz);
      let ed = this.edits.get(k);
      if (!ed) { ed = {}; this.edits.set(k, ed); }
      ed[idx] = id;
      this.rebuild(cx, cz);
      if (lx === 0) this.rebuild(cx - 1, cz);
      if (lx === 15) this.rebuild(cx + 1, cz);
      if (lz === 0) this.rebuild(cx, cz - 1);
      if (lz === 15) this.rebuild(cx, cz + 1);
    }

    rebuild(cx, cz) {
      const ch = this.chunks.get(this.key(cx, cz));
      if (ch && ch.group) this.buildMesh(ch);
    }

    buildMesh(ch) {
      const { cx, cz, data } = ch;
      if (ch.group) { this.group.remove(ch.group); disposeGroup(ch.group); }
      const OP = MB.OPAQUE, Blocks = MB.Blocks;
      const o = { pos: [], nor: [], uv: [], col: [], idx: [] };
      const w = { pos: [], nor: [], uv: [], col: [], idx: [] };
      const torches = [];

      const get = (x, y, z) => {
        if (y < 0 || y >= H) return 0;
        if (x >= 0 && x < CH && z >= 0 && z < CH) return data[x + z * CH + y * 256];
        return this.getBlock(cx * CH + x, y, cz * CH + z);
      };

      for (let y = 0; y < H; y++)
        for (let z = 0; z < CH; z++)
          for (let x = 0; x < CH; x++) {
            const b = data[x + z * CH + y * 256];
            if (!b) continue;
            if (b === 16) { torches.push([x, y, z]); continue; }
            const water = b === 6, glass = b === 17;
            const tiles = Blocks[b].f;

            for (let f = 0; f < 6; f++) {
              const F = FACES[f], d = F.dir;
              const nb = get(x + d[0], y + d[1], z + d[2]);
              let vis;
              if (water) vis = nb === 0 || (nb !== 6 && !OP[nb]);
              else if (glass) vis = nb !== 17 && !OP[nb];
              else vis = !OP[nb];
              if (!vis) continue;

              const t = tiles[f], tx = t % 16, ty = (t / 16) | 0;
              const tgt = water ? w : o;
              const base = tgt.pos.length / 3;
              const na = d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2; // normal axis
              const t1 = na === 0 ? 1 : 0, t2 = na === 2 ? 1 : 2;

              for (let k = 0; k < 4; k++) {
                const c = F.corners[k];
                tgt.pos.push(x + c[0], y + c[1], z + c[2]);
                tgt.nor.push(d[0], d[1], d[2]);
                tgt.uv.push((tx + c[3]) / 16, (16 - ty - 1 + c[4]) / 16);
                let ao = 1;
                if (!water) {
                  const p = [x + d[0], y + d[1], z + d[2]];
                  const d1 = c[t1] === 1 ? 1 : -1, d2 = c[t2] === 1 ? 1 : -1;
                  const s1p = p.slice(); s1p[t1] += d1;
                  const s2p = p.slice(); s2p[t2] += d2;
                  const cp = p.slice(); cp[t1] += d1; cp[t2] += d2;
                  const a1 = OP[get(s1p[0], s1p[1], s1p[2])] ? 1 : 0;
                  const a2 = OP[get(s2p[0], s2p[1], s2p[2])] ? 1 : 0;
                  const a3 = OP[get(cp[0], cp[1], cp[2])] ? 1 : 0;
                  ao = AO_LEVEL[a1 && a2 ? 3 : a1 + a2 + a3];
                }
                tgt.col.push(ao, ao, ao);
              }
              tgt.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
          }

      const grp = new THREE.Group();
      grp.position.set(cx * CH, 0, cz * CH);
      grp.matrixAutoUpdate = false;
      grp.updateMatrix();

      const mk = (buf, mat) => {
        if (!buf.idx.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(buf.pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(buf.nor, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(buf.uv, 2));
        g.setAttribute("color", new THREE.Float32BufferAttribute(buf.col, 3));
        g.setIndex(buf.idx);
        const m = new THREE.Mesh(g, mat);
        m.matrixAutoUpdate = false;
        grp.add(m);
      };
      mk(o, this.matOpaque);
      mk(w, this.matWater);

      ch.torches = [];
      for (const [x, y, z] of torches) {
        const stick = new THREE.Mesh(this.torchStickGeo, this.torchStickMat);
        const tip = new THREE.Mesh(this.torchTipGeo, this.torchTipMat);
        stick.position.set(x + 0.5, y, z + 0.5);
        tip.position.copy(stick.position);
        grp.add(stick, tip);
        ch.torches.push([cx * CH + x + 0.5, y + 0.7, cz * CH + z + 0.5]);
      }

      ch.group = grp;
      this.group.add(grp);
    }

    // build/dispose chunk meshes around player; budget = max meshes per call
    update(px, pz, radius, budget) {
      const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
      let built = 0;
      for (let r = 0; r <= radius && built < budget; r++)
        for (let dz = -r; dz <= r && built < budget; dz++)
          for (let dx = -r; dx <= r && built < budget; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const ch = this.ensureChunk(pcx + dx, pcz + dz);
            if (!ch.group) { this.buildMesh(ch); built++; }
          }
      for (const ch of this.chunks.values()) {
        if (!ch.group) continue;
        if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > radius + 1) {
          this.group.remove(ch.group);
          disposeGroup(ch.group);
          ch.group = null;
          ch.torches = [];
        }
      }
      return built;
    }

    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
      const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
      const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
      let tmx = dx !== 0 ? (dx > 0 ? (x + 1 - ox) : (ox - x)) * tdx : Infinity;
      let tmy = dy !== 0 ? (dy > 0 ? (y + 1 - oy) : (oy - y)) * tdy : Infinity;
      let tmz = dz !== 0 ? (dz > 0 ? (z + 1 - oz) : (oz - z)) * tdz : Infinity;
      let nx = 0, ny = 0, nz = 0, t = 0;
      for (let i = 0; i < 256; i++) {
        const b = this.getBlock(x, y, z);
        if (b !== 0 && b !== 6) return { x, y, z, nx, ny, nz, block: b, dist: t };
        if (tmx < tmy && tmx < tmz) { x += stx; t = tmx; tmx += tdx; nx = -stx; ny = 0; nz = 0; }
        else if (tmy < tmz) { y += sty; t = tmy; tmy += tdy; nx = 0; ny = -sty; nz = 0; }
        else { z += stz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -stz; }
        if (t > maxDist) return null;
      }
      return null;
    }

    surfaceY(x, z) {
      for (let y = H - 1; y > 0; y--) {
        const b = this.getBlock(x, y, z);
        if (b !== 0 && b !== 6) return y;
      }
      return 1;
    }

    findSpawn() {
      for (let r = 0; r < 40; r++)
        for (let a = 0; a < 8; a++) {
          const x = 8 + Math.round(Math.cos((a / 8) * Math.PI * 2) * r * 3);
          const z = 8 + Math.round(Math.sin((a / 8) * Math.PI * 2) * r * 3);
          const h = this.heightAt(x, z);
          if (h > SEA + 1) {
            const y = this.surfaceY(x, z);
            return new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
          }
        }
      return new THREE.Vector3(8.5, this.surfaceY(8, 8) + 1, 8.5);
    }

    getFurnace(key) {
      let st = this.furnaces.get(key);
      if (!st) {
        st = { in: [null], fuel: [null], out: [null], burn: 0, burnMax: 0, prog: 0 };
        this.furnaces.set(key, st);
      }
      return st;
    }
  }

  function disposeGroup(grp) {
    grp.traverse((m) => { if (m.geometry && m.geometry.dispose && !m.geometry._shared) m.geometry.dispose(); });
  }

  MB.SEA = SEA;
  MB.World = World;
})();
