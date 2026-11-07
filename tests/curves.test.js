// Radial mandala (SPEC 8.4, M4): Bezier flattening and node edits, curve motifs, conversion to an
// editable shape, edits reaching every symmetric copy, and the Mandala preset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    segment,
    cubic_at,
    flatten_shape,
    split_segment,
    nearest_on_shape,
    move_anchor,
    move_handle,
    delete_node,
    shape_area,
} from '../src/geom/bezier.js';
import { curve_nodes, to_shape, kCurveTypes } from '../src/sources/curves.js';
import { motif_openings } from '../src/sources/motifs.js';
import { base_design } from '../src/core/design.js';
import { compose_layer, build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { components, point_in_path } from '../src/pipeline/islands.js';
import { area_mm2, union_all } from '../src/geom/clip.js';
import { symmetry_matrices } from '../src/geom/symmetry.js';
import { preset_by_id } from '../src/core/presets.js';
import { generate_stack } from '../src/core/generate.js';

// A circle of radius R as four cubics (handle length 0.5523 R): within 0.03% of the circle.
function circle_nodes(R) {
    const k = 0.5523 * R;
    return [
        { x: R, y: 0, ix: R, iy: -k, ox: R, oy: k },
        { x: 0, y: R, ix: k, iy: R, ox: -k, oy: R },
        { x: -R, y: 0, ix: -R, iy: k, ox: -R, oy: -k },
        { x: 0, y: -R, ix: -k, iy: -R, ox: k, oy: -R },
    ];
}

const dist_to_polyline = (p, pts) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y));
    }
    return best;
};

test('flattening keeps every chord within the tolerance of the curve', () => {
    const nodes = circle_nodes(50);
    for (const tol of [0.1, 0.02, 0.005]) {
        const pts = flatten_shape(nodes, tol);
        for (let i = 0; i < nodes.length; i++) {
            const seg = segment(nodes, i);
            for (let k = 0; k <= 200; k++) assert.ok(dist_to_polyline(cubic_at(seg, k / 200), pts) <= tol * 1.01, `tol ${tol}`);
        }
        for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 50) < 50 * 0.0003 + 1e-9, 'the cubics follow the circle');
    }
    assert.ok(flatten_shape(nodes, 0.005).length > flatten_shape(nodes, 0.1).length, 'finer tolerance, more points');
    assert.ok(Math.abs(shape_area(nodes) - Math.PI * 2500) / (Math.PI * 2500) < 0.001);
});

test('node edits: split keeps the outline, anchors carry handles, smooth nodes stay smooth', () => {
    const nodes = circle_nodes(20);
    const split = split_segment(nodes, 1, 0.3);
    assert.equal(split.length, 5);
    const on = cubic_at(segment(nodes, 1), 0.3);
    assert.ok(Math.hypot(split[2].x - on.x, split[2].y - on.y) < 1e-9, 'the new node lies on the curve');
    assert.ok(Math.abs(shape_area(split) - shape_area(nodes)) < 1e-6 * shape_area(nodes), 'same outline');

    const moved = move_anchor(nodes, 0, 25, 3);
    assert.deepEqual([moved[0].ix - moved[0].x, moved[0].iy - moved[0].y], [nodes[0].ix - nodes[0].x, nodes[0].iy - nodes[0].y]);
    assert.equal(moved[1], nodes[1], 'other nodes untouched');

    const turned = move_handle(nodes, 1, 'out', -5, 30);
    const n = turned[1];
    const a = { x: n.ox - n.x, y: n.oy - n.y };
    const b = { x: n.ix - n.x, y: n.iy - n.y };
    assert.ok(Math.abs(a.x * b.y - a.y * b.x) < 1e-9 && a.x * b.x + a.y * b.y < 0, 'handles stay in line through the anchor');
    assert.ok(Math.abs(Math.hypot(b.x, b.y) - Math.hypot(nodes[1].ix - nodes[1].x, nodes[1].iy - nodes[1].y)) < 1e-9, 'the other handle keeps its length');

    assert.equal(delete_node(nodes, 0).length, 3);
    assert.equal(delete_node(delete_node(nodes, 0), 0).length, 3, 'never below three nodes');
    const near = nearest_on_shape(nodes, { x: 0, y: 23 });
    assert.ok(Math.abs(near.d - 3) < 0.01);
});

