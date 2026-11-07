// Circuit motif (SPEC 8.3, M3): traces routed on a square grid with 45-degree moves inside the
// symmetry's fundamental domain, then replicated by the symmetry engine.
// - Each trace starts at the edge of its area and walks as a seeded path: it prefers straight
//   runs, turns 45 degrees at a time, keeps one clear cell from every other trace and from its
//   own earlier cells, keeps half a cell from the domain's edges, and ends in a terminal.
// - A trace is a bundle of parallel strands. Terminals: drop, bulb, ring pad, via.
// - Polarity 'bars': the area is opened and the traces stay as material, each joined to the
//   material outside the area where it starts, so nothing is cut free. 'slots': the traces are
//   cut from solid material; they never touch one another or a copy of themselves, and a ring pad
//   keeps a tie, so no material is enclosed.
// Clearance: cells of different traces are at least two cells apart (Chebyshev), so centrelines
// are at least 1.41 lane pitches apart, and the pitch is the bundle width plus the strand gap.
// Assumptions: micrometres, origin at the symmetry centre, symmetry phase applied by replicate().
import { stroke, union_all, subtract, intersect_paths, circle_path, rect_path, circle_segments } from '../geom/clip.js';
import { fundamental_domain } from '../geom/symmetry.js';
import { rng_for } from '../core/rng.js';
import { mm_to_um } from '../core/units.js';

const TAU = 2 * Math.PI;
const kDirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
];
const kMinRun = 2; // cells in a straight line before a trace may turn again
const kMinCells = 3; // shorter traces are dropped
export const kTerminals = ['drop', 'bulb', 'ring', 'via'];

// Distance from p to the nearest edge of the fundamental domain (Infinity when it has none).
// For a wedge, the distance to each edge's whole line: never more than the true distance.
function edge_distance(p, sym, dom) {
    switch (sym.kind) {
        case 'mirror_x':
            return p.x;
        case 'mirror_xy':
            return Math.min(p.x, p.y);
        case 'rot':
        case 'dihedral': {
            if (dom.a1 - dom.a0 >= TAU - 1e-9) return Infinity;
            const d0 = -Math.sin(dom.a0) * p.x + Math.cos(dom.a0) * p.y;
            const d1 = Math.sin(dom.a1) * p.x - Math.cos(dom.a1) * p.y;
            return Math.min(d0, d1);
        }
        default:
            return Infinity;
    }
}

// Lane geometry in micrometres: strand count, strand width, gap, bundle width and pitch.
export function circuit_lanes(m) {
    const n = Math.max(1, Math.min(6, Math.round(m.strands ?? 1)));
    const s = mm_to_um(Math.max(0.3, m.strand_mm ?? 2));
    const g = mm_to_um(Math.max(0.3, m.gap_mm ?? 2));
    const b = n * s + (n - 1) * g;
    return { n, s, g, b, p: b + g };
}

