# Lamina Studio: specification

Status: draft 1, 2026-11-06, awaiting owner review. No code exists yet.

Lamina Studio is a browser studio for designing layered, laser-cut art. You build a stack of cut sheets that reads as one deep piece: a round lattice mandala, a circuit-trace festival panel, or a framed shadow box. The studio exports cut-ready files plus everything needed to build the piece: spacers, dowel holes, layer IDs, an assembly sheet and, later, a frame.

It is the fourth studio after Coaxial Interference, Fieldform and Tenebrae, and follows their house pattern: one self-contained `index.html`, MIT, GitHub Pages at `knnurl.github.io/lamina-studio`.

Mark unverified claims with `[Verify]`. Section 17 collects them.

---

## 1. Goals and non-goals

**Goals**
- Generate striking layered designs in four pattern families: lattice and key-fret, circuit and pipe routing, radial mandala, and image to layers.
- Make every export physically buildable on a shared university laser, so that cuts register and nothing falls out.
- Be usable by non-technical artists and festival crews, with safe defaults, a Basic mode and a guided tour.

**Non-goals (for now)**
- Driving the laser (no G-code, no machine control). Output is SVG and DXF for the lab's own software.
- True-shape nesting. Bounding-box sheet packing only.
- Psyight live control. M7 only exports an LED layout file.
- A general vector editor. Node editing (M4) is limited to the outlines Lamina owns.

## 2. Users and priorities

Primary users are artists and festival crews; the owner is the first and most demanding user. When goals conflict, resolve in this order:

1. **Visual creativity**: range and beauty of output.
2. **Buildability**: checks block only fatal faults (section 7) and warn on the rest.
3. **Ease of use**: a good piece in 10 minutes in Basic mode.
4. **Interactivity**: slider feedback fast enough to sculpt with (targets in section 13.6).

## 3. Decisions summary

Agreed in the scoping interview on 2026-11-06. Changes go in the decision log (section 18).

| Area | Decision |
|---|---|
| Pieces | Round wall mandala, framed shadow box, festival deco panels |
| Lighting | Per piece: unlit or static backlight. Psyight LED layout export in M7, but the data model carries LED fields from M1 |
| Pattern families | Lattice/key-fret (M2), circuit/pipe (M3), radial mandala (M4), image to layers (M5) |
| Artwork source | Generators, hand edits and import, all of them |
| Machine | Lab Epilog Fusion Pro 48, 120 W CO2, bed 1219 x 914 mm, driven from Adobe Illustrator through Epilog Job Manager. Stock sheets 600 x 400, 400 x 300 and 300 x 300 mm. No job time limit. Kerf unknown: calibration test card |
| Materials | 3 mm plywood, 3 mm MDF, acrylic (opaque, translucent). Custom presets |
| Colour | Per piece: paint or stain, coloured material, or light |
| Depth | Per-layer gap (0 means glued). Both "depth field sliced" and "per-layer source" modes |
| Islands | Auto bridges by default. Per-island toggle to glue-on, with locator scores on the layer behind |
| Registration | Silhouette, asymmetric dowel pattern, engraved layer IDs, assembly sheet |
| Frames | Laser-cut (spacers in M1, finger-joint box in M6) and 3D-printed comb frame STL (M6) |
| Symmetry | Rotational n, dihedral n, mirror X, mirror X+Y, tiling, none |
| Grids | Square, square plus 45 degrees, polar, free curves |
| Outlines | Circle, rectangle, arch, regular polygon, custom SVG |
| Image | Tone bands, imported depth map, in-browser depth AI, dithered engrave back plate |
| Editing | Cell paint and erase, region lock and mask, per-island bridges, vector node editing |
| Text | Stencil text tool and logo SVG import |
| Preview | 3D tilt with lighting, exploded view, 2D stacked render, WebM video |
| Big panels | Puzzle-joint tiling across sheets |
| Export | Plain SVG and DXF in mm, colour-coded operations, bbox sheet packing, zip |
| Build | Tenebrae model: `src/` modules built into one `index.html`, Node tests, Pages CI |
| Geometry | Clipper2 vector core; raster plus marching squares only for image and field inputs |
| Theme | Psy neon dark, with a light toggle |

---

## 4. Physical model

### 4.1 Piece
A piece is an ordered stack of **layers**, front (L1, nearest the viewer) to back (LN). Every layer shares the piece **outline**: the silhouette is the first registration feature, as in AngelShadowBox and the purchased 7-layer mandala.

- Layer count: 1 to 40.
- Size: up to the stock sheet size in M1. The default stock is 600 x 400 mm; the Epilog bed caps it at 1219 x 914 mm. Larger pieces need puzzle-joint tiling (M6).
- Default piece: 290 mm circle, 8 layers of 3 mm plywood, all gaps 0. At 290 mm, one layer fits a 300 x 300 sheet and two fit a 600 x 400 sheet, both with 4 mm margins (the kerf makes a 290 mm layer cut at 290.2 mm, which 5 mm margins would push over 300).
- Stock sheet presets: 600 x 400 (default), 400 x 300 and 300 x 300 mm, the lab's sizes. Custom sizes are allowed, up to the bed.

### 4.2 Layer
Each layer has:
- **Material and thickness**: from a preset; per-layer override allowed.
- **Gap**: the gap behind it to the next layer.
- **Finish**: paint or stain colour, or the material's own colour.
- **Source**: what draws its pattern.

Its cut geometry is the outline, minus the pattern openings, plus registration features.

**Frame ring.** By default every layer keeps an outer ring of material (width `frame_ring_mm`, per layer). This is what holds the pattern together and where hidden features go. It follows Angel's `make_layer`: the layer is the frame ring unioned with the motifs, clipped to the outline. The front layer's ring may be set to 0 to give a borderless look; the checks then verify connectivity.

### 4.3 Gaps and spacers
- **gap 0**: layers glue face to face.
- **gap > 0**: spacers hold the layers apart. They are generated from the same sheet material, so gaps snap to multiples of the spacer stock thickness. Showing the rounded value is better than silently cutting a different gap.
- **Spacer styles** (M1):
  - *Pucks*: washers threaded on the dowels. The default; cheapest in material.
  - *Rings*: following the frame ring, so they are light-tight for backlit pieces.
- Gaps that are not a multiple of the stock thickness are a warning. They need the printed comb frame (M6) or another stock thickness.

