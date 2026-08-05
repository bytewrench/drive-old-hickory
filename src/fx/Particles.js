// ──────────────────────────────────────────────────────────────
// GPU-integrated particle pool. The CPU only writes a particle once
// on spawn; the vertex shader integrates position from (p0, v, g)
// against a global clock, so a full pool costs almost nothing.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec3 aVel;
  attribute vec3 aCol;
  attribute float aBirth;
  attribute float aLife;
  attribute float aSize;
  attribute float aGrav;
  attribute float aDrag;

  uniform float uTime;
  uniform float uPixelScale;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // age decides visibility; t is clamped to the particle's lifetime so
    // nothing downstream can overflow. A dead particle used to keep ageing
    // forever, which made 0.5*aGrav*t*t reach Inf and pow(1.0 - k, 0.75) take
    // the root of a negative number - the resulting NaN alpha poisoned the
    // colour buffer and the bloom pass smeared it across the whole frame.
    float age = uTime - aBirth;
    float alive = step(0.0, age) * step(age, aLife);
    float t = min(age, aLife);
    float k = t / aLife;

    // Exponential velocity decay integrates to this closed form.
    float damp = (aDrag > 0.001) ? (1.0 - exp(-aDrag * t)) / aDrag : t;
    vec3 p = position + aVel * damp + vec3(0.0, 0.5 * aGrav * t * t, 0.0);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // alive leads the product so a dead particle is exactly 0, never 0 * Inf.
    gl_PointSize = alive * aSize * (1.0 - k * 0.45) * uPixelScale / max(-mv.z, 0.5);
    gl_Position = projectionMatrix * mv;

    // Guard the base away from zero: a dead particle has k == 1, and
    // pow(0.0, 0.75) returns NaN on some drivers (log2(0) -> -Inf).
    vAlpha = alive * pow(max(1.0 - k, 1e-4), 0.75);
    vColor = aCol;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;

    // Edges MUST be passed low-to-high: smoothstep is undefined when
    // edge0 >= edge1, and at least one driver returns NaN there. A NaN alpha
    // both renders the sprite as an opaque square and poisons the colour
    // buffer, which the bloom pass then smears over the entire frame.
    float a = (1.0 - smoothstep(uSoft, 0.5, r)) * vAlpha;

    // Written as a negated positive test so a NaN alpha discards too: every
    // comparison against NaN is false, so "a <= 0.003" would let it through
    // and blend NaN into the colour buffer, which bloom then spreads
    // across the entire frame.
    if (!(a > 0.003)) discard;

    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }
