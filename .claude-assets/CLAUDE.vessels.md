# CLAUDE.md — Vessels

<!-- Paste into the project CLAUDE.md, or keep as a file and reference it with
     @CLAUDE.vessels.md from the root CLAUDE.md. -->

## Vessel system

Vessel definitions live in `src/vessels/vesselCatalog.js` (pure data) and are
consumed by `src/vessels/buildVessel.js` (Three.js mesh construction + land-mode
animation). Full design rationale is in `docs/VESSELS.md`.

### Hard rules — do not violate without asking

> **Rules 1 and 2 were relaxed by the project owner.** The original text is kept
> below each entry so the reasoning stays visible. Everything else stands.

1. **Wheels are per-vessel, not banned.** The owner chose a deliberate mix:
   `runabout` and `tug` deploy real visible running gear on land; `airboat`,
   `hydrofoil` and `pwc` keep a boat-idiom gimmick. A hull opts in with
   `landWheels` in `vesselConfigs.js` — `VesselMesh` then builds tyre, rim,
   spokes and trailing arm into the wheel pivots that `Vessel.updateVisual`
   already drives. Do not give a hull wheels that has not opted in.
   *(Was: "No wheels, ever… each mode must read as a boat coping with land.")*
2. **Primitives, plus the lofted forms in `hullGeometry.js`.** `hull`, `foil`
   and `prop` build real curved surfaces — sheer, flare, deadrise, rocker,
   aerofoil sections, twisted blades — because a box cannot express a hull's
   silhouette. Lofted parts shade smoothly; chunky fittings stay
   `flatShading: true`. Materials are PBR via the `finish` opt
   (`gloss`/`satin`/`matte`/`metal`/`rubber`/`glass`), never raw Lambert.
   Still no image textures. An author-supplied glTF may be attached with
   `model: { url }` — see `modelLoader.js`.
   *(Was: "Primitives only… No imported models, no textures, no bevels.")*
3. **Parts reference palette keys, never hex.** `color: 'accent'`, not
   `color: '#ff5f6d'`. Palettes are per-vessel and swappable.
4. **Never hardcode a stat in game logic.** Read from `vessel.stats`. Balance
   passes happen in the catalog and nowhere else.
5. **Land gimmicks reuse existing hardware.** Before adding geometry for a land
   mode, check whether an existing part can rotate, extend, or reverse instead.

### Conventions

- Meters. Y up, **+Z forward (bow)**, +X starboard, right-handed.
- Origin = hull center at the static waterline. `y = 0` is the water surface.
- Rotations: radians, XYZ euler order.
- Stats are 1–10; `mass` is relative with `1.0` = runabout.

### Roster

| id | name | role | land mode |
|---|---|---|---|
| `runabout` | Bowrider | All-rounder (default pick) | Roller Bumpers |
| `airboat` | Fanjack | Skirmisher, best on land | Just Keep Going |
| `tug` | Bollard | Bruiser, mass + harpoon | Anchor Crawl |
| `hydrofoil` | Skimmer | Glass cannon, top speed | Stilt Walk |
| `pwc` | Skipjack | Unlockable duelist | Slip 'n' Slide |

### Adding a vessel

1. Add an entry to `VESSELS` in `vesselCatalog.js` with the full schema — a
   partial entry will build but will silently render wrong.
2. Every `part.color` must be a key present in that vessel's `palette`.
3. Part names must be unique within the vessel; `buildVessel` keys `rig.meshes`
   by name.
4. Give it a `landMode` with a distinct `id`, then add a matching `case` in the
   `switch` in `updateVessel()`. Do not fall through to `default` — a vessel with
   no land animation is a bug, not a placeholder.
5. Update the roster table above and `docs/VESSELS.md`.

### Land-mode contract

- Transition is triggered by terrain contact above the waterline, not a button.
- `setLandMode(rig, onLand)` toggles part visibility; `updateVessel()` drives the
  deploy interpolation and the gait.
- The vessel is **slow and vulnerable** for `landMode.deploySeconds`. That window
  is the balancing cost of going ashore — do not shorten it to "feel better".
- Weapons stay live on land.
- Only the PWC meters a resource (`landMode.resource.water_reserve`). If another
  hull ever needs one, raise it before implementing.

### Files

```
src/vessels/vesselCatalog.js   # data — roster, stats, geometry, land modes
src/vessels/buildVessel.js     # THREE.Group construction + per-frame animation
docs/VESSELS.md                # design rationale, balance triangle, art direction
```
