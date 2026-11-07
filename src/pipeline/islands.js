// Islands and bridges (SPEC 4.5, 6.2 steps 4 and 5, 6.5). An island is any component of a layer's
// material other than the body (the largest), so it would fall out when cut. Policies per island:
// 'bridge' (default) ties it to the material around the opening that encloses it, 'glue' cuts it
// as a separate part with a scored locator on the layer behind, 'drop' deletes it.
// Bridging works one level at a time: an island inside a hole of another island bridges to that
// island, which is itself bridged, so nested rings chain to the body.
// Assumptions: material is flat Clipper output in micrometres (outers positive, holes negative).
import { path_area_um2, union_all, subtract } from '../geom/clip.js';
import { mm_to_um, kUmPerMm } from '../core/units.js';
import { hash_str } from '../core/rng.js';

export const kBridgeLongMm = 15; // longer ties are fragile (W-03)
const kTwoBridgeAreaMm2 = 25;
const kThreeBridgeAreaMm2 = 2500;
const kSampleUm = 1000;
const kMinSpreadRad = Math.PI / 3;
const kSpreadTieRad = Math.PI / 180; // spreads within 1 degree count as equal; the shorter tie wins

export function point_in_path(p, path) {
    let inside = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        const a = path[i];
        const b = path[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function centroid(path) {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        const f = path[j].x * path[i].y - path[i].x * path[j].y;
        a += f;
        cx += (path[j].x + path[i].x) * f;
        cy += (path[j].y + path[i].y) * f;
    }
    return a === 0 ? path[0] : { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bbox_mm(paths) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const path of paths) {
        for (const p of path) {
            x0 = Math.min(x0, p.x);
            y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x);
            y1 = Math.max(y1, p.y);
        }
    }
    return { x0: x0 / kUmPerMm, y0: y0 / kUmPerMm, x1: x1 / kUmPerMm, y1: y1 / kUmPerMm };
}

// Material as components: each outer with the holes directly inside it.
export function components(material) {
    const outers = [];
    const holes = [];
    for (const path of material) (path_area_um2(path) > 0 ? outers : holes).push(path);
    const comps = outers.map(path => ({ outer: path, holes: [], area_um2: path_area_um2(path) }));
    const by_size = [...comps].sort((a, b) => a.area_um2 - b.area_um2);
    for (const hole of holes) {
        const owner = by_size.find(c => point_in_path(hole[0], c.outer));
        if (owner) {
            owner.holes.push(hole);
            owner.area_um2 += path_area_um2(hole);
        }
    }
    return comps;
}

// Stable ID (SPEC 6.6): layer, centroid to 0.5 mm, box size to 1 mm and area bucket. The box size
// tells concentric rings apart: they share a centroid, and their areas can share a bucket.
function island_id(layer_id, c) {
    const m = centroid(c.outer);
    const b = box_of(c.outer);
    const key = `${layer_id}:${Math.round(m.x / 500)}:${Math.round(m.y / 500)}:${Math.round((b.x1 - b.x0) / 1000)}:${Math.round((b.y1 - b.y0) / 1000)}:${Math.round(Math.log2(c.area_um2))}`;
    return 'i' + hash_str(key).toString(16).padStart(8, '0');
}

function resample(path) {
    const out = [];
    for (let i = 0; i < path.length; i++) {
        const a = path[i];
        const b = path[(i + 1) % path.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / kSampleUm));
        for (let s = 0; s < n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
    }
    return out;
}

