// ──────────────────────────────────────────────────────────────
// Procedural low-poly vessel models. No asset pipeline: every hull
// is boxes, cones and cylinders welded into a THREE.Group.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE4 = new THREE.ConeGeometry(1, 1, 4);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const CYL_LOW = new THREE.CylinderGeometry(1, 1, 1, 8);
const SPH = new THREE.SphereGeometry(1, 10, 8);
const TORUS = new THREE.TorusGeometry(1, 0.22, 6, 14);

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    flatShading: true,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.15,
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
 * @returns {{
 *   group: THREE.Group, wheels: THREE.Object3D[],
 *   turretYaw: THREE.Object3D|null, turretPitch: THREE.Object3D|null,
 *   neon: THREE.Material[], muzzleFlashAnchors: THREE.Object3D[],
 *   dispose: () => void
 * }}
 */
export function buildVessel(cfg) {
  const group = new THREE.Group();
  const neon = [];
  const owned = [];

  const body = std(cfg.color, { roughness: 0.42, metalness: 0.22 });
  const trim = std(cfg.accent, { roughness: 0.35, metalness: 0.3 });
  const dark = std('#22283a', { roughness: 0.7 });
  const glass = std('#8fd8ff', { roughness: 0.08, metalness: 0.6, emissive: '#123', emissiveIntensity: 0.4 });
  const neonMat = std('#111', { emissive: cfg.neon, emissiveIntensity: 0.6, roughness: 0.4 });
  const rubber = std('#1b1d24', { roughness: 0.95, metalness: 0.0 });
  const rim = std(cfg.accent, { roughness: 0.3, metalness: 0.6 });
  owned.push(body, trim, dark, glass, neonMat, rubber, rim);
  neon.push(neonMat);

  const { hx, hy, hz } = cfg.hull;

  // ── shared hull shell ──────────────────────────────────────
  group.add(part(BOX, body, [0, 0, -hz * 0.12], [hx * 2, hy * 2, hz * 1.55]));
  // Bow wedge.
  group.add(part(CONE4, body, [0, 0, hz * 0.78], [hx * 1.42, hz * 0.72, hx * 1.42], [Math.PI / 2, Math.PI / 4, 0]));
  // Waterline stripe (glows at night).
  group.add(part(BOX, neonMat, [hx * 1.01, -hy * 0.25, -hz * 0.12], [0.12, hy * 0.42, hz * 1.5]));
  group.add(part(BOX, neonMat, [-hx * 1.01, -hy * 0.25, -hz * 0.12], [0.12, hy * 0.42, hz * 1.5]));

  const turretYaw = null;
  const result = { group, wheels: [], turretYaw: null, turretPitch: null, neon, muzzleAnchors: [] };
  void turretYaw;

  // ── per-vessel superstructure ──────────────────────────────
  if (cfg.key === 'speedboat') {
    group.add(part(BOX, trim, [0, hy * 1.0, -hz * 0.28], [hx * 1.5, hy * 0.9, hz * 0.7]));
    group.add(part(BOX, glass, [0, hy * 1.5, hz * 0.05], [hx * 1.25, hy * 0.7, hz * 0.28], [-0.32, 0, 0]));
    group.add(part(BOX, trim, [0, hy * 1.7, -hz * 0.85], [0.2, hy * 1.9, 0.6]));      // aerial
    group.add(part(BOX, dark, [0, hy * 0.55, -hz * 0.95], [hx * 1.1, hy * 0.5, hz * 0.28]));
  }

  if (cfg.key === 'barge') {
    // Container stacks.
    const stack = [
      [-hx * 0.5, hy * 1.5, hz * 0.36, '#ff5d73'],
      [hx * 0.52, hy * 1.5, hz * 0.05, '#4ecdc4'],
      [-hx * 0.48, hy * 1.5, -hz * 0.32, '#ffd166'],
      [hx * 0.5, hy * 2.5, -hz * 0.32, '#b388ff'],
    ];
    for (const [x, y, z, c] of stack) {
      const m = std(c, { roughness: 0.7 });
      owned.push(m);
      group.add(part(BOX, m, [x, y, z], [hx * 0.82, hy * 0.95, hz * 0.5]));
    }
    // Wheelhouse.
    group.add(part(BOX, trim, [0, hy * 2.0, -hz * 0.74], [hx * 0.95, hy * 1.5, hz * 0.3]));
    group.add(part(BOX, glass, [0, hy * 2.6, -hz * 0.64], [hx * 0.8, hy * 0.55, 0.2]));
    // Broadside cannons.
    for (const s of [1, -1]) {
      const anchor = new THREE.Object3D();
      anchor.position.set(s * hx * 1.15, hy * 1.3, hz * 0.12);
      group.add(anchor);
      result.muzzleAnchors.push(anchor);
      group.add(part(CYL, dark, [s * hx * 1.0, hy * 1.3, hz * 0.12], [0.34, 2.4, 0.34], [0, 0, Math.PI / 2]));
      group.add(part(CYL, rim, [s * hx * 0.55, hy * 1.3, hz * 0.12], [0.5, 0.5, 0.5], [0, 0, Math.PI / 2]));
    }
  }

  if (cfg.key === 'hover') {
    group.add(part(SPH, trim, [0, hy * 0.9, -hz * 0.1], [hx * 0.85, hy * 1.25, hz * 0.55]));
    group.add(part(SPH, glass, [0, hy * 1.25, hz * 0.35], [hx * 0.55, hy * 0.7, hz * 0.28]));
    // Glowing hover rings under each corner.
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      group.add(part(TORUS, neonMat, [x * hx * 0.82, -hy * 0.9, z * hz * 0.62], [0.78, 0.78, 0.78], [Math.PI / 2, 0, 0]));
    }
    group.add(part(BOX, neonMat, [0, hy * 0.2, -hz * 0.95], [hx * 1.3, 0.22, 0.4]));
  }

  if (cfg.key === 'dreadnought') {
    group.add(part(BOX, trim, [0, hy * 0.95, -hz * 0.5], [hx * 1.35, hy * 0.9, hz * 0.55]));
    group.add(part(BOX, glass, [0, hy * 1.5, -hz * 0.5], [hx * 1.0, hy * 0.5, hz * 0.3]));
    group.add(part(BOX, dark, [0, hy * 0.6, hz * 0.35], [hx * 1.5, hy * 0.4, hz * 0.5]));

    // 360° turret: yaw ring → pitch cradle → barrel.
    const t = cfg.weapon.turret;
    const yawPivot = new THREE.Object3D();
    yawPivot.position.set(0, t.y, hz * 0.18);
    group.add(yawPivot);

    yawPivot.add(part(CYL, dark, [0, -0.22, 0], [1.35, 0.35, 1.35]));
    yawPivot.add(part(BOX, body, [0, 0.25, -0.2], [2.0, 0.95, 2.3]));
    yawPivot.add(part(BOX, neonMat, [0, 0.72, -0.2], [1.4, 0.12, 1.8]));

    const pitchPivot = new THREE.Object3D();
    pitchPivot.position.set(0, 0.3, 0.6);
    yawPivot.add(pitchPivot);
    pitchPivot.add(part(CYL, dark, [0, 0, t.barrelLen * 0.5], [0.3, t.barrelLen, 0.3], [Math.PI / 2, 0, 0]));
    pitchPivot.add(part(CYL, rim, [0, 0, t.barrelLen * 0.95], [0.42, 0.5, 0.42], [Math.PI / 2, 0, 0]));

    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0, t.barrelLen * 1.05);
    pitchPivot.add(anchor);

    result.turretYaw = yawPivot;
    result.turretPitch = pitchPivot;
    result.muzzleAnchors.push(anchor);
  }

  if (cfg.weapon.type === 'forward') {
    group.add(part(CYL, dark, [0, hy * 0.85, hz * 0.75], [0.2, 1.6, 0.2], [Math.PI / 2, 0, 0]));
    const anchor = new THREE.Object3D();
    anchor.position.set(0, hy * 0.85, hz * 0.75 + 0.9);
    group.add(anchor);
    result.muzzleAnchors.push(anchor);
  }

  // ── wheels / hover pads ────────────────────────────────────
  const L = cfg.land;
  for (const [wx, wy, wz] of cfg.wheels) {
    const pivot = new THREE.Object3D();          // steering yaw
    pivot.position.set(wx, wy, wz);
    group.add(pivot);

    const spin = new THREE.Object3D();           // rolling
    pivot.add(spin);

    if (cfg.hover) {
      spin.add(part(TORUS, neonMat, [0, 0, 0], [L.radius * 1.1, L.radius * 1.1, L.radius * 1.1], [Math.PI / 2, 0, 0]));
      spin.add(part(CYL_LOW, dark, [0, 0, 0], [L.radius * 0.8, 0.25, L.radius * 0.8]));
    } else {
      spin.add(part(CYL, rubber, [0, 0, 0], [L.radius, L.radius * 0.9, L.radius], [0, 0, Math.PI / 2]));
      spin.add(part(CYL, rim, [0, 0, 0], [L.radius * 0.55, L.radius * 0.95, L.radius * 0.55], [0, 0, Math.PI / 2]));
      spin.add(part(BOX, rim, [0, 0, 0], [L.radius * 0.95, L.radius * 0.18, L.radius * 0.18]));
      spin.add(part(BOX, rim, [0, 0, 0], [L.radius * 0.18, L.radius * 0.18, L.radius * 0.95]));
    }

    pivot.scale.setScalar(0.001);                // hidden until deployed
    result.wheels.push({ pivot, spin, base: new THREE.Vector3(wx, wy, wz) });
  }

  result.dispose = () => {
    group.traverse((o) => { if (o.isMesh) o.geometry === undefined; });
    for (const m of owned) m.dispose();
  };

  return result;
}
