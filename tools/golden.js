// Golden designs (SPEC 16): stored metrics for a fixed set of designs. tests/golden.test.js fails
// on any change, until the goldens are deliberately regenerated and the diff reviewed.
// Usage: node tools/golden.js           print the current metrics
//        node tools/golden.js --update  write tests/golden/metrics.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kPresets } from '../src/core/presets.js';
import { base_design, design_from_import, migrate } from '../src/core/design.js';
import { build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { export_design } from '../src/export/export_design.js';
import { import_svg_files } from '../src/sources/svg_import.js';
import { to_flat } from '../src/geom/pack.js';

const kRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const kGoldenFile = path.join(kRoot, 'tests', 'golden', 'metrics.json');

// Nested tie-0 rings: bridged, glued and dropped islands, with a gap and its spacers.
function islands_design() {
    const d = base_design(4);
    d.name = 'Golden islands';
    const ring = (r_mm, w_mm) => ({ type: 'ring', r_mm, w_mm, tie_mm: 0, mult: 1, angle_deg: 0 });
    d.layers[0].source.motifs = [ring(100, 8), ring(60, 6), ring(30, 5)];
    d.layers[1].source.motifs = [ring(90, 6), { type: 'disc', d_mm: 40 }];
    d.layers[1].gap_mm = 6;
    const built = build_design(d).layers[0].islands.sort((a, b) => a.area_mm2 - b.area_mm2);
    d.layers[0].overrides.islands[built[0].id] = 'glue';
    d.layers[0].overrides.islands[built[1].id] = 'drop';
    return d;
}

// Two synthetic SVG files: a framed panel with holes, and a backer.
function svg_design() {
    const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="150mm" viewBox="0 0 200 150">${body}</svg>`;
    const front = svg('<path d="M0 0H200V150H0Z M20 20H90V130H20Z M110 20H180V130H110Z"/><circle cx="55" cy="75" r="15"/>');
    const back = svg('<rect width="200" height="150" rx="6"/>');
    const r = import_svg_files([
        { name: 'panel-1.svg', text: front },
        { name: 'panel-2.svg', text: back },
    ]);
    return design_from_import({ layers: r.layers.map(l => ({ name: l.name, paths: to_flat(l.paths) })), outline: to_flat(r.outline), size_mm: r.size_mm }, 'Golden SVG');
}

export function golden_designs() {
    return [...kPresets.map(p => ({ id: p.id, design: p.make() })), { id: 'islands', design: islands_design() }, { id: 'svg', design: svg_design() }];
}

export function metrics(design) {
    const d = migrate(design);
    const b = build_design(d);
    const checks = [...b.checks, ...slow_checks(d, b.layers)];
    const out = export_design(d, b.layers, b.registration, checks);
    return {
        layers: b.layers.length,
        area_mm2: b.layers.map(l => Math.round(l.area_mm2)),
        islands: b.layers.map(l => l.islands.length),
        bridges: b.layers.map(l => l.bridges.length),
        glue_parts: b.layers.map(l => l.parts.length),
        dowels: b.registration.dowels.length,
        ids: b.layers.filter(l => l.ids.length).length,
        spacers: b.registration.spacers.map(s => `${s.kind}x${s.copies}@${s.gap + 1}`),
        cut_length_mm: Math.round(b.layers.reduce((s, l) => s + l.cut_length_mm, 0)),
        checks: checks.map(c => c.key).sort(),
        sheets: out.summary.sheets,
        parts: out.summary.parts,
        files: out.summary.files,
    };
}

export function all_metrics() {
    return Object.fromEntries(golden_designs().map(({ id, design }) => [id, metrics(design)]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const current = all_metrics();
    if (process.argv.includes('--update')) {
        fs.mkdirSync(path.dirname(kGoldenFile), { recursive: true });
        fs.writeFileSync(kGoldenFile, JSON.stringify(current, null, 2) + '\n');
        console.log(`wrote ${path.relative(kRoot, kGoldenFile)}`);
    } else {
        console.log(JSON.stringify(current, null, 2));
    }
}
