// Geometry core over Clipper2: units, booleans, kerf-style offsets and circle flattening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    rect_path,
    circle_path,
    circle_segments,
    union_all,
    subtract,
    offset,
    area_mm2,
    bounds_mm,
    kChordTolUm,
} from '../src/geom/clip.js';
import { mm_to_um } from '../src/core/units.js';

const sq = (x0_mm, y0_mm, size_mm) =>
    rect_path(mm_to_um(x0_mm), mm_to_um(y0_mm), mm_to_um(x0_mm + size_mm), mm_to_um(y0_mm + size_mm));

test('union of two overlapping 10 mm squares is 175 mm2', () => {
    const merged = union_all([sq(0, 0, 10), sq(5, 5, 10)]);
    assert.equal(merged.length, 1);
    assert.equal(area_mm2(merged), 175);
});

test('kerf offset grows a 10 mm outline to 10.2 mm and shrinks a 10 mm hole to 9.8 mm', () => {
    const plate = subtract([sq(-20, -20, 40)], [sq(-5, -5, 10)]);
    const cut = offset(plate, mm_to_um(0.1), 'miter');
    const outer = cut.find(p => bounds_mm([p]).x1 - bounds_mm([p]).x0 > 30);
    const hole = cut.find(p => p !== outer);
    assert.deepEqual(bounds_mm([outer]), { x0: -20.1, y0: -20.1, x1: 20.1, y1: 20.1 });
    assert.deepEqual(bounds_mm([hole]), { x0: -4.9, y0: -4.9, x1: 4.9, y1: 4.9 });

    const single = offset([sq(0, 0, 10)], mm_to_um(0.1), 'miter');
    const b = bounds_mm(single);
    assert.equal(+(b.x1 - b.x0).toFixed(3), 10.2);
});

test('round offsets respect the chord tolerance instead of exploding the vertex count', () => {
    const grown = offset([sq(0, 0, 10)], mm_to_um(1), 'round');
    const vertices = grown[0].length;
    // Four quarter arcs of radius 1 mm at 0.02 mm tolerance need about 4 x 6 segments.
    assert.ok(vertices >= 16 && vertices <= 80, `vertex count ${vertices}`);
});

test('circles are flattened within the chord tolerance', () => {
    const r_mm = 150;
    const circle = circle_path(0, 0, mm_to_um(r_mm));
    assert.equal(circle.length, circle_segments(mm_to_um(r_mm)));
    const n = circle.length;
    const sagitta_um = mm_to_um(r_mm) * (1 - Math.cos(Math.PI / n));
    assert.ok(sagitta_um <= kChordTolUm + 1, `sagitta ${sagitta_um.toFixed(2)} um`);
    // An inscribed n-gon falls short of the circle by about (2 pi / n)^2 / 6 of its area:
    // 1.8e-4 at n = 193 (r = 150 mm, 0.02 mm tolerance).
    const exact = Math.PI * r_mm * r_mm;
    const expected_deficit = (2 * Math.PI / n) ** 2 / 6;
    const deficit = (exact - area_mm2([circle])) / exact;
    assert.ok(Math.abs(deficit - expected_deficit) < 2e-6, `deficit ${deficit}`);
});

test('a ring with a centre island keeps three contours', () => {
    const ring = subtract([circle_path(0, 0, mm_to_um(50))], [circle_path(0, 0, mm_to_um(30))]);
    const with_island = union_all([...ring, circle_path(0, 0, mm_to_um(10))]);
    assert.equal(with_island.length, 3);
    const expected = Math.PI * (50 * 50 - 30 * 30 + 10 * 10);
    assert.ok(Math.abs(area_mm2(with_island) - expected) / expected < 1e-3);
});
