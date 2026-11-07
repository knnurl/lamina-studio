# Performance

Measured results against the SPEC 13.6 targets, each with the command that reproduces it. Re-run these after any change to the geometry pipeline and update the table.

Machine: the owner's Windows 11 laptop. Node 26.13.0 and 24.22.2, Edge 157 headless with software WebGL (SwiftShader), so the browser figures are pessimistic.

## Results (2026-11-06; M2 rows and the re-run bench 2026-11-07)

The bench re-run on 2026-11-07 is slower on the 20-layer case than on 2026-11-06. The M1 commit, checked out beside the M2 tree and run interleaved, measured the same (384 to 429 ms), so this is the machine's day, not a regression.

| Case | Target | Measured | How |
|---|---|---|---|
| Slider change to rebuilt geometry, 12 layers, 300 mm, primitives | under 150 ms | 50 ms median (Node 26 and 24); 20 to 23 ms on 2026-11-07 | `node tools/bench.js` |
| Slider change to rebuilt preview, 12 layers, in the browser (worker round trip and 3D render) | under 150 ms | 92 ms median of 7 (range 90 to 137) | `node tools/shot.js out.png --eval-file=tools/slider_latency.page.js` |
| Cold build, 12 layers, 300 mm | none | 51 to 55 ms median; 63 to 70 ms on 2026-11-07 | `node tools/bench.js` |
| Build, every check and the export zip, 20 layers, 600 mm, cold | under 5 s | 322 to 329 ms median; 395 to 458 ms on 2026-11-07 | `node tools/bench.js` |
| Dense lattice slider change, Lattice orb, 12 layers, 290 mm (M2, 2026-11-07) | under 400 ms | 186 ms median | `node tools/bench.js` |
| The same in the browser: worker round trip and 3D render (M2, 2026-11-07) | under 400 ms | 223 ms median of 7 (range 194 to 312), checks idle between samples | `node tools/shot.js out.png --timeout=120000 --eval-file=tools/lattice_latency.page.js` |
| Field slider change, 12 layers, 290 mm, rings: every layer rebuilds (M2) | none | 723 ms median; about 1.1 s in the browser | `node tools/bench.js` |
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
- **Dowels search a window around each target angle first (M2), then whole layers,** sparsest first. On the mandala, windows alone measured slower (273 ms against 192 ms). On dense lattices whole-layer intersections are slow. After one window miss the windows are skipped. The mandala's cold build measured the same as M1's, interleaved: 800 to 900 ms after the first, JIT-cold run of about 1.05 s.
- **Per-layer, registration and slow-check caches,** keyed by their inputs.
- **The 3D preview keeps extruded geometry per layer** (M2), keyed by the layer's material and thickness. Before, every build re-triangulated every layer, one 250 to 330 ms main-thread task per edit on the Lattice orb (PerformanceObserver long tasks). That cut the browser median from 460 ms to 223 ms.
- **Island bridging searches a segment grid** (M2): nearest points, crossing tests, and only the cells near an island's outline. A field slider on 8 Orb layers went from 1.2 to 1.6 s down to 0.4 to 0.7 s, with field sampling at 0.75 mm, 0.03 mm simplification, mitre joins for the opening, and numeric contour keys.

## Known limits

- **Slow checks share the worker with builds.** On the Lattice orb they take about 0.8 s in Node. They start 350 ms after edits pause, so an edit made while they run waits for them: 792 ms browser median with 900 ms between edits, 223 ms when the checks had finished. A second worker for checks would remove the wait.
