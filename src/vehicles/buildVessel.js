/**
 * buildVessel.js
 * ---------------------------------------------------------------------------
 * Turns a vesselCatalog entry into a THREE.Group of flat-shaded primitives.
 * Matches the existing chunky low-poly look: no bevels, no textures, flat
 * MeshLambert/MeshStandard with low roughness variance.
 *
 * Usage:
 *   import * as THREE from 'three';
 *   import { getVessel } from './vesselCatalog.js';
 *   import { buildVessel, updateVessel, setLandMode } from './buildVessel.js';
 *
 *   const rig = buildVessel(THREE, getVessel('airboat'));
 *   scene.add(rig.group);
 *   // each frame:
 *   updateVessel(rig, dt, { throttle, onLand });
 */

import { makeHull, makeFoil, makeProp } from './hullGeometry.js';

/** Triangular prism: wide at -Z, point at +Z. Centered on its own bbox. */
function makeWedge(THREE, w, h, d) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(0, d / 2);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);   // extrude up the Y axis
  geo.translate(0, -h / 2, 0); // recenter vertically
  return geo;
}

function makeGeometry(THREE, part) {
  const a = part.args;
  switch (part.geom) {
    case 'box':    return new THREE.BoxGeometry(a[0], a[1], a[2]);
    case 'cyl':    return new THREE.CylinderGeometry(a[0], a[1], a[2], a[3] ?? 8);
    case 'cone':   return new THREE.ConeGeometry(a[0], a[1], a[2] ?? 8);
    case 'wedge':  return makeWedge(THREE, a[0], a[1], a[2]);
    case 'sphere': return new THREE.SphereGeometry(a[0], a[1] ?? 8, a[2] ?? 6);
    // Lofted forms. These take an options object in `part.shape` rather than a
    // positional args array — there are too many parameters for positions to
    // stay readable.
    case 'hull':   return makeHull(THREE, part.shape || {});
    case 'foil':   return makeFoil(THREE, part.shape || {});
    case 'prop':   return makeProp(THREE, part.shape || {});
    // Open-ended cylinder, optionally only a partial arc — args [rTop, rBottom,
    // h, seg, thetaStart, thetaLength]. Theta 0 faces +Z (the bow), so a
    // wrap-around windscreen is an arc centred on zero. Without the arc
    // parameters a windscreen comes out as a full ring hooping the whole boat.
    case 'tube':   return new THREE.CylinderGeometry(
      a[0], a[1] ?? a[0], a[2], a[3] ?? 16, 1, true, a[4] ?? 0, a[5] ?? Math.PI * 2);
    case 'torus':  return new THREE.TorusGeometry(a[0], a[1], a[2] ?? 8, a[3] ?? 16);
    default: throw new Error(`Unknown geom "${part.geom}" on part "${part.name}"`);
  }
}

/**
 * Surface finishes. The catalog used to build everything from one flat-shaded
 * MeshLambertMaterial, which has no roughness, no metalness and — crucially —
 * no response to an environment map. That made the hero object of the game the
 * least-shaded thing in the scene. These map a named finish onto real PBR.
 */
/**
 * Clearcoat is a genuinely expensive shader on phone GPUs, and a vessel can
 * carry a dozen of them. On mobile every 'physical' finish falls back to
 * 'standard' with a compensating roughness drop — visually close, far cheaper,
 * and it avoids a pile of shader compiles during the launch transition.
 */
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
);

const FINISH = {
  // Gelcoat: a clearcoat over colour is exactly what a moulded GRP hull is.
  gloss:  { cls: 'physical', roughness: 0.38, metalness: 0.02, clearcoat: 1.0, clearcoatRoughness: 0.10, smooth: true },
  satin:  { cls: 'standard', roughness: 0.55, metalness: 0.05, smooth: true },
  matte:  { cls: 'standard', roughness: 0.88, metalness: 0.00 },
  metal:  { cls: 'standard', roughness: 0.34, metalness: 0.88, smooth: true },
  rubber: { cls: 'standard', roughness: 0.95, metalness: 0.00 },
  glass:  { cls: 'physical', roughness: 0.06, metalness: 0.00, clearcoat: 1.0, clearcoatRoughness: 0.04, smooth: true },
  default:{ cls: 'standard', roughness: 0.62, metalness: 0.06 },
};

