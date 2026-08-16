// ──────────────────────────────────────────────────────────────
// Vessel visuals. The *look* now comes from the declarative vessel
// catalog (src/vehicles/vesselCatalog.js), built into flat-shaded
// primitives by buildVessel.js. This module wraps that model and
// hands the physics controller the exact rig API it expects:
//
//   { group, wheels[{pivot,spin,base}], turretYaw, turretPitch,
//     neon[], muzzleAnchors[], update(dt,opts), dispose() }
//
// The catalog philosophy is NO WHEELS — on land the hull just slides,
// skims or crawls. So the wheel "views" here are invisible pivots: the
// controller keeps driving its raycast suspension physics (grip, drive,
// dust), but nothing visible sprouts under the hull. The turret and the
// weapon muzzle anchors are still built here because the catalog models
// don't carry them and the weapon system depends on them.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { LAYER_HULL } from '../config.js';
import { getVessel } from './vesselCatalog.js';
import { buildVessel as buildCatalog, updateVessel as updateCatalog } from './buildVessel.js';
import { attachExternalModel } from './modelLoader.js';

const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    flatShading: true,
    roughness: opts.roughness ?? 0.5,
    metalness: opts.metalness ?? 0.2,
    emissive: new THREE.Color(opts.emissive ?? '#000000'),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

function part(geo, material, pos, scale, rot) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * One road wheel: tyre, rim, spokes and the suspension arm that carries it.
 *
 * The wheel spins via `spin.rotation.x`, so every piece is built with its axle
 * along X. The arm goes in the non-spinning pivot — a strut that rotated with
 * the wheel would look absurd.
 */
function buildRoadWheel(THREE, spec, cfg, pivot, spin, owned, side) {
  const r = spec.radius ?? cfg.land?.radius ?? 0.85;
  const w = spec.width ?? r * 0.44;

  const tyre = mat(spec.tyre ?? '#15181f', { roughness: 0.95, metalness: 0 });
  const rim = mat(spec.rim ?? cfg.accent, { roughness: 0.32, metalness: 0.85 });
  const armM = mat(spec.arm ?? '#2a2f3c', { roughness: 0.5, metalness: 0.6 });
  owned.push(tyre, rim, armM);

  // Torus lies in XY with its axis on Z; a quarter turn about Y stands it up
  // as a wheel. Outer radius = ring + tube, so solve back from `r`.
  const t = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.28, 12, 24), tyre);
  t.rotation.y = Math.PI / 2;
  t.castShadow = true; t.receiveShadow = true;
  spin.add(t);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.46, r * 0.46, w, 14), rim);
  hub.rotation.z = Math.PI / 2;
  hub.castShadow = true;
  spin.add(hub);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const sp = new THREE.Mesh(BOX, rim);
    sp.scale.set(w * 0.55, r * 0.86, r * 0.16);
    sp.position.set(0, 0, 0);
    sp.rotation.x = a;
    sp.castShadow = true;
    spin.add(sp);
  }

  // Trailing arm reaching back up into the hull, so the wheel reads as
  // suspended rather than floating alongside the boat.
  const arm = new THREE.Mesh(BOX, armM);
  arm.scale.set(w * 0.5, r * 0.30, r * 1.5);
  arm.position.set(-side * w * 0.75, r * 0.55, -r * 0.35);
  arm.rotation.x = -0.5;
  arm.castShadow = true;
  pivot.add(arm);
}