### 4.4 Registration
1. **Silhouette**: the shared outline.
2. **Dowels**:
   - Default: 3 holes for 3 mm dowels in an **asymmetric pattern** (uneven angles). A layer that is rotated or flipped will not fit, so the dowels fix orientation as well as position.
   - Holes are placed in the material shared by every layer that has them, away from edges by at least `dowel_edge_min_mm`.
   - By default the dowels are **blind to the front**: layers L2 to LN are drilled, and L1 registers by its silhouette on L2. An option drives them through L1 as visible design studs.
   - The hole diameter is the dowel diameter plus a clearance found with the test card.
3. **Engraved IDs**:
   - Layer number plus an orientation tick, scored in a single-line stroke font.
   - Placed on the top face of layer k in a spot **hidden by the material of layer k-1**. No layer needs flipping, and IDs never show.
   - L1 carries no ID: it is the only layer without one, and the dowel pattern fixes its orientation.
4. **Assembly sheet**: stack order, material, finish, gap and spacer count per layer, dowel length, glue notes, and the glue-on islands to place.

### 4.5 Islands
An island is any piece of material that would come loose when a layer is cut: lattice cell centres, letter counters, circuit pads. For each island, the policy is one of:

- **bridge** (default): the studio adds tie bridges to the body of the layer (section 6.5).
- **glue-on**: the island is cut as a separate part, and its outline is scored on the layer behind as a placement locator. This needs material behind it and gap 0. Otherwise it is a fatal check (G-03), because the part would float.
- **drop**: the island is deleted, and its hole stays open.

### 4.6 Lighting
- **Unlit**: the preview uses only the material colours, shadow and ambient light.
- **Backlit**: a light plane behind LN, or in any gap, shows through the openings. The back layer should be translucent acrylic or open. A backlit piece with an opaque, solid back layer gets a warning.
- **Addressable (M7)**: LED strips planned in the gaps, with pixel positions exported for Psyight.

---

## 5. Data model

The design is one JSON document, the single source of truth. Every output is a pure function of it (section 13.5).

```jsonc
{
  "app": "lamina", "schema": 1,
  "name": "Orb 01", "seed": 12345,
  "piece": {
    "outline": { "kind": "circle|rect|arch|polygon|custom",
                 "w_mm": 300, "h_mm": 300, "sides": 8, "corner_r_mm": 0,
                 "custom_svg": null },
    "symmetry": { "kind": "none|rot|dihedral|mirror_x|mirror_xy|tile",
                  "n": 8, "phase_deg": 0, "tile": null },
    "lighting": { "mode": "unlit|backlit|addressable", "colour": "#ff3b1f",
                  "led": null },
    "depth_mode": "per_layer|field",
    "field": null
  },
  "materials": { "ply3": { "...": "see 5.1" } },
  "machine": { "id": "epilog_fusion_pro_48", "bed_w_mm": 1219, "bed_h_mm": 914 },
  "sheet": { "w_mm": 600, "h_mm": 400, "margin_mm": 5, "spacing_mm": 3 },
  "registration": { "dowel_d_mm": 3, "count": 3, "through_front": false,
                    "ids": true },
  "spacers": { "style": "pucks|rings", "stock_material": "ply3" },
  "layers": [
    { "id": "L1", "material": "ply3", "thickness_mm": 3, "gap_mm": 0,
      "finish": { "kind": "paint|stain|natural", "colour": "#8a8f98" },
      "frame_ring_mm": 12,
      "locked": false,
      "source": { "kind": "primitive|svg|lattice|circuit|radial|image",
                  "motifs": [ { "type": "window", "r_mm": 80, "size_mm": 20, "sides": 4,
                                "rot_deg": 0, "mult": 1, "angle_deg": 0 } ] },
      "island_policy": "bridge", "bridge": { "w_mm": null, "max": 4 },
      "overrides": { "islands": {}, "bridges": [], "locks": [], "edits": [] } }
  ],
  "frame": null,
  "tiling": null,
  "check_overrides": []
}
```

- Units are mm in JSON, and integer micrometres inside the geometry core.
- `null` on a material-dependent value means "use the material preset".
- `overrides` hold the hand edits (cell paint, bridge moves, island policies). They are keyed by stable IDs (section 6.6), so a re-run of a generator keeps them where it can.
- The `schema` version is bumped with a migration function. Old files always open.

### 5.1 Material presets
These are starting values. The test card (section 9.4) replaces them with measured ones.

| id | Material | t (mm) | kerf (mm) | min web (mm) | min bridge (mm) | min hole (mm) | Notes |
|---|---|---|---|---|---|---|---|
| ply3 | Birch plywood | 3.0 | 0.20 `[Verify]` | 1.5 | 1.2 | 1.0 | Angel used 1.5 mm min feature |
| mdf3 | MDF | 3.0 | 0.20 `[Verify]` | 1.5 | 1.2 | 1.0 | Takes paint well |
| acr3 | Acrylic, opaque | 3.0 | 0.15 `[Verify]` | 2.0 | 1.5 | 1.0 | Brittle, so larger webs |
| acr3t | Acrylic, translucent | 3.0 | 0.15 `[Verify]` | 2.0 | 1.5 | 1.0 | Diffuser or back layer for backlight |

Presets also carry a preview look (base colour, grain or translucency, edge char colour) and a measured flag. A preset that has not been measured from a test card shows a gentle "unmeasured" chip in the status bar.

---

## 6. Geometry core and pipeline

### 6.1 Representation
- Polygons are Clipper2 `Paths64` in integer micrometres (1 mm = 1000). For a 1 m piece this is far inside JS safe-integer range.
- Curves (arcs, circles, Bézier) are flattened at a chord tolerance of 0.02 mm, the value Angel used.
- Raster data (image inputs, depth fields, and some checks) is traced back to vectors with marching squares plus RDP simplification. These are ported from coaxial's `traceBinary` and `rdp`.

### 6.2 Per-layer pipeline
Each stage is a pure function, so stages cache by input hash and only dirty stages re-run.

1. **Source**: the primitive, SVG import or generator yields *openings*, the regions to remove.
2. **Symmetry**: replicate the fundamental domain by rotation, mirroring or tiling. This happens before the boolean union, so copies are exact.
3. **Compose**:
   - `layer = outline − (openings ∩ inner_region)`, where `inner_region` is the outline inset by `frame_ring_mm`.
   - Crumb removal: contours under 0.05 mm² are dropped. There is no blanket open/close. Measured on the Orb preset, it took 288 of 300 ms per build and changed the area by 2 mm² in 464,000 mm². Thin webs are left for the W-01/G-02 checks, which compute that morphology once anyway.
