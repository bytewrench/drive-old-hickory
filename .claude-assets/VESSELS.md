# Vessel Roster & Amphibious Design

Reference for the nautical speed + battle app. Source of truth for numbers is
`vesselCatalog.js`; this doc explains the *why* so the design does not drift.

---

## Core constraint

**Vessels are water craft. They never get wheels.** Land traversal is not a
fallback mode where the boat quietly becomes a car — it is a *feature*, and each
hull solves it a different, visibly ridiculous way. Land is a place a boat has
gotten itself into, and the animation should read that way.

Design test for any future hull: *if you paused the game mid-land-crossing and
showed someone the screenshot, would they laugh?* If not, the land mode is wrong.

---

## The four launch hulls

| | Runabout "Bowrider" | Airboat "Fanjack" | Tug "Bollard" | Hydrofoil "Skimmer" |
|---|---|---|---|---|
| Role | All-rounder | Skirmisher / amphibian | Bruiser / control | Speed / glass cannon |
| Top speed | 7 | 8 | 4 | 10 |
| Accel | 7 | 8 | 3 | 5 |
| Turn | 6 | 9 | 3 | 4 |
| Hull HP | 6 | 4 | 10 | 4 |
| Armor | 5 | 2 | 9 | 3 |
| Mass | 1.0 | 0.65 | 2.4 | 0.8 |
| Land speed | 0.55× | 0.92× | 0.35× | 0.50× |
| Land handling | 0.60× | 0.95× | 0.35× | 0.45× |

Plus the unlockable **PWC "Skipjack"** — 8 / 9 / 10 / 3 HP / 0.35 mass. Ship it
after the four are tuned; it is the most fun and the most fragile to balance.

### Why these four

They are a rock-paper-scissors triangle with a control vessel:

- **Airboat** beats **Tug** — it simply leaves. The tug cannot catch it and
  cannot hit it, and the airboat wins any race that touches shoreline.
- **Tug** beats **Hydrofoil** — one harpoon or one ram and the foiler is done.
  Falling off the foils is a death sentence in the tug's radius.
- **Hydrofoil** beats **Airboat** — open water, straight lines, torpedoes. The
  airboat has no armor and nowhere to hide on a wide stretch.
- **Runabout** is the honest baseline that loses nothing badly and wins nothing
  hard. It is what a new player should be handed.

---

## Land mode: one gimmick per hull

| Hull | Mode | Feel |
|---|---|---|
| Runabout | **Roller Bumpers** | Inflatable fenders punch out and drop under the keel. Rolls like a rolling pin. Fast straight, cannot turn, bounces over everything. |
| Airboat | **Just Keep Going** | No transformation at all. The fan does not care what is underneath it. This is the reference — every other hull is measured against how badly it compares. |
| Tug | **Anchor Crawl** | Fires its anchor forward, bites dirt, winches its own hull along in one-boat-length heaves. Slowest thing in the game. Funniest to watch. |
| Hydrofoil | **Stilt Walk** | Struts rotate down past vertical; the boat picks its way forward on four legs like an embarrassed heron. Steps over obstacles. One hit tips it over. |
| PWC | **Slip 'n' Slide** | Reverses its pump to a bow nozzle, sprays water on the dirt ahead, and surfs the mud it just made. Burns a limited reserve — run dry and you are beached. |

### Systems each mode reuses

Every gimmick is deliberately built on hardware the hull already has, so nothing
needs bespoke art or a second physics model:

- Tug's anchor winch **is** its harpoon. Same line, same reel. A good player uses
  it to slingshot onto land, or to yank an enemy off a beach.
- PWC's slick **is** the airboat's chum slick, emitted from a different nozzle.
  Shared hazard decal, shared grip modifier.
- Hydrofoil's legs **are** its foils. No extra geometry — just a rotation.
- Runabout's rollers are the only new parts, and they are two cylinders.

### Shared land-mode rules

- Transition triggers on hull contact with terrain above waterline, not on a
  button. Deploy time is per-hull (`landMode.deploySeconds`) and the vessel is
  **vulnerable and slow during deploy** — beaching yourself is a real risk.
- Weapons stay live on land. The airboat's fan blast and the tug's harpoon both
  become much better there; the hydrofoil's torpedo becomes much worse.
- Land mode drains nothing except the PWC's water reserve. That is the one
  resource-metered mode and it is what keeps the fastest land option honest.

---

## Art direction

Matches the existing screenshot style:

- Chunky low-poly primitives only — boxes, cylinders, cones, and a triangular
  prism helper for bows. **No bevels, no textures, no imported models.**
- Flat shading (`flatShading: true`, `MeshLambertMaterial`).
- Dark navy hulls, saturated block accents (purple / red / yellow / teal), near
  black for rails, fenders, and running gear.
- Each vessel carries its own six-key palette: `hull`, `deck`, `accent`, `trim`,
  `dark`, `glass`. Parts reference palette *keys*, never hex, so reskins and
  team colors are a one-line change.
- Silhouette is the identity. At 40px each hull should be unmistakable: flat pan
  + big circle (airboat), tall box + stack (tug), two needles (hydrofoil), low
  wedge (runabout), tiny wedge (PWC).

---

## Coordinate & unit conventions

- Meters. Y up, **+Z forward (bow)**, +X starboard. Right-handed.
- Origin is hull center at the **static waterline** — `y = 0` is where the water
  sits, so `buoyancy.draft` describes how much hull is below it.
- Rotations in radians, XYZ euler order.
- Stats are 1–10 and intentionally readable. `mass` is relative, `1.0` = runabout.

---

## Build order

1. `runabout` — proves the pipeline and the water physics.
2. `airboat` — proves land mode with the cheapest possible implementation.
3. `tug` — proves mass, ram damage, and the winch/harpoon system.
4. `hydrofoil` — proves the lift/foil state and the walking gait.
5. `pwc` — unlock, and the only vessel with a metered land resource.
