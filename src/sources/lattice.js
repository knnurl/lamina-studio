// Lattice and fret motifs (SPEC 8.2, M2). Both are built inside the symmetry's fundamental domain
// and replicated by the symmetry engine.
// - Lattice: a maze on a square, 45-degree or polar grid. Walls are material bars, cells are
//   openings. A perfect maze's walls all reach the boundary, so there are no islands; openness
//   removes only dead-end walls, which cannot disconnect any other wall. Painted cells are solid.
// - Fret: a ring band of interlocking hook tiles, every hook attached to the band's edge bars.
// Assumptions: micrometres, origin at the symmetry centre, symmetry phase applied by replicate().
import { stroke, union_all, subtract, intersect_paths, offset, circle_segments } from '../geom/clip.js';
import { fundamental_domain, sector_multiple } from '../geom/symmetry.js';
import { rng_for } from '../core/rng.js';
import { mm_to_um } from '../core/units.js';

const TAU = 2 * Math.PI;

function arc(r, a0, a1, tol_um = 40) {
    const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) / TAU) * circle_segments(r, tol_um)));
    const out = [];
    for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push({ x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) });
    }
    return out;
}

const pt = (x, y) => ({ x: Math.round(x), y: Math.round(y) });

// A grid of cells and the edges between them, limited to the annulus r0..r1 and the domain.
// cells: [{ id, poly }]; edges: [{ a, b, line }] with b = -1 on the boundary.
export function make_grid(kind, cell_um, r0_um, r1_um, sym) {
    const dom = fundamental_domain(sym);
    const cells = [];
    const index = new Map();
    const edges = [];
    const add_cell = (id, centre, poly) => {
        const r = Math.hypot(centre.x, centre.y);
        if (r < r0_um || r > r1_um || !dom.contains(centre)) return;
        index.set(id, cells.length);
        cells.push({ id, poly });
    };

    if (kind === 'polar') {
        // Sectors start at the domain's first edge, so both its edges fall on cell edges (a
        // mirror's half-plane starts at -90 degrees).
        const base = dom.a0;
        const ang = (j, s) => base + (TAU * j) / s;
        const rings = Math.max(1, Math.round((r1_um - r0_um) / cell_um));
        const dr = (r1_um - r0_um) / rings;
        const m = sector_multiple(sym);
        const sectors = [];
        for (let k = 0; k < rings; k++) {
            const ra = r0_um + k * dr;
            const rb = ra + dr;
            const s = Math.max(m, Math.round((TAU * (ra + rb)) / 2 / cell_um / m) * m);
            sectors.push(s);
            for (let j = 0; j < s; j++) {
                const a0 = ang(j, s);
                const a1 = ang(j + 1, s);
                const am = (a0 + a1) / 2;
                const rm = (ra + rb) / 2;
                const centre = { x: rm * Math.cos(am), y: rm * Math.sin(am) };
                if (!dom.contains(centre)) continue;
                add_cell(`p:${k}:${j}`, centre, [...arc(rb, a0, a1), ...arc(ra, a1, a0)]);
            }
        }
        const has = (k, j) => index.has(`p:${k}:${j}`);
        for (let k = 0; k < rings; k++) {
            const ra = r0_um + k * dr;
            const rb = ra + dr;
            const s = sectors[k];
            for (let j = 0; j < s; j++) {
                if (!has(k, j)) continue;
                const a = index.get(`p:${k}:${j}`);
                // Radial edge at the cell's far side.
                const a1 = ang(j + 1, s);
                const jn = (j + 1) % s;
                edges.push({ a, b: has(k, jn) ? index.get(`p:${k}:${jn}`) : -1, line: [pt(ra * Math.cos(a1), ra * Math.sin(a1)), pt(rb * Math.cos(a1), rb * Math.sin(a1))] });
                // Its near side, when the neighbour there is outside the domain.
                const jp = (j - 1 + s) % s;
                if (!has(k, jp)) {
                    const a0 = ang(j, s);
                    edges.push({ a, b: -1, line: [pt(ra * Math.cos(a0), ra * Math.sin(a0)), pt(rb * Math.cos(a0), rb * Math.sin(a0))] });
                }
                // Arcs to the ring outside (shared stretches) or to the boundary.
                const c0 = ang(j, s);
                const c1 = a1;
                if (k + 1 < rings) {
                    const s2 = sectors[k + 1];
                    let covered = 0;
                    for (let i = Math.floor(((c0 - base) / TAU) * s2); i <= Math.ceil(((c1 - base) / TAU) * s2); i++) {
                        const d0 = Math.max(c0, ang(i, s2));
                        const d1 = Math.min(c1, ang(i + 1, s2));
                        if (d1 - d0 < 1e-9) continue;
                        const ii = ((i % s2) + s2) % s2;
                        edges.push({ a, b: has(k + 1, ii) ? index.get(`p:${k + 1}:${ii}`) : -1, line: arc(rb, d0, d1) });
                        covered += d1 - d0;
                    }
                    if (covered < c1 - c0 - 1e-9) edges.push({ a, b: -1, line: arc(rb, c0, c1) });
                } else {
                    edges.push({ a, b: -1, line: arc(rb, c0, c1) });
                }
                if (k === 0) edges.push({ a, b: -1, line: arc(ra, c0, c1) });
            }
        }
        // Arcs facing an inner ring cell that is outside the domain.
        for (let k = 1; k < rings; k++) {
            const ra = r0_um + k * dr;
            const s = sectors[k];
            const s0 = sectors[k - 1];
            for (let j = 0; j < s; j++) {
                if (!has(k, j)) continue;
                const c0 = ang(j, s);
                const c1 = ang(j + 1, s);
                for (let i = Math.floor(((c0 - base) / TAU) * s0); i <= Math.ceil(((c1 - base) / TAU) * s0); i++) {
                    const d0 = Math.max(c0, ang(i, s0));
                    const d1 = Math.min(c1, ang(i + 1, s0));
                    const ii = ((i % s0) + s0) % s0;
                    if (d1 - d0 > 1e-9 && !has(k - 1, ii)) edges.push({ a: index.get(`p:${k}:${j}`), b: -1, line: arc(ra, d0, d1) });
                }
            }
        }
        return { cells, edges };
    }

    // Square grid, or the same turned 45 degrees ('diag'). Grid lines pass through the origin, so
    // mirror axes fall on cell edges.
    const turn = kind === 'diag' ? Math.PI / 4 : 0;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const map = (u, v) => ({ x: u * cos - v * sin, y: u * sin + v * cos });
    const span = Math.ceil(r1_um / cell_um) + 1;
    for (let i = -span; i < span; i++) {
        for (let j = -span; j < span; j++) {
            const centre = map((i + 0.5) * cell_um, (j + 0.5) * cell_um);
            const corner = (di, dj) => {
                const p = map((i + di) * cell_um, (j + dj) * cell_um);
                return pt(p.x, p.y);
            };
            add_cell(`${kind === 'diag' ? 'd' : 's'}:${i}:${j}`, centre, [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]);
        }
    }
    const tag = kind === 'diag' ? 'd' : 's';
    for (const cell of cells) {
        const [, si, sj] = cell.id.split(':');
        const i = Number(si);
        const j = Number(sj);
        const a = index.get(cell.id);
        const side = (di, dj, p, q) => {
            const nid = `${tag}:${i + di}:${j + dj}`;
            const b = index.has(nid) ? index.get(nid) : -1;
            if (b !== -1 && b < a) return; // shared edges once
            edges.push({ a, b, line: [p, q] });
        };
        const c = cell.poly;
        side(0, -1, c[0], c[1]);
        side(1, 0, c[1], c[2]);
        side(0, 1, c[2], c[3]);
        side(-1, 0, c[3], c[0]);
    }
    return { cells, edges };
}

