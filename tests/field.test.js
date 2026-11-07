// Depth field mode (SPEC 6.7, M2): marching squares, slicing, symmetry folding, and whole field
// stacks with every island bridged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contours_below, field_material, field_level, kFieldKinds } from '../src/sources/field.js';
import { fold_point, symmetry_matrices, fundamental_domain } from '../src/geom/symmetry.js';
import { base_design } from '../src/core/design.js';
import { build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { components } from '../src/pipeline/islands.js';
import { area_mm2, union_fill } from '../src/geom/clip.js';

// A sampled field over [-n/2, n/2]^2 samples of step_um, from f(x_mm, y_mm).
function grid_of(f, n, step_um) {
    const v = new Float32Array(n * n);
    const x0 = (-(n - 1) / 2) * step_um;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = f((x0 + i * step_um) / 1000, (x0 + j * step_um) / 1000);
    return { v, nx: n, ny: n, step: step_um, x0, y0: x0 };
}

test('marching squares: a cone sliced at half height is a circle of the right area', () => {
    const g = grid_of((x, y) => Math.hypot(x, y) / 50, 161, 500); // 80 mm square, r 50 mm at f = 1
    const loops = contours_below(g, 0.5);
    assert.equal(loops.length, 1);
    const want = Math.PI * 25 * 25;
    const got = area_mm2(union_fill(loops, true));
    assert.ok(Math.abs(got - want) / want < 0.002, `area ${got.toFixed(1)} mm2, want ${want.toFixed(1)}`);
});

test('marching squares: contours close at the grid edge, and saddles keep loops separate', () => {
    // Everything below the level: one loop round the whole grid.
    const full = contours_below(grid_of(() => 0, 21, 1000), 0.5);
    assert.equal(full.length, 1);
    assert.ok(Math.abs(area_mm2(union_fill(full, true)) - 400) < 25, 'about the 20 mm grid');
    // A 3 x 3 checkerboard of bumps: five low cells, touching only at saddle corners.
    const checker = grid_of((x, y) => (Math.cos((Math.PI * x) / 10) * Math.cos((Math.PI * y) / 10) > 0 ? 0 : 1), 31, 1000);
    const loops = contours_below(checker, 0.5);
    assert.ok(loops.length >= 4, `${loops.length} loops`);
    for (const loop of loops) assert.ok(loop.length >= 3);
});

test('folding: every copy of a point folds to the same domain point', () => {
    const syms = [
        { kind: 'rot', n: 6, phase_deg: 15 },
        { kind: 'dihedral', n: 8, phase_deg: 0 },
        { kind: 'dihedral', n: 5, phase_deg: 30 },
        { kind: 'mirror_x', n: 1, phase_deg: 20 },
        { kind: 'mirror_xy', n: 1, phase_deg: 0 },
    ];
    for (const sym of syms) {
        const dom = fundamental_domain(sym);
        const a = dom.a0 + 0.3 * (dom.a1 - dom.a0);
        const p = { x: 40 * Math.cos(a), y: 40 * Math.sin(a) };
        const ph = ((sym.phase_deg ?? 0) * Math.PI) / 180;
        const copy0 = { x: p.x * Math.cos(ph) - p.y * Math.sin(ph), y: p.x * Math.sin(ph) + p.y * Math.cos(ph) };
        const base = fold_point(copy0, sym);
        assert.ok(Math.hypot(base.x - p.x, base.y - p.y) < 1e-9, `${sym.kind}: the identity copy folds to its domain point`);
        for (const m of symmetry_matrices(sym)) {
            const q = fold_point({ x: m[0] * p.x + m[1] * p.y, y: m[2] * p.x + m[3] * p.y }, sym);
            assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1e-9, `${sym.kind}${sym.n}`);
        }
    }
});

test('slices nest: material grows with the level, for every field kind', () => {
    const piece = { symmetry: { kind: 'dihedral', n: 6, phase_deg: 0 }, field: { kind: 'rings', scale_mm: 20, k: 6, a: 0.6, lo: 0.3, hi: 1 } };
    const bounds = { x0: -60000, y0: -60000, x1: 60000, y1: 60000 };
    for (const kind of kFieldKinds) {
        piece.field.kind = kind;
        let last = 0;
        for (const level of [0.2, 0.4, 0.6, 0.8]) {
            const a = area_mm2(field_material(piece, level, bounds));
            assert.ok(a >= last, `${kind} at ${level}: ${a.toFixed(0)} after ${last.toFixed(0)}`);
            last = a;
        }
        assert.equal(field_material(piece, 1, bounds), null, 'level 1 keeps the whole outline');
    }
    assert.equal(field_level(piece, 0, 5), 0.3);
    assert.equal(field_level(piece, 4, 5), 1);
});

test('a field stack of every kind builds as one piece per layer, with no fatal finding', () => {
    for (const kind of kFieldKinds) {
        const d = base_design(5);
        d.piece.outline = { kind: 'circle', w_mm: 160 };
        d.piece.symmetry = { kind: 'dihedral', n: 6, phase_deg: 0 };
        d.piece.depth_mode = 'field';
        d.piece.field = { kind, scale_mm: 18, k: 6, a: 0.8, lo: 0.3, hi: 1 };
        const b = build_design(d);
        for (const [k, l] of b.layers.entries()) {
            assert.deepEqual(l.unbridged, [], `${kind} layer ${k + 1}`);
            assert.equal(components(l.material).length, 1, `${kind} layer ${k + 1} is one piece`);
        }
        const fatal = [...b.checks, ...slow_checks(d, b.layers)].filter(c => c.severity === 'fatal');
        assert.deepEqual(fatal.map(c => c.id), [], kind);
        assert.ok(b.layers.some(l => l.islands.length > 0), `${kind}: the field makes islands to bridge`);
    }
});
