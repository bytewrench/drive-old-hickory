# Drive Old Hickory

A full-screen 3D physics sandbox on **the real Cumberland River**, centred on
the Hunters Point Access Area in Wilson County, Tennessee. Five craft — four
boats and a floatplane — buoyant hulls that turn into off-road vehicles the
moment you hit a bank, working lock gates, spillway ramps, cannons, and about a
thousand destructible props. Drive from the chase camera or from the helm.

Built with **Vite + Three.js + Rapier3D (WASM)**. No paid APIs and no art
assets — vessels, props and audio are generated in code at boot; the waterway
itself is baked from OpenStreetMap. Hulls are **lofted parametric surfaces**,
not boxes: see [Hull geometry](#hull-geometry).

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

For multiplayer in dev, run the relay alongside it in a second terminal — Vite
proxies `/ws` to it, so the client connects to its own origin either way:

```bash
npm run server
```

Production is a **single Node process** that serves the built bundle *and* runs
the relay, which is what the Docker image starts:

```bash
npm run build
```

```bash
npm start
```

That serves <http://localhost:8080> with the multiplayer socket on `/ws`. Set
`PORT` to move it. `npm run preview` still works for a static-only look.

---

## Controls

Two schemes run side by side, picked by what you're using — and **firing is
its own trigger, never the navigation pointer**.

**Mouse (desktop) — slingshot navigation**
- **Click** the water to set a drive-to target (a reticle marks it); the boat
  auto-steers and throttles there.
- **Drag & release** — pull away from the boat to draw a slingshot, release to
  fling it the opposite way with a nitro burst (power = pull length).
- **SPACE** fires the cannon. The mouse also aims the Skimmer's turret.
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
| Mouse | Aim the turret (Skimmer) |
| Left click / `Space` | Fire |
| `1` – `5` | Swap vessel instantly, in place |
| `R` | Reset to Hunters Point Boat Dock (also repairs the hull) |
| `T` | Sunny morning ⇄ synthwave night — shared with the room |
| `C` | Cycle camera distance |
| `V` | Chase view ⇄ **helm (first person)** |
| `X` | Handbrake (kills grip — drift on land) |
| `M` | Mute |

---

## The five craft

| # | Vessel | Mass | Weapon | Ashore | Character |
| --- | --- | --- | --- | --- | --- |
| 1 | Bowrider | 1.3 t | Light forward gun | **Trailer gear** — four wheels swing down | Fastest boat, 175 km/h down the river |
| 2 | Bollard | 91 t | Dual broadside cannons | **Dozer gear** — oversized tyres | Ruinous plow force, answers like a continent |
| 3 | Fanjack | 1.6 t | Light forward gun | Just keeps going — flat pan, no gear | Rides pads over water *and* land, skates |
| 4 | Skimmer | 32 t | 360° mouse-aimed turret | Stilt walk — the foils become legs | 26 m blast radius, heavy and deliberate |
| 5 | **Osprey** | 1.0 t | Nose gun | Beach skid — it has no undercarriage | **Flies.** Takes off at ~145 km/h |

Land traversal is deliberately **per-vessel**: two hulls grow real running
gear, three cope with the shore in their own idiom, and the aeroplane's answer
to being on land is to stop being on land.

### The Osprey actually flies

It is not a boat with an "up" button. `Vessel._updateFlight` is a real (if
simplified) fixed-wing model — lift from angle of attack with a stall break,
induced plus parasitic drag, sideslip resistance, and control surfaces whose
authority scales with dynamic pressure, so the controls go slack at low
airspeed and a stall drops the nose on its own.

There is no separate "take off" action. It is an ordinary boat on the step,
accelerating under normal hull thrust while lift builds with airspeed, and it
leaves the water at the moment lift exceeds weight. `water.settle` — the term
that sucks a fast hull down onto the surface — is turned nearly off for this
hull alone, because that force is precisely what would keep it from unsticking.

Airborne, the controls change meaning:

| Input | On the water | Flying |
| --- | --- | --- |
| `W` / `S` | Thrust / reverse | **Elevator** — nose up / nose down |
| `A` / `D` | Rudder | **Ailerons** — roll, with coordinated yaw |
| `Shift` | Nitro | Throttle boost |

Two details make it fly nicely rather than merely fly. The **trimmed angle of
attack is `pitchAuth / pitchStab`**, which has to stay under `stallAlpha` or
holding `W` simply stalls the aeroplane — at 0.20/0.30 it trimmed to 0.67 rad
and stood the thing on its tail. And control authority carries an
**`authFloor`**, because authority proportional to dynamic pressure alone
collapses toward zero exactly when the craft is slow and nose-high, which is
the one moment it most needs to get its nose down.

Held at full elevator it will still zoom-climb to ~60 m, stall, and recover —
that is correct, and it is how you learn to fly it. Eased back to about a third
it cruises at 177 km/h, climbs to 50 m, and holds an 86° banked turn.

## Helm view

`V` (or the 📷 button on touch, which now walks all four states) drops you to
the wheel. Each vessel declares a `helm` eye point in the catalog, built as an
`Object3D` **inside** the rig so it inherits the catalog→physics rescale — a
raw catalog coordinate would be wrong by the wrap scale factor.

Hiding your own hull is the interesting part. `visible = false` would take the
boat's shadow with it, so the local hull's meshes are moved to `LAYER_HULL`
instead: first-person masks that layer off the main camera while the shadow
camera keeps it enabled. You see the world from the wheel, and your own shadow
still runs alongside you on the water.

Full hull attitude is nauseating on a wave train and a yaw-only lock feels
detached from the boat, so the view blends **55% of the real pitch and roll**.

## Look and feel

Five fixes, in rough order of how much each one moved the picture.

**Anti-aliasing was silently off.** The renderer is created with
`antialias: true`, but that flag only ever applies to the default framebuffer —
and every pixel goes through an `EffectComposer` instead, whose default render
target is built *without* `samples`. Supplying an explicitly multisampled
target is what actually turns AA on. Every low-poly silhouette in the game was
jagged for want of one argument.

**There was no environment map.** `scene.environment` was never assigned, so
every `metalness > 0` surface in the game had nothing to reflect and resolved
to flat grey — `MeshStandardMaterial` is a PBR model whose specular lobe is
meaningless without an environment. Rather than ship an HDRI, the engine PMREMs
a miniature stand-in scene that mirrors the sky gradient and ground tone, so
reflections always agree with the sky the player can actually see. It is
re-baked in 8 steps across a day/night transition, which is indistinguishable
from continuous and vastly cheaper than per-frame.

**A long lens, and speed dollies instead of zooming.** The chase camera moved
from a 48° FOV that blew out to 76° under boost, to a fixed 34° that pulls the
camera *back* with speed. A long lens flattens perspective so the world reads
as a built model rather than a wide-angle demo; the old FOV punch distorted the
whole frame and undid it. Chase distances were scaled by tan(24°)/tan(17°) ≈
1.46 so the subject framing is unchanged. Impacts now kick a **roll spring** —
a damped oscillator that tilts the horizon, which reads far better than
positional shake because that is what an impact actually does to your view.

**Shadows were detached from their objects.** The frustum was a fixed ±150 m at
2048², i.e. 0.146 m per texel, which forced a `normalBias` of 0.6 — about four
texels — and every contact shadow floated free of its caster. Fitting the
frustum to what the camera can see (and biasing it forward of the boat, since
half the budget was being spent behind the player) tightened it to ~0.054 m per
texel and let the bias drop to 0.045.

**The depth buffer was spent on empty space.** The sky dome was map-sized —
radius 53 km — which forced the far plane to 123,200 against a near of 0.5, a
246,400:1 ratio, for a scene that fog makes fully opaque past about 2 km. The
dome follows the player, so it only has to out-range the fog: at 7 km, with a
9 km far plane, depth resolution improves roughly 27×.

Two smaller ones: bloom was being re-sized to CSS pixels *after* the composer
had already applied device pixel ratio, halving its mip chain on a retina
display; and the star field's `gl_PointSize` never accounted for DPR, drawing
every star at half its intended size.

**On phones** the whole stack steps down — MSAA off, clearcoat materials fall
back to standard with a compensating roughness drop (clearcoat is a genuinely
expensive shader on mobile GPUs and a vessel can carry a dozen), and hull lofts
drop to 60% resolution. The silhouette is the point of lofting, and it survives
the reduction; only the shading facets get chunkier, which suits the art
direction anyway.

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
│   ├── vesselConfigs.js     all five craft as pure data (physics + tuning)
│   ├── vesselCatalog.js     the *look*: parts, palettes, helm points
│   ├── hullGeometry.js      lofted hulls, aerofoils, propellers
│   ├── buildVessel.js       catalog → THREE.Group, PBR finishes, land modes
│   ├── modelLoader.js       optional author-supplied glTF slot
│   ├── Vessel.js            buoyancy + hydrodynamics + suspension + flight
│   └── VesselMesh.js        rig wrapper, road wheels, turret, muzzle anchors
├── gameplay/
│   ├── Weapons.js           CCD cannonballs, detonation
│   └── Destruction.js       damage, debris pool, blast falloff, combos
├── net/
│   ├── Net.js               the socket: reconnect, 20 Hz throttle, dispatch
│   ├── RemoteVessel.js      another player's boat — interpolated, kinematic
│   └── Multiplayer.js       ties the socket to the world
├── fx/Particles.js          GPU-integrated particle pools
└── ui/                      HUD, minimap, nameplates/roster/feed, styles

server/
├── index.mjs                static host + WebSocket relay (one process)
└── static.mjs               dist/ with the caching rules nginx used to do
shared/protocol.js           the wire format, imported by both sides
```

### Multiplayer: everyone shares one Cumberland

Open the URL, type a call sign, launch — you're on the same river as everyone
else who did. There are no rooms and no lobby.

**The server relays; it does not simulate.** It runs no physics and doesn't
know where the river is — replicating a 56 km heightfield and a full Rapier
world server-side would buy nothing here. Each client sims exactly one boat,
its own, and broadcasts the result 20 times a second. Everyone else renders
that as a `RemoteVessel`: no buoyancy, no wheels, no forces, just a replay of
what its owner reported, **90 ms in the past** so there are always two samples
to blend between. What the ghost *does* carry is a real kinematic collider —
that's what lets you ram somebody and lets your shells hit them. Kinematic
bodies win every contact, so a ghost never gets shoved off its owner's
reported path; the local player is the one who bounces.

**You decide when you get hurt.** Damage is applied only by the client that
owns the boat, never by the shooter. Fire a cannon and the shot is relayed as
position + velocity; every client launches that shell through its own physics,
and if it detonates on *your* hull, *your* machine applies the damage and tells
the room. Two clients can disagree about a near miss. They can never disagree
about a kill — which is the part that would actually be visible. The same rule
covers blast falloff and ramming (closing speed, computed on both sides).

Hull integrity scales off each vessel's mass stat, so the Bollard soaks three
turret shells where the Bowrider barely survives one. Sink and you drift as a
wreck for 3.5 s, then relaunch at the ramp. Swapping hulls mid-river carries
your damage across, so hopping boats isn't a free repair.

Prop destruction and the sky are shared too. The scatter pass is seeded, so
every client builds the same props in the same order and agrees on their ids —
that's what lets "I blew up prop 812" mean the same thing everywhere, and a
prop keeps its id when it grows back. Weather and night are whoever touched
them last, held by the server so a late joiner sees the same sky.

What that buys and what it costs: no server tick to fight, no rollback, no
authoritative state to reconcile, and a relay that idles at nearly nothing. In
exchange, a determined client can lie about where its own boat is. For a
sandbox on a private river that is the right trade.

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

### Hull geometry

Hulls used to be a `BoxGeometry` with a triangular prism stuck on the bow. That
can never read as a boat, because everything that makes a hull recognisable is
a curve a box has no way to express. `hullGeometry.js` lofts them instead —
stations along Z, each a cross-section swept keel to sheer, skinned into one
surface and capped at the transom and deck:

| Parameter | What it is |
| --- | --- |
| `sheer` | the deck edge sweeping up toward the bow |
| `flare` | topsides widening above the waterline to throw spray |
| `sectionAft` / `sectionFwd` | superellipse exponent — **1.3 = fine V, 2 = round bilge, 6 = hard chine** |
| `rocker` | the keel lifting at the forefoot so the stem clears the water |
| `entry` | how finely the waterline tapers to the stem |

Interpolating the section exponent bow-to-stern is what gives a planing hull
its "sharp forward, flat aft" character in one continuous surface. It is also
what separates the craft: the tug is a round bilge (2.4 → 1.85), the runabout
is hard-chined aft and fine forward (5.5 → 1.30), the airboat is a flat pan
throughout (8.0 → 4.2), and the Skimmer's needle hulls run 2.6 → 1.15.

`makeFoil` builds symmetric aerofoil sections for foils, wings, fins and
rudders — the hydrofoil's wings were 0.10 m rectangular slabs — and `makeProp`
builds twisted, tapered blades in place of the flat cylinder disc that used to
stand in for a screw.

Lofted parts shade smoothly; fittings stay flat-shaded, so the chunky look
survives where it belongs. Materials are PBR by named `finish` — `gloss` is a
clearcoat over colour, which is exactly what a moulded GRP hull is.

**Bringing your own model.** Give a catalog entry `model: { url: '/my-boat.glb' }`
and that glTF is used for the visual while physics, weapons, land modes and the
helm anchor keep working off the same catalog data. Loading is async and
non-blocking: the procedural hull renders immediately and is swapped out only
once the file arrives, so a missing asset degrades to the built-in model rather
than an empty river. Author it +Z forward, Y up, origin on the waterline; it is
auto-fitted to the physics hull length. Plain `.glb` only — no Draco or Meshopt,
since neither decoder is bundled.

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
4+ km per vessel. *These runs predate the hull-geometry and flight work and use
the older vessel names; they have not been re-measured, and the Osprey is not
covered:*

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