// The routed traces of a circuit motif, in the fundamental domain:
// { lanes, traces: [{ cells: [[i, j]], points: [{x, y}] (stub first), dir, terminal, centre, r }] }.
// Cell (i, j) is centred on ((i + 0.5) p, (j + 0.5) p).
export function circuit_routes(m, sym) {
    const lanes = circuit_lanes(m);
    const { p, b, g } = lanes;
    const dom = fundamental_domain(sym);
    const W = mm_to_um(m.area_w_mm) / 2;
    const H = mm_to_um(m.area_h_mm) / 2;
    const R1 = m.reach_mm > 0 ? mm_to_um(m.reach_mm) : Infinity;
    const R0 = mm_to_um(Math.max(0, m.r0_mm ?? 0));
    const slots = (m.polarity ?? 'slots') === 'slots';
    const rng = rng_for(m.seed ?? 1, 'circuit');
    const centre = (i, j) => ({ x: (i + 0.5) * p, y: (j + 0.5) * p });
    const in_area = c => Math.abs(c.x) <= W - p / 2 && Math.abs(c.y) <= H - p / 2 && Math.hypot(c.x, c.y) <= R1 - p / 2;
    const clear_of_edges = (c, margin) => dom.contains(c) && edge_distance(c, sym, dom) >= margin;
    const key = (i, j) => (i + 32768) * 65536 + (j + 32768);

    const span = Math.ceil(Math.min(Math.max(W, H), R1) / p) + 1;
    const allowed = new Set();
    for (let i = -span; i <= span; i++) {
        for (let j = -span; j <= span; j++) {
            const c = centre(i, j);
            if (in_area(c) && Math.hypot(c.x, c.y) >= R0 + p / 2 && clear_of_edges(c, p / 2)) allowed.add(key(i, j));
        }
    }

    // Starts: a cell and an inward direction whose outward neighbour lies outside the area (the
    // material round it), clear of the domain's edges. In slots, also from the inner keep-out,
    // which is solid; in bars it is open, so nothing could hold a trace there.
    const starts = [];
    for (let i = -span; i <= span; i++) {
        for (let j = -span; j <= span; j++) {
            if (!allowed.has(key(i, j))) continue;
            for (const d of [0, 2, 4, 6]) {
                const o = centre(i - kDirs[d][0], j - kDirs[d][1]);
                if (!clear_of_edges(o, p / 2)) continue;
                const outside = !in_area(o);
                const from_centre = slots && R0 > 0 && in_area(o) && Math.hypot(o.x, o.y) < R0 + p / 2;
                if (outside || from_centre) starts.push({ i, j, d });
            }
        }
    }
    // Seeded shuffle.
    for (let k = starts.length - 1; k > 0; k--) {
        const r = rng.int(0, k);
        [starts[k], starts[r]] = [starts[r], starts[k]];
    }

    const occ = new Map(); // cell -> trace index
    const enterable = (i, j, t, last) => {
        if (!allowed.has(key(i, j))) return false;
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                const o = occ.get(key(i + di, j + dj));
                if (o === undefined) continue;
                if (o !== t || !last || last[0] !== i + di || last[1] !== j + dj) return false;
            }
        }
        return true;
    };

    const want = Math.max(1, Math.round(m.traces ?? 12));
    const longest = Math.max(kMinCells, Math.round(m.length ?? 16));
    const straight = Math.max(0, Math.min(1, m.straight ?? 0.7));
    const traces = [];
    for (const st of starts) {
        if (traces.length >= want) break;
        const t = traces.length;
        if (!enterable(st.i, st.j, t, null)) continue;
        const cells = [[st.i, st.j]];
        occ.set(key(st.i, st.j), t);
        let dir = st.d;
        let run = 1;
        const target = rng.int(Math.max(kMinCells, Math.ceil(longest / 2)), longest);
        while (cells.length < target) {
            const last = cells[cells.length - 1];
            const turn = run >= kMinRun;
            // A weighted draw picks the first choice; the others follow as fallbacks.
            const choices = [dir, (dir + 1) % 8, (dir + 7) % 8];
            const weights = [straight, turn ? (1 - straight) / 2 : 0, turn ? (1 - straight) / 2 : 0];
            let x = rng.next() * (weights[0] + weights[1] + weights[2]);
            let first = 0;
            while (first < 2 && x >= weights[first]) x -= weights[first++];
            const order = [choices[first], ...choices.filter((_, k) => k !== first)];
            let moved = false;
            for (const d of order) {
                const ni = last[0] + kDirs[d][0];
                const nj = last[1] + kDirs[d][1];
                if (!enterable(ni, nj, t, last)) continue;
                cells.push([ni, nj]);
                occ.set(key(ni, nj), t);
                run = d === dir ? run + 1 : 1;
                dir = d;
                moved = true;
                break;
            }
            if (!moved) break;
        }
        if (cells.length < kMinCells) {
            for (const [i, j] of cells) occ.delete(key(i, j));
            continue;
        }

        // Terminal: drop, bulb and ring need the cell ahead free and room from the domain's
        // edges; otherwise the trace ends in a via, which fits its own lane.
        const [ei, ej] = cells[cells.length - 1];
        const e = centre(ei, ej);
        const u = { x: kDirs[dir][0] / Math.hypot(...kDirs[dir]), y: kDirs[dir][1] / Math.hypot(...kDirs[dir]) };
        let terminal = m.terminal && m.terminal !== 'mix' ? m.terminal : rng.pick(kTerminals);
        const r_big = b / 2 + 0.25 * p;
        const lead = { drop: 0.9 * r_big, bulb: 0.5 * r_big, ring: r_big - lanes.s / 2 }[terminal];
        let tc = e;
        let r = b / 2;
        if (terminal !== 'via') {
            const ai = ei + kDirs[dir][0];
            const aj = ej + kDirs[dir][1];
            const c = { x: e.x + u.x * lead, y: e.y + u.y * lead };
            if (enterable(ai, aj, t, [ei, ej]) && clear_of_edges(c, r_big + g / 2)) {
                occ.set(key(ai, aj), t);
                tc = c;
                r = r_big;
            } else {
                terminal = 'via';
            }
        }
        // The stub runs back out of the area, at least a quarter pitch past its edge, so a bar is
        // anchored in the material round the area (cell centres sit on the pitch grid, not on it).
        const sd = kDirs[st.d];
        const c0 = centre(st.i, st.j);
        const past = q => Math.abs(q.x) > W + p / 4 || Math.abs(q.y) > H + p / 4 || Math.hypot(q.x, q.y) > R1 + p / 4;
        let reach = p;
        if (!in_area({ x: c0.x - sd[0] * p, y: c0.y - sd[1] * p })) {
            while (!past({ x: c0.x - sd[0] * reach, y: c0.y - sd[1] * reach }) && reach < 4 * p) reach += p / 4;
        }
        const stub = { x: c0.x - sd[0] * reach, y: c0.y - sd[1] * reach };
        traces.push({ cells, points: [stub, ...cells.map(([i, j]) => centre(i, j))], dir: u, terminal, centre: tc, r });
    }
    return { lanes, traces };
}