4. **Islands**: find connected components. The body is the component touching the frame ring, or else the largest. Every other component is an island, with a stable ID.
5. **Islands policy**: synthesise bridges (6.5), split into a glue-on part plus a locator, or drop.
6. **Registration**: dowel holes, then engraved IDs (computed across the whole stack, 6.4).
7. **Checks** (section 7).
8. **Kerf**: offset the cut paths outward by kerf/2. This grows outer boundaries and shrinks holes. Score and engrave paths are not offset.
9. **Emit**: cut paths ordered inner contours first, then outer. Score paths and engrave strokes go on their own operations.

### 6.3 Stack-level stages
- **Visible and hidden regions**: for layer k, `hidden_k = material_k ∩ union(material_1..k-1)`. Hidden regions are where IDs, dowels and spacer contact can go without being seen.
- **Dowel placement**:
  - Candidates come from the intersection of the material of every drilled layer, inset by the dowel radius plus `dowel_edge_min_mm`.
  - Choose `count` points that maximise the minimum spread. Then perturb their angles to break symmetry, with a minimum angular asymmetry of 10 degrees.
  - Deterministic: seeded by the piece seed.
- **Spacers**: generated from the dowel positions (pucks) or from the frame ring (rings) for each non-zero gap. The count per gap is `gap_mm / stock_t`.

### 6.4 Engraved IDs
- A minimal built-in single-stroke font: digits, "L" and an arrow, defined in-repo with no licence baggage.
- Placed at the largest hidden spot of each layer.
- About 4 mm cap height, scaled down to 2.5 mm if space is short. A warning fires if it doesn't fit.

### 6.5 Bridge synthesis
For each island to be bridged:
- Candidate bridges are short straight ties along the shortest gaps between the island and the body: closest-point pairs along both boundaries, sampled.
- Score each tie for shortness, for straightness against the local motif direction, and for distance from other ties.
- Pick at least 1 tie. Pick 2 if the island's area is above `bridge_two_area_mm2`, and up to `bridge.max`. Spread them by at least 60 degrees around the island's centroid.
- Bridge width defaults to the material's min bridge.
- A bridge longer than `bridge_len_warn_mm` (default 15 mm) is a warning, because long, thin ties are fragile.
- Bridges are part of the design. They render in the preview and can be moved, deleted or added per island (M1 click-to-toggle; M2 drag).

### 6.6 Stable IDs for edits
An island or cell is identified by a hash of its centroid rounded to 0.5 mm, its area bucket and its layer. Edits refer to these IDs. If a generator change makes an edit's ID disappear, the edit is kept but shown as "orphaned" in the layer panel instead of being silently lost.

### 6.7 Depth field mode (M2)
One scalar field `f(x, y)` in [0, 1] drives every layer. The field can come from fieldform-style modes, a lattice distance field, an image or depth map, or a blend.

Layer k (1 = front) keeps material where `f < level_k`. The levels rise from front to back, so the front is most open and the back most solid, and the stack nests by construction. The fields are rasterised at `field_res_mm` (default 0.25 mm) and traced.

---

## 7. Checks

Every check has an ID, a severity, a rule and a default threshold. Results show as a red overlay on the offending geometry, plus a row in the report. The status light shows green (pass), amber (warnings) or red (fatal).

**Fatal** checks block export. Each one can be overridden individually with a confirm. An override is recorded in `check_overrides` and printed on the assembly sheet.

| ID | Severity | Rule |
|---|---|---|
| G-01 | Fatal | Unbridged island under the `bridge` policy: synthesis failed, so a part would fall out |
| G-02 | Fatal | A web narrower than the kerf: the cut would sever it |
| G-03 | Fatal | Glue-on island with nothing behind it (layer k+1 material covers under 60% of it) or a gap above 0 |
| G-04 | Fatal | The layer splits into several bodies |
| G-05 | Fatal | Part larger than the sheet, without tiling enabled |
| W-01 | Warning | Web below the material min web, found by morphological opening as in tenebrae |
| W-02 | Warning | Hole below min hole |
| W-03 | Warning | Bridge below min bridge, or longer than `bridge_len_warn_mm` |
| W-04 | Warning | Gap not a multiple of the spacer stock thickness |
| W-05 | Warning | Not enough hidden area for dowels or IDs. Fewer dowels are placed, or the ID is skipped |
| W-06 | Warning | Backlit piece with an opaque, solid back layer |
| W-07 | Warning | Front layer frame ring is 0 and the connectivity margin is thin |
| I-01 | Info | Per-layer and total cut length, sheet count, material area used |

Randomise with checks: Randomise tries up to 10 variations and keeps the first with no fatal checks, as tenebrae does. Warnings are allowed, because visual creativity comes first.

---

## 8. Sources and generators

### 8.1 M1: primitives and import
- **Primitives** ("openings"): each layer holds a list of motifs. Each motif is drawn once on the +x axis. "Copies per repeat" spreads copies across one symmetry wedge, and the symmetry engine fills the circle.
  - **Centre opening** (diameter). Not replicated.
  - **Windows**: a regular polygon, or a circle when sides is 0, at a radius, with size and turn. A scalloped border is windows on the inner edge of the frame ring.
  - **Petals**: a lens at a radius, with length and width.
  - **Arc slots**: an annular sector at a radius with width, keeping a tie between neighbours. A tie of 0 makes a full ring, which cuts an island free (the bridge stage ties it back).
  - **Rays**: a tapered spoke from an inner to an outer radius.
- **Generator** (Randomise, the seed arrows):
  - It picks a centre opening and 2 to 4 concentric bands, each with one motif type, and repeats them through the stack.
  - Openings shrink from front to back, alternate layers may turn half a step, and frame rings widen towards the back. The back layer stays solid.
  - Bands reach the far corners on rectangles and arches, clipped by the frame ring.
  - Output is island-free by construction (arc slots always keep a tie), and sizes are capped against neighbours so webs stay well above the minimum.
  - Locks keep the repeat count. "Keep this layer" leaves a layer untouched.
- **Presets**: Orb, Rose window, Acid gate, Hex lantern, Walnut sun. Each is an outline, symmetry, palette and generator seed, with the seed chosen from a rendered sweep.
- **SVG import**:
  - Per layer, or one multi-layer file split by top-level group or layer.
  - Handles `viewBox` and `width`/`height` in px, pt or mm. Px is assumed to be 96 DPI unless overridden; an Illustrator export is 72 DPI, `[Verify]` by importing the purchased 7-layer mandala, which should come out about 291 mm.
  - Handles even-odd and non-zero fill rules.
  - An imported layer is taken as material, not as openings. It is then clipped to the outline and goes through the same island, bridge and check pipeline.

