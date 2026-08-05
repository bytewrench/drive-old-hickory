// ──────────────────────────────────────────────────────────────
// Low-poly terrain: one indexed mesh with vertex colours rendered
// flat-shaded, plus a matching Rapier heightfield collider.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { MAP_SIZE, TERRAIN_SEG, WATER_LEVEL } from '../config.js';
import { sampleHeight, sampleNormal, fbm } from './heightfield.js';
import { RAPIER } from '../core/Physics.js';

const COL = {
  bed: new THREE.Color('#3f5d4a'),
  sand: new THREE.Color('#e6d3a3'),
  grass: new THREE.Color('#7cc45f'),
  grassDark: new THREE.Color('#4f9b4a'),
  scrub: new THREE.Color('#a8b06a'),
  rock: new THREE.Color('#9c948a'),
  snowish: new THREE.Color('#cfd8c8'),
};

export class Terrain {
  constructor(physics, scene) {
    this.physics = physics;
    const N = TERRAIN_SEG;
    const step = MAP_SIZE / N;
    const count = (N + 1) * (N + 1);

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);

    const c = new THREE.Color();
    const nrm = { x: 0, y: 1, z: 0 };

    for (let iz = 0; iz <= N; iz++) {
      const z = -MAP_SIZE / 2 + iz * step;
      for (let ix = 0; ix <= N; ix++) {
        const x = -MAP_SIZE / 2 + ix * step;
        const h = sampleHeight(x, z);
        const idx = iz * (N + 1) + ix;

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = z;

        sampleNormal(x, z, nrm);
        normals[idx * 3] = nrm.x;
        normals[idx * 3 + 1] = nrm.y;
        normals[idx * 3 + 2] = nrm.z;

        this._colorFor(h, 1 - nrm.y, x, z, c);
        colors[idx * 3] = c.r;
        colors[idx * 3 + 1] = c.g;
        colors[idx * 3 + 2] = c.b;
      }
    }

    const indices = new Uint32Array(N * N * 6);
    let k = 0;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iz * (N + 1) + ix;
        const b = a + 1;
        const d = a + (N + 1);
        const e = d + 1;
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
        indices[k++] = b; indices[k++] = d; indices[k++] = e;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.97,
      metalness: 0.0,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);

    this._buildCollider();
    this._buildWalls();
  }

  /**
   * Middle Tennessee palette. The DEM only spans ~0–93 m above pool here, and
   * it is wooded farmland the whole way up — so no alpine banding: grass and
   * scrub throughout, with limestone showing through on the steep bluffs.
   */
  _colorFor(h, slope, x, z, out) {
    const grain = fbm(x * 0.06, z * 0.06, 2);
    if (h < WATER_LEVEL - 0.4) {
      out.copy(COL.bed).lerp(COL.sand, THREE.MathUtils.clamp((h + 8) / 8, 0, 1) * 0.45);
    } else if (h < 1.8) {
      out.copy(COL.sand).lerp(COL.grass, THREE.MathUtils.smoothstep(h, 0.4, 2.0));
    } else {
      out.copy(COL.grass).lerp(COL.grassDark, grain);
      // Drier scrub on the ridge tops.
      out.lerp(COL.scrub, THREE.MathUtils.smoothstep(h, 34, 88) * 0.55);
    }
    // Exposed limestone on steep faces — the real bluffs along this reach.
    out.lerp(COL.rock, THREE.MathUtils.smoothstep(slope, 0.22, 0.55) * 0.9);
    // Subtle per-vertex variation so big flat areas don't read as plastic.
    out.multiplyScalar(0.92 + grain * 0.16);
  }

  /**
   * Rapier stores the height matrix column-major with rows on Z and columns
   * on X. We build it that way, then verify with a handful of downward rays
   * and transpose if this build of rapier disagrees — a silent mismatch here
   * would put the collision surface somewhere the player can't see.
   */
  _buildCollider() {
    const N = TERRAIN_SEG;
    const world = this.physics.world;
    const nrows = N, ncols = N;

    const build = (transposed) => {
      const heights = new Float32Array((nrows + 1) * (ncols + 1));
      for (let i = 0; i <= nrows; i++) {
        const z = (i / nrows - 0.5) * MAP_SIZE;
        for (let j = 0; j <= ncols; j++) {
          const x = (j / ncols - 0.5) * MAP_SIZE;
          const h = sampleHeight(x, z);
          heights[transposed ? j + i * (ncols + 1) : i + j * (nrows + 1)] = h;
        }
      }
      const bodyDesc = RAPIER.RigidBodyDesc.fixed();
      const body = world.createRigidBody(bodyDesc);
      const desc = RAPIER.ColliderDesc
        .heightfield(nrows, ncols, heights, { x: MAP_SIZE, y: 1, z: MAP_SIZE })
        .setFriction(1.0)
        .setRestitution(0.06);
      const collider = world.createCollider(desc, body);
      return { body, collider };
    };

    let attempt = build(false);
    let err = this._colliderError();

    if (err > 6) {
      console.warn(`[terrain] heightfield layout looks wrong (err ${err.toFixed(1)}m) — trying transpose`);
      world.removeRigidBody(attempt.body);
      attempt = build(true);
      const err2 = this._colliderError();
      if (err2 < err) {
        err = err2;
      } else {
        // Transpose was no better — keep the documented layout.
        world.removeRigidBody(attempt.body);
        attempt = build(false);
        this._colliderError();
      }
    }

    this.body = attempt.body;
    this.collider = attempt.collider;
    this.physics.register(this.collider, { kind: 'terrain' });
    this.colliderError = err;
    console.info(`[terrain] heightfield ready · max ray error ${err.toFixed(2)}m`);
  }

  /** Max |rayHitY − sampleHeight| over a fixed probe set. */
  _colliderError() {
    // Scene queries only see colliders that have been through a step, so
    // advance the (otherwise empty) world once before probing.
    this.physics.world.step();

    const probes = [
      [0, 0], [120, 60], [-160, 140], [80, -220], [-240, -90],
      [300, 300], [-320, 250], [30, 380], [-380, -330], [200, -60],
    ];
    let worst = 0;
    for (const [x, z] of probes) {
      const expected = sampleHeight(x, z);
      const from = { x, y: expected + 260, z };
      const d = this.physics.castDown(from, { x: 0, y: -1, z: 0 }, 600);
      if (d < 0) { worst = Math.max(worst, 999); continue; }
      worst = Math.max(worst, Math.abs((from.y - d) - expected));
    }
    return worst;
  }

  /** Invisible boxes on the map border, belt-and-braces with the rim hills. */
  _buildWalls() {
    const world = this.physics.world;
    const h = 220, t = 12, s = MAP_SIZE / 2 + t;
    const specs = [
      [0, h / 2, s, MAP_SIZE / 2 + t, h / 2, t],
      [0, h / 2, -s, MAP_SIZE / 2 + t, h / 2, t],
      [s, h / 2, 0, t, h / 2, MAP_SIZE / 2 + t],
      [-s, h / 2, 0, t, h / 2, MAP_SIZE / 2 + t],
    ];
    for (const [x, y, z, hx, hy, hz] of specs) {
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.4), b);
    }
  }
}
