// Cubic Bezier shapes (SPEC 8.4, M4): closed outlines of nodes, each an anchor with an incoming
// and an outgoing handle, in a motif's local frame (mm, x along the radius, origin at the motif's
// centre). Segment i runs from node i (anchor, out handle) to node i + 1 (in handle, anchor).
// Pure maths with no geometry library, so the Layer view's node editor can use it on the main
// thread and the worker can flatten the same shapes.
// A node is { x, y, ix, iy, ox, oy }: the anchor and its two handles, all absolute.

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// The four control points of segment i.
export function segment(nodes, i) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    return [
        { x: a.x, y: a.y },
        { x: a.ox, y: a.oy },
        { x: b.ix, y: b.iy },
        { x: b.x, y: b.y },
    ];
}

export function cubic_at([p0, p1, p2, p3], t) {
    const u = 1 - t;
    return {
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
}

// Steps for a segment so the chords stay within tol of the curve (Wang's bound).
export function cubic_steps([p0, p1, p2, p3], tol) {
    const d1 = Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y);
    const d2 = Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y);
    return Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.max(d1, d2)) / tol)));
}

// The closed outline as a polyline (no repeated last point), chords within tol (same unit).
export function flatten_shape(nodes, tol = 0.02) {
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
        const seg = segment(nodes, i);
        const n = cubic_steps(seg, tol);
        for (let k = 0; k < n; k++) out.push(cubic_at(seg, k / n));
    }
    return out;
}

// Splits segment i at t (de Casteljau): the outline is unchanged, with one more node.
export function split_segment(nodes, i, t) {
    const [p0, p1, p2, p3] = segment(nodes, i);
    const a = lerp(p0, p1, t);
    const b = lerp(p1, p2, t);
    const c = lerp(p2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    const m = lerp(d, e, t);
    const out = nodes.map(n => ({ ...n }));
    const j = (i + 1) % nodes.length;
    out[i].ox = a.x;
    out[i].oy = a.y;
    out[j].ix = c.x;
    out[j].iy = c.y;
    out.splice(i + 1, 0, { x: m.x, y: m.y, ix: d.x, iy: d.y, ox: e.x, oy: e.y });
    return out;
}

// The closest point of the outline to p: { seg, t, d }, by sampling then refining.
export function nearest_on_shape(nodes, p) {
    let best = { seg: 0, t: 0, d: Infinity };
    for (let i = 0; i < nodes.length; i++) {
        const seg = segment(nodes, i);
        for (let k = 0; k <= 32; k++) {
            const q = cubic_at(seg, k / 32);
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < best.d) best = { seg: i, t: k / 32, d };
        }
    }
    let step = 1 / 64;
    const seg = segment(nodes, best.seg);
    for (let it = 0; it < 12; it++) {
        for (const t of [best.t - step, best.t + step]) {
            if (t < 0 || t > 1) continue;
            const q = cubic_at(seg, t);
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < best.d) best = { ...best, t, d };
        }
        step /= 2;
    }
    return best;
}

// Removes node i, keeping at least three.
export function delete_node(nodes, i) {
    if (nodes.length <= 3) return nodes;
    return nodes.filter((_, k) => k !== i).map(n => ({ ...n }));
}

// Moves anchor i to (x, y), its handles with it.
export function move_anchor(nodes, i, x, y) {
    return nodes.map((n, k) => {
        if (k !== i) return n;
        const dx = x - n.x;
        const dy = y - n.y;
        return { x, y, ix: n.ix + dx, iy: n.iy + dy, ox: n.ox + dx, oy: n.oy + dy };
    });
}

// Moves handle 'in' or 'out' of node i to (x, y). A smooth node (handles in line through the
// anchor) stays smooth: the other handle turns to match and keeps its length.
export function move_handle(nodes, i, which, x, y) {
    return nodes.map((n, k) => {
        if (k !== i) return n;
        const mine = which === 'in' ? { x: n.ix, y: n.iy } : { x: n.ox, y: n.oy };
        const other = which === 'in' ? { x: n.ox, y: n.oy } : { x: n.ix, y: n.iy };
        const a = { x: mine.x - n.x, y: mine.y - n.y };
        const b = { x: other.x - n.x, y: other.y - n.y };
        const la = Math.hypot(a.x, a.y);
        const lb = Math.hypot(b.x, b.y);
        const smooth = la > 1e-9 && lb > 1e-9 && (a.x * b.x + a.y * b.y) / (la * lb) < -0.999;
        let o = other;
        if (smooth) {
            const nx = x - n.x;
            const ny = y - n.y;
            const ln = Math.hypot(nx, ny) || 1;
            o = { x: n.x - (nx / ln) * lb, y: n.y - (ny / ln) * lb };
        }
        return which === 'in' ? { ...n, ix: x, iy: y, ox: o.x, oy: o.y } : { ...n, ox: x, oy: y, ix: o.x, iy: o.y };
    });
}

// Smooth closed nodes through points (Catmull-Rom); points flagged corner get no handles.
export function nodes_through(points, corners = new Set()) {
    const n = points.length;
    return points.map((p, i) => {
        if (corners.has(i)) return { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y };
        const a = points[(i - 1 + n) % n];
        const b = points[(i + 1) % n];
        const tx = (b.x - a.x) / 6;
        const ty = (b.y - a.y) / 6;
        return { x: p.x, y: p.y, ix: p.x - tx, iy: p.y - ty, ox: p.x + tx, oy: p.y + ty };
    });
}

// Signed area of the flattened outline (positive counter-clockwise).
export function shape_area(nodes) {
    const pts = flatten_shape(nodes, 0.01);
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
    return a / 2;
}