### 8.2 M2: lattice and key-fret
- **Grids**: square, square plus 45 degrees, polar (rings by sectors, with the sector count rising with radius to keep cells near-square).
- **Generators**:
  - *Meander and key-fret*: a single-stroke path grammar on the grid, with Greek key and T-fret variants. A grammar rule stops interlocking hooks forming swastika shapes by default. That motif is common in traditional key-fret but easily misread, and an advanced toggle allows it.
  - *Window lattice*: Chinese-style cracked-ice and stepped lattices, built as a maze or spanning tree on the cell graph, which is connected by construction.
  - *Bands*: concentric polar bands, each with its own motif, as on the orb's outer rings.
- **Stroke to material**: grid strokes become material with a width; this is coaxial's `ribbonize`, generalised to Clipper offsets.
- **Editor**:
  - Cell paint and erase on the grid, mirrored live through the symmetry.
  - Region lock: freeze cells while re-rolling the seed.
  - Region mask: limit where a generator may draw.

### 8.3 M3: circuit and pipe routing
- Traces on square plus 45-degree routing with parallel offset strands, rounded joins, and terminals (drop, bulb, ring pad, via dot).
- Mirror symmetry is the default.
- Routing uses a seeded grid router that avoids collisions and keeps trace spacing at or above min web.

### 8.4 M4: radial mandala
- Petals, arcs, rosettes, scroll and ruyi cloud motifs as parametric curves in n-fold symmetry, layered as rings.
- Vector node editing of these curves: move nodes and handles, add or delete nodes. The edits are stored as overrides.

### 8.5 M5: image to layers, and text
- **Tone bands**: posterise into N bands, one layer per band, with smoothing and min-feature filtering, then the usual pipeline.
- **Depth map import**: a greyscale depth image feeds the field mode (6.7).
- **In-browser depth AI**: Depth Anything V2 Small through Transformers.js, loaded only on first use. It needs internet once, then the browser cache.
- **Engrave back plate**: Angel's `prep_portrait.py` recipe in the browser:
  - Contrast via CLAHE or a simpler local contrast.
  - Gamma 1/1.55 for dot gain.
  - A mask to the window of the layer in front, plus 2 mm.
  - Error-diffusion dither, at 600 DPI by default.

  It also exports a grey-ramp test strip.
- **Text**:
  - A stencil text tool using OFL fonts through opentype.js, with automatic counter bridges.
  - Logo SVG import, placed on a layer, with bridges added to its counters.

---

## 9. Exports

### 9.1 Cut files
- **SVG**:
  - `width`/`height` in mm, with a `viewBox` in mm.
  - Strokes use pure RGB primaries, because the Epilog driver's colour mapping works on vector artwork in RGB: cut `#FF0000`, score `#0000FF`, engrave (vector marking, for IDs) `#00FF00`.
  - No guide geometry in cut files. Epilog vectors every colour it is sent, mapped or not `[Verify]`, so guides live only in previews and the assembly sheet. The writers reject unknown layers.
  - Stroke width 0.025 mm (about 0.001 in), so the driver treats every line as a hairline vector. `[Verify the threshold on the lab's Job Manager setup]`
  - Vector paths have no fill.
- **DXF R12** (AC1009):
  - Header `$INSUNITS` 4 (mm) and `$MEASUREMENT` 1. The DXFs already proven at the lab (AngelShadowBox, written by ezdxf as AC1024) carry the same two values. R12 keeps the writer small, with no handles to get wrong.
  - A `LAYER` table and `POLYLINE`/`VERTEX` entities in mm: closed for cuts, open for score lines and engraved text strokes.
  - Layers `CUT` (colour 1), `SCORE` (5) and `ENGRAVE` (3). The test card's score ramp adds `RAMP_1` to `RAMP_5`, using ACI colours 5, 4, 6, 2 and 30, which are RGB blue, cyan, magenta, yellow and orange.
  - No splines and no bulges: everything is flattened.
- **Order**: within each part, inner contours first, then the outline.
- **Lab workflow** (Adobe Illustrator printing to Epilog Job Manager):
  - Open or place the file in an **RGB** document. A CMYK document shifts the pure colours, and colour mapping then misses them.
  - Import DXF at original size in millimetres.
  - The test card has a built-in scale check (9.4), so a wrong import scale is caught before any real piece is cut. `[Verify SVG import in Illustrator: DXF is proven, SVG is untried]`

### 9.2 Sheets and zip
- Parts are packed onto sheets (`sheet.w_mm` by `sheet.h_mm`, margin and spacing) with a bounding-box skyline packer.
  - Rotation by 0 or 90 degrees is allowed.
  - Parts are sorted by area, descending.
  - Small parts (pucks, glue-on islands) may sit inside the bounding box of a larger part's central hole only if they clear its geometry. This is a simple fit test, not nesting.
- The zip is written by an in-repo store-only writer with fixed timestamps, so it is deterministic:

```
lamina_<name>/
  design.json
  checks.txt
  assembly.html
  preview.png                         (the 3D view, when available)
  sheets/sheet_01_ply3.svg  .dxf ...  (numbered per material)
  layers/L01.svg  L01.dxf ...
  parts/gap03_puck_x6.svg  L02_glue_01.svg ...
```

### 9.3 Assembly sheet
`assembly.html` is a printable page; the browser saves it as PDF. It includes:
- An exploded diagram and the stack table: layer, material, thickness, finish swatch, gap, and the spacers for that gap.
- Dowel length: the sum of the drilled stack plus gaps.
- The glue-on islands with their target layer.
- Check overrides, and the cut length per sheet.

### 9.4 Calibration test card
One small cut, 150 x 100 mm, which fits every lab sheet. Everything is cut **without kerf compensation**, and engraved labels name each feature. Files: `test_card.svg`, `test_card.dxf` and `test_card_instructions.txt`, in one zip. The engraved title says which format the card was cut from.

- **Kerf and scale**:
  - A 20.00 mm square is cut free as a part P, which leaves a square hole H. Measure both with calipers.
  - Kerf = (H − P) / 2.
  - Scale check: (H + P) / 2 must be 20.00 ± 0.05 mm. If it isn't, the import scale is wrong: stop and fix the import before trusting anything else. The 150.00 mm card width is a second check.