test('curve motifs: closed, counter-clockwise, and no islands under a kaleidoscope', () => {
    const sym = { kind: 'dihedral', n: 8, phase_deg: 0 };
    for (const type of [...kCurveTypes, 'petal']) {
        const m = { type, r_mm: 60, length_mm: 40, width_mm: type === 'scroll' ? 12 : 26, turns: 1.25, mult: 1, angle_deg: type === 'scroll' ? 90 / 8 : 0 };
        assert.ok(shape_area(curve_nodes(m)) > 0, `${type} winds counter-clockwise`);
        const d = base_design(2);
        d.piece.symmetry = sym;
        d.layers[0].source = { kind: 'primitive', motifs: [m] };
        const c = compose_layer(d, 0);
        assert.equal(components(c.material).length, 1, `${type}: one piece`);
        assert.ok(area_mm2(c.material) < area_mm2(c.outline) - 200, `${type} cuts something`);
    }
});

test('a petal converted to a shape has the same outline', () => {
    const sym = { kind: 'dihedral', n: 6, phase_deg: 0 };
    const petal = { type: 'petal', r_mm: 70, length_mm: 50, width_mm: 22, mult: 1, angle_deg: 0 };
    const shape = to_shape(petal);
    assert.equal(shape.type, 'shape');
    assert.equal(shape.r_mm, 70);
    const a = area_mm2(union_all(motif_openings(petal, sym)));
    const b = area_mm2(union_all(motif_openings(shape, sym)));
    assert.ok(Math.abs(a - b) / a < 0.002, `petal ${a.toFixed(1)} mm2, shape ${b.toFixed(1)} mm2`);
    for (const type of kCurveTypes) assert.equal(to_shape({ type, r_mm: 50, length_mm: 30, width_mm: 20, mult: 2, angle_deg: 5 }).mult, 2);
});

test('editing a shape node changes every symmetric copy', () => {
    const sym = { kind: 'dihedral', n: 6, phase_deg: 12 };
    const d = base_design(2);
    d.piece.symmetry = sym;
    const shape = to_shape({ type: 'petal', r_mm: 70, length_mm: 40, width_mm: 18, mult: 1, angle_deg: 0 });
    d.layers[0].source = { kind: 'primitive', motifs: [shape] };
    // The outer tip (largest x) moves 6 mm outwards.
    const tip = shape.nodes.reduce((a, n, i) => (n.x > shape.nodes[a].x ? i : a), 0);
    const probe_local = { x: 70 + shape.nodes[tip].x + 4, y: 0 }; // inside the new tip, in material before
    const material_at = (mat, p) => mat.reduce((n, path) => n + (point_in_path(p, path) ? 1 : 0), 0) % 2 === 1;
    const copies = symmetry_matrices(sym).map(m => ({ x: (m[0] * probe_local.x + m[1] * probe_local.y) * 1000, y: (m[2] * probe_local.x + m[3] * probe_local.y) * 1000 }));
    const before = compose_layer(d, 0).material;
    for (const p of copies) assert.ok(material_at(before, p), 'material before the edit');
    shape.nodes = move_anchor(shape.nodes, tip, shape.nodes[tip].x + 6, shape.nodes[tip].y);
    const after = compose_layer(d, 0).material;
    for (const p of copies) assert.ok(!material_at(after, p), 'cut on every copy after the edit');
});

test('the Mandala preset and mandala-style variations build with no fatal finding', () => {
    const fatal = d => {
        const b = build_design(d);
        return [...b.checks, ...slow_checks(d, b.layers)].filter(c => c.severity === 'fatal').map(c => c.key);
    };
    const made = preset_by_id('mandala');
    assert.equal(made.generator.style, 'mandala');
    const types = new Set(made.layers.flatMap(l => l.source.motifs.map(m => m.type)));
    assert.ok([...types].some(t => kCurveTypes.includes(t)), `curve motifs in the preset: ${[...types].join(', ')}`);
    assert.deepEqual(fatal(made), []);
    for (const seed of [1, 2, 3, 6]) {
        const d = preset_by_id('mandala');
        generate_stack(d, seed, { lock_n: true });
        assert.deepEqual(fatal(d), [], `seed ${seed}`);
    }
});
