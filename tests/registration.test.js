// Dowels, engraved IDs and spacers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base_design } from '../src/core/design.js';
import { build_design } from '../src/pipeline/compose.js';
import { dowel_angles, dowel_length_mm, kDowelEdgeMm } from '../src/pipeline/registration.js';
import { point_in_path } from '../src/pipeline/islands.js';
import { preset_by_id } from '../src/core/presets.js';

// Inside the material: odd number of containing contours (holes are contours too).
const in_material = (p, material) => material.filter(path => point_in_path(p, path)).length % 2 === 1;

const around = (c, r_um, n = 16) =>
    Array.from({ length: n }, (_, i) => ({
        x: c.x + r_um * Math.cos((2 * Math.PI * i) / n),
        y: c.y + r_um * Math.sin((2 * Math.PI * i) / n),
    }));

test('dowel angles: every gap differs, so no rotation or flip maps the set onto itself', () => {
    for (let n = 3; n <= 6; n++) {
        const a = dowel_angles(n);
        assert.equal(a.length, n);
        const gaps = a.map((x, i) => (((a[(i + 1) % n] - x) % 360) + 360) % 360);
        assert.ok(Math.abs(gaps.reduce((s, g) => s + g, 0) - 360) < 1e-6);
        const sorted = [...gaps].sort((p, q) => p - q);
        for (let i = 1; i < n; i++) assert.ok(sorted[i] - sorted[i - 1] >= 5, `n=${n} gaps ${sorted}`);
    }
});

test('dowels sit in material every layer shares; the front layer is not drilled', () => {
    const d = preset_by_id('orb');
    const b = build_design(d);
    const { dowels } = b.registration;
    assert.equal(dowels.length, 3);
    const r_hole = (b.registration.hole_d_mm / 2) * 1000;
    for (const c of dowels) {
        assert.ok(in_material(c, b.layers[0].material), 'hidden behind the undrilled front layer');
        for (const l of b.layers.slice(1)) {
            assert.ok(!in_material(c, l.material), 'drilled through');
            for (const p of around(c, r_hole + (kDowelEdgeMm - 0.5) * 1000)) {
                assert.ok(in_material(p, l.material), 'material all round the hole');
            }
        }
    }
});

test('through_front drills the front layer too', () => {
    const d = preset_by_id('orb');
    d.registration.through_front = true;
    const b = build_design(d);
    for (const c of b.registration.dowels) assert.ok(!in_material(c, b.layers[0].material));
});

test('IDs: on every layer but the front, hidden by the layer in front, clear of dowels', () => {
    const d = preset_by_id('rose');
    const b = build_design(d);
    assert.equal(b.layers[0].ids.length, 0);
    const r_keep = (b.registration.hole_d_mm / 2 + kDowelEdgeMm) * 1000;
    b.layers.forEach((l, k) => {
        if (k === 0) return;
        assert.ok(l.ids.length > 0, `layer ${k + 1} has an ID`);
        for (const p of l.ids.flat()) {
            assert.ok(in_material(p, l.material), `ID on material, layer ${k + 1}`);
            assert.ok(in_material(p, b.layers[k - 1].material), `ID hidden by layer ${k}`);
            for (const c of b.registration.dowels) assert.ok(Math.hypot(p.x - c.x, p.y - c.y) > r_keep);
        }
    });
    d.registration.ids = false;
    assert.ok(build_design(d).layers.every(l => l.ids.length === 0));
});

test('spacers: one sheet per stock thickness of gap, pucks per dowel or rings', () => {
    const d = preset_by_id('orb');
    d.layers[1].gap_mm = 6; // two 3 mm sheets
    d.layers[3].gap_mm = 3;
    const pucks = build_design(d).registration.spacers;
    assert.deepEqual(pucks.map(s => [s.kind, s.gap, s.copies]), [
        ['puck', 1, 6],
        ['puck', 3, 3],
    ]);
    d.spacers.style = 'rings';
    const rings = build_design(d).registration.spacers;
    assert.deepEqual(rings.map(s => [s.kind, s.gap, s.copies]), [
        ['ring', 1, 2],
        ['ring', 3, 1],
    ]);
    assert.ok(rings.every(s => s.paths.length >= 2), 'a ring has its outline, inner edge and dowel holes');
});

test('no shared material for dowels is a warning, not a crash', () => {
    const d = base_design(3);
    d.layers[0].frame_ring_mm = 0;
    d.layers[0].source.motifs = [{ type: 'disc', d_mm: 289 }];
    const b = build_design(d);
    assert.equal(b.registration.dowels.length, 0);
    assert.ok(b.checks.some(c => c.id === 'W-05'));
});

test('dowel length covers the drilled layers and the gaps between them', () => {
    const d = base_design(4);
    d.layers[1].gap_mm = 6;
    // drilled: L2, L3, L4 (3 mm each) plus the 6 mm gap behind L2
    assert.equal(dowel_length_mm(d), 15);
    d.registration.through_front = true;
    d.layers[0].gap_mm = 3;
    assert.equal(dowel_length_mm(d), 21);
});

test('registration is deterministic', () => {
    const a = build_design(preset_by_id('gate'));
    const b = build_design(preset_by_id('gate'));
    assert.deepEqual(a.registration.dowels, b.registration.dowels);
    assert.deepEqual(a.layers.map(l => l.ids), b.layers.map(l => l.ids));
});