- **Web ladder**: webs of 0.6, 0.8, 1.0, 1.2, 1.5, 2.0 and 2.5 mm between 4 mm slots, each 14 mm long. Physical web = nominal − kerf.
- **Bridge ladder**: 5 x 5 mm islands in 9 x 9 mm windows, each held by two bridges of 0.6, 0.8, 1.0, 1.2, 1.5 or 2.0 mm. Note which survive cutting and which snap off cleanly by hand.
- **Hole ladder**: 0.5, 0.8, 1.0, 1.5, 2.0 and 3.0 mm. Physical hole = nominal + kerf.
- **Dowel fit**: for 3 mm dowels, holes of 2.90 to 3.20 mm in 0.05 mm steps.
- **Fit notches**: six edge notches of 10.00 mm plus 0, 0.05, 0.10, 0.15, 0.20 and 0.25 mm, and a separate 10.00 mm key. Slide the key into each notch in the sheet's plane. Uncompensated gap = clearance + 2 x kerf. This sets tab and puzzle-joint clearances (M6).
- **Score ramp**: five lines on `RAMP_1` to `RAMP_5`, coloured blue, cyan, magenta, yellow and orange. Map each colour to a different power in Job Manager, and see which marks cleanly without cutting through. The green labels show the engrave setting.

M1 adds a "Calibrate" panel. You enter the measurements there, and it converts them to physical values (kerf, minimum web, minimum bridge, minimum hole, dowel hole, fit clearance) and saves a measured material preset.

### 9.5 Other outputs
- Design JSON save and load.
- PNG of the current preview.
- `checks.txt`.
- **M6**: WebM video of a tilt loop through `MediaRecorder`; frame STL; puzzle-tiled sheets.
- **M7**: LED layout JSON for Psyight.

---

## 10. Preview

- **3D** (three.js):
  - Each layer is extruded at its real thickness and gap, using the material look: plywood grain with a char edge, MDF, acrylic tint with translucency, or paint.
  - Orbit and tilt.
  - Backlit mode adds an emissive plane, with a glow pass through the openings.
  - An exploded slider separates the layers along Z.
- **2D stacked render** (canvas): a flat composite with drop shadows and material tints, in the style of Angel's `preview_stack.png`. It is the fast fallback for very dense pieces.
- **Layer view**: one layer, flat, with the check overlay, islands, bridges and hidden regions shown. This is where clicking on islands and bridges happens.
- **Sheets view**: the packed sheets as they will be exported.

## 11. UI and UX

- **Layout**:
  - A header with the name, presets, seed (←, →, ↻), randomise, undo/redo, open/save, Export and Help.
  - A left sidebar of steps in decision order: Piece, Material and colour, Layers, Pattern, Structure (islands, bridges, dowels, spacers), Light, Make (sheet, checks, export).
  - A main viewport with tabs 3D, 2D, Layer and Sheets.
  - A status bar with the check light, chips and cut length.
- **Parameter registry**:
  - Every control is declared once in a `SCHEMA` entry: `{id, scope, label, type, min, max, step, unit, default, tier: basic|advanced, randomisable, lockable, show_if, desc}`.
  - Controls are generated from it, following coaxial's `SCHEMA` and `buildControl`.
  - Presets and the design JSON serialise by id.
- **Basic and Advanced**: Basic shows about 15 controls. Advanced shows everything.
- **Randomise**:
  - Seeded and lock-aware, with checks as in section 7.
  - An undo history of 80 steps, as in fieldform.
- **Onboarding** (M6): a spotlight tour (`TUT_STEPS` from fieldform and coaxial), a tutorial page, preset thumbnails, and a "make your first piece" path.
- **Theme**:
  - Psy neon dark is the default, with a light toggle saved in localStorage.
  - Tokens on `:root`: deep purple-black background, violet panels, acid-green primary accent, orange-red secondary, cool blue info. Final values are set in M1.
- **Text**: sentence case labels, British English, units in every label.

## 12. Licensing and assets

- The repo is MIT, copyright knnurl.
- Dependencies must be MIT, BSD, ISC, Apache-2.0, BSL-1.0, zlib or OFL (fonts only). Ask before adding anything else.
- **Never commit** reference screenshots (`refs/`, third-party art and festival branding), purchased designs, or photos of people. These stay in the gitignored `refs/` and `data/`.
- CI uses synthetic fixtures only. Tests that need private fixtures skip when the files are absent.

---

## 13. Architecture

### 13.1 Repository layout
```
CLAUDE.md  LICENSE  README.md (M6)  index.html (built, committed)
docs/SPEC.md
src/
  main.js              app wiring
  core/                rng (mulberry32, hash), schema, store + undo, migrate, result
  geom/                clipper wrapper, flatten, offset, booleans, raster trace, rdp
  pipeline/            compose, islands, bridges, registration, spacers, kerf, checks
  sources/             primitives, svg_import  (M2+: lattice, circuit, radial, image)
  export/              svg, dxf_r12, zip_store, pack, assembly, test_card
  preview/             three_stack, render2d, layer_view, sheets_view
  ui/                  sidebar, controls, header, status, tour, theme.css
  worker/              geometry worker entry and its UI-thread client
  dev/                 M0 boot self-test stack (removed in M1)
  vendor/              clipper2-ts, three (pinned, with licence files)
tools/build.js         bundles src/ into one index.html
tools/shot.js          headless browser check: status, console errors, screenshot
tests/                 node:test suites + synthetic fixtures
.github/workflows/pages.yml
refs/  data/           gitignored
```

### 13.2 Build
- `tools/build.js` is a small scope-hoisting bundler. It walks the ES-module graph from an entry and wraps each module in its own function scope:
  - `import { a, b as c } from './x.js'` becomes `const { a, b: c } = __mN;`.
  - Each module returns its exports as an object.
  - The result is a classic script that runs from `file://`, inside a Blob worker and in Node's `vm`.
- It builds two graphs, `src/main.js` (the app) and `src/worker/geometry_worker.js` (the worker), and inlines both, plus `src/ui/theme.css`, into `src/template.html`.
- **Supported syntax** (anything else is a build error, never a silent miscompile):
  - static imports: named, namespace, default and side-effect;
  - `export` declarations and lists;
  - `export * [as ns] from`;
  - a trailing minified `export{...}` list.
