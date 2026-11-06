# Performance

Measured results against the SPEC 13.6 targets, each with the command that reproduces it. Re-run these after any change to the geometry pipeline and update the table.

Machine: the owner's Windows 11 laptop. Node 26.13.0 and 24.22.2, Edge 157 headless with software WebGL (SwiftShader), so the browser figures are pessimistic.

## Results (2026-11-06)

| Case | Target | Measured | How |
|---|---|---|---|
| Slider change to rebuilt geometry, 12 layers, 300 mm, primitives | under 150 ms | 50 ms median (Node 26 and 24) | `node tools/bench.js` |
| Slider change to rebuilt preview, 12 layers, in the browser (worker round trip and 3D render) | under 150 ms | 92 ms median of 7 (range 90 to 137) | `node tools/shot.js out.png --eval-file=tools/slider_latency.page.js` |
| Cold build, 12 layers, 300 mm | none | 51 to 55 ms median | `node tools/bench.js` |
| Build, every check and the export zip, 20 layers, 600 mm, cold | under 5 s | 322 to 329 ms median | `node tools/bench.js` |
| Dense lattice slider change (M2) | under 400 ms | not yet measurable | M2 |
| 3D preview frame rate, 20 layers | at least 30 fps | not measured: headless Edge has no GPU | owner, on the laptop's GPU |

## Imported artwork

The purchased 7-layer mandala is the heaviest real design so far: 1,880 contours and about 45,000 vertices.

| Case | Measured | How |
|---|---|---|
| Import (7 files) | 244 ms | Node, `import_svg_files` |
| Cold build, registration included | about 850 ms (1.9 s in headless Edge) | Node, `build_design` |
| Slow checks, cold | about 590 ms | Node, `slow_checks` |
| Colour or gap edit (cached geometry) | 7 ms build, 0 ms slow checks | Node, after one cold build |

Stage caches (SPEC 6.2) make edits that do not touch geometry (colour, gaps, lighting, sheet) nearly free. Most of the cold cost is registration: intersecting seven dense layers for the dowels, and searching for hidden ID spots.

## Commands

- Geometry bench: `node tools/bench.js`. It exits 1 if a target fails.
- Browser slider latency: `node tools/shot.js out.png --eval-file=tools/slider_latency.page.js`. The script sets the layer count to 12, then nudges the first opening slider 7 times. For each nudge it times from the `input` event to the next mutation of `#status-text`, using a MutationObserver.

## Decisions taken from these measurements

- **No blanket open/close cleanup in compose.** It took 288 of 300 ms on the Orb and changed the area by 2 mm2 in 464,000 mm2.
- **ID placement searches rect-clipped windows,** and skips a window whose largest hidden piece cannot hold the label. On the Orb that took about 47 ms down to under 5 ms.
- **Dowels intersect whole layers,** sparsest first. Windowed intersections measured slower: 273 ms against 192 ms on the mandala.
- **Per-layer, registration and slow-check caches,** keyed by their inputs.
