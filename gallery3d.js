/* ============================================================
   Infinite 3D photo gallery — raw WebGL, no dependencies.

   Ported from a react-three-fiber component to plain WebGL so the
   static site keeps its no-build-step setup (and because the CSP
   blocks CDN scripts). Keeps the original behaviour: an infinite
   z-tunnel of photo planes, wheel / arrow / touch navigation with
   momentum, auto-play after idle, depth-based fade + blur, and a
   scroll-force cloth curve in the vertex shader.

   Textures load lazily — only planes about to become visible fetch
   their image, so the page starts with a handful, not all 80.
   ============================================================ */
(function (global) {
  'use strict';

  var VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUv;',
    'uniform mat4 uProj;',
    'uniform vec3 uOffset;',   // plane position (x, y, z)
    'uniform vec2 uScale;',    // plane size
    'uniform float uForce;',   // scroll force -> cloth curve
    'uniform float uTime;',
    'uniform float uHover;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = aUv;',
    '  vec3 p = aPos;',
    '  p.xy *= uScale;',
    // cloth curve: edges bow away proportional to scroll force
    '  float curveIntensity = uForce * 0.06;',
    '  float d = length(aPos.xy);',
    '  float curve = d * d * curveIntensity;',
    '  float ripple = sin(aPos.x * 6.2 + uForce * 3.0) * 0.02',
    '              + sin(aPos.y * 7.5 + uForce * 2.0) * 0.015;',
    '  float cloth = ripple * abs(curveIntensity) * 6.0;',
    // hover: flag wave, damped from the left edge
    '  float wave = 0.0;',
    '  if (uHover > 0.5){',
    '    float damp = smoothstep(-0.5, 0.5, aPos.x);',
    '    wave = sin(aPos.x * 9.0 + uTime * 8.0) * 0.10 * damp',
    '         + sin(aPos.x * 15.0 + uTime * 12.0) * 0.03 * damp;',
    '  }',
    '  p.z -= (curve + cloth + wave);',
    '  gl_Position = uProj * vec4(p + uOffset, 1.0);',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'uniform sampler2D uTex;',
    'uniform float uOpacity;',
    'uniform float uBlur;',
    'uniform vec2 uTexel;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 c;',
    '  if (uBlur > 0.01){',
    // 5x5 weighted tap — matches the original's blur approximation
    '    vec4 sum = vec4(0.0); float total = 0.0;',
    '    for (int x = -2; x <= 2; x++){',
    '      for (int y = -2; y <= 2; y++){',
    '        vec2 o = vec2(float(x), float(y)) * uTexel * uBlur;',
    '        float w = 1.0 / (1.0 + length(vec2(float(x), float(y))));',
    '        sum += texture2D(uTex, vUv + o) * w; total += w;',
    '      }',
    '    }',
    '    c = sum / total;',
    '  } else {',
    '    c = texture2D(uTex, vUv);',
    '  }',
    '  if (uOpacity <= 0.001) discard;',
    '  gl_FragColor = vec4(c.rgb, c.a * uOpacity);',
    '}'
  ].join('\n');

  var DEPTH = 50;          // total z range planes cycle through
  var MAX_X = 5.5, MAX_Y = 5.0;

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function InfiniteGallery(opts) {
    var canvas = opts.canvas;
    var images = opts.images || [];
    var speed = opts.speed == null ? 1.2 : opts.speed;
    var visibleCount = Math.min(opts.visibleCount || 12, images.length || 1);
    var fade = opts.fade || { inStart: .05, inEnd: .25, outStart: .40, outEnd: .46 };
    var blurCfg = opts.blur || { inStart: 0, inEnd: .10, outStart: .40, outEnd: .46, max: 6 };
    var onFail = opts.onFail || function () {};

    if (!images.length) { onFail(); return null; }

    var gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
        || canvas.getContext('experimental-webgl');
    } catch (e) {}
    if (!gl) { onFail(); return null; }

    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { onFail(); return null; }
    gl.useProgram(prog);

    // unit quad, subdivided so the vertex-shader curve has geometry to bend
    var SEG = 16, pos = [], uv = [], idx = [];
    for (var y = 0; y <= SEG; y++) {
      for (var x = 0; x <= SEG; x++) {
        pos.push(x / SEG - .5, y / SEG - .5, 0);
        uv.push(x / SEG, 1 - y / SEG);
      }
    }
    for (var yy = 0; yy < SEG; yy++) {
      for (var xx = 0; xx < SEG; xx++) {
        var a = yy * (SEG + 1) + xx, b = a + 1, c = a + SEG + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    function buf(target, data, Type) {
      var b = gl.createBuffer(); gl.bindBuffer(target, b);
      gl.bufferData(target, new Type(data), gl.STATIC_DRAW); return b;
    }
    var posBuf = buf(gl.ARRAY_BUFFER, pos, Float32Array);
    var uvBuf = buf(gl.ARRAY_BUFFER, uv, Float32Array);
    var idxBuf = buf(gl.ELEMENT_ARRAY_BUFFER, idx, Uint16Array);
    var idxCount = idx.length;

    var aPos = gl.getAttribLocation(prog, 'aPos'), aUv = gl.getAttribLocation(prog, 'aUv');
    var U = {};
    ['uProj', 'uOffset', 'uScale', 'uForce', 'uTime', 'uHover', 'uTex', 'uOpacity', 'uBlur', 'uTexel']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);   // painter's order, back to front
    gl.uniform1i(U.uTex, 0);

    // ---- lazy texture cache -------------------------------------------
    var texCache = {}, pending = {};
    function getTexture(i) {
      if (texCache[i]) return texCache[i];
      if (pending[i]) return null;
      pending[i] = true;
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        // thumbs are non-power-of-two: CLAMP_TO_EDGE + LINEAR is the only
        // legal combination in WebGL1 (REPEAT/mipmaps would render black)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); }
        catch (e) { pending[i] = false; return; }
        texCache[i] = { tex: t, w: img.naturalWidth, h: img.naturalHeight };
        pending[i] = false;
      };
      img.onerror = function () { pending[i] = false; };
      img.src = typeof images[i] === 'string' ? images[i] : images[i].src;
      return null;
    }

    // ---- plane ring ----------------------------------------------------
    var planes = [];
    for (var i = 0; i < visibleCount; i++) {
      var ha = (i * 2.618) % (Math.PI * 2), va = (i * 1.618 + Math.PI / 3) % (Math.PI * 2);
      planes.push({
        z: (DEPTH / visibleCount) * i,
        imageIndex: i % images.length,
        x: Math.sin(ha) * ((i % 3) * 1.2) * MAX_X / 3,
        y: Math.cos(va) * (((i + 1) % 4) * 0.8) * MAX_Y / 4,
        hover: 0
      });
    }
    // warm the first screenful
    planes.forEach(function (p) { getTexture(p.imageIndex); });

    // ---- input ---------------------------------------------------------
    var velocity = 0, autoPlay = true, lastInteract = Date.now(), hoverIdx = -1;
    function nudge(v) { velocity += v; autoPlay = false; lastInteract = Date.now(); }

    function onWheel(e) { e.preventDefault(); nudge(e.deltaY * 0.01 * speed); }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function onKey(e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nudge(-2 * speed);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nudge(2 * speed);
    }
    document.addEventListener('keydown', onKey);

    var touchY = null;
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) touchY = e.touches[0].clientY;
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (touchY === null) return;
      var y = e.touches[0].clientY;
      nudge((touchY - y) * 0.035 * speed);
      touchY = y;
    }, { passive: true });
    canvas.addEventListener('touchend', function () { touchY = null; }, { passive: true });

    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect();
      var nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      var ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
      hoverIdx = pickPlane(nx, ny);
    });
    canvas.addEventListener('pointerleave', function () { hoverIdx = -1; });

    var W = 1, H = 1, aspect = 1, proj;
    function resize() {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      if (!W || !H) return;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      aspect = W / H;
      proj = perspective(55 * Math.PI / 180, aspect, 0.1, 200);
      gl.uniformMatrix4fv(U.uProj, false, proj);
    }

    // rough screen-space pick against each plane's projected box
    function pickPlane(nx, ny) {
      var best = -1, bestZ = -Infinity;
      for (var i = 0; i < planes.length; i++) {
        var p = planes[i], wz = p.z - DEPTH / 2;
        if (wz > -0.5) continue;                    // behind / at camera
        var s = sizeFor(p); if (!s) continue;
        var f = 1 / Math.tan((55 * Math.PI / 180) / 2);
        var sx = (p.x / -wz) * f / aspect, sy = (p.y / -wz) * f;
        var hw = (s[0] / 2 / -wz) * f / aspect, hh = (s[1] / 2 / -wz) * f;
        if (nx >= sx - hw && nx <= sx + hw && ny >= sy - hh && ny <= sy + hh) {
          if (wz > bestZ) { bestZ = wz; best = i; }
        }
      }
      return best;
    }

    function sizeFor(p) {
      var t = texCache[p.imageIndex];
      if (!t) return null;
      var a = t.w / t.h;
      return a > 1 ? [2 * a, 2] : [2, 2 / a];
    }

    function ramp(v, a, b) { return (v - a) / (b - a); }

    var raf = null, running = false, last = 0, visible = true;

    function frame(now) {
      if (!last) last = now;
      var dt = Math.min((now - last) / 1000, 0.05); last = now;

      if (Date.now() - lastInteract > 3000) autoPlay = true;
      if (autoPlay) velocity += 0.3 * dt;
      velocity *= Math.pow(0.95, dt * 60);          // frame-rate independent damping

      var t = now / 1000;
      gl.clear(gl.COLOR_BUFFER_BIT);

      // advance + collect drawable planes
      var draw = [];
      for (var i = 0; i < planes.length; i++) {
        var p = planes[i];
        var nz = p.z + velocity * dt * 10;
        if (nz >= DEPTH) {
          var fwd = Math.floor(nz / DEPTH); nz -= DEPTH * fwd;
          p.imageIndex = (p.imageIndex + fwd * visibleCount) % images.length;
        } else if (nz < 0) {
          var back = Math.ceil(-nz / DEPTH); nz += DEPTH * back;
          p.imageIndex = ((p.imageIndex - back * visibleCount) % images.length + images.length) % images.length;
        }
        p.z = ((nz % DEPTH) + DEPTH) % DEPTH;

        var n = p.z / DEPTH, op;
        if (n < fade.inStart) op = 0;
        else if (n <= fade.inEnd) op = ramp(n, fade.inStart, fade.inEnd);
        else if (n < fade.outStart) op = 1;
        else if (n <= fade.outEnd) op = 1 - ramp(n, fade.outStart, fade.outEnd);
        else op = 0;
        op = Math.max(0, Math.min(1, op));

        var bl;
        if (n < blurCfg.inStart) bl = blurCfg.max;
        else if (n <= blurCfg.inEnd) bl = blurCfg.max * (1 - ramp(n, blurCfg.inStart, blurCfg.inEnd));
        else if (n < blurCfg.outStart) bl = 0;
        else if (n <= blurCfg.outEnd) bl = blurCfg.max * ramp(n, blurCfg.outStart, blurCfg.outEnd);
        else bl = blurCfg.max;
        bl = Math.max(0, Math.min(blurCfg.max, bl));

        if (op <= 0.002) continue;
        // fetch the texture a little before the plane fades in
        var tex = texCache[p.imageIndex] || getTexture(p.imageIndex);
        if (!tex) continue;
        draw.push({ p: p, i: i, op: op, bl: bl, wz: p.z - DEPTH / 2, tex: tex });
      }

      // back to front so alpha blends correctly without depth testing
      draw.sort(function (a, b) { return a.wz - b.wz; });

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

      gl.uniform1f(U.uForce, velocity);
      gl.uniform1f(U.uTime, t);

      for (var k = 0; k < draw.length; k++) {
        var d = draw[k], s = sizeFor(d.p);
        if (!s) continue;
        var target = (d.i === hoverIdx) ? 1 : 0;
        d.p.hover += (target - d.p.hover) * Math.min(1, dt * 10);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, d.tex.tex);
        gl.uniform3f(U.uOffset, d.p.x, d.p.y, d.wz);
        gl.uniform2f(U.uScale, s[0], s[1]);
        gl.uniform1f(U.uOpacity, d.op);
        gl.uniform1f(U.uBlur, d.bl);
        gl.uniform1f(U.uHover, d.p.hover);
        gl.uniform2f(U.uTexel, 1 / d.tex.w, 1 / d.tex.h);
        gl.drawElements(gl.TRIANGLES, idxCount, gl.UNSIGNED_SHORT, 0);
      }

      if (running) raf = requestAnimationFrame(frame);
    }

    function play() { if (running || !visible) return; running = true; last = 0; raf = requestAnimationFrame(frame); }
    function pause() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

    resize();
    var rt;
    global.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 150); });
    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden; if (visible) play(); else pause();
    });
    play();

    return {
      destroy: function () {
        pause();
        canvas.removeEventListener('wheel', onWheel);
        document.removeEventListener('keydown', onKey);
      }
    };
  }

  global.InfiniteGallery = InfiniteGallery;
})(window);