- **Not supported**: circular imports, `import.meta`, and multi-declarator `export const`.
- **Validation**: every bundle is syntax-checked with `vm.Script`, and the build refuses leftover `import` or `export` statements, `<!--` and unescaped `</script`.
- The build reason: tenebrae concatenates classic scripts, but Lamina's module count, Node ESM tests and worker need real module scoping.
- `node tools/build.js --check` exits 1 if `index.html` is stale. CI runs it.
- `package.json` exists only for `"type": "module"` and scripts. It has no dependencies.
- `.gitattributes` forces LF. The owner's Git has `core.autocrlf=true`, and CRLF would break a byte-identical build.
- Vendor code is checked in under `src/vendor/` at pinned versions, with a `README.md` listing sources and local patches.
- `index.html` must work from `file://` with no network, except for the lazily loaded M5 depth model and optional web fonts, which fall back to system fonts.

### 13.3 Worker
The geometry pipeline runs in a Web Worker created from an inlined Blob URL, which works under `file://`. The UI thread only renders and edits. Messages carry the design JSON and the dirty-stage set, and return geometry plus check results.

### 13.4 Tests and CI
- `node --test "tests/*.test.js"` runs unit tests on the geometry, pipeline, exports and determinism.
- CI (`pages.yml`): install nothing, run the tests, run the build, fail if `index.html` differs from the committed copy, then deploy Pages.

### 13.5 Determinism
- All randomness comes from `mulberry32`, seeded by a hash of (piece seed, layer id, generator id).
- Geometry is integer, and nothing outputs a date or time.
- The same design JSON gives a byte-identical zip within one JS engine; a test enforces this.
- Cross-engine identity is not guaranteed, because `Math.sin` and the like may differ in the last bit between engines. The rounding to micrometres should hide this, but it is `[Verify]`.

### 13.6 Performance targets (to be measured, not assumed)
| Case | Target |
|---|---|
| Slider change to preview, 12 layers, 300 mm, primitives | under 150 ms |
| Slider change to preview, 12 layers, dense lattice (M2) | under 400 ms |
| Full checks and export, 20 layers, 600 mm | under 5 s |
| 3D preview frame rate, 20 layers | at least 30 fps on the owner's laptop |

Measure with a `tools/bench.js` script on synthetic designs, and record the results in `docs/PERF.md` with the command that reproduces them.

---

## 14. Dependencies

| Package | Use | Licence | Milestone | Notes |
|---|---|---|---|---|
| clipper2-ts (countertype) 2.0.1-18 | Booleans, offsets | BSL-1.0 | M0 | `dist/clipper2.min.mjs`, 125 KB, one file. It passes 194 of 195 of the C# reference tests; the one failure also fails in C#. JS numbers, so coordinates must stay within 2^53 |
| three.js 0.186.1 | 3D preview | MIT | M0 | `three.core.js` + `three.module.js` + `OrbitControls.js`, unminified, about 2.2 MB. OrbitControls' `'three'` import is patched to a relative path |
| opentype.js | Text glyph outlines | MIT | M5 | |
| OFL fonts | Stencil text | OFL-1.1 | M5 | Bundled with the font licence |
| Transformers.js (`@huggingface/transformers`) | Depth AI runtime | Apache-2.0 | M5 | Loaded on demand from a CDN |
| Depth Anything V2 Small (`onnx-community/depth-anything-v2-small`) | Depth model | Apache-2.0 | M5 | Base, Large and Giant are CC-BY-NC: never use them |

The zip writer, DXF writer, SVG writer, stroke font, packer and marching squares are written in-repo.

---

## 15. Milestones

### M0: scaffold
Done when:
- [x] The repo has `src/`, `tools/build.js`, `tests/`, `pages.yml`, `LICENSE`, `CLAUDE.md`, `.gitignore`.
- [x] `node tools/build.js` produces `index.html`, which opens from `file://` and shows the themed empty shell. Checked with `node tools/shot.js` in headless Edge, dark and light, with no console errors. The shell also renders a 6-layer boot stack, built by Clipper2 in the worker and drawn by three.js, to prove the whole chain.
- [x] `node --test "tests/*.test.js"` runs: 17 tests covering the bundler, the built page, the worker bundle and the geometry core. CI fails on a stale `index.html` (`node tools/build.js --check`).
- [x] clipper2-ts and three.js are vendored at pinned versions with their licence files (`src/vendor/README.md`). Tests exercise a Clipper union, the kerf offset (10 mm square to 10.2 mm, 10 mm hole to 9.8 mm) and circle flattening.

### M1: layer engine
Done when:
- [ ] The data model (section 5) is complete, with schema migration and design JSON save and load.
- [ ] Outlines work: circle, rectangle, arch, regular polygon, custom SVG.
- [ ] Primitives work (8.1), with symmetry: none, rotational, dihedral, mirror X, mirror X+Y.
- [ ] SVG import is unit-correct. The purchased 7-layer mandala (a local fixture) imports at about 291 mm with its layers in order.
- [ ] The full per-layer and stack pipeline runs (6.2, 6.3): frame ring, islands, bridges, the glue-on and drop policies, kerf, dowels, IDs, spacers (pucks and rings).
- [ ] Every check in section 7 for M1 scope works, with the overlay, report, status light and the override flow.
- [ ] Previews work: 3D (orbit, tilt, exploded, unlit and backlit), 2D stacked, Layer view (click an island to cycle its policy), Sheets view.
- [ ] Exports work: per-layer and per-sheet SVG and DXF R12, the zip, the assembly sheet, the test card, PNG and `checks.txt`.
- [ ] The UI is generated from `SCHEMA`, with Basic and Advanced, presets (at least 5 primitive demos), seed, lock, randomise with checks, 80-step undo, and the theme.
- [ ] The tests in section 16 pass, including the determinism test.
- [ ] Performance targets for M1 are measured and recorded in `docs/PERF.md`.
- [ ] Physical proof: the test card is cut on the lab laser and its measurements are entered. A 4-layer, 120 mm primitive piece is cut and assembled, with bridges, dowels, IDs and spacers all working.

**Progress** (M1 is built in slices, the test card first):
- 2026-11-06, slice 1 done: the calibration test card (9.4) downloads from the Make step as a zip of SVG, DXF and instructions.
  - New code: the SVG and DXF R12 writers, the store-only zip, and the single-stroke font.
  - Checked independently with ezdxf 1.4.5: AC1009, 0 audit errors, `$INSUNITS` 4, cut extents exactly 150.000 x 100.000 mm. Python `zipfile` finds valid CRCs.
  - The zip the browser downloads is byte-identical to the one Node builds.
  - **TODO (owner):** cut the test card at the lab and record the measurements listed in its instructions. Until then, material presets stay unmeasured and the Calibrate panel (slice 8) is built against the formulas in 9.4.
