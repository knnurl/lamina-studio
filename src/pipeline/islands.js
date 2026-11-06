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

function island_id(layer_id, c) {
    const m = centroid(c.outer);
    const key = `${layer_id}:${Math.round(m.x / 500)}:${Math.round(m.y / 500)}:${Math.round(Math.log2(c.area_um2))}`;
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

function crosses_path(a, b, path) {
    for (let i = 0; i < path.length; i++) if (segments_cross(a, b, path[i], path[(i + 1) % path.length])) return true;
    return false;
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

// Chooses tie lines from an island to the boundary of the hole that encloses it.
function plan_bridges(island, hole, others, w_um, count) {
    const m = centroid(island.outer);
    const candidates = [];
    for (const s of resample(island.outer)) {
        const { q, d } = nearest_on_path(s, hole);
        if (others.some(o => crosses_path(s, q, o.outer))) continue;
        candidates.push({ s, q, d, angle: Math.atan2(s.y - m.y, s.x - m.x) });
    }
    if (!candidates.length) return [];
    const shortest = Math.min(...candidates.map(c => c.d));
    const pool = candidates.filter(c => c.d <= shortest * 1.25 + w_um);
    const picked = [pool.reduce((a, b) => (b.d < a.d ? b : a))];
    const gap = (a, b) => {
        const t = Math.abs(a - b) % (2 * Math.PI);
        return Math.min(t, 2 * Math.PI - t);
    };
    while (picked.length < count) {
        let best = null;
        let best_spread = -1;
        for (const c of pool) {
            const spread = Math.min(...picked.map(p => gap(p.angle, c.angle)));
            if (spread > best_spread + 1 || (Math.abs(spread - best_spread) <= 1 && best && c.d < best.d)) {
                best_spread = spread;
                best = c;
            }
        }
        if (!best || best_spread < kMinSpreadRad) break;
        picked.push(best);
    }
    return picked.map(c => ({ a: c.s, b: c.q, length_um: c.d, rect: bridge_rect(c.s, c.q, w_um) }));
}

// Applies island policies to a layer's material.
// Returns { material, islands, bridges, parts, unbridged }:
//   islands  [{ id, policy, area_mm2, bbox, outer }]
//   bridges  [{ island, a, b, length_mm, w_mm, rect }]
//   parts    glue-on islands, each [outer, ...holes]
export function resolve_islands(material, layer, bridge_w_mm) {
    const comps = components(material);
    if (comps.length <= 1) return { material, islands: [], bridges: [], parts: [], unbridged: [] };
    const body = comps.reduce((a, b) => (b.area_um2 > a.area_um2 ? b : a));
    const islands = comps
        .filter(c => c !== body)
        .map(c => {
            const id = island_id(layer.id, c);
            return {
                ...c,
                id,
                policy: layer.overrides?.islands?.[id] ?? layer.island_policy ?? 'bridge',
                area_mm2: c.area_um2 / (kUmPerMm * kUmPerMm),
            };
        });

    const all_holes = comps.flatMap(c => c.holes.map(h => ({ hole: h, owner: c })));
    const w_um = mm_to_um(bridge_w_mm);
    const bridges = [];
    const unbridged = [];
    const removed = [];
    const parts = [];
    for (const island of islands) {
        if (island.policy === 'drop' || island.policy === 'glue') {
            removed.push(island.outer);
            if (island.policy === 'glue') parts.push([island.outer, ...island.holes]);
            continue;
        }
        // The smallest hole around the island (hole areas are negative, so the largest value).
        const enclosing = all_holes
            .filter(h => h.owner.outer !== island.outer && point_in_path(island.outer[0], h.hole))
            .sort((a, b) => path_area_um2(b.hole) - path_area_um2(a.hole))[0];
        if (!enclosing) {
            unbridged.push(island.id);
            continue;
        }
        const neighbours = islands.filter(o => o !== island && point_in_path(o.outer[0], enclosing.hole));
        const planned = plan_bridges(island, enclosing.hole, neighbours, w_um, bridge_count(island.area_mm2, layer.bridge?.max ?? 4));
        if (!planned.length) unbridged.push(island.id);
        for (const b of planned) {
            bridges.push({
                island: island.id,
                a: b.a,
                b: b.b,
                length_mm: b.length_um / kUmPerMm,
                w_mm: bridge_w_mm,
                rect: b.rect,
            });
        }
    }

    let out = material;
    if (removed.length) out = subtract(out, removed);
    if (bridges.length) out = union_all([...out, ...bridges.map(b => b.rect)]);
    return {
        material: out,
        islands: islands.map(i => ({ id: i.id, policy: i.policy, area_mm2: i.area_mm2, bbox: bbox_mm([i.outer]), outer: i.outer })),
        bridges,
        parts,
        unbridged,
    };
}
