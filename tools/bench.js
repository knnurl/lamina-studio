// Performance bench for the SPEC 13.6 targets, geometry side (Node). Each case is the median of
// 5 runs; "cold" runs use a fresh seed so the stage caches cannot help.
// Usage: node tools/bench.js
import { base_design, apply_palette } from '../src/core/design.js';
import { generate_stack } from '../src/core/generate.js';
import { build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { export_design } from '../src/export/export_design.js';

const kRuns = 5;

function piece(layers, w_mm, seed) {
    const d = base_design(layers);
    d.name = `Bench ${layers} x ${w_mm}`;
    d.piece.outline.w_mm = w_mm;
    d.piece.symmetry = { kind: 'dihedral', n: 12, phase_deg: 0 };
    for (const l of d.layers) l.frame_ring_mm = w_mm * 0.04;
    apply_palette(d, 'orb');
    generate_stack(d, seed, { lock_n: true });
    return d;
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function time(fn) {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
}

const rows = [];
function report(name, target_ms, samples) {
    const m = median(samples);
    rows.push({ name, median_ms: Math.round(m), target_ms, pass: target_ms ? m < target_ms : null });
}

// Warm the JIT once so the first measured run is not an outlier.
build_design(piece(4, 200, 999));

// 12 layers, 300 mm, primitives: a cold build, then one slider change on one layer.
report('12 x 300 mm: cold build', null, Array.from({ length: kRuns }, (_, i) => time(() => build_design(piece(12, 300, 100 + i)))));
report(
    '12 x 300 mm: slider change on one layer (warm caches)',
    150,
    Array.from({ length: kRuns }, (_, i) => {
        const d = piece(12, 300, 200 + i);
        build_design(d);
        const motifs = d.layers[2].source.motifs;
        const m = motifs.find(x => x.type !== 'disc') ?? motifs[0];
        if (m.r_mm !== undefined) m.r_mm += 1;
        else m.d_mm += 1;
        return time(() => build_design(d));
    }),
);

// 20 layers, 600 mm: full checks and export, from cold.
report(
    '20 x 600 mm: build + all checks + export zip (cold)',
    5000,
    Array.from({ length: kRuns }, (_, i) => {
        const d = piece(20, 600, 300 + i);
        d.layers[4].gap_mm = 6;
        d.sheet = { w_mm: 1200, h_mm: 900, margin_mm: 4, spacing_mm: 3 };
        return time(() => {
            const b = build_design(d);
            const checks = [...b.checks, ...slow_checks(d, b.layers)];
            export_design(d, b.layers, b.registration, checks);
        });
    }),
);

console.log(`Node ${process.version}, ${kRuns} runs each, median:`);
for (const r of rows) {
    const verdict = r.pass === null ? '' : r.pass ? `  target < ${r.target_ms} ms: pass` : `  target < ${r.target_ms} ms: FAIL`;
    console.log(`  ${r.name.padEnd(56)} ${String(r.median_ms).padStart(6)} ms${verdict}`);
}
process.exitCode = rows.some(r => r.pass === false) ? 1 : 0;
