// Primitive motifs (SPEC 8.1): the openings a layer cuts, before symmetry. Each motif is drawn once
// on the +x axis; "copies per repeat" spreads copies across one symmetry wedge, then the symmetry
// engine fills the circle. Returns paths in micrometres, counter-clockwise.
import { circle_path, regular_polygon_path, circle_segments, union_all } from '../geom/clip.js';
import { rotate_path, replicate, rotation_order } from '../geom/symmetry.js';
import { kMotifTypes } from '../core/schema.js';
import { mm_to_um } from '../core/units.js';

const kDeg = Math.PI / 180;

function arc_points(cx, cy, r, a0, a1) {
    const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) / (2 * Math.PI)) * circle_segments(r)));
    const out = [];
    for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        out.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) });
    }
    return out;
}

function window_path(m) {
    const r = mm_to_um(m.r_mm);
    const half = mm_to_um(m.size_mm) / 2;
    const sides = Math.round(m.sides);
    if (sides < 3) return circle_path(r, 0, half);
    return regular_polygon_path(r, 0, half, sides, (m.rot_deg ?? 0) * kDeg);
}

// A lens (vesica) pointing along the radius: two arcs meeting at tips length_mm apart.
function petal_path(m) {
    const cx = mm_to_um(m.r_mm);
    const half_len = mm_to_um(m.length_mm) / 2;
    const half_w = Math.min(mm_to_um(m.width_mm) / 2, half_len * 0.98);
    const R = (half_len * half_len + half_w * half_w) / (2 * half_w);
    const beta = Math.asin(half_len / R);
    const top = arc_points(cx, -(R - half_w), R, Math.PI / 2 - beta, Math.PI / 2 + beta);
    const bottom = arc_points(cx, R - half_w, R, -Math.PI / 2 - beta, -Math.PI / 2 + beta);
    return [...top, ...bottom.slice(1, -1)];
}

// An annular sector between r - w/2 and r + w/2, filling its share of the wedge minus a tie.
function ring_path(m, wedge_rad) {
    const r = mm_to_um(m.r_mm);
    const w = mm_to_um(m.w_mm);
    const r_out = r + w / 2;
    const r_in = Math.max(0, r - w / 2);
    const tie_rad = r > 0 ? mm_to_um(m.tie_mm ?? 0) / r : 0;
    // With no tie, neighbouring sectors would meet edge to edge, and vertex rounding leaves a
    // micron crack that survives as a hairline spike of material. Overlap them by about 5 um.
    const overlap_rad = tie_rad > 0 ? 0 : 5 / Math.max(r_in, 1000);
    const half = wedge_rad / 2 - tie_rad / 2 + overlap_rad;
    if (half <= 0) return [];
    if (half >= Math.PI - 1e-9) {
        // A full annulus: outer circle plus an inner hole (clockwise). This cuts an island free;
        // the bridge stage ties it back.
        return r_in > 0 ? [circle_path(0, 0, r_out), circle_path(0, 0, r_in).reverse()] : [circle_path(0, 0, r_out)];
    }
    const outer = arc_points(0, 0, r_out, -half, half);
    const inner = r_in > 0 ? arc_points(0, 0, r_in, half, -half) : [{ x: 0, y: 0 }];
    return [[...outer, ...inner]];
}

function ray_path(m) {
    const r0 = mm_to_um(m.r0_mm);
    const r1 = mm_to_um(m.r1_mm);
    const w0 = mm_to_um(m.w0_mm) / 2;
    const w1 = mm_to_um(m.w1_mm) / 2;
    if (r1 <= r0) return [];
    const path = [];
    if (w0 > 0) path.push({ x: r0, y: -w0 });
    else path.push({ x: r0, y: 0 });
    path.push({ x: r1, y: -w1 }, { x: r1, y: w1 });
    if (w0 > 0) path.push({ x: r0, y: w0 });
    return w1 > 0 || w0 > 0 ? [path] : [];
}

// Paths for one copy of a motif on the +x axis.
function base_paths(m, wedge_rad) {
    switch (m.type) {
        case 'window':
            return [window_path(m)];
        case 'petal':
            return [petal_path(m)];
        case 'ring':
            return ring_path(m, wedge_rad);
        case 'ray':
            return ray_path(m);
        default:
            throw new Error(`unknown motif "${m.type}"`);
    }
}

// All openings of one motif under the piece's symmetry.
export function motif_openings(m, sym) {
    if (!(m.type in kMotifTypes)) throw new Error(`unknown motif "${m.type}"`);
    if (m.type === 'disc') return m.d_mm > 0 ? [circle_path(0, 0, mm_to_um(m.d_mm) / 2)] : [];
    const mult = Math.max(1, Math.round(m.mult ?? 1));
    const wedge = (2 * Math.PI) / rotation_order(sym);
    const base = base_paths(m, wedge / mult);
    if (!base.length) return [];
    const copies = [];
    for (let j = 0; j < mult; j++) {
        const a = (m.angle_deg ?? 0) * kDeg + (j * wedge) / mult;
        for (const path of base) copies.push(rotate_path(path, a));
    }
    return replicate(copies, sym);
}

// The union of every motif's openings on a layer.
export function layer_openings(layer, sym) {
    const all = [];
    for (const m of layer.source.motifs ?? []) all.push(...motif_openings(m, sym));
    return all.length ? union_all(all) : [];
}