function nearest_on_path(p, path) {
    let best = null;
    let best_d2 = Infinity;
    for (let i = 0; i < path.length; i++) {
        const a = path[i];
        const b = path[(i + 1) % path.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (d2 < best_d2) {
            best_d2 = d2;
            best = q;
        }
    }
    return { q: best, d: Math.sqrt(best_d2) };
}

function segments_cross(p1, p2, p3, p4) {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(p3, p4, p1);
    const d2 = d(p3, p4, p2);
    const d3 = d(p1, p2, p3);
    const d4 = d(p1, p2, p4);
    return d1 * d2 < 0 && d3 * d4 < 0;
}

function bridge_rect(p, q, w_um) {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    const e = w_um / 2 + 200; // run into both sides so the union joins them
    const nx = (-uy * w_um) / 2;
    const ny = (ux * w_um) / 2;
    const a = { x: p.x - ux * e, y: p.y - uy * e };
    const b = { x: q.x + ux * e, y: q.y + uy * e };
    return [
        { x: Math.round(a.x - nx), y: Math.round(a.y - ny) },
        { x: Math.round(b.x - nx), y: Math.round(b.y - ny) },
        { x: Math.round(b.x + nx), y: Math.round(b.y + ny) },
        { x: Math.round(a.x + nx), y: Math.round(a.y + ny) },
    ];
}

function bridge_count(area_mm2, max) {
    const n = area_mm2 < kTwoBridgeAreaMm2 ? 1 : area_mm2 < kThreeBridgeAreaMm2 ? 2 : 3;
    return Math.max(1, Math.min(n, max));
}

// A closed path's segments bucketed by kGridUm cells, so nearest-point queries only look nearby.
// Long outlines (rings, large openings) have thousands of segments; one query needs a few.
const kGridUm = 4000;
const kSearchMaxUm = 80000;
const grid_cache = new WeakMap();
const cell_key = (gx, gy) => (gx + 32768) * 65536 + (gy + 32768);

function seg_grid(path) {
    if (grid_cache.has(path)) return grid_cache.get(path);
    const cells = new Map();
    for (let i = 0; i < path.length; i++) {
        const a = path[i];
        const b = path[(i + 1) % path.length];
        for (let gx = Math.floor(Math.min(a.x, b.x) / kGridUm); gx <= Math.floor(Math.max(a.x, b.x) / kGridUm); gx++) {
            for (let gy = Math.floor(Math.min(a.y, b.y) / kGridUm); gy <= Math.floor(Math.max(a.y, b.y) / kGridUm); gy++) {
                const k = cell_key(gx, gy);
                if (cells.has(k)) cells.get(k).push(i);
                else cells.set(k, [i]);
            }
        }
    }
    const g = { path, cells };
    grid_cache.set(path, g);
    return g;
}

// The nearest point of the gridded path within reach_um of p, or null. Exact: a segment within
// reach has a point inside the searched window, and it is listed in that point's cell.
function nearest_within(p, g, reach_um) {
    const gx0 = Math.floor((p.x - reach_um) / kGridUm);
    const gx1 = Math.floor((p.x + reach_um) / kGridUm);
    const gy0 = Math.floor((p.y - reach_um) / kGridUm);
    const gy1 = Math.floor((p.y + reach_um) / kGridUm);
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > g.path.length) {
        const r = nearest_on_path(p, g.path);
        return r.d <= reach_um ? r : null;
    }
    const path = g.path;
    let best = null;
    let best_d2 = reach_um * reach_um;
    for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
            for (const i of g.cells.get(cell_key(gx, gy)) ?? []) {
                const a = path[i];
                const b = path[(i + 1) % path.length];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len2 = dx * dx + dy * dy;
                const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
                const qx = a.x + t * dx;
                const qy = a.y + t * dy;
                const d2 = (qx - p.x) ** 2 + (qy - p.y) ** 2;
                if (d2 <= best_d2) {
                    best_d2 = d2;
                    best = { x: qx, y: qy };
                }
            }
        }
    }
    return best ? { q: best, d: Math.sqrt(best_d2) } : null;
}

// The nearest point anywhere on the path, searching outwards from p.
function nearest_grid(p, g) {
    for (let reach = kGridUm; reach <= kSearchMaxUm; reach *= 2) {
        const r = nearest_within(p, g, reach);
        if (r) return r;
    }
    return nearest_on_path(p, g.path);
}

function box_of(path) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of path) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
}