// Randomised depth-first maze over the domain's cells, then dead-end pruning by openness.
// Returns the edges that stay as walls.
export function maze_walls(grid, seed, openness) {
    const rng = rng_for(seed, 'maze');
    const n = grid.cells.length;
    const adj = Array.from({ length: n }, () => []);
    grid.edges.forEach((e, i) => {
        if (e.b >= 0) {
            adj[e.a].push([e.b, i]);
            adj[e.b].push([e.a, i]);
        }
    });
    const open = new Set();
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start++) {
        if (seen[start]) continue;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
            const c = stack[stack.length - 1];
            const choices = adj[c].filter(([d]) => !seen[d]);
            if (!choices.length) {
                stack.pop();
                continue;
            }
            const [d, edge] = choices[Math.floor(rng.next() * choices.length)];
            open.add(edge);
            seen[d] = 1;
            stack.push(d);
        }
    }
    let walls = grid.edges.map((e, i) => i).filter(i => !open.has(i));

    // Dead-end pruning: a wall with an endpoint that no other wall touches can go without
    // disconnecting anything. Boundary walls always stay.
    const interior = walls.filter(i => grid.edges[i].b >= 0).length;
    let to_remove = Math.round(Math.max(0, Math.min(1, openness)) * interior);
    const key = p => `${Math.round(p.x / 5)},${Math.round(p.y / 5)}`;
    while (to_remove > 0) {
        const degree = new Map();
        for (const i of walls) {
            const line = grid.edges[i].line;
            for (const p of [line[0], line[line.length - 1]]) degree.set(key(p), (degree.get(key(p)) ?? 0) + 1);
        }
        const leaves = walls.filter(i => {
            const e = grid.edges[i];
            return e.b >= 0 && (degree.get(key(e.line[0])) === 1 || degree.get(key(e.line[e.line.length - 1])) === 1);
        });
        if (!leaves.length) break;
        const pick = leaves[Math.floor(rng.next() * leaves.length)];
        walls = walls.filter(i => i !== pick);
        to_remove--;
    }
    return walls.map(i => grid.edges[i]);
}

