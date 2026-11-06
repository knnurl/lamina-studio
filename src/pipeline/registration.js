// Registration and spacers (SPEC 4.3, 4.4, 6.3, 6.4).
// Dowels: placed in material that every layer shares, so the holes are hidden behind the front
// layer even when it is not drilled. Angles follow a fixed pattern whose gaps all differ, so no
// rotation or flip of a layer fits: the dowels fix orientation as well as position. Each sits
// mid-band on the outermost run of shared material along its ray.
// IDs: "L<n> ^" engraved on layer n (n >= 2) where the layer in front hides it, clear of dowels.
// Spacers: for each gap, gap / stock-thickness sheets of pucks (washers on the dowels) or rings
// (inside both layers' frame rings).
// Assumptions: material in micrometres after island resolution; origin at the symmetry centre.
import { offset, intersect_paths, subtract, circle_path, area_mm2, clip_to_rect } from '../geom/clip.js';
import { outline_paths } from '../geom/outline.js';
import { text_strokes, text_width_mm } from '../export/stroke_font.js';
import { material_of } from '../core/design.js';
import { mm_to_um, kUmPerMm } from '../core/units.js';

export const kDowelEdgeMm = 3.5; // material kept around each hole: pucks are 3 mm wide
const kPuckWidthMm = 3;
const kHoleClearanceMm = 0.1;
const kIdCaps = [4, 2.5];
const kIdMarginMm = 1;
const kDeg = Math.PI / 180;

// Dowel angles in degrees, starting at the top, with every gap different (no symmetry).
export function dowel_angles(count) {
    const n = Math.max(2, Math.round(count));
    const offsets = Array.from({ length: n }, (_, i) => (i % 2 ? 1 : -1) * (6 + 5 * i));
    const mean = offsets.reduce((a, b) => a + b, 0) / n;
    const gaps = offsets.map(o => 360 / n + o - mean);
    const angles = [90];
    for (let i = 0; i < n - 1; i++) angles.push(angles[i] + gaps[i]);
    return angles.map(a => ((a % 360) + 360) % 360);
}

// Distances along a ray from the origin where it crosses the region's boundary, paired into
// inside intervals (even-odd).
function ray_intervals(region, angle_rad) {
    const dx = Math.cos(angle_rad);
    const dy = Math.sin(angle_rad);
    const hits = [];
    for (const path of region) {
        for (let i = 0; i < path.length; i++) {
            const a = path[i];
            const b = path[(i + 1) % path.length];
            const ex = b.x - a.x;
            const ey = b.y - a.y;
            const den = dx * ey - dy * ex;
            if (Math.abs(den) < 1e-12) continue;
            const t = (a.x * ey - a.y * ex) / den; // distance along the ray
            const s = (a.x * dy - a.y * dx) / den; // position along the edge
            if (t > 0 && s >= 0 && s < 1) hits.push(t);
        }
    }
    hits.sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i], hits[i + 1]]);
    return out;
}

function at(angle_rad, r) {
    return { x: Math.round(r * Math.cos(angle_rad)), y: Math.round(r * Math.sin(angle_rad)) };
}

export function hole_d_mm(design) {
    return design.registration.hole_d_mm ?? design.registration.dowel_d_mm + kHoleClearanceMm;
}

function place_dowels(design, built) {
    const reg = design.registration;
    const r_hole = mm_to_um(hole_d_mm(design) / 2);
    let shared = built[0].material;
    for (const l of built.slice(1)) shared = intersect_paths(shared, l.material);
    const region = shared.length ? offset(shared, -(r_hole + mm_to_um(kDowelEdgeMm)), 'round') : [];
    const dowels = [];
    for (const angle_deg of dowel_angles(reg.count)) {
        // Search outwards from the target angle until the ray meets usable material.
        for (let step = 0; step <= 30; step++) {
            const a = (angle_deg + (step % 2 ? 1 : -1) * Math.ceil(step / 2)) * kDeg;
            const runs = ray_intervals(region, a);
            if (runs.length) {
                const [t0, t1] = runs[runs.length - 1];
                dowels.push(at(a, (t0 + t1) / 2));
                break;
            }
        }
    }
    return { dowels, r_hole };
}

// Searches rays from the bottom (270 degrees) outwards, up to max_steps 5-degree steps each way,
// for a spot where the text's box lies wholly inside room.
function search_id(text, room, max_steps) {
    for (const cap of kIdCaps) {
        const w = mm_to_um(text_width_mm(text, cap) + 2 * kIdMarginMm);
        const h = mm_to_um(cap + 2 * kIdMarginMm);
        const full = (w * h) / (kUmPerMm * kUmPerMm);
        for (let step = 0; step <= 2 * max_steps; step++) {
            const a = (270 + (step % 2 ? 1 : -1) * 5 * Math.ceil(step / 2)) * kDeg;
            for (const [t0, t1] of ray_intervals(room, a).reverse()) {
                const c = at(a, (t0 + t1) / 2);
                const inside = area_mm2(clip_to_rect(room, c.x - w / 2, c.y - h / 2, c.x + w / 2, c.y + h / 2));
                if (inside >= full * 0.999) {
                    return text_strokes(text, { x_mm: c.x / kUmPerMm, y_mm: c.y / kUmPerMm - cap / 2, cap_mm: cap, align: 'centre' });
                }
            }
        }
    }
    return null;
}

