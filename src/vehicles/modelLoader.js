/**
 * modelLoader.js
 * ---------------------------------------------------------------------------
 * Optional author-supplied vessel models.
 *
 * Everything else in this project is generated in code at boot — that is the
 * premise, and the procedural hulls remain the default. This is the escape
 * hatch: give a catalog entry a `model: { url }` and that glTF is used for the
 * visual instead, while physics, weapons, land modes and the helm anchor all
 * keep working off the same catalog data.
 *
 * Loading is asynchronous and non-blocking. The procedural hull renders
 * immediately and is swapped out only once the file has actually arrived, so a
 * slow or missing asset degrades to the built-in model rather than an empty
 * river.
 *
 * Authoring notes for a drop-in model:
 *   · +Z is the bow, Y is up, +X is starboard.
 *   · Origin at the hull centre, on the static waterline.
 *   · Real-world metres. It gets uniformly rescaled to the physics hull length
 *     anyway, but starting close keeps the detail proportionate.
 *   · .glb (single file) is easiest. Plain glTF/glb only — no Draco or Meshopt
 *     compression, since neither decoder is bundled.
 */

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let loader = null;
const cache = new Map();

function load(url) {
  if (!cache.has(url)) {
    loader ||= new GLTFLoader();
    cache.set(url, new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    }));
  }
  return cache.get(url);
}

/**
 * Fit `obj` so its longitudinal extent matches `targetLen`, and seat it so the
 * waterline sits at y = 0. Author models rarely arrive at game scale.
 */
function fitToHull(THREE, obj, targetLen, opts) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const len = Math.max(size.z, 1e-3);

  const s = opts.scale ?? (targetLen / len);
  obj.scale.setScalar(s);

  if (opts.position) {
    obj.position.fromArray(opts.position);
  } else if (opts.autoSeat !== false) {
    // Recompute after scaling, then centre longitudinally/laterally and put the
    // waterline at the fraction of hull depth the catalog asks for.
    const b2 = new THREE.Box3().setFromObject(obj);
    const c = b2.getCenter(new THREE.Vector3());
    const sz = b2.getSize(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= b2.min.y + sz.y * (opts.waterlineAt ?? 0.34);
  }
  if (opts.rotation) obj.rotation.fromArray(opts.rotation);
}

/**
 * Swap an external model in over the procedural rig.
 * Resolves to true if the model loaded, false if we stayed procedural.
 */
export async function attachExternalModel(THREE, wrap, vessel, result) {
  const opts = vessel.model || {};
  try {
    const gltf = await load(opts.url);
    // Clone so several boats (and remote players) can share one download.
    const obj = gltf.scene.clone(true);

    const targetLen = vessel.collider?.size?.[2] ?? 4;
    fitToHull(THREE, obj, targetLen, opts);

    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.shadowSide = THREE.BackSide;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        // Authored maps are almost always sRGB-encoded colour; anything else
        // (roughness, normal, AO) must stay linear.
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        m.envMapIntensity = opts.envMapIntensity ?? 1.0;
        m.needsUpdate = true;
      }
    });

    // Hide the procedural hull rather than disposing it: land-mode animation
    // and setLandMode() still hold references to those meshes, and the model
    // may be swapped back out if the vessel is rebuilt.
    result.rig.group.visible = false;
    wrap.add(obj);
    result.external = obj;

    // Re-apply the local-hull layer, since the meshes arrived after setLocal().
    if (result.isLocal !== undefined) result.setLocal(result.isLocal);
    return true;
  } catch (err) {
    console.warn(`[vessel] external model "${opts.url}" failed to load; keeping the procedural hull.`, err);
    return false;
  }
}