`;

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.cursor = 0;
    this.time = 0;
    this.dirty = false;

    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    // Far enough in the past to read as dead; small enough to stay well
    // inside float precision even before the shader clamps it.
    this.birth = new Float32Array(max).fill(-1e4);
    this.life = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aGrav', new THREE.BufferAttribute(this.grav, 1));
    geo.setAttribute('aDrag', new THREE.BufferAttribute(this.drag, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelScale: { value: 620 },
        // Radius at which the sprite starts fading out (0 = fade from the
        // centre, giving glows a soft core; 0.32 = flat core with a soft rim).
        uSoft: { value: additive ? 0.0 : 0.32 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(px, py, pz, vx, vy, vz, r, g, b, size, life, grav, drag = 0.6) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;

    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.birth[i] = this.time;
    this.life[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.dirty = true;
  }

  update(time, pixelScale) {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uPixelScale.value = pixelScale;
    if (!this.dirty) return;
    for (const name of ['position', 'aVel', 'aCol', 'aBirth', 'aLife', 'aSize', 'aGrav', 'aDrag']) {
      this.geo.attributes[name].needsUpdate = true;
    }
    this.dirty = false;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * Named emitters. Everything the game triggers goes through here so the
 * look of e.g. "water spray" is defined in exactly one place.
 */
export class ParticleFX {
  constructor(scene) {
    this.soft = new ParticlePool(scene, 5000, false);   // spray, dust, smoke
    this.glow = new ParticlePool(scene, 4000, true);    // fire, sparks, neon
  }

  update(time, height) {
    const scale = height * 0.9;
    this.soft.update(time, scale);
    this.glow.update(time, scale);
  }

  // ── water ───────────────────────────────────────────────────
  wake(x, y, z, vx, vz, intensity) {
    const n = Math.min(2, 1 + (intensity * 2) | 0);
    for (let i = 0; i < n; i++) {
      this.soft.emit(
        x + rnd(-1.6, 1.6), y + rnd(-0.1, 0.25), z + rnd(-1.6, 1.6),
        -vx * rnd(0.08, 0.2) + rnd(-1.8, 1.8),
        rnd(1.2, 3.6) * intensity,
        -vz * rnd(0.08, 0.2) + rnd(-1.8, 1.8),
        0.92, 0.98, 1.0,
        rnd(0.7, 1.5), rnd(0.4, 0.85), -7, 1.6,
      );
    }
  }

  spray(x, y, z, dirx, dirz, power) {
    const n = Math.min(3, 1 + (power * 3) | 0);
    for (let i = 0; i < n; i++) {
      this.soft.emit(
        x + rnd(-0.7, 0.7), y + rnd(0, 0.4), z + rnd(-0.7, 0.7),
        dirx * rnd(3, 8) * power + rnd(-1.5, 1.5),
        rnd(2.5, 6) * power,
        dirz * rnd(3, 8) * power + rnd(-1.5, 1.5),
        0.86, 0.96, 1.0,
        rnd(0.6, 1.3), rnd(0.3, 0.6), -12, 1.4,
      );
    }
  }

  splash(x, y, z, power) {
    const n = Math.min(34, 8 + (power * 12) | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(1.5, 7) * power;
      this.soft.emit(
        x, y, z,
        Math.cos(a) * sp, rnd(4, 12) * power, Math.sin(a) * sp,
        0.9, 0.97, 1.0,
        rnd(0.8, 1.9), rnd(0.5, 1.0), -16, 1.0,
      );
    }
  }

  // ── land ────────────────────────────────────────────────────
  dust(x, y, z, vx, vz, intensity) {
    const n = Math.min(2, 1 + (intensity * 2) | 0);
    for (let i = 0; i < n; i++) {
      this.soft.emit(
        x + rnd(-1.0, 1.0), y + 0.15, z + rnd(-1.0, 1.0),
        -vx * rnd(0.04, 0.16) + rnd(-1.4, 1.4), rnd(0.8, 2.6), -vz * rnd(0.04, 0.16) + rnd(-1.4, 1.4),
        0.83, 0.74, 0.55,
        rnd(1.1, 2.4), rnd(0.6, 1.2), -2.0, 1.7,
      );
    }
  }

  // ── combat ──────────────────────────────────────────────────
  muzzle(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 22; i++) {
      const s = rnd(6, 34);
      this.glow.emit(
        x, y, z,
        dx * s + rnd(-6, 6), dy * s + rnd(-3, 5), dz * s + rnd(-6, 6),
        1.0, rnd(0.55, 0.95), rnd(0.1, 0.4),
        rnd(1.4, 3.6), rnd(0.14, 0.4), -4, 5.5,
      );
    }
    for (let i = 0; i < 10; i++) {
      this.soft.emit(
        x, y, z,
        dx * rnd(2, 9) + rnd(-3, 3), rnd(1, 5), dz * rnd(2, 9) + rnd(-3, 3),
        0.72, 0.72, 0.74,
        rnd(2.2, 5), rnd(0.5, 1.1), 1.2, 1.6,
      );
    }
  }

  explosion(x, y, z, scale = 1) {
    const nf = (46 * scale) | 0;
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = Math.acos(rnd(-1, 1));
      const sp = rnd(4, 30) * scale;
      this.glow.emit(
        x, y, z,
        Math.sin(p) * Math.cos(a) * sp, Math.cos(p) * sp * 0.8 + rnd(2, 10), Math.sin(p) * Math.sin(a) * sp,
        1.0, rnd(0.35, 0.9), rnd(0.05, 0.3),
        rnd(2.5, 7) * scale, rnd(0.3, 0.85), -6, 3.2,
      );
    }
    const ns = (28 * scale) | 0;
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2;
      this.soft.emit(
        x, y + rnd(0, 2), z,
        Math.cos(a) * rnd(1, 11) * scale, rnd(2, 9), Math.sin(a) * rnd(1, 11) * scale,
        0.28, 0.26, 0.25,
        rnd(4, 11) * scale, rnd(1.1, 2.4), 1.6, 1.0,
      );
    }
  }

  sparks(x, y, z, n = 14, r = 1, g = 0.8, b = 0.3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(3, 16);
      this.glow.emit(
        x, y, z,
        Math.cos(a) * sp, rnd(2, 12), Math.sin(a) * sp,
        r, g, b,
        rnd(0.8, 2.0), rnd(0.25, 0.7), -18, 1.2,
      );
    }
  }

  boostFlame(x, y, z, vx, vy, vz, power) {
    for (let i = 0; i < 4; i++) {
      const heat = Math.random();
      this.glow.emit(
        x + rnd(-0.4, 0.4), y + rnd(-0.3, 0.3), z + rnd(-0.4, 0.4),
        vx + rnd(-3, 3), vy + rnd(0.5, 3.5), vz + rnd(-3, 3),
        1.0, 0.35 + heat * 0.55, heat * 0.35,
        rnd(1.6, 4.2) * power, rnd(0.16, 0.42), 2.0, 4.0,
      );
    }
  }

  confetti(x, y, z, n = 60) {
    const palette = [
      [1.0, 0.36, 0.45], [1.0, 0.82, 0.4], [0.31, 0.8, 0.77],
      [0.70, 0.53, 1.0], [0.55, 0.93, 0.5], [1.0, 1.0, 1.0],
    ];
    for (let i = 0; i < n; i++) {
      const c = palette[(Math.random() * palette.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(2, 16);
      this.soft.emit(
        x, y + rnd(0, 1.5), z,
        Math.cos(a) * sp, rnd(8, 22), Math.sin(a) * sp,
        c[0], c[1], c[2],
        rnd(1.6, 3.6), rnd(1.4, 2.8), -9, 0.7,
      );
    }
  }

  debrisPuff(x, y, z, r, g, b, n = 16) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(2, 12);
      this.soft.emit(
        x, y + rnd(0, 1), z,
        Math.cos(a) * sp, rnd(2, 11), Math.sin(a) * sp,
        r, g, b,
        rnd(1.6, 4.4), rnd(0.5, 1.3), -8, 1.1,
      );
    }
  }
}
