// Sketch strokes (SPEC M4.5): drawn in the Layer view on any symmetric copy, and kept in the
// fundamental domain so the symmetry repeats them. A whole stroke goes back by the copy its first
// point lies on, so a stroke never splits where it crosses a mirror line. No geometry library.
import { symmetry_matrices, fundamental_domain } from './symmetry.js';

// The symmetry matrix of the copy holding p: the one whose inverse takes p into the domain.
// Matrices are orthonormal, so the inverse is the transpose.
export function copy_of(p, sym) {
    const dom = fundamental_domain(sym);
    const all = symmetry_matrices(sym);
    for (const m of all) if (dom.contains({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y })) return m;
    return all[0];
}

// Points (any unit) taken back into the domain by the copy of the first point.
export function to_domain(points, sym) {
    if (!points.length) return [];
    const m = copy_of(points[0], sym);
    return points.map(p => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y }));
}

// Every copy of domain points, for previews: one list per symmetry matrix.
export function all_copies(points, sym) {
    return symmetry_matrices(sym).map(m => points.map(p => ({ x: m[0] * p.x + m[1] * p.y, y: m[2] * p.x + m[3] * p.y })));
}

const seg_dist = (p, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};

// Douglas-Peucker: drops points closer than tol to the line through their neighbours.
export function simplify_line(points, tol) {
    if (points.length < 3) return points.slice();
    let worst = 0;
    let at = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = seg_dist(points[i], points[0], points[points.length - 1]);
        if (d > worst) {
            worst = d;
            at = i;
        }
    }
    if (worst <= tol) return [points[0], points[points.length - 1]];
    const left = simplify_line(points.slice(0, at + 1), tol);
    return [...left.slice(0, -1), ...simplify_line(points.slice(at), tol)];
}

// Chaikin corner cutting: each round replaces every edge with points at 1/4 and 3/4. Open lines
// keep their ends.
export function chaikin(points, closed, rounds = 2) {
    let pts = points;
    for (let r = 0; r < rounds; r++) {
        const out = closed ? [] : [pts[0]];
        const n = pts.length;
        const edges = closed ? n : n - 1;
        for (let i = 0; i < edges; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
        }
        if (!closed) out.push(pts[n - 1]);
        pts = out;
    }
    return pts;
}

// The distance from p to a stroke's line (closed strokes include the closing edge).
export function stroke_distance(p, points, closed) {
    let best = Infinity;
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, seg_dist(p, points[i], points[(i + 1) % n]));
    return n === 1 ? Math.hypot(points[0].x - p.x, points[0].y - p.y) : best;
}
