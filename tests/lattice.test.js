// Lattice and fret motifs (SPEC 8.2, M2): grids, maze connectivity, openness pruning, cell paint
// and its live symmetry, fret tiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base_design } from '../src/core/design.js';
import { compose_layer, build_design } from '../src/pipeline/compose.js';
import { components, point_in_path } from '../src/pipeline/islands.js';
import { make_grid, maze_walls, lattice_cell_at, kFretPatterns } from '../src/sources/lattice.js';
import { fundamental_domain, sector_multiple, symmetry_matrices, fold_point } from '../src/geom/symmetry.js';
import { area_mm2 } from '../src/geom/clip.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { preset_by_id } from '../src/core/presets.js';
import { generate_stack } from '../src/core/generate.js';

const kSyms = [
    { kind: 'none', n: 1 },
    { kind: 'rot', n: 5 },
    { kind: 'dihedral', n: 8 },
    { kind: 'dihedral', n: 3 },
    { kind: 'mirror_x', n: 1 },
    { kind: 'mirror_xy', n: 1 },
];
const kGrids = ['polar', 'square', 'diag'];

const lattice = (grid, extra = {}) => ({ type: 'lattice', grid, r0_mm: 20, r1_mm: 85, cell_mm: 9, bar_mm: 2, openness: 0.4, seed: 1, cells: {}, ...extra });

// A 200 mm circle whose front layer holds the given motifs, under sym.
function one_layer(sym, motifs) {
    const d = base_design(2);
    d.piece.outline = { kind: 'circle', w_mm: 200 };
    d.piece.symmetry = { phase_deg: 0, ...sym };
    d.layers[0].frame_ring_mm = 8;
    d.layers[0].source = { kind: 'primitive', motifs };
    return d;
}

test('grids: every cell lies in the fundamental domain, and polar sectors fit its edges', () => {
    for (const sym of kSyms) {
        const dom = fundamental_domain(sym);
        for (const kind of kGrids) {
            const g = make_grid(kind, 9000, 20000, 85000, sym);
            assert.ok(g.cells.length > 10, `${sym.kind}${sym.n} ${kind}: ${g.cells.length} cells`);
            for (const c of g.cells) {
                const cx = c.poly.reduce((s, p) => s + p.x, 0) / c.poly.length;
                const cy = c.poly.reduce((s, p) => s + p.y, 0) / c.poly.length;
                if (kind !== 'polar') assert.ok(dom.contains({ x: cx, y: cy }), `${kind} cell ${c.id} outside the domain`);
            }
            for (const e of g.edges) assert.ok(e.a >= 0 && e.a < g.cells.length && e.b < g.cells.length);
        }
        // Polar: the cells of one ring tile the domain's angle exactly.
        const g = make_grid('polar', 9000, 20000, 85000, sym);
        const ring0 = g.cells.filter(c => c.id.startsWith('p:0:'));
        const copies = (2 * Math.PI) / (dom.a1 - dom.a0);
        const total = Math.round(ring0.length * copies);
        assert.ok(Math.abs(ring0.length * copies - total) < 1e-9, 'whole sectors per domain');
        assert.equal(total % sector_multiple(sym), 0);
    }
});

test('a lattice has no islands on every grid, under every symmetry, at any openness', () => {
    for (const sym of kSyms) {
        for (const grid of kGrids) {
            for (const openness of [0, 1]) {
                const c = compose_layer(one_layer(sym, [lattice(grid, { openness, seed: 3 })]), 0);
                assert.equal(components(c.material).length, 1, `${sym.kind}${sym.n} ${grid} openness ${openness}`);
            }
        }
    }
});

