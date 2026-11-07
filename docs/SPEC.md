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
  "palette": "orb|...|custom", "palette_custom": null, "palette_spread": "blend|repeat",
  "piece": {
    "outline": { "kind": "circle|rect|arch|polygon|custom",
                 "w_mm": 300, "h_mm": 300, "sides": 8, "corner_r_mm": 0,
                 "custom_svg": null },
    "symmetry": { "kind": "none|rot|dihedral|mirror_x|mirror_xy|tile",
                  "n": 8, "phase_deg": 0, "tile": null },
    "lighting": { "mode": "unlit|backlit|addressable", "colour": "#ff3b1f",
                  "led": null },
    "depth_mode": "per_layer|field",
    "field": { "kind": "rings|chladni|interference|rose", "scale_mm": 24, "k": 8,
               "a": 0.6, "lo": 0.3, "hi": 1 }
  },
  "generator": { "style": "classic|lattice|circuit|mandala" },
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
                                "rot_deg": 0, "mult": 1, "angle_deg": 0 },
                              { "type": "shape", "r_mm": 70, "mult": 1, "angle_deg": 0,
                                "nodes": [ { "x": 20, "y": 0, "ix": 20, "iy": -6,
                                             "ox": 20, "oy": 6 } ] } ] },
      "island_policy": "bridge", "bridge": { "w_mm": null, "max": 4 },
      "overrides": { "islands": {}, "bridge_angles": {}, "locks": [], "edits": [] } }
  ],
  "frame": null,
  "tiling": null,
  "check_overrides": []
}
```

- Units are mm in JSON, and integer micrometres inside the geometry core.
- `null` on a material-dependent value means "use the material preset".
- `overrides` hold the hand edits, keyed by stable island IDs (section 6.6) so a re-run of a generator keeps them where it can: island policies, and dragged bridges as preferred angles in degrees from the island's centre (`bridge_angles`).
- Cell paint lives on the lattice motif itself (`cells`, keyed by grid cell ID), so it survives re-rolling the lattice's seed.
- `palette` names one of 18 palettes, or `custom` for the design's own colours in `palette_custom` (2 to 8, front to back). `palette_spread` blends the colours from the front layer to the back, or repeats them in turn. Choosing a palette sets every layer's finish colour; a layer's colour can then be changed on its own.
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
- **Connection (M2):** a minimum spanning tree over the body and the bridged islands. Each island offers its shortest ties to its three nearest neighbours (closest points on sampled boundaries, found through a spatial grid), and the shortest ties join pieces first (Kruskal).
  - A group still cut off from the body then takes its shortest tie to anything outside the group, until every piece reaches the body.
  - This replaces M1's tie to the enclosing opening's edge, which failed for islands packed among islands (thresholded fields: 96 unbridged on a Chladni layer).
- **Extra ties:** larger islands then get more ties to the edge of the opening around them. Pick 2 in total if the island's area is above `bridge_two_area_mm2`, 3 above 2500 mm², and up to `bridge.max`. Spread them by at least 60 degrees around the island's centroid; among near-equal spreads (within 1 degree) the shorter tie wins.
- **Dragged bridges:** an island with preferred angles ties to the edge of its opening at the candidate nearest each angle, instead of the above.
- Bridge width defaults to the material's min bridge.
- A bridge longer than `bridge_len_warn_mm` (default 15 mm) is a warning, because long, thin ties are fragile.
- Bridges are part of the design. They render in the preview and can be moved, deleted or added per island (M1 click-to-toggle; M2 drag).

### 6.6 Stable IDs for edits
An island or cell is identified by a hash of its centroid rounded to 0.5 mm, its box size rounded to 1 mm, its area bucket and its layer. The box size tells concentric rings apart, which share a centroid and can share an area bucket. An ID still shared gets a numbered suffix. Edits refer to these IDs. If a generator change makes an edit's ID disappear, the edit is kept but shown as "orphaned" in the layer panel instead of being silently lost.

### 6.7 Depth field mode (M2)
One scalar field `f(x, y)` in [0, 1] drives every layer. The field can come from fieldform-style modes, a lattice distance field, an image or depth map, or a blend.

Layer k (1 = front) keeps material where `f < level_k`. The levels rise from front to back, so the front is most open and the back most solid, and the stack nests by construction.
- The field is sampled once on a 0.75 mm grid, folded into the symmetry's fundamental domain, and cached. 0.5 mm measured 2.25 times slower, and linear interpolation keeps smooth fields accurate.
- Each layer is traced with marching squares and simplified at 0.03 mm. Outside the grid reads as above any level, so every contour closes.
- A morphological opening at half the minimum web removes the necks a field makes at its saddle points; the laser would sever them anyway (G-02).

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
- Routing uses a seeded grid router that avoids collisions. Trace spacing is at least the strand gap, which the generator keeps at or above the plywood min web (1.7 mm or more; acrylic's 2 mm can give W-01 warnings).

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

The Make step's "Enter the measurements" form (`src/core/calibrate.js`) turns the readings into physical values with the formulas above: kerf, minimum web, minimum bridge, minimum hole, dowel clearance and fit clearance. It refuses to save on a failed scale check, a swapped reading or an implausible kerf.

The measured material is stored in the design (`design.materials`, overriding the built-in preset of the same id) and in a per-browser library, which new designs inherit. A status-bar chip shows while any material in use is unmeasured. The measured values drive:
- the checks;
- the dowel hole (dowel plus the measured clearance);
- the export kerf.

The test card and the calculator share one set of ladders.

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
- **Layer visibility (3D and 2D, the view only):** an eye button on each strip thumbnail shows or hides that layer, a Peel slider hides the front layers one at a time, and "Show all" brings everything back. Checks, cut files, the export picture and the assistant's look always keep every layer. Opening another design shows every layer.
- **2D stacked render** (canvas): a flat composite with drop shadows and material tints, in the style of Angel's `preview_stack.png`. It is the fast fallback for very dense pieces.
- **Layer view**: one layer, flat, with the check overlay, islands, bridges and hidden regions shown. This is where clicking on islands and bridges happens.
- **Sheets view**: the packed sheets as they will be exported.

## 11. UI and UX

- **Layout (guided, 2026-11-07, owner's choice from clickable mockups):** one step on screen at a time, with no scrolling between steps.
  - A top bar with the name, a step bar, undo and redo, New, Open, Save and the theme toggle.
  - **Five steps** in decision order. Each has a one-line guide, Back and Next buttons, and opens the view it needs:
    - Piece: outline, size, layers and symmetry. Opens 3D.
    - Pattern: style, Randomise and seed, depth mode, and the selected layer's openings or artwork. Opens 3D.
    - Look: palette (swatches, the palette's colours to edit, add to, take from or reverse, and the spread), material, colour, gap and frame ring of the selected layer, and light. Opens 3D.
    - Structure: islands, bridges, dowels and spacers. Opens the Layer view.
    - Make: sheet, checks, export and calibration. Opens the Sheets view.
  - Any step can be clicked at any time; nothing is locked. The view tabs (3D, 2D, Layer, Sheets) stay available, and a step change resets them to that step's view.
  - **A layer strip** under the preview shows a thumbnail of every layer, front first. Clicking one selects it for every per-layer control.
    - **All layers switch:** while it is on, the per-layer controls (colour, material, gap, frame ring, island policy, bridges) and "Keep this layer" change every layer at once, as one undo step. Every thumbnail is marked and the heading reads "All layers". Openings stay per layer.
    - Each thumbnail's eye button shows or hides the layer in the preview (section 10).
  - A status bar with the check light, chips and cut length.
- **Start screen:** "What are you making?" with four kinds:
  - round wall piece;
  - framed shadow box (box frames arrive in M6);
  - festival panel;
  - from a photo (M5).
  - Each kind shows a gallery of matching presets, drawn from their real geometry, plus "Start blank".
  - Opening a preset goes to the Pattern step; starting blank goes to the Piece step.
  - It shows on the first visit and from New. A returning visitor opens straight into the last design.
  - A one-minute spotlight tour is offered on the start screen and once after the first piece opens.
- **Parameter registry**:
  - Every control is declared once in a `SCHEMA` entry: `{id, scope, label, type, min, max, step, unit, default, tier: basic|advanced, randomisable, lockable, show_if, desc}`.
  - Controls are generated from it, following coaxial's `SCHEMA` and `buildControl`.
  - Presets and the design JSON serialise by id.
- **More options (replaces Basic and Advanced):** each step shows its essential controls, and a "More options" fold holds the registry entries marked `tier: advanced`. Motif cards fold their own advanced parameters the same way. Nothing is hidden by a global mode.
- **Randomise**:
  - Seeded and lock-aware, with checks as in section 7.
  - An undo history of 80 steps, as in fieldform.
- **Onboarding:** the start screen and spotlight tour above (2026-11-07). M6 adds the tutorial page.
- **As built (2026-11-07):** driven in headless Edge.
  - A first visit opens on the start screen, with real thumbnails of all six round presets.
  - Opening the Mandala lands on step 2, Pattern, in 3D, with a 10-layer strip and the tour offer.
  - Next walks Piece, Pattern and Look (3D), Structure (Layer view) and Make (Sheets); Next is disabled on Make.
  - "More options" adds the advanced controls, and the Look panel follows the layer picked in the strip.
  - The tour lights each part in turn, with the panel's note beside it.
  - Slider latency in the browser: 37 ms median on the Orb (12 layers) and 199 ms on the Lattice orb, after the strip stopped rescanning every point each build (272 ms before).
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
| Transformers.js (`@huggingface/transformers`) 4.3.1 | Depth AI | Apache-2.0 | M5 | Pinned; loaded from jsDelivr on first use |
| Depth Anything V2 Small (`onnx-community/depth-anything-v2-small`) | Depth model | Apache-2.0 | M5 | |
| Depth Anything V2 Base and Large | Depth models, optional | CC-BY-NC-4.0 | M5 | Owner approved (2026-11-07). Downloaded on demand, never bundled; the picker labels them non-commercial |
| Anthropic TypeScript SDK (`@anthropic-ai/sdk`) 1.3.0 | The assistant on Claude models (optional) | Apache-2.0 | M4.5 | Loaded on first use from jsDelivr (`+esm`), pinned; with `dangerouslyAllowBrowser`, as each user brings their own key |
| Google Gen AI SDK (`@google/genai`) 2.31.0 | The assistant on Gemini models (default), and pictures | Apache-2.0 | M4.5 | Loaded on first use from jsDelivr, pinned; only with a Gemini key |

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
- [x] The data model (section 5) is complete, with schema migration and design JSON save and load.
- [x] Outlines work: circle, rectangle, arch, regular polygon, custom SVG.
- [x] Primitives work (8.1), with symmetry: none, rotational, dihedral, mirror X, mirror X+Y.
- [x] SVG import is unit-correct. The purchased 7-layer mandala (a local fixture) imports at about 291 mm with its layers in order.
- [x] The full per-layer and stack pipeline runs (6.2, 6.3): frame ring, islands, bridges, the glue-on and drop policies, kerf, dowels, IDs, spacers (pucks and rings).
- [x] Every check in section 7 for M1 scope works, with the overlay, report, status light and the override flow.
- [x] Previews work: 3D (orbit, tilt, exploded, unlit and backlit), 2D stacked, Layer view (click an island to cycle its policy), Sheets view.
- [x] Exports work: per-layer and per-sheet SVG and DXF R12, the zip, the assembly sheet, the test card, PNG and `checks.txt`.
- [x] The UI is generated from `SCHEMA`, with Basic and Advanced, presets (at least 5 primitive demos), seed, lock, randomise with checks, 80-step undo, and the theme.
- [x] The tests in section 16 pass, including the determinism test.
- [x] Performance targets for M1 are measured and recorded in `docs/PERF.md`. The 3D frame rate still needs the owner's GPU; headless Edge renders in software.
- [ ] **TODO (owner)** Physical proof: the test card is cut on the lab laser and its measurements are entered. A 4-layer, 120 mm primitive piece is cut and assembled, with bridges, dowels, IDs and spacers all working.

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
  - **Sheets tab:** the packed sheets exactly as exported, through the same `sheet_drawings` the export uses, laid out only while the tab is open.
- 2026-11-06, slice 7 done: SVG import, and stage caches.
  - **Reader:** pure JS (no DOMParser), so it runs in the worker and in Node tests. A small XML reader copes with Illustrator's DOCTYPE subset, comments and CDATA.
  - **Paths:** all commands, with arcs whose flags run together, are parsed and flattened at 0.02 mm *after* transforming to mm.
  - **Shapes and transforms:** rect (rounded too), circle, ellipse and polygon, under nested transforms. Open paths, lines and texts are counted and ignored.
  - **Units:** mm, cm, in, pt, pc and px. A px is 1/96 in, or 1/72 in in Illustrator files.
  - **Layering:**
    - Several files give one layer each, front first by natural name order.
    - One file with two or more top-level groups gives one layer per group, the last drawn in front.
    - One plain file goes onto the selected layer.
  - **Outline and holes:** the union silhouette becomes a custom outline. Holes follow even-odd by default (the cut-file convention), with non-zero as a per-layer choice.
  - **Purchased mandala (private fixture):** imports at 290.88 x 290.85 mm, which resolves assumption 4. Its contour counts match the files (62, 245, 425, 473, 393, 281, 1), and it builds with no islands and no fatal finding. Its ornate front leaves no shared material for dowels, which W-05 reports.
  - **Caches:** per-layer geometry, stack registration and per-layer slow checks are cached by their inputs. On the mandala, a colour or gap edit went from about 850 ms to 7 ms, with slow checks from 590 ms to 0. A cold build of heavy imported art is still about 0.85 s (1.9 s in headless Edge).
  - **Bundler fix:** the bundler took a line such as `import_svg,` for an import statement. Fixed, and covered by a test.
- 2026-11-06, slice 8 done: the Calibrate panel (9.4).
  - Formulas tested exactly: for a 0.18 mm kerf card, the minimum web, bridge and hole, dowel clearance and fit clearance all come out as expected.
  - A measured material changes the export kerf (a 290 mm layer cuts at 290.18 mm) and the dowel hole (3.23 mm).
  - Driven in headless Edge: P and H are entered, the results appear, the material is saved, and the "not measured" chip clears.
  - **Still TODO (owner):** the real measurements from the lab.
- 2026-11-06, slice 9 done: performance and golden designs.
  - `tools/bench.js` (geometry targets, exits 1 on a miss) and `tools/slider_latency.page.js` (browser latency). Results are in `docs/PERF.md`.
    - Slider change: 50 ms in Node, 92 ms end to end in the browser.
    - 20 layers at 600 mm through build, checks and export: about 0.33 s.
  - Golden designs: the 5 presets, a nested-islands design (bridge, glue, drop, spacers) and a synthetic two-file SVG import. Stored metrics are in `tests/golden/metrics.json`; regenerate with `node tools/golden.js --update` and review the diff. They match exactly on Node 24 and 26.
  - Randomise now keeps the first of up to 10 seeds whose variation has no fatal finding (worker-side, deterministic for a given seed).
- **M1 status:** every item except the physical proof is done. That proof waits on the owner's test card cut and a 4-layer test piece.

### M2: lattice
Square, 45-degree and polar grids. Meander, key-fret, window lattice and band generators. Field-sliced depth mode. Cell paint and erase with live symmetry, region lock and mask, and bridge drag.

Design decisions (2026-11-07):
- **Lattice motif:** a maze built in the symmetry's fundamental domain (the wedge for rotate and kaleidoscope, a half or quadrant for mirrors), on a square, 45-degree or polar grid, then replicated.
  - The maze's walls are the material bars, and openings are the cells.
  - A perfect maze's walls all reach the boundary, so a lattice has no islands by construction.
  - "Openness" removes only dead-end walls, which cannot disconnect any other wall.
  - Polar sector counts are multiples of the symmetry order, so the wedge edges fall on cell edges.
- **Fret motif:** a ring band of interlocking hook tiles (Greek key, double key, T-fret), with every hook attached to the band's edge bars.
- **Cell paint:** clicking a lattice cell in the Layer view toggles it solid.
  - Clicks are mapped back into the fundamental domain, so painting is mirrored live.
  - Paint is keyed by grid cell, so it survives re-rolling the lattice's seed. This is the region lock.
  - The band limits (inner and outer radius) are the mask.
- **Generator styles:** `design.generator.style` is classic (the M1 behaviour, unchanged, so existing presets keep their output), lattice, circuit (M3) or mandala (M4). Randomise follows the design's style.
- **Field mode:** a layer source `field` takes the material where a shared scalar field is below the layer's level. Levels rise towards the back, and the frame ring is kept.
  - Fields: rings, Chladni, two-centre interference and a polar rose, folded by the piece's symmetry.
  - The field is sampled at 0.75 mm and traced with marching squares (6.7). Islands go through the usual bridges, joined by the spanning tree (6.5).
- **Domain edges:** polar sectors start at the domain's first edge, so a mirror's half-plane (from -90 degrees) falls on cell edges. Square and 45-degree cells straddle a wedge's edges, so their region is clipped to the exact wedge and each wedge edge becomes a bar, which the next wedge's copy meets edge to edge.
- **Bridge drag:** dragging a bridge in the Layer view sets a preferred angle for that island's bridge, stored with the layer's overrides.

Done when:
- [x] The lattice and fret motifs work on all three grids under every symmetry, with no islands, and are editable in the Pattern step.
- [x] Cell paint works in the Layer view with live symmetry, and paint survives a re-roll.
- [x] Bridges can be dragged.
- [x] Field mode builds a stack from at least four field kinds.
- [x] A "Lattice orb" preset (12 layers) builds in Basic mode with no fatal finding. Randomise in the lattice style keeps that true.
- [x] Tests cover the grids, maze connectivity, openness pruning, paint, fret tiles and field slicing. Goldens include a lattice design.

**Progress:**
- 2026-11-07, M2 done.
  - **Lattice:** a sweep of 231 configurations (3 grids, 7 symmetries, 3 seeds, 3 opennesses, plus 3 fret patterns) found islands in 99 before the domain-edge fixes and in none after.
  - **Lattice orb:** the seed is 6, chosen from a rendered sweep of seeds 1 to 8. All 8 seeds build with no islands and no fatal finding. A slider change on one layer takes 186 ms in Node and 223 ms median in headless Edge (`tools/lattice_latency.page.js`), against the 400 ms target. Before the 3D preview kept extruded layers, the browser median was 460 ms.
  - **Field mode:** four kinds (rings, Chladni, two-centre interference, polar rose), each with no fatal finding on the 290 mm, 8-layer Orb outline.
    - A field slider rebuilds every layer: 0.4 to 0.7 s in Node for 8 layers, 0.72 s for 12, and about 1.1 s in the browser for 12.
    - Profiled and cut down from 1.2 to 1.6 s. Nearest-point searches over a segment grid, a tie search limited to cells near each island's outline, mitre joins for the opening, 0.03 mm simplification, and numeric keys in contour linking.
  - **Layer view:** a click that misses every island paints the lattice cell under it. The worker folds the point into the fundamental domain, so any copy works. Dragging a bridge stores the island's preferred angles, and Alt-click resets them. Both were driven in headless Edge with synthetic pointer events; the painted cell `p:1:4` came from a click on a copy at 200 degrees.
  - **Found and fixed along the way:**
    - The Layer view never drew bridges: a path was passed where a list of paths was expected.
    - Concentric rings shared island IDs, which mixed their bridges and their policies.
    - The bridge spread tolerance was 1 radian, not 1 degree.
  - **Tests:** 117 pass. New suites: `lattice.test.js` (grids, connectivity under every symmetry, maze and openness, paint with folding and re-roll, frets, the preset) and `field.test.js` (marching squares area, saddles and borders, folding, nesting, four field stacks). Island tests cover distinct IDs, dragged bridges and packed islands.
  - **Goldens:** the Lattice orb and a 6-layer Chladni field design were added. Every existing golden is unchanged, so M1 output is preserved.
  - **Known limit:** slow checks run in the same worker as builds. On the Lattice orb they take about 0.8 s in Node, and an edit made while they run waits for them. A second worker for checks is the fix, if this proves annoying in use.

### M3: circuit
The grid router, parallel strands, terminals and rect-panel presets.

Design decisions (2026-11-07):
- **Circuit motif:** traces routed on a square grid with 45-degree moves, inside the fundamental domain and then replicated (mirror both ways is the default).
  - Each trace starts on the domain's boundary or the frame and runs as a seeded walk. It prefers straight runs, turns by 45 degrees, avoids occupied cells with a clearance, and ends in a terminal.
  - Each trace is a bundle of parallel strands. Terminals are a drop, a bulb, a ring pad or a via.
- **Polarity:** "bars" makes traces material over an opening, and each trace starts at material, so there are no islands. "Slots" cuts traces as openings in solid material, which looks strong when backlit.

As built (2026-11-07):
- **Area:** a centred rectangle (width, height), optionally limited to a circle ("round limit"), with an inner keep-out radius. The keep-out is solid in slots and open in bars, because nothing could hold a bar there.
- **Lanes:** the cell pitch is the bundle width plus the strand gap. Cells of different traces are at least two cells apart, and a trace's own cells likewise apart except for neighbours along it. So centrelines are at least 1.41 pitches apart, which leaves at least one strand gap between bundles. Cells keep half a pitch from the domain's edges, so a trace never meets its own mirrored or rotated copy.
- **Walk:** traces start at the area's edge, pointing inwards, in seeded order. Each runs straight or turns 45 degrees, after at least two cells straight, with a straightness weight. A trace stops at its target length, drawn from the upper half of "longest trace", or when blocked. Traces under three cells are dropped.
- **Anchoring:** each trace's first segment runs back out of the area to at least a quarter pitch past its edge, so a bar is held by the frame or the material round the area.
- **Ends:** drop, bulb and ring pad need the next cell ahead free and room from the domain's edges; otherwise the trace ends in a via, which fits its own lane. In slots, a ring pad keeps a tie on its far side.
- **Generator style:** one circuit per patterned layer over the area inside its frame ring, each with its own seed. Strands, gap, ends and straightness are shared through the stack, traces thin out towards the back, and the front layer is bars 40% of the time. The back layer stays solid.

Done when:
- [x] A MO:DEM-style rectangular panel preset builds with no fatal finding in both polarities.
- [x] Randomise in the circuit style keeps that true.
- [x] Tests cover routing determinism, clearance and connectivity.

**Progress:**
- 2026-11-07, M3 done.
  - **Circuit panel preset:** 380 x 280 mm, 6 layers, mirror both ways, acid palette, seed 7 from a rendered sweep of seeds 1 to 8. All eight seeds build with no fatal finding and no islands.
    - The preset's frame ring is 12 mm, not 10. With a bars front layer the ring is the only material all layers share, and 10 mm left room for only 2 of 3 dowels (W-05).
    - Measured in Node: cold build 54 ms, slow checks 34 ms, slider change 26 ms (median of 5). In headless Edge the status shows 100 to 140 ms of geometry.
  - **Coverage:** every layer as slots and every layer as bars both build with no fatal finding. So do six circuit-style seeds, and circles (kaleidoscope 8), arches (mirror) and hexagons (rotate 6). Some show W-01 or W-05 warnings, none fatal.
  - **Found and fixed:** bars traces were cut free (46 islands on one test panel), because each anchor stub ended a fraction of a pitch short of the area's edge. Stubs now run to at least a quarter pitch past it.
  - **Tests:** `circuit.test.js`:
    - routing determinism;
    - cell clearance between traces and within a trace, and centreline separation of at least 1.41 pitches, under five symmetries and three seeds;
    - one piece in both polarities with every kind of end under five symmetries;
    - the keep-out;
    - the preset in both polarities, and three circuit-style seeds.
    123 tests pass. The circuit preset joined the goldens; every existing golden is unchanged.

### M4: radial mandala
Curve motifs in rings, and vector node editing.

Design decisions (2026-11-07):
- **New curve motifs:**
  - **Scroll:** a spiral curl.
  - **Ruyi:** a cloud-head lobe.
  - **Ogee:** a pointed arch.
  - **Lotus:** a compound petal.
- **Editable shape:** a `shape` motif holds cubic Bezier nodes (anchor plus handles) in local mm, placed at a radius and replicated like any motif. Any curve motif can be converted into one.
- **Node editing:** happens in the Layer view on the domain copy, with every copy following live.
  - Drag anchors and handles.
  - Double-click a segment to add a node; double-click a node to delete it.
  - Each drag is one undo step.

As built (2026-11-07):
- **Bezier maths** (`src/geom/bezier.js`): no geometry library, so the Layer view uses it on the main thread and the worker flattens the same nodes.
  - A node is an anchor with absolute in and out handles, in the motif's local mm.
  - Flattening uses Wang's bound for the step count, so chords stay within 0.02 mm.
  - Splitting is de Casteljau, so adding a node keeps the outline exactly.
  - A smooth node stays smooth when one handle is dragged: the other turns to match and keeps its length.
- **Curves** (`src/sources/curves.js`):
  - The petal is exact: each arc is two cubics.
  - Ogee and lotus are mirrored halves.
  - Ruyi is a three-lobed cloud head (rho = 0.7 + 0.3 cos 3 phi) on a stem, so the back lobes curl towards it.
  - The scroll is a band along a stem and a spiral that tightens to 45% of its radius. The band is at most half the spacing between arms, so the arms never touch.
  - The scroll is the only curve not symmetric about its axis. Under a kaleidoscope it sits mid-way between mirror lines and takes half the width; on a mirror line, its mirrored copy would cross it and cut islands (12 on a test layer).
  - The lotus notch meets at about 84 degrees. A 16-degree notch measured G-02.
- **Mandala style:** bands of lotus, ogee, ruyi, scroll, petal, arc slots and windows, through the M1 band generator. Lotus, ogee and ruyi sit on the mirror lines like petals.
- **Editing:** "Edit nodes" on a petal or curve card turns it into a shape and opens the Layer view. Nodes are shown on the first copy, at the motif's offset plus the symmetry's phase. A drag moves the node at once, and the rebuild moves every copy.

Done when:
- [x] A "Mandala" preset in the mandala style builds with no fatal finding.
- [x] Converting a petal to a shape and editing its nodes changes every symmetric copy.
- [x] Tests cover the Bezier flattening, the node edits and the conversion.

**Progress:**
- 2026-11-07, M4 done.
  - **Mandala preset:** 290 mm, 10 layers, kaleidoscope 12, ember palette. The seed is 7, chosen from a rendered sweep of seeds 1 to 12, all with no islands and no fatal finding.
    - Measured in Node: cold build 65 ms, slow checks 79 ms, slider change 20 ms (median of 5).
  - **Node editing in headless Edge:**
    - "Edit nodes" turned a lotus into a 7-node shape and opened the Layer view.
    - Dragging its outer node moved it 5.06 mm, and every copy rebuilt.
    - One undo reverted the whole drag, and redo restored it.
    - Double-clicking the outline added a node; double-clicking that node deleted it.
  - **Found and fixed:** the long "Shape" label widened the add-openings select, and with it the whole sidebar. The label is now "Editable shape", with the instructions in a note on the card, and the select may shrink.
  - **Tests:** `curves.test.js`:
    - chords within the tolerance at three tolerances;
    - splitting keeps the outline;
    - anchor and handle moves;
    - every curve counter-clockwise and island-free under a kaleidoscope;
    - petal conversion within 0.2% of the petal's area;
    - a node edit cutting every copy under kaleidoscope 6 with a 12-degree phase;
    - the preset and four mandala-style seeds.
    130 tests pass. The Mandala joined the goldens; every existing golden is unchanged.

### M4.5: AI studio and drawing (owner, 2026-11-07)
Sliders alone are too slow for complex designs. An assistant designs and edits by conversation, draws artwork, and turns pictures and sketches into cuttable layers, all inside the studio.

Decisions (from the owner's answers):
- **Each user's own keys.** No server; the page stays on GitHub Pages and works without keys.
  - Gemini by default (owner, 2026-11-07: a Gemini key is free from AI Studio, while Claude API use is billed separately from a Claude plan). One Gemini key runs the assistant and makes pictures from a description.
  - Claude models stay available with a Claude key.
  - Keys stay in that browser, or only for the session if the user chooses; "Forget keys" clears them.
- **Both ways of drawing:** sketch tools on the canvas, and describe-to-draw. Either way the assistant finishes the job: cuttable layers, bridges, checks.
- **Pictures are vectorised or traced,** never cut as raster. The assistant draws SVG artwork, or a Gemini picture is traced into tone layers (M5's image field, brought forward).
- **AI first,** then M5 (photos, depth, text, engraving) and M6.

Design:
- **Assistant panel:** a drawer beside the preview, open from the top bar in every step, and a "Describe it" box on the start screen.
  - It shows the conversation, a line per action ("Added a lotus ring to layer 3", "Checked: no problems"), and pictures.
  - A Stop button cancels a turn. Every change the assistant makes goes through the store as one undo step.
- **Agent:** a manual tool loop in the page, on whichever engine the chosen model belongs to. Both share the system prompt, tools, input checks, events and round cap. Effort is set in settings, `high` by default.
  - Gemini (the default): streamed `models.generateContentStream` with function calling (`parametersJsonSchema` from the same tool schemas). Models `gemini-flash-latest` (the default; works with a free key) and `gemini-pro-latest` (best designs; needs billing, as free keys get a quota of 0 for Pro, seen on the owner's first run); the aliases follow Google's newest models, so the studio does not rot when a version retires. Effort maps to thinking level (medium to `LOW`, high and extra high to `HIGH`), with thought summaries streamed as progress: the panel says which model it is waiting for, shows the latest thinking heading, and counts seconds on Stop (the owner's first Flash request sat blank while the model thought). A reply that sends nothing for 180 s is dropped with a clear error. Model turns go back into the history part by part as they streamed, including empty parts that carry a signature, so thought signatures stay valid. Pictures from `look` travel inside the function response. A turn that fails, is blocked or is stopped leaves the history as it was; the message goes back in the box with its pictures. A malformed function call is asked again up to twice. After the round cap, "carry on" joins the last function responses, so turns keep alternating.
  - Errors read as what to do: a quota of 0 says the model is not in the key's free tier and offers "Use Gemini Flash and send again" in one click; a per-minute limit gives Google's retry delay; a daily limit says so.
  - Claude: the SDK's streaming manual loop, Opus 5.5 or Sonnet 5.5, adaptive thinking. Server-side refusal fallbacks are on (`server-side-fallback-2026-07-01`, `fallbacks: "default"`).
  - A turn stops after 30 tool rounds. Token use per turn shows in the panel.
  - The system prompt is generated from the registry (motif types, parameters, ranges, symmetries, styles, materials, cutting limits), so it is deterministic and cached.
  - The current design travels with each user message; tool results carry the state after each change.
- **Tools:**
  - `edit_design`: a list of operations (set a piece or design value, set layer count, set a layer's fields, set, add, update or remove motifs, generate from a style and seed). Validated against the registry and clamped to its ranges, then applied as one undo step. Errors come back to the model.
  - `check_design`: every check, with per-layer open fraction, islands and cut length.
  - `look`: a picture of the design (front composite, 3D, or one layer), so the model can judge it.
  - `draw_artwork`: SVG the model writes, placed on a layer as material or cut as openings, then through bridges and checks.
  - `make_picture` (Gemini key only): a picture from a description, worded for layering (flat tones, bold shapes). It appears in the conversation and as a reference over the Layer view.
  - `trace_picture`: slices a picture into the stack as an image field (tone or depth), with levels, inversion, smoothing and framing.
- **Sketch tools** in the Layer view: select, pen, line, circle, polygon and eraser.
  - Strokes become a `sketch` motif on the chosen layer: open strokes cut as slots of a set width, closed shapes as openings.
  - Each stroke is taken back into the symmetry's fundamental domain by the copy it was drawn on, so the drawing mirrors live.
  - "Smooth" tidies strokes locally. "Clean up with AI" asks the assistant to replace the sketch with clean shapes, curves or artwork.

Done when:
- [ ] With a Gemini key, "a 10-layer lotus mandala with a key-fret border" builds a piece with no fatal finding, and a follow-up edit changes it as asked. Both are driven by the owner, with real keys.
- [ ] The assistant can draw artwork onto a layer, and a Gemini picture can be traced into layers, with no fatal finding.
- [ ] Sketch tools draw mirrored strokes that cut, and "Clean up with AI" replaces a sketch with clean shapes.
- [x] Tests cover edit validation and clamping, both tool loops (stand-in clients: tool results in one turn, pictures in Gemini function responses, thought signatures kept, stops on refusal or a safety block, malformed calls asked again, `max_tokens` and the round cap), sketch geometry, and image-field slicing. No real API calls in CI.

**Progress:**
- 2026-11-07, slice 1: the assistant.
  - **Built:** validated operations, the generated prompt and tools, the streaming tool loop, the panel and settings, "Describe it" on the start screen, artwork as openings (a new `art` motif) or as material, the picture field with tracing, and "Add a picture" for the user's own pictures.
  - **Tests:** `ai.test.js`, 8 tests, no network: operations and clamping, motif cleaning, the summary, the prompt's determinism, input checks, and the loop with a stand-in client (one message for all results; refusal, `max_tokens`, round cap, API errors, Stop).
  - **Driven in headless Edge with a scripted stand-in client** (no keys here):
    - Describe, then edit, check, look and draw artwork, then undo the steps one at a time.
    - A picture added by the user, traced into 8 layers (open 73% at the front to 0% at the back), then looked at.
  - **Not yet run with real keys:** the owner's first live session checks the requests against the real APIs.
- 2026-11-07, slice 2: the sketch tools.
  - **Tools:** select, pen, line, circle, rectangle and erase on a bar over the Layer view, plus stroke width, "Fill closed shapes", Smooth and "Clean up with AI".
  - **Strokes:** each goes back into the fundamental domain by the copy holding its first point, so it never splits at a mirror line. They land in a `sketch` motif on the chosen layer. While drawing, every copy shows the stroke in progress.
  - **Cutting:** open strokes cut as round-ended slots; closed ones cut filled or as an outline slot.
  - **In the Pattern step:** a sketch card has Draw more, Smooth and Clean up with AI, and every layer has "Draw on this layer".
  - **Driven in headless Edge:**
    - A pen stroke drawn at about 130 degrees on the Mandala (kaleidoscope 12) was stored at 6 to 14 degrees, inside the 0 to 15 degree domain. It cut 24 mirrored slots, and the rings they cut free were bridged.
    - A circle stored as a closed, filled stroke.
    - Erase removed the pen stroke when a mirrored copy was clicked.
    - "Clean up with AI" (with a stand-in) looked at the layer, removed the sketch and added petals.
  - **Tests:** `sketch.test.js`, 5 tests:
    - folding under five symmetries;
    - whole strokes keep their length, and their copies include the stroke as drawn;
    - slot, filled and outline areas, with 12 copies;
    - simplify and smooth;
    - a picture sliced by tone: the disc's area within 5%, the whole square at a high level, and the swapped picture and the original filling the square between them.

### M5: image and text
Tone bands, depth map import, depth AI, the dithered engrave back plate with its ramp strip, stencil text, and logo import. Done when an Angel-style shadow box can be rebuilt from a photo, end to end.

Design decisions (2026-11-07):
- **Photos live outside the design.** The full photo (at most 1600 px on its longest side) is kept in this browser's IndexedDB under its hash; the design holds only `piece.photo = { hash, w, h }` and the 320 px grey raster the field slices.
  - Why: a photo good enough to engrave is megabytes, and the design is copied into every undo step, the autosave (a 5 MB browser limit) and every worker message.
  - Saved `.lamina.json` files carry the photo inside (`assets`), and opening one stores it again, so files move between machines intact.
- **Tone bands and depth maps** use M4.5's picture field.
  - "Use a photo" in the Pattern step, or the start screen's "From a photo", slices by tone.
  - A depth map image can be loaded directly, or made from the photo.
- **Depth AI:** Transformers.js 4.3.1, loaded on first use from jsDelivr, runs Depth Anything V2 in the page (WebGPU when there is one, otherwise WebAssembly).
  - Small (Apache-2.0, about 50 MB) is the default.
  - Base and Large (CC-BY-NC-4.0, larger downloads) are offered and labelled non-commercial.
  - The browser caches the model after the first download. Near parts go to the front layers.
- **Engraved back plate** (`prep_portrait.py`'s recipe):
  - Red-leaning grey, a local contrast stretch (CLAHE, clip 2.2 on an 8 x 8 grid), levels 8 to 240, gamma 1/1.55 for dot gain, and an unsharp mask.
  - The photo is placed on the chosen layer exactly where the picture field puts it, and kept only where the layer in front lets it show, grown by 2 mm.
  - Exports a greyscale PNG at 600 DPI (the Epilog driver dithers it) and an SVG with the cut lines and the picture placed in mm. An 11-step grey ramp strip, 90 x 30 mm, goes in the zip and the Make step.
  - The Layer view, the 2D view and the 3D view show it as an error-diffused preview.
- **Text:** a `text` motif renders glyph outlines with opentype.js 2.0.0 (MIT), bundled in the worker, from bundled OFL stencil fonts.
  - Counters (the inside of an O) become islands, which the bridge stage ties, so any font cuts as a stencil.
  - Text sits on a line or round an arc, once or round the symmetry.
- **Logo import:** "Add a logo (SVG)" places the file as an `art` motif.
- **The assistant** can do all of this through its existing tools: text and engraving are registry controls and motifs.

**Progress:**
- 2026-11-07, slices 1 and 2: layers from a photo, and depth AI.
  - **Flow:** "From a photo" on the start screen (a new piece) and "Use a photo" in the Pattern step (the current piece, one undo step). A dialog takes a photo (chosen or dropped), slices it by light and dark, by depth found by AI, or as a depth map already, and shows the bands each layer will cut before anything is made.
  - **Slicing:** bright parts come forward. Tones are evened out by default: each tone becomes its percentile, so layer k of n keeps (k + 1) / n of the picture. Plain histogram equalisation was tried first and missed by up to 4%, because a large dark ground piles at 0 and squeezes the other bands.
  - **New pieces:** a rectangle fitted to the photo (300 mm on its long side) or round, no symmetry, the Mono palette (light at the front to dark at the back, as the preview shows). On a round piece, or any outline of another shape, the photo covers the outline.
  - **Depth AI:** Small, Base and Large in a picker that shows each download size for this browser's backend and labels Base and Large non-commercial. Driven in headless Edge (WebAssembly, no GPU): "Find depth" with Small loaded the library, downloaded 27 MB and found depth in 10.8 s in all; the 8 layers built in 111 ms with every check passing.
  - **Field mode:** the Pattern step no longer offers openings on a layer the field shapes; it says how to switch.
  - **Tests:** `photo.test.js`, 4 tests: the raster helpers; evening out keeps order and centres the tones; the bands preview matches each layer's cut area within 3%, and the back layer is solid; evened-out tones give every layer its share within 3%.
  - **Not yet:** the engraved back plate, text and logos, and the shadow box flow (slices 3 to 5). Photos are not yet kept with the design, so a reopened design keeps its layers but not the photo.

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
4. Resolved 2026-11-06: the purchased mandala's px are 72-per-inch points. It imports at 290.88 mm, against 218 mm at 96 per inch.
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
| 2026-11-07 | Islands joined by a minimum spanning tree, then group-to-group ties | Ties to the enclosing opening failed for islands packed among islands; three nearest neighbours alone left whole clusters cut off |
| 2026-11-07 | Field sampled at 0.75 mm, simplified at 0.03 mm | 0.5 mm measured 2.25 times slower; the simplification cut opening time 15 to 25% for an area change of 0.003% |
| 2026-11-07 | Square and 45-degree lattices clipped to the wedge, with a bar on each wedge edge | Without it, 99 of 231 swept lattice configurations had islands |
| 2026-11-07 | Island IDs include the box size | Concentric rings shared IDs, so their bridges and policies mixed |
| 2026-11-07 | Lattice orb seed 6 | The densest of a rendered sweep and the closest to the orb reference, still inside the 400 ms slider target |
| 2026-11-07 | The 3D preview keeps extruded geometry per layer, keyed by its material | Browser slider latency on the Lattice orb: 460 ms median down to 223 ms |
| 2026-11-07 | Photos kept in IndexedDB by hash; designs hold a reference; saved files embed them | A photo good enough to engrave would otherwise be copied into every undo step, autosave and worker message |
| 2026-11-07 | The engrave plate is exported greyscale at 600 DPI, not dithered | The Epilog driver dithers itself (as at AngelShadowBox); the preview shows an error-diffused version |
| 2026-11-07 | M4.5 AI studio and drawing before M5 | Owner: sliders alone are too slow for complex designs |
| 2026-11-07 | Users bring their own Claude and Gemini keys; SDKs load from jsDelivr on first use | No server to run or pay for, and the page works without AI |
| 2026-11-07 | The assistant edits through validated operations, not by rewriting the design JSON | Each change is checked against the registry's ranges and is one undo step |
| 2026-11-07 | Gemini pictures are traced (image field) or redrawn as SVG by Claude, never cut as raster | Cuttable output with bridges and checks, from the same pipeline as everything else |
| 2026-11-07 | Guided layout: one step on screen at a time (Piece, Pattern, Look, Structure, Make), each opening its view, with a layer strip under the preview | Owner: the long scrolling sidebar was hard to use. Chosen from three clickable mockups drawn with real presets |
| 2026-11-07 | Start screen on the first visit and from New; a returning visitor opens their last design | Owner chose the start screen; resuming saves returning users a click every visit |
| 2026-11-07 | "More options" folds per step replace the Basic and Advanced switch | Owner: nothing hidden by a global mode |
| 2026-11-07 | Symmetry moves to the Piece step | It shapes the whole piece, and the Pattern step was the longest |
| 2026-11-07 | Bezier maths in a module with no geometry library | The Layer view edits nodes on the main thread, which must not load Clipper2 (a test enforces it) |
| 2026-11-07 | Scrolls sit mid-way between mirror lines under a kaleidoscope | The only asymmetric curve: on a mirror line its mirrored copy crosses it and cuts islands |
| 2026-11-07 | Mandala preset seed 7 | From a rendered sweep of 12 seeds: a lotus ring inside a ring of arc slots |
| 2026-11-07 | Circuit lanes: pitch = bundle + gap, traces two cells apart, half a pitch from domain edges | Gives at least one strand gap between bundles, including a trace and its own copies, with no geometric search |
| 2026-11-07 | Circuit keep-out is solid in slots and open in bars | An open keep-out in slots is fine, but a solid one in bars would be an island holding nothing |
| 2026-11-07 | Circuit panel frame ring 12 mm | With a bars front, the ring is the only material all layers share; 10 mm fitted only 2 of 3 dowels |
| 2026-11-07 | Dowel search skips the windows after one miss | Saves windows that cannot succeed on art with no shared outer band; the mandala's build time measured the same before and after |
| 2026-11-07 | The assistant runs on Gemini by default; Claude stays as an option | Owner's call: one free Gemini key covers the assistant and pictures, where Claude API use is billed separately from a Claude plan |
| 2026-11-07 | Gemini Flash is the default model; Pro is labelled as needing billing | The owner's first request on Pro with a free key failed at once with a quota of 0; Flash works on free keys |
| 2026-11-07 | Layer visibility is view state, not part of the design | Owner asked for per-layer on and off and a layer-by-layer slider. Hiding a layer is for looking into the stack; saving it would risk a design that previews without a layer it still cuts |
| 2026-11-07 | Twelve more palettes, picked from swatches, plus the design's own palette and a spread | Owner asked for more colour presets and customisation. Editing any colour makes a Custom palette, so the named palettes stay fixed and an old design opens unchanged |
| 2026-11-07 | An All layers switch applies per-layer control changes to every layer; openings stay per layer | Owner asked for a switch that applies changes to all layers. Layers usually carry different openings, so copying a motif edit across them has no clear meaning |