// Where layer k's ID can go: material of layer k that the layer in front hides, clear of dowels.
// Tried first in a band along the bottom (cheap: both layers are rect-clipped before the boolean
// work), then over the whole layer.
function place_id(text, material, front, keep_out, bounds) {
    const room_in = (a, b) => {
        const hidden = offset(intersect_paths(a, b), -mm_to_um(0.5));
        return keep_out.length && hidden.length ? subtract(hidden, keep_out) : hidden;
    };
    const { x0, y0, x1, y1 } = bounds;
    const band_top = y0 + (y1 - y0) * 0.3;
    const near = room_in(clip_to_rect(material, x0, y0, x1, band_top), clip_to_rect(front, x0, y0, x1, band_top));
    return (near.length && search_id(text, near, 12)) || search_id(text, room_in(material, front), 36);
}

function spacer_parts(design, dowels, r_hole, k) {
    const layer = design.layers[k];
    const stock_t = material_of(design, { material: design.spacers.stock_material }).thickness_mm;
    const copies = Math.max(1, Math.round(layer.gap_mm / stock_t));
    const holes = dowels.map(p => circle_path(p.x, p.y, r_hole, { tol_um: 5, fit: 'outside' }));
    if (design.spacers.style === 'rings') {
        const outline = outline_paths(design.piece.outline);
        const band_mm = Math.min(layer.frame_ring_mm, design.layers[k + 1].frame_ring_mm) - 1;
        if (band_mm < 2 * material_of(design, layer).min_web_mm) return null;
        const ring = subtract(offset(outline, -mm_to_um(0.5)), offset(outline, -mm_to_um(band_mm + 0.5)));
        return { kind: 'ring', gap: k, copies, paths: subtract(ring, holes) };
    }
    if (!dowels.length) return null;
    // One puck, centred on the origin; every dowel takes `copies` of them.
    const puck = [circle_path(0, 0, r_hole + mm_to_um(kPuckWidthMm)), circle_path(0, 0, r_hole, { tol_um: 5, fit: 'outside' }).reverse()];
    return { kind: 'puck', gap: k, copies: copies * dowels.length, paths: puck };
}

// Adds dowel holes and IDs to the built layers, and returns the stack-level results.
export function register_stack(design, built) {
    const reg = design.registration;
    const out = { dowels: [], hole_d_mm: hole_d_mm(design), spacers: [], warnings: [] };
    if (!built.length) return out;
    const { dowels, r_hole } = built.length > 1 || reg.through_front ? place_dowels(design, built) : { dowels: [], r_hole: 0 };
    out.dowels = dowels;
    if (dowels.length < reg.count && built.length > 1) {
        out.warnings.push({ id: 'W-05', layer: 0, message: `Room for only ${dowels.length} of ${reg.count} dowels in the material every layer shares.` });
    }
    const holes = dowels.map(p => circle_path(p.x, p.y, r_hole, { tol_um: 5, fit: 'outside' }));
    const keep_out = dowels.map(p => circle_path(p.x, p.y, r_hole + mm_to_um(kDowelEdgeMm)));
    built.forEach((l, k) => {
        l.ids = [];
        if (holes.length && (k > 0 || reg.through_front)) l.material = subtract(l.material, holes);
    });
    if (reg.ids) {
        const outline = outline_paths(design.piece.outline)[0];
        const bounds = {
            x0: Math.min(...outline.map(p => p.x)),
            y0: Math.min(...outline.map(p => p.y)),
            x1: Math.max(...outline.map(p => p.x)),
            y1: Math.max(...outline.map(p => p.y)),
        };
        built.forEach((l, k) => {
            if (k === 0) return;
            const strokes = place_id(`L${k + 1} ^`, l.material, built[k - 1].material, keep_out, bounds);
            if (strokes) l.ids = strokes;
            else out.warnings.push({ id: 'W-05', layer: k, message: `Layer ${k + 1}: no hidden spot large enough for its engraved ID.` });
        });
    }
    design.layers.forEach((layer, k) => {
        if (k < design.layers.length - 1 && layer.gap_mm > 0) {
            const part = spacer_parts(design, dowels, r_hole, k);
            if (part) out.spacers.push(part);
            else {
                const why = design.spacers.style === 'rings' ? 'frame rings too narrow for spacer rings; use pucks' : 'no dowels to put spacer pucks on';
                out.warnings.push({ id: 'W-05', layer: k, message: `Layer ${k + 1}: ${why}.` });
            }
        }
    });
    return out;
}

// Total length a dowel needs: every drilled layer plus the gaps between them.
export function dowel_length_mm(design) {
    const first = design.registration.through_front ? 0 : 1;
    let total = 0;
    design.layers.forEach((layer, k) => {
        if (k < first) return;
        total += layer.thickness_mm ?? material_of(design, layer).thickness_mm;
        if (k < design.layers.length - 1) total += layer.gap_mm;
    });
    return Math.round(total * 10) / 10;
}