// Openings of a lattice motif in the fundamental domain.
export function lattice_openings(m, sym) {
    const cell = mm_to_um(Math.max(1, m.cell_mm));
    const bar = mm_to_um(Math.max(0.3, m.bar_mm));
    const grid = make_grid(m.grid ?? 'polar', cell, mm_to_um(m.r0_mm ?? 0), mm_to_um(m.r1_mm), sym);
    if (!grid.cells.length) return [];
    const walls = maze_walls(grid, m.seed ?? 1, m.openness ?? 0);
    // The region is the union of the cells, except on polar grids: there neighbouring rings
    // sample their shared arcs at different points, and the union would keep cracks up to the
    // chord tolerance wide as slivers. The polar region is the exact band sector instead.
    let region;
    let edge_bars = [];
    if ((m.grid ?? 'polar') === 'polar') {
        const dom = fundamental_domain(sym);
        const r0 = mm_to_um(m.r0_mm ?? 0);
        const r1 = mm_to_um(m.r1_mm);
        region = dom.a1 - dom.a0 >= TAU - 1e-9 ? [arc(r1, 0, TAU), arc(r0, TAU, 0)] : [[...arc(r1, dom.a0, dom.a1), ...arc(r0, dom.a1, dom.a0)]];
        if (r0 <= 0) region = [arc(r1, dom.a0, dom.a1).concat(dom.a1 - dom.a0 >= TAU - 1e-9 ? [] : [{ x: 0, y: 0 }])];
    } else {
        // Square cells straddle a wedge's edges; replicated, their openings would overlap the
        // next wedge's and cut through its bars. So the region is clipped to the exact domain, and
        // the domain's edges become bars, which the next wedge's copy meets edge to edge.
        region = union_all(grid.cells.map(c => c.poly));
        const dom = fundamental_domain(sym);
        if (dom.a1 - dom.a0 < TAU - 1e-9) {
            const R = mm_to_um(m.r1_mm) + 2 * cell;
            const ray = a => [pt(0, 0), pt(R * Math.cos(a), R * Math.sin(a))];
            region = intersect_paths(region, [[pt(0, 0), ...arc(R, dom.a0, dom.a1)]]);
            edge_bars = [ray(dom.a0), ray(dom.a1)];
        }
    }
    let openings = subtract(region, stroke([...walls.map(w => w.line), ...edge_bars], bar, 'square'));
    // Painted cells are solid; grown a little so no crack is left along their edges.
    const solid = new Set(Object.entries(m.cells ?? {}).filter(([, v]) => v === 'solid').map(([id]) => id));
    if (solid.size) openings = subtract(openings, offset(grid.cells.filter(c => solid.has(c.id)).map(c => c.poly), 20, 'miter'));
    return openings;
}

