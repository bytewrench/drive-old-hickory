// ──────────────────────────────────────────────────────────────
// Rapier world wrapper: fixed-step driver, collider→entity registry
// and collision-event dispatch.
// ──────────────────────────────────────────────────────────────

import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, FIXED_DT } from '../config.js';

export { RAPIER };

export class Physics {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = FIXED_DT;
    this.events = new RAPIER.EventQueue(true);

    /** collider handle → owning game entity */
    this.registry = new Map();

    /** Listeners get (entA, entB, started). */
    this.collisionListeners = [];
    /** Flat [entA, entB, started, …] scratch buffer for one step's events. */
    this._pairs = [];

    // Some rapier builds name the ray hit distance `timeOfImpact`, older ones `toi`.
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  register(collider, entity) {
    this.registry.set(collider.handle, entity);
  }

  unregister(collider) {
    if (collider) this.registry.delete(collider.handle);
  }

  entityFor(handle) {
    return this.registry.get(handle) ?? null;
  }

  onCollision(fn) {
    this.collisionListeners.push(fn);
  }

  step() {
    this.world.step(this.events);

    // Collect first, dispatch second: listeners destroy props and projectiles,
    // and mutating the world from inside drainCollisionEvents would invalidate
    // handles that later events in the same drain still refer to.
    this._pairs.length = 0;
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.registry.get(h1) ?? null;
      const b = this.registry.get(h2) ?? null;
      if (!a && !b) return;
      this._pairs.push(a, b, started);
    });

    for (let i = 0; i < this._pairs.length; i += 3) {
      const a = this._pairs[i], b = this._pairs[i + 1], started = this._pairs[i + 2];
      // Either side may have been destroyed by an earlier pair in this batch.
      if (a?.dead || b?.dead) continue;
      if (a?.kind === 'prop' && !a.alive) continue;
      if (b?.kind === 'prop' && !b.alive) continue;
      for (const fn of this.collisionListeners) fn(a, b, started);
    }
  }

  /**
   * Downward ray against *static* geometry only (terrain, bridges, ramps,
   * lock walls). Excluding dynamics means wheels never self-collide with
   * their own chassis and never try to stand on loose debris.
   * @returns {number} distance to the ground, or -1 for no hit.
   */
  castDown(origin, dir, maxToi) {
    this._ray.origin.x = origin.x; this._ray.origin.y = origin.y; this._ray.origin.z = origin.z;
    this._ray.dir.x = dir.x; this._ray.dir.y = dir.y; this._ray.dir.z = dir.z;
    const hit = this.world.castRay(
      this._ray, maxToi, true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    if (!hit) return -1;
    return hit.timeOfImpact !== undefined ? hit.timeOfImpact : hit.toi;
  }

  removeBody(body) {
    if (body) this.world.removeRigidBody(body);
  }
}

// ── small vector helpers used all over the vehicle code ───────
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
