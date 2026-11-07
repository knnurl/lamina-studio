// Sketch strokes and the picture field (SPEC M4.5): strokes drawn on any copy fold back into the
// fundamental domain whole; strokes cut as slots or filled shapes round the symmetry; a picture
// slices by tone with levels that nest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copy_of, to_domain, all_copies, simplify_line, chaikin, stroke_distance } from '../src/geom/sketch.js';
import { fundamental_domain, symmetry_matrices } from '../src/geom/symmetry.js';
import { motif_openings } from '../src/sources/motifs.js';
import { field_material } from '../src/sources/field.js';
import { area_mm2, union_all } from '../src/geom/clip.js';
import { components } from '../src/pipeline/islands.js';

const kSyms = [
    { kind: 'none', n: 1, phase_deg: 0 },
    { kind: 'rot', n: 5, phase_deg: 10 },
    { kind: 'dihedral', n: 6, phase_deg: 0 },
    { kind: 'mirror_x', n: 1, phase_deg: 0 },
    { kind: 'mirror_xy', n: 1, phase_deg: 20 },
];

test('a point on any copy goes back into the fundamental domain', () => {
    for (const sym of kSyms) {
        const dom = fundamental_domain(sym);
        const a = dom.a0 + 0.4 * (dom.a1 - dom.a0);
        const p = { x: 50 * Math.cos(a), y: 50 * Math.sin(a) };
        for (const m of symmetry_matrices(sym)) {
            const copy = { x: m[0] * p.x + m[1] * p.y, y: m[2] * p.x + m[3] * p.y };
            const back = to_domain([copy], sym)[0];
            assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-9, `${sym.kind}${sym.n}`);
            assert.ok(copy_of(copy, sym).every((v, i) => Math.abs(v - m[i]) < 1e-12) || dom.contains(back));
        }
    }
});

test('a stroke goes back whole by its first point, and its copies include where it was drawn', () => {
    const sym = { kind: 'dihedral', n: 6, phase_deg: 0 };
    // A stroke on the copy at about 130 degrees.
    const drawn = Array.from({ length: 10 }, (_, i) => {
        const a = ((128 + i * 0.5) * Math.PI) / 180;
        return { x: 80 * Math.cos(a), y: 80 * Math.sin(a) };
    });
    const dom = to_domain(drawn, sym);
    assert.ok(dom.every(p => fundamental_domain(sym).contains(p)), 'inside the domain');
    // Its length is unchanged: one transform for the whole stroke.
    const len = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    assert.ok(Math.abs(len(dom) - len(drawn)) < 1e-9);
    const copies = all_copies(dom, sym);
    assert.equal(copies.length, 12);
    assert.ok(copies.some(c => c.every((p, i) => Math.hypot(p.x - drawn[i].x, p.y - drawn[i].y) < 1e-9)), 'one copy is the stroke as drawn');
});

test('strokes cut as slots or filled shapes, repeated by the symmetry', () => {
    const sym = { kind: 'dihedral', n: 6, phase_deg: 0 };
    // An open stroke 20 mm long, 3 mm wide, inside the 0 to 30 degree domain.
    const slot = { type: 'sketch', strokes: [{ closed: false, fill: false, width_mm: 3, points: [[70, 8], [90, 8]] }] };
    const cut = motif_openings(slot, sym);
    const per_copy = 20 * 3 + Math.PI * 1.5 * 1.5; // round ends
    assert.ok(Math.abs(area_mm2(union_all(cut)) - 12 * per_copy) < 12 * 0.5, `slot area ${area_mm2(union_all(cut))}`);
    assert.equal(components(union_all(cut)).length, 12);
    // A filled square, 10 mm a side.
    const square = { type: 'sketch', strokes: [{ closed: true, fill: true, width_mm: 3, points: [[60, 5], [70, 5], [70, 15], [60, 15]] }] };
    assert.ok(Math.abs(area_mm2(union_all(motif_openings(square, sym))) - 12 * 100) < 1);
    // The same square, not filled: a slot round its outline.
    const outline = { type: 'sketch', strokes: [{ closed: true, fill: false, width_mm: 2, points: [[60, 5], [70, 5], [70, 15], [60, 15]] }] };
    const ring = area_mm2(union_all(motif_openings(outline, sym))) / 12;
    assert.ok(ring > 70 && ring < 100, `outline slot ${ring}`);
});

test('simplify, smooth and distance', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0.001 * Math.sin(i) }));
    assert.deepEqual(simplify_line(line, 0.01), [line[0], line[49]]);
    const zig = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    assert.equal(simplify_line(zig, 0.1).length, 3);
    const open = chaikin(zig, false, 2);
    assert.deepEqual(open[0], zig[0]);
    assert.deepEqual(open.at(-1), zig.at(-1));
    assert.equal(chaikin(zig, true, 1).length, 6);
    assert.equal(stroke_distance({ x: 5, y: 1 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }], false), 1);
});

// A synthetic picture: grey bytes, a dark disc in a light square.
function picture(w = 100, h = 100) {
    const bytes = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bytes[j * w + i] = Math.hypot(i - w / 2, j - h / 2) < 30 ? 30 : 220;
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return { w, h, data: btoa(bin), hash: 'test-disc' };
}

test('a picture slices by tone: the dark disc is material at low levels, and levels nest', () => {
    const bounds = { x0: -100000, y0: -100000, x1: 100000, y1: 100000 };
    const piece = { symmetry: { kind: 'none', n: 1 }, field: { kind: 'image', image: picture(), zoom: 1, smooth_mm: 0, invert: false } };
    const low = area_mm2(field_material(piece, 0.3, bounds));
    // The disc is 30 of 100 pixels in radius on a 200 mm square: 60 mm in radius, about 11,310 mm2.
    assert.ok(Math.abs(low - Math.PI * 60 * 60) / (Math.PI * 60 * 60) < 0.05, `disc area ${low}`);
    // Above the ground's tone (220 / 255), the whole 200 mm square is material.
    const high = area_mm2(field_material(piece, 0.95, bounds));
    assert.ok(Math.abs(high - 200 * 200) < 400, `at a high level the light ground is material too: ${high}`);
    // Swapped, the light ground is material at the low level instead.
    piece.field.invert = true;
    const swapped = area_mm2(field_material(piece, 0.3, bounds));
    // Together they tile the square, less the half-cell inset of the 0.75 mm grid at its border.
    assert.ok(Math.abs(swapped + low - 200 * 200) < 0.02 * 200 * 200, `swapped ${swapped} + disc ${low}`);
});
