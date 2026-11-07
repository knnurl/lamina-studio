# CLAUDE.md

Instructions for Claude Code in this repository. Read this file and `docs/SPEC.md` before writing code.

## What this project is

Lamina Studio is a browser studio for layered, laser-cut art. It designs stacks of cut sheets (lattice mandalas, circuit panels, shadow boxes, festival panels) and exports cut-ready SVG and DXF, spacers, dowel holes, layer IDs and an assembly sheet. It is the fourth "studio" after coaxial-interference-studio, fieldform-studio and tenebrae-studio, and follows their house pattern: one self-contained `index.html`, MIT, GitHub Pages.

The owner is Kaan Ural, a robotics and embedded engineer. Treat him as an expert. Be direct and flag uncertainty explicitly.

`docs/SPEC.md` is the source of truth for requirements and design. This file covers process and conventions.

## Priorities (highest first)

1. Visual creativity
2. Buildability: checks block only fatal faults (SPEC section 7)
3. Ease of use for non-technical artists
4. Interactivity

When trade-offs conflict, follow this order and state which priority drove the decision.

## Current milestone

M4, radial mandala (SPEC section 15). The owner approved M2, M3 and M4 on 2026-11-07; M2 (lattice) and M3 (circuit) are done. M1's physical proof still waits on the owner's test card cut and a 4-layer test piece. M5 and later start only when the owner says so. Don't build ahead of the approved milestones.

## Commands

- Build: `node tools/build.js` writes `index.html` from `src/`. `--check` exits 1 if it is stale.
- Test: `node --test "tests/*.test.js"`. Keep the quoted glob: Node 24 (the CI version) treats a bare `tests/` as one file and fails, while Node 26 searches it.
- Run: open `index.html` in a browser (works from `file://`)
- Check in a real browser: `node tools/shot.js <out.png> [--light] [--size=1400x860] [--click=<css selector>] [--eval=<js>] [--eval-file=<path>]`.
  - It drives headless Edge or Chrome, waits for the status light, prints the status and any console errors, and saves a screenshot. Exit 1 on errors.
  - `--click` then clicks an element and reports any download (saved in `downloads/` beside the PNG).
  - `--eval` and `--eval-file` run a script in the page (async allowed) and print its result. Use `--eval-file` for long scripts such as embedded SVG fixtures.
- Performance: `node tools/bench.js` (exits 1 if a SPEC 13.6 target fails), `node tools/shot.js out.png --eval-file=tools/slider_latency.page.js` (primitives) and `node tools/shot.js out.png --timeout=120000 --eval-file=tools/lattice_latency.page.js` (the dense Lattice orb). Record results in `docs/PERF.md`.
- Golden designs: `node tools/golden.js --update` regenerates `tests/golden/metrics.json`. Only do this for a deliberate change, and review the diff.
- Private fixtures live in the gitignored `data/fixtures/` (for example the purchased mandala SVGs). Tests that need them skip when absent.
- Shell gotcha: never put JS template literals (backticks) inside `node -e "..."` in Bash; Bash runs them as command substitution. Use the Edit tool, a file, or a quoted heredoc.

Keep this section accurate.

## Rules

- **Single file output.** `index.html` is built and committed. CI fails if it's stale, so rebuild before committing.
- **No npm runtime dependencies.** Third-party code is vendored under `src/vendor/` at pinned versions with its licence. Ask before adding any dependency.
- **Licences:** MIT, BSD, ISC, Apache-2.0, BSL-1.0, zlib, and OFL (fonts only). Nothing else without asking.
- **Never commit** anything in `refs/` (third-party reference art and festival branding), purchased designs, or photos of people. `refs/` and `data/` are gitignored. CI uses synthetic fixtures only.
- **Determinism.** Every output is a pure function of the design JSON. All randomness comes from seeded `mulberry32`. Geometry uses integer micrometres. No dates in outputs. A test enforces byte-identical zips.
- **Geometry runs in the worker.** The UI thread renders and edits only.
- **Parameter registry.** Every control is declared once in `SCHEMA`. Never hand-write a control outside it.
- **Measure, don't guess.** Every performance or accuracy claim needs a measurement in `docs/PERF.md` and the command that reproduces it.
- **Visible problems first.** When cut quality is in question, build the overlay or check that shows the problem before tuning numbers.

## Code conventions

- Plain JavaScript ES modules with JSDoc types. 4-space indent, 100 columns.
- Functions and variables are `snake_case`. Classes are `PascalCase`. Constants are `kPascalCase`. Files are `snake_case.js`.
- Put units in names: `_mm`, `_um`, `_deg`, `_mm2`, `_s`.
- Each pipeline stage is a pure function from inputs to outputs, with a header comment listing its assumptions.

## Writing conventions (docs, UI text, comments, commit messages)

- British English: colour, behaviour, analyse.
- Never use em dashes. Use colons, commas or full stops.
- Sentence case for UI labels. Units in every label that has one.
- Mark unverified technical claims in docs with `[Verify]`.

## How to work

- Before starting a task, restate the acceptance criteria you're targeting and list the SPEC section 17 assumptions it depends on.
- Make small, reviewable commits, one concern per commit.
- Keep `SPEC.md` current. When a decision changes, update the spec in the same commit and add a row to the decision log (section 18).
- Reuse code from the earlier studios by porting it, not pasting it blindly. The source locations are listed in the plan and SPEC.

## Reuse sources (local paths)

- `../Kinesthetic/CoaxialStudio_Repo/coaxial_interference.html`:
  - `SCHEMA` and `buildControl` (about lines 855 to 1125)
  - `applyWedge`, `offsetPath`, `ribbonize`, `traceBinary`, `rdp`, `floodKeepHub`
  - the DXF and SVG writers
- `../Relief/fieldform_studio.html`:
  - the kaleidoscope fold and field modes
  - the preset, lock and undo history
  - the theme toggle and the `TUT_STEPS` tour
  - the binary STL writer
- `https://github.com/knnurl/tenebrae-studio`:
  - `tools/build.js` and `pages.yml`
  - the thin-web check and island removal
  - kerf-compensated DXF R12
- `../AngelShadowBox/build.py` and `prep_portrait.py`:
  - layer composition (frame ring plus motifs)
  - DXF colour conventions
  - the tone and engrave recipe
