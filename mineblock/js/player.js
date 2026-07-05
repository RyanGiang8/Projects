// First-person player: input, physics, collision.
(function () {
  const MB = window.MB;
  const EPS = 0.001, HALF = 0.3, HEIGHT = 1.8, EYE = 1.62;

  class Player {
    constructor(world) {
      this.world = world;
      this.pos = new THREE.Vector3(8.5, 40, 8.5);
      this.vel = new THREE.Vector3();
      this.yaw = 0;
      this.pitch = 0;
      this.onGround = false;
      this.inWater = false;
      this.hitWall = false;
      this.peakY = 0;
      this.hp = 20;
      this.spawn = new THREE.Vector3(8.5, 40, 8.5);
      this.keys = {};

      window.addEventListener("keydown", (e) => {
        this.keys[e.code] = true;
        if (["Space", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code) &&
            document.pointerLockElement) e.preventDefault();
      });
      window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });
      window.addEventListener("blur", () => { this.keys = {}; });
    }

    eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }

    lookDir() {
      const cp = Math.cos(this.pitch);
      return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    }

    solid(x, y, z) {
      return MB.SOLID[this.world.getBlock(x, y, z)] === 1;
    }

    collideAxis(axis) {
      const p = this.pos;
      const x0 = Math.floor(p.x - HALF), x1 = Math.floor(p.x + HALF);
      const y0 = Math.floor(p.y), y1 = Math.floor(p.y + HEIGHT);
      const z0 = Math.floor(p.z - HALF), z1 = Math.floor(p.z + HALF);
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            if (!this.solid(x, y, z)) continue;
            if (axis === 0) {
              if (this.vel.x > 0) p.x = x - HALF - EPS;
              else p.x = x + 1 + HALF + EPS;
              this.vel.x = 0; this.hitWall = true;
            } else if (axis === 2) {
              if (this.vel.z > 0) p.z = z - HALF - EPS;
              else p.z = z + 1 + HALF + EPS;
              this.vel.z = 0; this.hitWall = true;
            } else {
              if (this.vel.y > 0) { p.y = y - HEIGHT - EPS; }
              else { p.y = y + 1; this.onGround = true; }
              this.vel.y = 0;
            }
            return;
          }
    }

    update(dt, inputEnabled) {
      const k = inputEnabled ? this.keys : {};
      const p = this.pos, w = this.world;

      const fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
      const str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
      const sprint = k.ControlLeft || k.ControlRight;
      const sneak = k.ShiftLeft || k.ShiftRight;
      let speed = sneak ? 1.6 : sprint ? 5.9 : 4.35;

      let mx = 0, mz = 0;
      if (fwd || str) {
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        mx = (-s * fwd + c * str);
        mz = (-c * fwd - s * str);
        const l = Math.hypot(mx, mz);
        mx = (mx / l) * speed; mz = (mz / l) * speed;
      }
      this.vel.x = mx; this.vel.z = mz;

      const feetB = w.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
      const eyeB = w.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z));
      const wasInWater = this.inWater;
      this.inWater = feetB === 6 || eyeB === 6;

      if (this.inWater) {
        this.vel.y -= 9 * dt;
        if (this.vel.y < -3.2) this.vel.y = -3.2;
        if (k.Space) this.vel.y = this.hitWall ? 7.5 : 3.4;
        this.vel.x *= 0.7; this.vel.z *= 0.7;
        this.peakY = p.y;
      } else {
        this.vel.y -= 26 * dt;
        if (this.vel.y < -52) this.vel.y = -52;
        if (k.Space && this.onGround) this.vel.y = 8.0;
      }
      this.hitWall = false;

      p.x += this.vel.x * dt; this.collideAxis(0);
      p.z += this.vel.z * dt; this.collideAxis(2);

      const wasGround = this.onGround;
      this.onGround = false;
      p.y += this.vel.y * dt; this.collideAxis(1);

      if (!this.onGround) {
        if (p.y > this.peakY || wasGround) this.peakY = Math.max(this.peakY, p.y);
      } else {
        const fall = this.peakY - p.y;
        this.peakY = p.y;
        if (fall > 3.5 && !wasInWater && !this.inWater) {
          const dmg = Math.floor(fall - 3);
          if (dmg > 0) this.damage(dmg);
        }
      }

      if (p.y < -20) this.respawn(true);
    }

    damage(n) {
      this.hp -= n;
      if (MB.onDamage) MB.onDamage();
      if (this.hp <= 0) this.respawn(true);
      if (MB.renderHearts) MB.renderHearts();
    }

    respawn(died) {
      this.pos.copy(this.spawn);
      this.vel.set(0, 0, 0);
      this.peakY = this.pos.y;
      if (died) {
        this.hp = 20;
        if (MB.toast) MB.toast("You died! Respawning...");
      }
      if (MB.renderHearts) MB.renderHearts();
    }

    applyCamera(camera) {
      camera.rotation.order = "YXZ";
      camera.rotation.set(this.pitch, this.yaw, 0);
      const e = this.eyePos();
      camera.position.copy(e);
    }
  }

  MB.Player = Player;
})();
