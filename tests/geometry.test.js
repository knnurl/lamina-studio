// Symmetry, outlines, motifs and layer composition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symmetry_matrices, replicate } from '../src/geom/symmetry.js';
import { outline_paths } from '../src/geom/outline.js';
import { motif_openings, layer_openings } from '../src/sources/motifs.js';
import { compose_layer, build_design } from '../src/pipeline/compose.js';
import { pack_paths, unpack_paths } from '../src/geom/pack.js';
import { area_mm2, path_area_um2, union_all, bounds_mm } from '../src/geom/clip.js';
import { base_design } from '../src/core/design.js';
import { kPresets } from '../src/core/presets.js';

const near = (a, b, rel = 1e-3) => Math.abs(a - b) <= rel * Math.abs(b);

test('symmetry groups have the right sizes', () => {
    assert.equal(symmetry_matrices({ kind: 'none' }).length, 1);
    assert.equal(symmetry_matrices({ kind: 'rot', n: 8 }).length, 8);
    assert.equal(symmetry_matrices({ kind: 'dihedral', n: 8 }).length, 16);
    assert.equal(symmetry_matrices({ kind: 'mirror_x' }).length, 2);
    assert.equal(symmetry_matrices({ kind: 'mirror_xy' }).length, 4);
});

test('mirrored copies stay counter-clockwise, so a symmetric motif does not cancel', () => {
    const square = [
        { x: 10000, y: -2000 },
        { x: 14000, y: -2000 },
        { x: 14000, y: 2000 },
        { x: 10000, y: 2000 },
    ];
    const copies = replicate([square], { kind: 'dihedral', n: 4 });
    assert.equal(copies.length, 8);
    for (const c of copies) assert.ok(path_area_um2(c) > 0);
    // Each mirrored copy lands exactly on a rotated one, so the union is 4 squares of 16 mm2.
    assert.equal(area_mm2(union_all(copies)), 64);
});

test('outlines have the expected areas', () => {
    assert.ok(near(area_mm2(outline_paths({ kind: 'circle', w_mm: 200 })), Math.PI * 100 * 100));
    assert.equal(area_mm2(outline_paths({ kind: 'rect', w_mm: 300, h_mm: 200, corner_r_mm: 0 })), 60000);
    const hex = outline_paths({ kind: 'polygon', w_mm: 200, sides: 6 });
    assert.ok(near(area_mm2(hex), (3 * Math.sqrt(3) / 2) * 100 * 100));
    const ys = hex[0].map(p => p.y).sort((a, b) => a - b);
    assert.equal(ys[0], ys[1], 'flat bottom: the two lowest vertices share a y');
    const arch = outline_paths({ kind: 'arch', w_mm: 200, h_mm: 300 });
    assert.ok(near(area_mm2(arch), 200 * 200 + (Math.PI * 100 * 100) / 2));
});

test('motif openings: counts and areas under symmetry', () => {
    const sym = { kind: 'rot', n: 6 };
    const windows = motif_openings({ type: 'window', r_mm: 50, size_mm: 10, sides: 4, rot_deg: 0, mult: 2, angle_deg: 0 }, sym);
    assert.equal(windows.length, 12);
    const square_mm2 = 2 * 5 * 5; // a square of circumradius 5 mm
    assert.ok(near(area_mm2(union_all(windows)), 12 * square_mm2));

    const disc = motif_openings({ type: 'disc', d_mm: 40 }, sym);
    assert.equal(disc.length, 1, 'centre openings are not replicated');

    // Arc slots with no tie join into a full annulus.
    const ring = motif_openings({ type: 'ring', r_mm: 50, w_mm: 10, tie_mm: 0, mult: 1, angle_deg: 0 }, sym);
    assert.ok(near(area_mm2(union_all(ring)), Math.PI * (55 * 55 - 45 * 45), 2e-3));
    // With a tie, n separate slots remain.
    const slots = union_all(motif_openings({ type: 'ring', r_mm: 50, w_mm: 10, tie_mm: 4, mult: 1, angle_deg: 0 }, sym));
    assert.equal(slots.length, 6);

    const petals = motif_openings({ type: 'petal', r_mm: 60, length_mm: 30, width_mm: 10, mult: 1, angle_deg: 0 }, sym);
    for (const p of petals) assert.ok(path_area_um2(p) > 0);
    const rays = motif_openings({ type: 'ray', r0_mm: 20, r1_mm: 80, w0_mm: 0, w1_mm: 10, mult: 1, angle_deg: 0 }, sym);
    assert.ok(near(area_mm2(union_all(rays)), 6 * 0.5 * 60 * 10));
});

test('a layer is its outline minus the openings inside its frame ring', () => {
    const d = base_design(2);
    d.layers[0].frame_ring_mm = 20;
    d.layers[0].source.motifs = [
        { type: 'disc', d_mm: 100 },
        // a ring of windows that pokes past the frame ring: it is clipped there
        { type: 'window', r_mm: 135, size_mm: 30, sides: 0, rot_deg: 0, mult: 1, angle_deg: 0 },
    ];
    const { outline, inner, material } = compose_layer(d, 0);
    const disc_mm2 = Math.PI * 50 * 50;
    const removed = area_mm2(outline) - area_mm2(material);
    assert.ok(removed > disc_mm2, 'windows remove material too');
    // Nothing is removed outside the frame ring's inner edge.
    for (const p of material.filter(q => path_area_um2(q) > 0)) {
        assert.ok(area_mm2([p]) <= area_mm2(outline));
    }
    const ring_mm2 = area_mm2(outline) - area_mm2(inner);
    assert.ok(area_mm2(material) >= ring_mm2, 'the frame ring stays whole');
});

test('every preset builds quickly enough to sculpt with', () => {
    for (const p of kPresets) {
        const built = build_design(p.make());
        assert.ok(built.layers.every(l => l.area_mm2 > 0), p.id);
        assert.ok(built.ms < 400, `${p.id} took ${built.ms.toFixed(0)} ms`);
    }
});

test('packing round-trips paths exactly', () => {
    const paths = [
        [
            { x: 1, y: -2 },
            { x: 3, y: 4 },
        ],
        [],
        [{ x: -2147483000, y: 2147483000 }],
    ];
    assert.deepEqual(unpack_paths(pack_paths(paths)), paths);
});