- 2026-11-06, slices 2 and 3 done: the design model and UI, and the primitive pipeline driving the 3D preview.
  - Model: design model with migration, parameter registry (`src/core/schema.js`) and an undo store (80 steps; a slider drag is one step).
  - UI: generated panels, presets, seed stepping, Randomise with locks, Basic/Advanced, open/save `.lamina.json`, and autosave to browser storage.
  - Geometry: outlines (circle, rectangle, polygon, arch), symmetry (none, rotate, kaleidoscope, mirror, mirror both ways), five motif types, the generator and five presets.
  - Measured with `node gallery`-style sweeps: 30 seed variants build in 33 ms on average in Node. In the browser the Orb preset builds in 31 to 94 ms in the worker.
  - Driven in headless Edge with `tools/shot.js --eval`:
    - seed stepping, then a three-step slider drag undone in one step;
    - layer count to 12;
    - adding an opening to layer 3.
  - The M0 boot demo is gone.
- 2026-11-06, slice 4 done: islands, bridges, island policies and checks.
  - **Islands:** found as material components, with stable IDs. Each bridges to the boundary of the opening that encloses it, so nested rings chain to the body.
  - **Bridges:** scored by length, rejected if they cross another island, spread at least 60 degrees apart. One, two or three per island depending on its area.
  - **Policies:** glue-on islands become separate parts with a scored locator on the layer behind; drop deletes the island.
  - **Checks:**
    - G-01 to G-04, W-01 to W-04, W-06 and W-07 are implemented.
    - Fast checks run with every build. Morphological checks run in the worker after edits pause (350 ms), on a cached build.
    - Measured: slow checks take 11 to 72 ms per preset.
    - Thin-web detection uses miter joins with limit 20, plus a 10 um re-opening to drop rounding slivers.
    - Bridge zones are excluded from W-01, because bridges are meant to be thinner than webs.
    - Verified exact on synthetic webs: 1.0 mm gives W-01 with a 1.00 x 20.00 box; 0.1 mm gives G-02.
    - No preset has a fatal finding.
  - **UI:** the Layer tab is a 2D inspector (click an island to cycle bridge, glue, drop; wheel zoom, drag pan). The Make step shows the check report with Show and Allow. The Structure step holds island policy, bridge width and the bridge cap.
  - **Found and fixed:**
    - Tie-0 arc slots left micron cracks that became hairline spikes, so sectors now overlap by 5 um.
    - three.js's inline `display` beat `[hidden]`.
    - The app bundle had started pulling in Clipper2, now caught by a test.
- 2026-11-06, slice 5 done: registration and spacers.
  - **Dowels:**
    - Placed in the material all layers share, inset by the hole radius plus a 3.5 mm edge, so the holes are hidden behind the undrilled front.
    - Angles follow fixed patterns whose gaps all differ by at least 5 degrees (3 dowels: 90, 207.7, 342.3), so no rotation or flip of a layer fits.
    - Each dowel is centred on the outermost run of shared material along its ray. The hole is the dowel plus 0.1 mm until the Calibrate panel measures it.
  - **IDs:** "L<n> ^" at 4 mm cap height (falling back to 2.5 mm), in material hidden by the layer in front and clear of the dowels. The search runs first in a bottom band, rect-clipped with Clipper2's RectClip, which cut ID placement from about 47 ms to under 5 ms on the Orb.
  - **Spacers:** gap / stock sheets of pucks on the dowels, or rings inside both frame rings. W-05 covers no room for dowels or an ID, and frame rings too narrow for spacer rings.
  - **Measured:** full builds with registration take 15 to 34 ms per preset in Node (best of 3).
- 2026-11-06, slice 6 done (brought ahead of previews, because export is what the lab needs): packing, export zip and the assembly sheet.
  - **Kerf:** cut paths are the design offset by +kerf/2 with round joins. A 290 mm layer cuts at 290.2 mm, and holes shrink by the kerf; both are tested.
  - **Packing:** skyline bottom-left, rotation 0 or 90 degrees, largest first, first fit across open sheets, one sheet set per material. Small parts fill earlier sheets' spare strips.
  - **Zip:** sheets, per-layer and per-part SVG and DXF, design.json, checks.txt, assembly.html, and preview.png from the 3D view.
    - Byte-identical for the same design when no PNG is included.
    - The Orb exports in 61 ms (1.76 MB, 29 files).
    - All 13 of the Orb's DXFs audit clean with ezdxf 1.4.5 (AC1009, mm).
  - **Export rules:** an un-allowed fatal finding blocks export, and the worker re-runs every check before writing. G-05 (part larger than the sheet inside its margin) is a fast check.
  - **Assembly sheet:** summary cards, the stack table, build steps, layer thumbnails and findings, in a light print theme, with the design name escaped.
  - Clicked in headless Edge: the zip downloads with a real 3D snapshot.
- 2026-11-06, slice 5 done: previews.
  - **3D:** faces in the finish colour; charred edges on ply and MDF, darker edges on acrylic; translucent acrylic drawn see-through.
  - **Backlit:** a glow panel cut to the back layer's silhouette, translucent layers lit in the light colour, and the room light dimmed.
  - **Exploded:** a slider over the 3D view spreads the layers by up to 28 mm each.
  - **2D tab:** a stacked render with drop shadows, plus a glow when backlit.
  - **Sheets tab:** the packed sheets exactly as exported, through the same  the export uses, laid out only while the tab is open.
- Next slices:
  7. SVG import.
  8. Calibrate panel.
  9. Performance and golden designs.

### M2: lattice
Square, 45-degree and polar grids. Meander, key-fret, window lattice and band generators. Field-sliced depth mode. Cell paint and erase with live symmetry, region lock and mask, and bridge drag. Done when an orb-style piece of about 12 layers can be made in Basic mode from a preset and passes the checks. A physical cut is recommended.

### M3: circuit
The grid router, parallel strands, terminals and rect-panel presets. Done when a MO:DEM-style panel can be made and passes the checks.

### M4: radial mandala
Curve motifs in rings, and vector node editing.

### M5: image and text
Tone bands, depth map import, depth AI, the dithered engrave back plate with its ramp strip, stencil text, and logo import. Done when an Angel-style shadow box can be rebuilt from a photo, end to end.