test('the maze spans its cells, and openness removes only dead-end walls', () => {
    const sym = { kind: 'dihedral', n: 8, phase_deg: 0 };
    const g = make_grid('polar', 9000, 20000, 85000, sym);
    const interior = g.edges.filter(e => e.b >= 0).length;
    const boundary = g.edges.length - interior;
    const closed = maze_walls(g, 1, 0);
    // A spanning tree opens n - 1 interior edges (one per cell joined), for each connected part.
    assert.ok(g.edges.length - closed.length <= g.cells.length - 1);
    assert.ok(g.edges.length - closed.length >= g.cells.length - 3);
    let last = closed.length;
    for (const openness of [0.25, 0.5, 1]) {
        const walls = maze_walls(g, 1, openness);
        assert.ok(walls.length <= last, `openness ${openness}: ${walls.length} walls, before ${last}`);
        assert.equal(walls.filter(e => e.b < 0).length, boundary, 'boundary walls always stay');
        last = walls.length;
    }
    assert.ok(last < closed.length, 'full openness removes walls');
    assert.deepEqual(maze_walls(g, 7, 0.5), maze_walls(g, 7, 0.5), 'deterministic for a seed');
});

test('cell paint: a clicked copy maps to its domain cell, and the paint survives a re-roll', () => {
    const sym = { kind: 'dihedral', n: 8, phase_deg: 10 };
    const m = lattice('polar');
    // A point on a mirrored copy, folded back, finds the same cell as its domain image.
    const domain_p = fold_point({ x: 50000 * Math.cos(0.2), y: 50000 * Math.sin(0.2) }, { ...sym, phase_deg: 0 });
    const want = lattice_cell_at(m, sym, domain_p);
    assert.ok(want, 'a cell under the domain point');
    for (const mat of symmetry_matrices(sym)) {
        const p = { x: mat[0] * domain_p.x + mat[1] * domain_p.y, y: mat[2] * domain_p.x + mat[3] * domain_p.y };
        assert.equal(lattice_cell_at(m, sym, fold_point(p, sym)), want);
    }
    // Painting the cell adds material; changing the seed keeps the painted cell solid.
    const d = one_layer(sym, [m]);
    const before = area_mm2(compose_layer(d, 0).material);
    m.cells[want] = 'solid';
    const painted = compose_layer(d, 0).material;
    assert.ok(area_mm2(painted) > before + 20, `paint adds material: ${before} -> ${area_mm2(painted)}`);
    const inside = (material, p) => material.reduce((n, path) => n + (point_in_path(p, path) ? 1 : 0), 0) % 2 === 1;
    // The cell's centre, on every copy (the phase is part of each copy), is now material.
    const g = make_grid('polar', 9000, 20000, 85000, sym);
    const cell = g.cells.find(c => c.id === want);
    const cx = cell.poly.reduce((s, p) => s + p.x, 0) / cell.poly.length;
    const cy = cell.poly.reduce((s, p) => s + p.y, 0) / cell.poly.length;
    const copies = symmetry_matrices(sym).map(mat => ({ x: mat[0] * cx + mat[1] * cy, y: mat[2] * cx + mat[3] * cy }));
    for (const p of copies) assert.ok(inside(painted, p), 'painted on every copy');
    m.seed = 99;
    const rolled = compose_layer(d, 0).material;
    for (const p of copies) assert.ok(inside(rolled, p), 'still solid after a re-roll');
    assert.equal(components(rolled).length, 1);
});

test('fret bands: every pattern stays one piece under every symmetry', () => {
    for (const sym of kSyms) {
        for (const pattern of kFretPatterns) {
            const fret = { type: 'fret', pattern, r_mm: 70, w_mm: 14, bar_mm: 2, tiles: 3 };
            const c = compose_layer(one_layer(sym, [fret]), 0);
            assert.equal(components(c.material).length, 1, `${sym.kind}${sym.n} ${pattern}`);
            assert.ok(area_mm2(c.material) < area_mm2(c.outline) - 100, 'the fret cuts something');
        }
    }
});

test('the Lattice orb preset, and lattice-style variations, build with no fatal finding', () => {
    const fatal = d => {
        const b = build_design(d);
        return [...b.checks, ...slow_checks(d, b.layers)].filter(c => c.severity === 'fatal').map(c => c.id);
    };
    const orb = preset_by_id('lattice');
    assert.equal(orb.layers.length, 12);
    assert.equal(orb.generator.style, 'lattice');
    assert.deepEqual(fatal(orb), []);
    // Randomise keeps the first of ten clean; in practice each seed tried here is clean.
    for (const seed of [2, 3, 4]) {
        const d = preset_by_id('lattice');
        generate_stack(d, seed, { lock_n: true });
        assert.deepEqual(fatal(d), [], `seed ${seed}`);
    }
});