// Whether segment a-b crosses the gridded path: a box test, then only the segments listed in the
// cells a-b's box covers.
function crosses_grid(a, b, g, box) {
    if (Math.max(a.x, b.x) < box.x0 || Math.min(a.x, b.x) > box.x1 || Math.max(a.y, b.y) < box.y0 || Math.min(a.y, b.y) > box.y1) return false;
    const path = g.path;
    for (let gx = Math.floor(Math.min(a.x, b.x) / kGridUm); gx <= Math.floor(Math.max(a.x, b.x) / kGridUm); gx++) {
        for (let gy = Math.floor(Math.min(a.y, b.y) / kGridUm); gy <= Math.floor(Math.max(a.y, b.y) / kGridUm); gy++) {
            for (const i of g.cells.get(cell_key(gx, gy)) ?? []) {
                if (segments_cross(a, b, path[i], path[(i + 1) % path.length])) return true;
            }
        }
    }
    return false;
}

const angle_gap = (a, b) => {
    const t = Math.abs(a - b) % (2 * Math.PI);
    return Math.min(t, 2 * Math.PI - t);
};

// Extra (or preferred-angle) tie lines from an island to the boundary of the hole around it.
// existing: angles (from the island's centre) of bridges it already has, kept clear by the 60
// degree spread. prefs: preferred angles in degrees (bridges dragged in the Layer view); each
// takes the candidate nearest that angle.
function plan_bridges(island, hole, others, w_um, count, existing = [], prefs = []) {
    const m = centroid(island.outer);
    const candidates = [];
    const g = seg_grid(hole);
    const boxes = others.map(o => box_of(o.outer));
    const grids = others.map(o => seg_grid(o.outer));
    for (const s of resample(island.outer)) {
        const { q, d } = nearest_grid(s, g);
        if (others.some((o, n) => crosses_grid(s, q, grids[n], boxes[n]))) continue;
        candidates.push({ s, q, d, angle: Math.atan2(s.y - m.y, s.x - m.x) });
    }
    if (!candidates.length) return [];
    const make = c => ({ a: c.s, b: c.q, length_um: c.d, rect: bridge_rect(c.s, c.q, w_um), angle: c.angle });
    if (prefs.length) {
        const nearest = deg => candidates.reduce((a, b) => (angle_gap(b.angle, (deg * Math.PI) / 180) < angle_gap(a.angle, (deg * Math.PI) / 180) ? b : a));
        return prefs.map(deg => make(nearest(deg)));
    }
    const shortest = Math.min(...candidates.map(c => c.d));
    const pool = candidates.filter(c => c.d <= shortest * 1.25 + w_um);
    const angles = [...existing];
    const picked = [];
    if (!angles.length) {
        const first = pool.reduce((a, b) => (b.d < a.d ? b : a));
        picked.push(first);
        angles.push(first.angle);
    }
    while (angles.length < count) {
        let best = null;
        let best_spread = -1;
        for (const c of pool) {
            const spread = Math.min(...angles.map(a => angle_gap(a, c.angle)));
            if (spread > best_spread + kSpreadTieRad || (Math.abs(spread - best_spread) <= kSpreadTieRad && best && c.d < best.d)) {
                best_spread = spread;
                best = c;
            }
        }
        if (!best || best_spread < kMinSpreadRad) break;
        picked.push(best);
        angles.push(best.angle);
    }
    return picked.map(make);
}

// Boundary samples of every component in a spatial hash, for the nearest-neighbour tie search.
const kHashUm = kGridUm;

function sample_hash(comps) {
    const hash = new Map();
    comps.forEach((c, ci) => {
        for (const path of [c.outer, ...c.holes]) {
            for (const p of resample(path)) {
                const k = cell_key(Math.floor(p.x / kHashUm), Math.floor(p.y / kHashUm));
                if (hash.has(k)) hash.get(k).push({ x: p.x, y: p.y, c: ci });
                else hash.set(k, [{ x: p.x, y: p.y, c: ci }]);
            }
        }
    });
    return hash;
}

// The cells within reach_um of any cell the gridded path passes through: a point within reach of
// the path lies in one of them. For a ring-shaped island this is a band, where its bounding box
// would be most of the piece.
function cells_near(g, reach_um) {
    const rc = Math.ceil(reach_um / kGridUm);
    const out = new Set();
    for (const k of g.cells.keys()) {
        const gx = Math.floor(k / 65536) - 32768;
        const gy = (k % 65536) - 32768;
        for (let dx = -rc; dx <= rc; dx++) for (let dy = -rc; dy <= rc; dy++) out.add(cell_key(gx + dx, gy + dy));
    }
    return out;
}

