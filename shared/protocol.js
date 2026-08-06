// ──────────────────────────────────────────────────────────────
// The wire protocol, shared verbatim by the browser client
// (src/net/Net.js) and the Node relay (server/index.mjs).
//
// Everything is JSON. The only message that goes out every tick is
// the state snapshot, so that one is packed into a flat array —
// the rest are readable objects sent a few times a second at most.
//
// AUTHORITY MODEL — the server relays, it does not simulate.
// Each client owns exactly one thing: its own vessel. It sims that
// vessel locally and broadcasts the result. Everyone else renders it
// as an interpolated ghost. Damage is decided by the *victim*, never
// the shooter, so two clients can never disagree about who is dead.
// ──────────────────────────────────────────────────────────────

/** Bumped whenever the shape below changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Snapshot broadcasts per second (both directions). */
export const TICK_HZ = 20;

/** How far behind live the client renders remote boats, in ms. One and a
 *  half snapshot intervals: enough to always have two samples to blend
 *  between, short enough that ramming still feels fair. */
export const INTERP_DELAY_MS = 90;

/** Beyond this, a ghost stops being extrapolated and just freezes. */
export const EXTRAPOLATE_MS = 300;

export const MAX_PLAYERS = 32;
export const MAX_NAME_LEN = 16;

// ── message types ─────────────────────────────────────────────
export const MSG = {
  // client → server
  JOIN: 'join',
  STATE: 'st',
  SHOT: 'shot',
  HIT: 'hit',            // "I was hit by <by>" — sent by the victim
  BREAK: 'brk',          // "I destroyed prop <i>"
  WORLD: 'world',        // weather / night change
  PING: 'ping',

  // server → client
  WELCOME: 'hello',
  JOINED: 'joined',
  LEFT: 'left',
  SNAPSHOT: 'snap',
  KILL: 'kill',
  PONG: 'pong',
  FULL: 'full',
  // SHOT / HIT / BREAK / WORLD are relayed back out under the same type.
};

/** Vessel state bit flags packed into the snapshot's `st` field. */
export const FLAG = {
  BOOSTING: 1,
  ONLAND: 2,
  DEAD: 4,
};

// ── snapshot packing ──────────────────────────────────────────
// [id, px,py,pz, qx,qy,qz,qw, vx,vy,vz, vesselIndex, turretYaw, turretPitch,
//  flags, hp]
export const SNAP_FIELDS = 16;

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** @param {number} id @param {object} s flattened vessel state */
export function packState(id, s) {
  return [
    id,
    r2(s.px), r2(s.py), r2(s.pz),
    r3(s.qx), r3(s.qy), r3(s.qz), r3(s.qw),
    r2(s.vx), r2(s.vy), r2(s.vz),
    s.vessel | 0,
    r3(s.turretYaw), r3(s.turretPitch),
    s.flags | 0,
    Math.round(s.hp),
  ];
}

export function unpackState(a) {
  return {
    id: a[0],
    px: a[1], py: a[2], pz: a[3],
    qx: a[4], qy: a[5], qz: a[6], qw: a[7],
    vx: a[8], vy: a[9], vz: a[10],
    vessel: a[11],
    turretYaw: a[12], turretPitch: a[13],
    flags: a[14],
    hp: a[15],
  };
}

/** Rejects NaN/Infinity and anything the wrong length — a malformed row
 *  would otherwise poison a rigid body and panic the Rapier module. */
export function validState(a) {
  if (!Array.isArray(a) || a.length !== SNAP_FIELDS) return false;
  for (let i = 0; i < SNAP_FIELDS; i++) {
    if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return false;
  }
  return true;
}

export function validVec3(v, limit = 1e6) {
  return Array.isArray(v) && v.length === 3
    && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < limit);
}

/** Drop control characters and clamp the length. Names are always written
 *  with textContent, never as HTML, but keep them tame regardless. */
export function cleanName(raw) {
  let out = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) continue;   // C0 / C1 controls
    out += ch;
    if (out.length >= MAX_NAME_LEN) break;
  }
  return out.trim() || 'Skipper';
}