### M6: frames, scale, launch
- Finger-joint box generator and printed comb frame STL (geometry from `Layered_3D/layered/spacer.dxf`: 3.6 mm slots on a 6 mm pitch for 3 mm sheets).
- Puzzle-joint tiling with staggered seams.
- WebM export.
- The tour, tutorial page, preset gallery, a house-style README, and the public Pages launch.

### M7: Psyight
LED strip paths in the gaps, and a pixel layout export in Psyight's rig format `[Verify the format against Psyight's src/io]`.

---

## 16. Test plan

**Unit tests** (synthetic fixtures, run in CI):
- **Kerf**: a 10 mm square with 0.2 mm kerf gives a 10.2 mm outer cut. A 10 mm hole gives a 9.8 mm cut.
- **Islands**: a ring-with-centre fixture gives exactly one island. After bridging there is one connected body. Under glue-on there is one part plus one locator on layer k+1.
- **Web checks**: a 1.0 mm web is flagged W-01 at a 1.5 mm minimum and G-02 at a 1.2 mm kerf.
- **Dowels**: holes lie inside every drilled layer's hidden material, at least `dowel_edge_min_mm` from any edge. The pattern has no rotational or mirror symmetry.
- **IDs**: they lie entirely within `hidden_k`.
- **Spacers**: the count per gap is `gap/stock_t`, and W-04 fires on a remainder.
- **SVG**: dimensions in mm, colours per operation, inner contours before outer.
- **DXF**: R12 parses with an in-repo minimal reader, and the entity counts and bounds match.
- **Packing**: no overlaps, everything inside the margins, deterministic.
- **Import**: px, pt and mm sizes are handled, as are even-odd and non-zero fill.
- **Determinism**: the same design gives a byte-identical zip across two runs.

**Golden designs:** about 6 stored design JSONs with stored metrics (part count, island count, cut length, check results). Any change fails the test until the goldens are deliberately updated.

**Offline cross-check** (not in CI): `ezdxf` audit of the exported DXF files.

**Manual:** open the exports in Inkscape and in the lab's laser software, and check the sizes and operations.

**Physical:** the M1 test card and 4-layer piece; then a recommended cut at each generator milestone.

## 17. Assumptions to verify
1. The default kerf, min web and min hole values in 5.1. Replaced by test card measurements.
2. Mostly resolved 2026-11-06 (owner):
   - The lab prints from Adobe Illustrator to Epilog Job Manager.
   - DXF works well there; SVG is untried.
   - Stock sheets are 600 x 400, 400 x 300 and 300 x 300 mm.

   Still to verify with the first test card: SVG import scale in Illustrator, the hairline threshold, and the RGB colour mapping.
3. Resolved 2026-11-06: there is no job time limit, so the cut-time warning was dropped.
4. That the purchased mandala's SVG px are 72 DPI points (it should import at about 291 mm).
5. Resolved 2026-11-06: clipper2-ts 2.0.1-18 is BSL-1.0 (from its package metadata and LICENSE file).
6. Resolved 2026-11-06: tenebrae concatenates classic scripts. Lamina uses its own ES-module bundler instead (section 13.2).
7. Determinism across browser engines.
8. Psyight's pixel layout format, for M7.

## 18. Decision log
| Date | Decision | Why |
|---|---|---|
| 2026-11-06 | Scope, families, order, build model, geometry core, theme, name: see section 3 | Owner scoping interview |
| 2026-11-06 | IDs engraved on top faces in regions hidden by the layer in front; L1 unmarked | No flipping needed; IDs are never visible |
| 2026-11-06 | Asymmetric dowel pattern, blind to the front by default | Fixes orientation for every layer, including L1; keeps the front face clean |
| 2026-11-06 | Laser-cut spacers snap gaps to multiples of the stock thickness | Spacers come from the same sheets, and a visible snap beats a silently wrong gap |
| 2026-11-06 | DXF R12 with flattened polylines | The most compatible choice for an unknown lab machine |
| 2026-11-06 | clipper2-ts as the Clipper2 port | The most complete JS port found (194 of 195 reference tests) |
| 2026-11-06 | Depth Anything V2 Small only | The only Apache-2.0 size; the others are non-commercial |
| 2026-11-06 | Lab machine: Epilog Fusion Pro 48, 120 W CO2, bed 1219 x 914 mm | Owner. Default stock stays 600 x 400 mm; the bed only caps the sheet size |
| 2026-11-06 | Pure RGB primaries and hairline strokes in SVG | Epilog colour mapping works on RGB vector artwork |
| 2026-11-06 | Lab route is Illustrator to Job Manager; DXF R12 carries `$INSUNITS` 4 and `$MEASUREMENT` 1 | Owner: DXF works well at the lab; those are the unit values in the lab-proven Angel DXFs |
| 2026-11-06 | Default piece 290 mm; stock presets 600 x 400, 400 x 300, 300 x 300 | The lab's sheet sizes. 300 mm plus margins would not fit a 300 x 300 sheet |
| 2026-11-06 | Cut-time warning dropped | No job time limit at the lab |
| 2026-11-06 | M1 starts with the calibration test card | It is the first thing that can go to the lab, and its measurements feed every later check |
| 2026-11-06 | No blanket open/close cleanup in compose; crumbs under 0.05 mm² are dropped instead | Measured: 288 of 300 ms per build for a 2 mm² area change. Thin webs go to the checks |
| 2026-11-06 | M1 primitives are five motif types in a per-layer list, plus a seeded band generator | More creative range than one primitive per layer, and Randomise produces island-free, buildable stacks |
| 2026-11-06 | Default sheet margin 4 mm, not 5 | Kerf makes a 290 mm layer 290.2 mm; with 5 mm margins it would not fit the lab's 300 x 300 stock |
| 2026-11-06 | Export before preview polish in M1 | Buildability outranks interactivity, and export is what the lab needs |
| 2026-11-06 | Dowel angles from a fixed pattern with all-different gaps, not perturbed farthest-point picks | Deterministic, provably asymmetric for 3 or more dowels; two dowels can never stop a flip, and the control says so |
| 2026-11-06 | Registry entries use `panel` for the sidebar step | `step` is a slider's increment; the duplicate key silently hid every slider (caught in the browser, now tested) |
| 2026-11-06 | Own scope-hoisting ES-module bundler, not tenebrae's concatenation | Real module scope for a large codebase, the same files in Node tests, and a Blob worker under `file://` |
| 2026-11-06 | three.js 0.186.1, not the newest 0.187.0 | 0.187.0 was a week old; pin a release that has had time to settle |