export function buildVessel(THREE, vessel, { castShadow = true } = {}) {
  const group = new THREE.Group();
  group.name = `vessel:${vessel.id}`;

  const materials = new Map();
  const getMaterial = (colorKey, opts = {}) => {
    const finishName = opts.finish || (opts.opacity != null && opts.opacity < 1 ? 'glass' : 'default');
    const f = FINISH[finishName] || FINISH.default;
    const key = `${colorKey}|${finishName}|${opts.wire ? 'w' : ''}|${opts.opacity ?? 1}`;

    if (!materials.has(key)) {
      const common = {
        color: vessel.palette[colorKey],
        // Curved lofted surfaces must shade smoothly or the loft is wasted;
        // chunky fittings keep the faceted look the rest of the world uses.
        flatShading: !(f.smooth || opts.smooth),
        wireframe: !!opts.wire,
        transparent: (opts.opacity ?? 1) < 1,
        opacity: opts.opacity ?? 1,
        // Without a clearcoat lobe the surface reads duller, so drop roughness
        // to recover some of the sheen the fallback loses.
        roughness: (opts.roughness ?? f.roughness)
          * (f.cls === 'physical' && IS_MOBILE ? 0.7 : 1),
        metalness: opts.metalness ?? f.metalness,
      };
      const m = f.cls === 'physical' && !IS_MOBILE
        ? new THREE.MeshPhysicalMaterial({
          ...common,
          clearcoat: f.clearcoat ?? 0,
          clearcoatRoughness: f.clearcoatRoughness ?? 0.1,
        })
        : new THREE.MeshStandardMaterial(common);
      // Thin panels shadow-acne badly from the inside; sampling the back face
      // for shadows is the standard fix and costs nothing.
      m.shadowSide = THREE.BackSide;
      // Open boats are a single lofted skin with no lid, so you look straight
      // into the hull from the chase camera. Those interior faces have to draw.
      if (opts.doubleSided) m.side = THREE.DoubleSide;
      materials.set(key, m);
    }
    return materials.get(key);
  };

  const meshes = {};
  const spinners = [];
  const landOnly = [];
  const waterOnly = [];
  const groups = {};

  for (const part of vessel.parts) {
    const opts = part.opts || {};
    const mesh = new THREE.Mesh(makeGeometry(THREE, part), getMaterial(part.color, opts));
    mesh.name = part.name;
    mesh.position.fromArray(part.pos);
    if (part.rot) mesh.rotation.fromArray(part.rot);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.part = part;

    group.add(mesh);
    meshes[part.name] = mesh;

    if (opts.spin) spinners.push({ mesh, kind: opts.spin });
    if (opts.showOnLand) { mesh.visible = false; landOnly.push(mesh); }
    if (opts.hideOnLand) waterOnly.push(mesh);
    if (opts.group) (groups[opts.group] ||= []).push(mesh);
  }

  // Helm eye point for the first-person view. Parented inside the rig so it
  // inherits the catalog->physics rescale — reading the raw catalog coordinate
  // would be wrong by the wrap scale factor.
  const eye = new THREE.Object3D();
  eye.position.fromArray(vessel.helm || [0, 1.0, 0.4]);
  eye.name = 'helm';
  group.add(eye);

  return {
    vessel,
    group,
    eye,
    meshes,
    spinners,
    landOnly,
    waterOnly,
    groups,
    materials,
    state: { onLand: false, deployT: 0, spinPhase: 0 },
    dispose() {
      group.traverse((o) => o.geometry?.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

/**
 * Toggle land mode. Call once on transition; updateVessel() animates the rest.
 */
export function setLandMode(rig, onLand) {
  if (rig.state.onLand === onLand) return;
  rig.state.onLand = onLand;
  rig.state.deployT = 0;
  rig.landOnly.forEach((m) => (m.visible = onLand));
  rig.waterOnly.forEach((m) => (m.visible = !onLand));
}

/**
 * Per-frame cosmetic update. Physics lives elsewhere; this only drives the
 * spinning bits and the land-mode deploy/gait animation.
 */
export function updateVessel(rig, dt, { throttle = 0, onLand = false } = {}) {
  setLandMode(rig, onLand);
  const s = rig.state;
  const lm = rig.vessel.landMode;

  // spinners
  s.spinPhase += dt;
  for (const { mesh, kind } of rig.spinners) {
    const rate = kind === 'fan' ? 22 + throttle * 30 : 14 + throttle * 26;
    mesh.rotateZ(rate * dt);
  }

  // deploy progress 0..1
  const deploySec = lm.deploySeconds || 0.001;
  s.deployT = Math.min(1, s.deployT + dt / deploySec);
  const t = s.onLand ? s.deployT : 1 - s.deployT;

  const g = rig.group;

  switch (lm.id) {
    case 'roller_bumpers': {
      const r = rig.groups.landgear || [];
      r.forEach((m) => (m.scale.setScalar(0.2 + 0.8 * t)));
      g.position.y = -0.10 * t + (s.onLand ? Math.sin(s.spinPhase * lm.motion.bounceHz * 6.28) * lm.motion.bounceAmpl * t : 0);
      g.rotation.x = -0.14 * t;
      break;
    }
    case 'just_keep_going': {
      g.position.y = s.onLand ? Math.sin(s.spinPhase * lm.motion.bounceHz * 6.28) * lm.motion.bounceAmpl : 0;
      break;
    }
    case 'anchor_crawl': {
      const cyc = (s.spinPhase % lm.motion.cyclePeriod) / lm.motion.cyclePeriod;
      const lurch = s.onLand ? Math.pow(Math.sin(cyc * Math.PI), 3) : 0;
      (rig.groups.landgear || []).forEach((m) => {
        m.position.z = m.userData.part.pos[2] + lurch * 1.6 * t;
      });
      g.rotation.x = -0.05 * lurch;
      g.position.y = -0.25 * t;
      break;
    }
    case 'stilt_walk': {
      // struts rotate down past vertical; hull rises
      (rig.groups.foil || []).forEach((m, i) => {
        m.rotation.x = (m.userData.part.rot?.[0] || 0) + t * 0.7 * (i % 2 ? 1 : -1);
      });
      const gait = Math.sin(s.spinPhase * (6.28 / lm.motion.gaitPeriod));
      g.position.y = 0.85 * t + (s.onLand ? Math.abs(gait) * 0.05 : 0);
      g.rotation.z = s.onLand ? gait * (lm.motion.bodySwayDeg * Math.PI / 180) * t : 0;
      break;
    }
    case 'beach_skid': {
      g.position.y = -0.05 * t;
      g.rotation.z = s.onLand ? Math.sin(s.spinPhase * 2.2) * 0.04 * t : 0;
      break;
    }
    case 'slip_n_slide': {
      const head = rig.meshes.slickHead;
      if (head) head.rotation.x = (Math.PI / 2) + t * Math.PI; // nozzle flips forward
      g.position.y = -0.06 * t;
      g.rotation.z = s.onLand ? Math.sin(s.spinPhase * 3.1) * 0.05 * t : 0;
      break;
    }
    default: break;
  }
}

export default buildVessel;
