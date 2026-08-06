# Drive Old Hickory

A full-screen 3D physics sandbox on **the real Cumberland River**, centred on
the Hunters Point Access Area in Wilson County, Tennessee. Four vessels,
buoyant hulls that turn into off-road ATVs the moment you hit a bank, working
lock gates, spillway ramps, cannons, and about a thousand destructible props.

Built with **Vite + Three.js + Rapier3D (WASM)**. No paid APIs and no art
assets — vessels, props and audio are generated in code at boot; the waterway
itself is baked from OpenStreetMap.

## The waterway is real

The shoreline is not procedural. `tools/build-terrain.mjs` pulls the water
polygons for Old Hickory Lake / the Cumberland from OpenStreetMap, projects
them to local metres at **1:1 scale**, and bakes a signed-distance field of the
true shoreline. Everything else — bed depth, bank rise, hills — is derived from
distance to that shoreline, so the in-game waterline sits exactly on the real
one, islands and coves included.

| | |
| --- | --- |
| Centre | corridor midpoint (36.2455 N, 86.52 W); dock at Hunters Point |
| Map | **56 km × 56 km**, 1:1, no compression |
| Reaches | Hunters Point → **downtown Nashville** (49 km) + Old Hickory Dam |
| Navigable channel | **152 km** of Cumberland stitched into one centreline |
| Land relief | real, up to **234 m** above pool (AWS terrarium DEM) |
| Real structures | **80 bridges** (incl. US-231 by the dock and the I-40 / downtown Nashville spans), 5 dams, 9 marinas |
| Also real | US 231, Hunters Point Pike, Spring Creek, Stones River, the islands |

You start mid-channel at Hunters Point facing **downstream toward Nashville** —
follow the buoy trail the whole way, or blast across land anywhere. A buoy is
dropped every ~920 m along the real centreline, so there's a marked route from
the dock all the way down.

Hunters Point is a peninsula wrapped by a big horseshoe meander, and that is
exactly how it plays: the ramp sits at the tip, US 231 runs down the spine, and
the river bends a full U around you.

### The hills are real too

Elevation comes from the AWS **terrarium** terrain tiles (SRTM/NED derived,
free, no key), sampled at z14 ≈ 7.7 m/px and cached on disk. The build
re-datums them so the reservoir surface reads as 0 — and it takes that datum
from the *median DEM height over water* rather than a published figure. It
comes out at **135.6 m**, which is 445 ft: exactly Old Hickory's normal pool.
That agreement is a useful check that the projection and encoding are right.

Only the *bathymetry* is synthetic — SRTM cannot see through water, so below
the waterline the bed is shaped from the shoreline distance instead.

### Regenerating the terrain

The baked asset is checked in, so this is only needed if you want to move the
map or widen the bounds:

```bash
npm run fetch-osm && npm run build-terrain
```