// A polyline offset sideways by o (left of travel positive), mitred at the 45-degree turns.
function offset_line(pts, o) {
    const out = [];
    const n = pts.length;
    const unit = (a, b) => {
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    };
    for (let i = 0; i < n; i++) {
        const d1 = i > 0 ? unit(pts[i - 1], pts[i]) : unit(pts[0], pts[1]);
        const d2 = i < n - 1 ? unit(pts[i], pts[i + 1]) : d1;
        const n1 = { x: -d1.y, y: d1.x };
        const mx = n1.x - d2.y;
        const my = n1.y + d2.x;
        const ml = Math.hypot(mx, my) || 1;
        const scale = 1 / ((mx / ml) * n1.x + (my / ml) * n1.y);
        out.push({ x: Math.round(pts[i].x + (mx / ml) * o * scale), y: Math.round(pts[i].y + (my / ml) * o * scale) });
    }
    return out;
}

// The terminal's outline (a drop, bulb, ring pad or via); in slots a ring pad keeps a tie.
function terminal_paths(tr, lanes, slots) {
    const { b, s } = lanes;
    const c = tr.centre;
    const r = tr.r;
    const u = tr.dir;
    const nrm = { x: -u.y, y: u.x };
    const e = tr.points[tr.points.length - 1];
    const pt = (q, a, k) => ({ x: Math.round(q.x + a.x * k), y: Math.round(q.y + a.y * k) });
    switch (tr.terminal) {
        case 'drop':
            // A disc ahead of the trace, joined to the bundle's end by a taper.
            return union_all([circle_path(c.x, c.y, r), [pt(e, nrm, -b / 2), pt(c, nrm, -r), pt(c, nrm, r), pt(e, nrm, b / 2)]]);
        case 'ring': {
            const hole = r - Math.max(s, 1200);
            const ring = [circle_path(c.x, c.y, r), circle_path(c.x, c.y, hole).reverse()];
            if (!slots) return ring;
            // The tie on the far side keeps the pad's centre joined to the panel.
            const a = pt(c, u, hole - 200);
            const z = pt(c, u, r + 400);
            const half = Math.max(s, 1500) / 2;
            return subtract(ring, [[pt(a, nrm, -half), pt(z, nrm, -half), pt(z, nrm, half), pt(a, nrm, half)]]);
        }
        default:
            return [circle_path(c.x, c.y, r)];
    }
}

// The domain as a polygon (null when it is the whole plane), reaching radius R.
function domain_polygon(dom, R) {
    if (dom.a1 - dom.a0 >= TAU - 1e-9) return null;
    const n = Math.max(2, Math.ceil(((dom.a1 - dom.a0) / TAU) * circle_segments(R, 200)));
    const out = [{ x: 0, y: 0 }];
    for (let k = 0; k <= n; k++) {
        const a = dom.a0 + ((dom.a1 - dom.a0) * k) / n;
        out.push({ x: Math.round(R * Math.cos(a)), y: Math.round(R * Math.sin(a)) });
    }
    return out;
}

// Openings of a circuit motif in the fundamental domain.
export function circuit_openings(m, sym) {
    const { lanes, traces } = circuit_routes(m, sym);
    const slots = (m.polarity ?? 'slots') === 'slots';
    const strands = [];
    for (const tr of traces) {
        for (let k = 0; k < lanes.n; k++) strands.push(offset_line(tr.points, (k - (lanes.n - 1) / 2) * (lanes.s + lanes.g)));
    }
    const shapes = [...(strands.length ? stroke(strands, lanes.s, 'butt', 'miter') : []), ...traces.flatMap(tr => terminal_paths(tr, lanes, slots))];
    if (slots) return shapes.length ? union_all(shapes) : [];
    // Bars: the area (clipped to the domain) minus the traces.
    const W = mm_to_um(m.area_w_mm) / 2;
    const H = mm_to_um(m.area_h_mm) / 2;
    let area = [rect_path(-W, -H, W, H)];
    if (m.reach_mm > 0) area = intersect_paths(area, [circle_path(0, 0, mm_to_um(m.reach_mm))]);
    const dom_poly = domain_polygon(fundamental_domain(sym), Math.hypot(W, H) + lanes.p);
    if (dom_poly) area = intersect_paths(area, [dom_poly]);
    return shapes.length ? subtract(area, union_all(shapes)) : area;
}