// The grid cell (in the fundamental domain) under a point already mapped into that domain.
export function lattice_cell_at(m, sym, p) {
    const grid = make_grid(m.grid ?? 'polar', mm_to_um(Math.max(1, m.cell_mm)), mm_to_um(m.r0_mm ?? 0), mm_to_um(m.r1_mm), sym);
    const inside = (q, poly) => {
        let hit = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i];
            const b = poly[j];
            if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
        }
        return hit;
    };
    return grid.cells.find(c => inside(p, c.poly))?.id ?? null;
}

// Fret tiles on a grid of W x H units: polylines of bars. Every hook starts on a band edge.
const kFrets = {
    greek: { w: 5, h: 5, lines: [[[0, 0], [0, 4], [4, 4], [4, 2], [2, 2]]] },
    double: {
        w: 6,
        h: 5,
        lines: [
            [[0, 0], [0, 4], [4, 4], [4, 2], [2, 2]],
            [[5, 5], [5, 1], [1, 1], [1, 3], [3, 3]],
        ],
    },
    tfret: {
        w: 6,
        h: 6,
        lines: [
            [[1.5, 0], [1.5, 2]],
            [[0.5, 2], [2.5, 2]],
            [[4.5, 6], [4.5, 4]],
            [[3.5, 4], [5.5, 4]],
        ],
    },
};
export const kFretPatterns = Object.keys(kFrets);

// Openings of a fret band in the fundamental domain: band sector minus edge bars and hook bars.
export function fret_openings(m, sym) {
    const tile = kFrets[m.pattern] ?? kFrets.greek;
    const dom = fundamental_domain(sym);
    const r_in = mm_to_um(m.r_mm - m.w_mm / 2);
    const r_out = mm_to_um(m.r_mm + m.w_mm / 2);
    if (r_in <= 0 || r_out <= r_in) return [];
    const tiles = Math.max(1, Math.round(m.tiles ?? 1));
    const total_u = tile.w * tiles;
    const map = (u, v) => {
        const a = dom.a0 + (u / total_u) * (dom.a1 - dom.a0);
        const r = r_in + (v / tile.h) * (r_out - r_in);
        return pt(r * Math.cos(a), r * Math.sin(a));
    };
    const lines = [];
    for (let t = 0; t < tiles; t++) {
        // A tie across the band at each tile's start. A meander's corridor would otherwise run
        // unbroken round the ring and cut the inner edge off from the outer one.
        lines.push([map(t * tile.w, 0), map(t * tile.w, tile.h)]);
        for (const line of tile.lines) {
            const out = [];
            for (let i = 0; i + 1 < line.length; i++) {
                const [u0, v0] = line[i];
                const [u1, v1] = line[i + 1];
                const steps = Math.max(1, Math.ceil(Math.abs(u1 - u0) * 4));
                for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
                    out.push(map(t * tile.w + u0 + ((u1 - u0) * s) / steps, v0 + ((v1 - v0) * s) / steps));
                }
            }
            lines.push(out);
        }
    }
    lines.push(arc(r_in, dom.a0, dom.a1), arc(r_out, dom.a0, dom.a1));
    const sector = [...arc(r_out, dom.a0, dom.a1), ...arc(r_in, dom.a1, dom.a0)];
    return subtract([sector], stroke(lines, mm_to_um(Math.max(0.3, m.bar_mm)), 'square'));
}