---

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the URL Vite prints (default <http://localhost:5173>), pick a vessel, hit
**LAUNCH**.

Production build:

```bash
npm run build
```

```bash
npm run preview
```

---

## Controls

Two schemes run side by side, picked by what you're using — and **firing is
its own trigger, never the navigation pointer**.

**Mouse (desktop) — slingshot navigation**
- **Click** the water to set a drive-to target (a reticle marks it); the boat
  auto-steers and throttles there.
- **Drag & release** — pull away from the boat to draw a slingshot, release to
  fling it the opposite way with a nitro burst (power = pull length).
- **SPACE** fires the cannon. The mouse also aims the Dreadnought's turret.
- **W A S D** still work any time — pressing them hands control straight back
  to the keyboard. **Shift** = nitro.

**Touch (mobile) — virtual joystick**
- **Left thumb** spawns a floating joystick — push to steer + throttle
  (up = forward, down = reverse).
- **Right side** aims the turret. **NITRO** and **FIRE** buttons on the right.
- Small buttons for reset / day-night / camera; tap the vessel pills to swap.

**Everywhere:** the **SOUND** button (top-left) toggles audio (also `M`). Click
the **minimap** to open a zoomable, pannable **route map** (the game pauses) so
you can plan the run down to Nashville; ESC or CLOSE resumes.

Audio is tuned deep and rumbly with a master low-pass — no harsh, hissy or
spiky high frequencies (measured 58–100 dB below the rumble), for hearing
comfort. The vessels are hard to flip and self-right within ~1 s after a flub.

## Controls (keyboard reference)

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Throttle · steer · reverse |
| `Shift` | Mega-nitro boost |
| Mouse | Aim the turret (Dreadnought) |
| Left click / `Space` | Fire |
| `1` – `4` | Swap vessel instantly, in place |
| `R` | Reset to Hunters Point Boat Dock |
| `T` | Sunny morning ⇄ synthwave night |
| `C` | Cycle camera distance |
| `X` | Handbrake (kills grip — drift on land) |
| `M` | Mute |

---

## The four vessels

| # | Vessel | Mass | Weapon | Helm → 90% turn | Character |
| --- | --- | --- | --- | --- | --- |
| 1 | Speedboat | 1.3 t | Light forward gun | 1.2 s | Fastest, 175 km/h down the river |
| 2 | Battle Barge | 91 t | Dual broadside cannons | 3.8 s | Ruinous plow force, answers like a continent |
| 3 | Hover-Cruiser | 1.6 t | Light forward gun | 4.4 s | Rides pads over water *and* land, skates |
| 4 | Dreadnought | 32 t | 360° mouse-aimed turret | 3.3 s | 26 m blast radius, heavy and deliberate |

## Handling: boats, not cars

Steering is deliberately soft. Three things do the work:

1. **Helm smoothing** — key input winds a virtual wheel on over `helm.rate`
   rather than snapping to full lock, and self-centres at `helm.centre`.
2. **A yaw-rate servo** — the helm asks for a *rate of turn* (rad/s) and only
   the torque needed to reach it is applied. You cannot snap the bow round or
   spin out; the boat eases in, holds, and eases out.
3. **A heel servo onto a target roll angle** — a bank into the turn that is
   inherently bounded.

For scale: a car reaches its steady yaw rate in roughly 0.2 s. These take
1.2–4.4 s. The rudder force is still there for the stern-swing feel, but it is
small — the servo owns the rate of turn.

Forgiveness comes from an **attitude keeper that runs in every mode**, plus
hydrodynamic settling that sucks fast hulls onto the water so they stop
skipping off wave crests, a suspension **roll centre** lifted toward the centre
of mass so cornering force is not a rollover lever, and generous self-righting.

---

## How it fits together

```
src/
├── main.js                  boot, garage screen, fixed-step loop, plow rules
├── config.js                world scale, gravity, timestep, wave constants
├── game.js                  runtime service locator (avoids import cycles)
├── core/
│   ├── Engine.js            renderer, chase camera, sky dome, day⇄night blend
│   ├── PostFX.js            bloom + two-pass tilt-shift + vignette
│   ├── Physics.js           Rapier world, collider→entity registry, ray casts
│   ├── Input.js             keyboard/mouse, edge-triggered actions
│   └── Audio.js             synthesised engine drone and one-shot hits
├── world/
│   ├── heightfield.js       sampleHeight() — the single source of truth
│   ├── Terrain.js           low-poly mesh + Rapier heightfield collider
│   ├── Water.js             depth-aware water shader, shoreline foam
│   ├── Structures.js        bridges, dam + spillway, ramps, lock gates
│   └── Props.js             ~1,040 destructible props in instanced meshes
├── vehicles/
│   ├── vesselConfigs.js     all four vessels as pure data
│   ├── Vessel.js            buoyancy + hydrodynamics + raycast suspension
│   └── VesselMesh.js        procedural low-poly hulls, wheels, turret
├── gameplay/
│   ├── Weapons.js           CCD cannonballs, detonation
│   └── Destruction.js       damage, debris pool, blast falloff, combos
├── fx/Particles.js          GPU-integrated particle pools
└── ui/                      HUD, minimap, styles
```

### Hunters Point Boat Dock

You start — and `R` returns you to — the ramp at **Hunters Point**, at the real
OSM position of the access area. The dock has a concrete launch ramp running
under the waterline, a timber pier on pilings with six finger slips, a covered
boathouse, a striped lot and canvas-drawn signage. The build script finds the
nearest genuinely wet texel to the access area and points the spawn heading out
toward open water, so the boat always starts afloat and facing the river.

`US 231` is laid from its true alignment, and prop scattering respects a
keep-clear zone around the apron and the road so nothing grows up through the
asphalt. There is no bridge in this reach because there genuinely isn't one —
Hunters Point Pike dead-ends on the peninsula. Airtime comes from the bank
kickers and the spillway instead.

### Terrain

Everything geometric derives from one function, `sampleHeight(x, z)`, which is
driven by `shoreDistance(x, z)` — a bilinear lookup into the baked shoreline
SDF. Positive distance is open water (shelf → channel); negative is inland
(bank rise → procedural hills, faded in so the waterline stays crisp). The
render mesh, the Rapier heightfield, prop scattering, buoy placement, the
minimap and the water shader's depth texture all read the same function, so
they can never disagree.

Channel buoys are walked along the real Cumberland centreline and pushed out
toward each bank, so they mark navigable water rather than decorating it.

`Terrain._buildCollider` verifies itself: it casts probe rays at the finished
collider and compares against `sampleHeight`. Current max error **0.12 m**
(the heightfield's own discretisation). If a future Rapier build changes the
row/column convention, the check catches it and transposes.

### Surface transformation

The hull carries both modes at once and neither is ever switched off:

- **Buoyancy** — eight probes at the *corners* of the hull box (top ones
  included) sample the analytic wave field. Sampling the whole volume rather
  than just the bottom face makes displacement orientation-independent, so a
  rolled or capsized hull keeps its buoyancy and rights itself.
- **Suspension** — four raycast wheels against static geometry only
  (`EXCLUDE_DYNAMIC`), so they ride bridges and ramps but never try to stand
  on their own chassis or on loose debris. They deploy over ~0.2 s once
  submersion drops below 34%.

Whichever surface the probes find wins, so bank transitions happen mid-slide
without losing speed. The Hover-Cruiser additionally treats the water surface
itself as solid ground for its pads.

### Uncapped speed

Linear damping is 0.02 and angular 0.25 — near zero. No force is
velocity-clamped. Boost multiplies thrust *and* cuts hydrodynamic forward drag
to 25%, which pushes the drag-limited terminal speed from ~210 km/h to roughly
780 km/h — well beyond anything a 900 m map can exercise.

### A Rapier gotcha worth knowing

Rapier's user forces **persist across steps** — `addForce` accumulates into a
running total that is never cleared automatically. Anything applying
per-step forces must call `resetForces()` / `resetTorques()` first, which
`Vessel.fixedUpdate` and `PropSystem.fixedUpdate` both do. Impulses
(`applyImpulse`) are instantaneous and need no reset.

### Three ways a hovercraft finds holes in your physics

The Hover-Cruiser is never *submerged* and always in pad contact, which put it
in a state nothing else visits. Each of these read as "it randomly flips over":

1. **Roll damping and self-righting lived inside the water branch**, and the
   airborne branch handled the rest — so a craft that is neither got no
   attitude control at all. There is now one attitude keeper for every mode.
2. **Suspension pushed along the hull's own up axis.** Correct for a car, which
   stays level; fatal for a cushion, because once tilted the pads push
   *sideways* and tip it further. It would slowly roll itself over in open
   water over about half a second. A cushion presses on the surface
   vertically, so `hover` craft now use world up.
3. **All drag was gated on being submerged**, so the hovercraft had no
   resistance whatsoever and accelerated to 259 km/h. There is now an
   always-on aerodynamic term.

### Two NaN traps worth knowing about

Both showed up as *the entire 3D view going black* while the HUD kept working,
and both came from the particle shader poisoning the colour buffer, which
`UnrealBloomPass` then smeared over the whole frame:

1. **`smoothstep(edge0, edge1, x)` is undefined when `edge0 >= edge1`** and
   returns NaN on some drivers. Always pass the edges low-to-high.
2. **`pow(0.0, y)` can return NaN** (`exp2(y * log2(0))`). Clamp the base away
   from zero.

The reason a single NaN escaped the alpha cutoff is worth remembering: `if (a
<= 0.003) discard;` **never fires for NaN**, because every comparison against
NaN is false. Written as `if (!(a > 0.003)) discard;` it discards NaN too.

### Swapping vessels destroys a rigid body mid-frame

`frame()` used to capture `const v = game.vessel` *before* running hotkeys.
Pressing `1`–`4` disposes that vessel and builds a new one, so the rest of the
frame then drove a body that had been removed from the physics world — which
panics the Rapier WASM module, and a panicked module stays broken, so every
later frame threw too and the game froze solid. `game.vessel` is now read
after hotkeys, and `Vessel` carries a `disposed` flag that every entry point
checks.

### Collision handling

`Physics.step` collects collision events into a buffer and dispatches them
*after* the drain completes. Listeners destroy props and projectiles, and
mutating the world from inside `drainCollisionEvents` would invalidate handles
that later events in the same batch still refer to.

---

## Debug hooks

`window.__game` exposes the live service locator, `window.__frame` runs a
single frame, `window.__addScore(n)` bumps the score. Useful for driving the
simulation from the console:

```js
__game.vessel.reset({ x: 0, z: 100 });
__game.destruction.explode({ x: 0, y: 2, z: 100 }, 40, 900, 2);
```

---

## Verified behaviour

**Waterway** — 414 channel stations sampled: 0 dry, 0 narrower than 120 m. The
18.07 km reach is navigable end to end. Terrain collider matches the render
mesh to 0.22 m (heightfield cell size).

**Forgiveness** — an autopilot follows the real river at full throttle for
4+ km per vessel:

| Vessel | km run | top km/h | grounded | capsized | airborne | peak heel |
| --- | --- | --- | --- | --- | --- | --- |
| Speedboat | 4.50 | 175 | 0% | 0% | 0% | 5° |
| Battle Barge | 4.22 | 86 | 0% | 0% | 0% | 8° |
| Hover-Cruiser | 4.22 | 90 | 0% | 0% | 0% | 24° |
| Dreadnought | 4.28 | 101 | 0% | 0% | 0% | 9° |

Holding *full nitro* for the whole run — the deliberately abusive case — the
speedboat hits 345 km/h and the dreadnought 221 km/h, both still ending
upright; capsize frames are 8% / 2% / 5% / 0%.

**Other** — all four hulls settle at a 37–48% waterline and self-right from
fully inverted; ATV mode reaches 99 km/h on four wheels with the surface swap
happening mid-slide; vessels swap under `1`–`4` without stalling the clock;
all four weapon types fire, break props and score with no exceptions over
3,600 physics steps; 144 FPS (display-capped) with ~1,900 props.

## Attribution

- Water geometry and roads: map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, licensed ODbL 1.0.
- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  (public domain / attribution varies by source; SRTM and USGS NED here).