export function buildVessel(cfg) {
  const group = new THREE.Group();
  const owned = [];
  const neon = [];

  // ── 1 · catalog visual model ───────────────────────────────
  const vessel = getVessel(cfg.catalog) || getVessel('runabout');
  const rig = buildCatalog(THREE, vessel);
  // Neutralise the land-mode deploy pose on the water (see buildVessel.js:
  // deployT ramps to 1, and on water t = 1 - deployT, so start it settled).
  rig.state.deployT = 1;
  rig.state.onLand = false;

  // Uniform-scale the model so its length fills the physics hull, then seat it.
  // A wrapper holds the scale/seat so the catalog's per-frame land animation
  // (which writes rig.group.position.y) never fights our seating offset.
  const wrap = new THREE.Group();
  const halfD = (vessel.collider?.size?.[2] ?? cfg.hull.hz * 2) / 2;
  wrap.scale.setScalar(cfg.hull.hz / Math.max(halfD, 0.1));
  wrap.position.y = cfg.modelY ?? 0;
  wrap.add(rig.group);
  group.add(wrap);

  // Night glow: the accent / trim panels light up. MeshLambert supports
  // emissive; setNight() ramps intensity, so give them a colour to emit.
  rig.materials.forEach((m, key) => {
    if (key.startsWith('accent') || key.startsWith('trim')) {
      m.emissive = new THREE.Color(cfg.neon || vessel.palette.accent);
      m.emissiveIntensity = 0.35;
      neon.push(m);
    }
  });

  const result = {
    group, wrap, rig,
    eye: rig.eye,
    wheels: [], turretYaw: null, turretPitch: null,
    neon, muzzleAnchors: [],
  };

  // An author-supplied glTF replaces the procedural hull when the catalog entry
  // names one. Loading is async, so the procedural model stays up until the file
  // arrives and is then swapped out — the game never blocks on the network.
  if (vessel.model?.url) {
    attachExternalModel(THREE, wrap, vessel, result);
  }

  /**
   * Mark this as the player's own boat. Hull meshes move to LAYER_HULL, which
   * first-person masks off the main camera. They stay on the shadow camera's
   * layer mask, so the boat keeps casting a shadow you can see from the helm.
   */
  result.setLocal = (isLocal) => {
    result.isLocal = isLocal;
    wrap.traverse((o) => { if (o.isMesh) o.layers.set(isLocal ? LAYER_HULL : 0); });
  };

  // ── 2 · weapon nodes the controller / weapon system need ────
  const { hx, hy, hz } = cfg.hull;
  const dark = mat('#20242f', { roughness: 0.7 }); owned.push(dark);
  const rim = mat(cfg.accent, { roughness: 0.3, metalness: 0.6 }); owned.push(rim);
  const bodyM = mat(cfg.color, { roughness: 0.45, metalness: 0.2 }); owned.push(bodyM);
  const neonMat = mat('#111', { emissive: cfg.neon, emissiveIntensity: 0.6 });
  owned.push(neonMat); neon.push(neonMat);

  if (cfg.weapon.type === 'turret') {
    // 360° turret: yaw ring → pitch cradle → barrel → muzzle anchor.
    const t = cfg.weapon.turret;
    const yawPivot = new THREE.Object3D();
    yawPivot.position.set(0, t.y, hz * 0.12);
    group.add(yawPivot);
    yawPivot.add(part(CYL, dark, [0, -0.18, 0], [1.2, 0.32, 1.2]));
    yawPivot.add(part(BOX, bodyM, [0, 0.22, -0.15], [1.7, 0.85, 2.0]));
    yawPivot.add(part(BOX, neonMat, [0, 0.64, -0.15], [1.2, 0.1, 1.5]));

    const pitchPivot = new THREE.Object3D();
    pitchPivot.position.set(0, 0.26, 0.5);
    yawPivot.add(pitchPivot);
    pitchPivot.add(part(CYL, dark, [0, 0, t.barrelLen * 0.5], [0.26, t.barrelLen, 0.26], [Math.PI / 2, 0, 0]));
    pitchPivot.add(part(CYL, rim, [0, 0, t.barrelLen * 0.95], [0.36, 0.44, 0.36], [Math.PI / 2, 0, 0]));

    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0, t.barrelLen * 1.05);
    pitchPivot.add(anchor);

    result.turretYaw = yawPivot;
    result.turretPitch = pitchPivot;
    result.muzzleAnchors.push(anchor);
  } else if (cfg.weapon.type === 'broadside') {
    for (const sgn of [1, -1]) {
      const anchor = new THREE.Object3D();
      anchor.position.set(sgn * hx * 1.05, hy * 1.2, hz * 0.1);
      group.add(anchor);
      result.muzzleAnchors.push(anchor);
      group.add(part(CYL, dark, [sgn * hx * 0.95, hy * 1.2, hz * 0.1], [0.3, 2.0, 0.3], [0, 0, Math.PI / 2]));
      group.add(part(CYL, rim, [sgn * hx * 0.5, hy * 1.2, hz * 0.1], [0.42, 0.5, 0.42], [0, 0, Math.PI / 2]));
    }
  } else {
    // forward-firing bow gun
    group.add(part(CYL, dark, [0, hy * 0.75, hz * 0.85], [0.18, 1.3, 0.18], [Math.PI / 2, 0, 0]));
    const anchor = new THREE.Object3D();
    anchor.position.set(0, hy * 0.75, hz * 1.05);
    group.add(anchor);
    result.muzzleAnchors.push(anchor);
  }

  // ── 3 · road wheels ────────────────────────────────────────
  // Hulls that opt in via cfg.landWheels grow real running gear when they
  // beach. Nothing extra has to be animated: Vessel.updateVisual already
  // drives pivot.scale from `this.deploy` (so the wheels unfold over the
  // deploy window), pivot.position.y from suspension travel, pivot.rotation.y
  // from steering and spin.rotation.x from wheel speed. Hulls without the
  // field keep bare pivots and their boat-idiom land gimmick instead.
  const spec = cfg.landWheels;
  for (const [wx, wy, wz] of cfg.wheels) {
    const pivot = new THREE.Object3D();
    pivot.position.set(wx, wy, wz);
    pivot.scale.setScalar(0.001);
    group.add(pivot);
    const spin = new THREE.Object3D();
    pivot.add(spin);
    if (spec) buildRoadWheel(THREE, spec, cfg, pivot, spin, owned, Math.sign(wx) || 1);
    result.wheels.push({ pivot, spin, base: new THREE.Vector3(wx, wy, wz) });
  }

  // ── 4 · cosmetic per-frame hook ────────────────────────────
  // Spins props / fans and plays the land-mode deploy + gait animation.
  result.update = (dt, opts) => updateCatalog(rig, dt, opts);

  result.dispose = () => {
    rig.dispose();
    for (const m of owned) m.dispose();
  };

  return result;
}