// The shortest tie from comps[i]'s outline to each nearby other component, by an expanding
// search around its outline: [{ i, j, s, q, d }], at most kNearest, nearest first.
const kNearest = 3;

function nearest_ties(comps, i, hash, wanted = () => true) {
    const g = seg_grid(comps[i].outer);
    for (let reach = 2000; reach <= kSearchMaxUm; reach *= 2) {
        const best = new Map(); // component -> tie
        for (const cell of cells_near(g, reach)) {
            for (const q of hash.get(cell) ?? []) {
                if (q.c === i || !wanted(q.c)) continue;
                const near = nearest_within(q, g, reach);
                if (!near) continue;
                const { q: s, d } = near;
                const prev = best.get(q.c);
                if (!prev || d < prev.d) best.set(q.c, { i, j: q.c, s, q: { x: q.x, y: q.y }, d });
            }
        }
        if (best.size) return [...best.values()].sort((a, b) => a.d - b.d).slice(0, kNearest);
    }
    return [];
}

// Applies island policies to a layer's material.
// - Bridged islands are joined by a minimum spanning tree: the shortest ties first (Kruskal),
//   each from an island to its nearest other material (the body or another island), until every
//   piece reaches the body. Islands packed among other islands (thresholded fields, imported art)
//   are always reachable this way, where a tie to the enclosing hole's edge may be blocked.
// - Larger islands then get extra ties to the edge of the hole around them, spread 60 degrees.
// - A dragged bridge (a preferred angle) replaces the island's own ties.
// Returns { material, islands, bridges, parts, unbridged }:
//   islands  [{ id, policy, area_mm2, bbox, outer }]
//   bridges  [{ island, a, b, length_mm, w_mm, rect }]
//   parts    glue-on islands, each [outer, ...holes]
export function resolve_islands(material, layer, bridge_w_mm) {
    const comps = components(material);
    if (comps.length <= 1) return { material, islands: [], bridges: [], parts: [], unbridged: [] };
    const body = comps.reduce((a, b) => (b.area_um2 > a.area_um2 ? b : a));
    const seen = new Map(); // any ID still shared gets a suffix, in component order
    const islands = comps
        .filter(c => c !== body)
        .map(c => {
            const base = island_id(layer.id, c);
            const n = seen.get(base) ?? 0;
            seen.set(base, n + 1);
            const id = n ? `${base}.${n + 1}` : base;
            return {
                ...c,
                id,
                centre: centroid(c.outer),
                policy: layer.overrides?.islands?.[id] ?? layer.island_policy ?? 'bridge',
                area_mm2: c.area_um2 / (kUmPerMm * kUmPerMm),
            };
        });

    const w_um = mm_to_um(bridge_w_mm);
    const bridges = [];
    const removed = [];
    const parts = [];
    for (const island of islands) {
        if (island.policy === 'drop' || island.policy === 'glue') {
            removed.push(island.outer);
            if (island.policy === 'glue') parts.push([island.outer, ...island.holes]);
        }
    }
    // The pieces that take part: the body first, then the bridged islands.
    const active = [body, ...islands.filter(i => i.policy === 'bridge')];
    const parent = active.map((_, k) => k);
    const find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    const join = (a, b) => {
        parent[find(a)] = find(b);
    };
    const add_bridge = (island, tie) => {
        // angle_deg: from the island's centre to the bridge's island end, the angle a dragged bridge stores.
        const angle_deg = (Math.atan2(tie.a.y - island.centre.y, tie.a.x - island.centre.x) * 180) / Math.PI;
        bridges.push({ island: island.id, a: tie.a, b: tie.b, angle_deg, length_mm: tie.length_um / kUmPerMm, w_mm: bridge_w_mm, rect: tie.rect });
    };
    const all_holes = active.flatMap((c, k) => c.holes.map(h => ({ hole: h, k, box: box_of(h) })));
    const in_box = (p, b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
    const enclosing_of = k =>
        all_holes
            .filter(h => h.k !== k && in_box(active[k].outer[0], h.box) && point_in_path(active[k].outer[0], h.hole))
            .sort((a, b) => path_area_um2(b.hole) - path_area_um2(a.hole))[0];
    const count_of = new Map();

    // Islands with dragged bridges keep their preferred angles.
    for (let k = 1; k < active.length; k++) {
        const prefs = layer.overrides?.bridge_angles?.[active[k].id];
        if (!prefs?.length) continue;
        const enc = enclosing_of(k);
        if (!enc) continue;
        const ties = plan_bridges(active[k], enc.hole, [], w_um, prefs.length, [], prefs);
        for (const t of ties) add_bridge(active[k], t);
        if (ties.length) {
            join(k, enc.k);
            count_of.set(k, ties.length);
        }
    }

    // Minimum spanning tree over the rest, shortest ties first.
    const hash = sample_hash(active);
    const edges = [];
    for (let k = 1; k < active.length; k++) if (!count_of.has(k)) edges.push(...nearest_ties(active, k, hash));
    edges.sort((a, b) => a.d - b.d);
    for (const e of edges) {
        if (find(e.i) === find(e.j)) continue;
        join(e.i, e.j);
        // The tie belongs to the smaller of the two pieces (never the body).
        const k = e.j !== 0 && active[e.j].area_um2 < active[e.i].area_um2 ? e.j : e.i;
        const from = k === e.i ? e.s : e.q;
        const to = k === e.i ? e.q : e.s;
        add_bridge(active[k], { a: from, b: to, length_um: e.d, rect: bridge_rect(from, to, w_um) });
        count_of.set(k, (count_of.get(k) ?? 0) + 1);
    }

    // Groups still cut off from the body (their nearest neighbours were all inside the group): join
    // each by its shortest tie to anything outside it, until none is left or no tie exists.
    for (let pass = 0; pass < active.length; pass++) {
        const cut_off = [];
        for (let j = 1; j < active.length; j++) if (find(j) !== find(0)) cut_off.push(j);
        if (!cut_off.length) break;
        let best = null;
        for (const j of cut_off) {
            for (const e of nearest_ties(active, j, hash, c => find(c) !== find(j))) {
                if (!best || e.d < best.d) best = e;
            }
        }
        if (!best) break;
        join(best.i, best.j);
        const from_small = best.j !== 0 && active[best.j].area_um2 < active[best.i].area_um2;
        const kk = from_small ? best.j : best.i;
        const from = kk === best.i ? best.s : best.q;
        const to = kk === best.i ? best.q : best.s;
        add_bridge(active[kk], { a: from, b: to, length_um: best.d, rect: bridge_rect(from, to, w_um) });
        count_of.set(kk, (count_of.get(kk) ?? 0) + 1);
    }

    // Extra ties for stability, to the edge of the hole around each island.
    for (let k = 1; k < active.length; k++) {
        const island = active[k];
        const want = bridge_count(island.area_mm2, layer.bridge?.max ?? 4);
        const have = count_of.get(k) ?? 0;
        if (have >= want || layer.overrides?.bridge_angles?.[island.id]?.length) continue;
        const enc = enclosing_of(k);
        if (!enc) continue;
        const m = centroid(island.outer);
        const existing = bridges.filter(b => b.island === island.id).map(b => Math.atan2(b.a.y - m.y, b.a.x - m.x));
        const neighbours = active.filter((o, j) => j !== k && j !== 0 && point_in_path(o.outer[0], enc.hole));
        for (const t of plan_bridges(island, enc.hole, neighbours, w_um, want, existing)) add_bridge(island, t);
    }

    const unbridged = active.filter((c, k) => k > 0 && find(k) !== find(0)).map(c => c.id);
    let out = material;
    if (removed.length) out = subtract(out, removed);
    if (bridges.length) out = union_all([...out, ...bridges.map(b => b.rect)]);
    return {
        material: out,
        islands: islands.map(i => ({ id: i.id, policy: i.policy, area_mm2: i.area_mm2, bbox: bbox_mm([i.outer]), centre: i.centre, outer: i.outer })),
        bridges,
        parts,
        unbridged,
    };
}
