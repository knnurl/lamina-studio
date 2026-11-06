// Geometry core over Clipper2 (SPEC 6.1). Paths are arrays of {x, y} in integer micrometres
// (Clipper2 Path64), closed, outer boundaries positive (counter-clockwise, y up) and holes negative.
// Assumptions: coordinates stay far below 2^53 (Clipper2-ts throws on overflow); curves are
// flattened at kChordTolUm before they reach this module or by the helpers here.
import {
    union,
    difference,
    intersect,
    rectClip,
    inflatePaths,
    area,
    areaPaths,
    getBoundsPaths,
    FillRule,
    JoinType,
    EndType,
} from '../vendor/clipper2/clipper2.min.mjs';
import { kUmPerMm } from '../core/units.js';

export const kChordTolUm = 20; // 0.02 mm, the flattening tolerance AngelShadowBox used

// Segment count for a circle of radius r_um whose chords deviate at most tol_um from the arc.
export function circle_segments(r_um, tol_um = kChordTolUm) {
    if (r_um <= tol_um) return 8;
    return Math.max(8, Math.ceil(Math.PI / Math.acos(1 - tol_um / r_um)));
}

// fit 'inside' puts the vertices on the circle (the polygon lies inside it), right for parts.
// fit 'outside' circumscribes it (the polygon's inscribed circle is r_um), right for holes that
// must clear a pin: an inscribed 3 mm hole at 0.02 mm tolerance is up to 0.037 mm too tight.
export function circle_path(cx_um, cy_um, r_um, { tol_um = kChordTolUm, fit = 'inside' } = {}) {
    const n = circle_segments(r_um, tol_um);
    const r_vertex_um = fit === 'outside' ? r_um / Math.cos(Math.PI / n) : r_um;
    return regular_polygon_path(cx_um, cy_um, r_vertex_um, n, 0);
}

// Counter-clockwise regular polygon with circumradius r_um; rot_rad turns the first vertex.
export function regular_polygon_path(cx_um, cy_um, r_um, sides, rot_rad = 0) {
    const path = [];
    for (let i = 0; i < sides; i++) {
        const a = rot_rad + (2 * Math.PI * i) / sides;
        path.push({ x: Math.round(cx_um + r_um * Math.cos(a)), y: Math.round(cy_um + r_um * Math.sin(a)) });
    }
    return path;
}

export function rect_path(x0_um, y0_um, x1_um, y1_um) {
    return [
        { x: x0_um, y: y0_um },
        { x: x1_um, y: y0_um },
        { x: x1_um, y: y1_um },
        { x: x0_um, y: y1_um },
    ];
}

// Counter-clockwise rectangle with corner radius r_um (vertices on the arcs).
export function rounded_rect_path(x0_um, y0_um, x1_um, y1_um, r_um, tol_um = kChordTolUm) {
    if (r_um <= 0) return rect_path(x0_um, y0_um, x1_um, y1_um);
    const quarter = Math.max(1, Math.ceil(circle_segments(r_um, tol_um) / 4));
    const corners = [
        [x1_um - r_um, y0_um + r_um, -Math.PI / 2],
        [x1_um - r_um, y1_um - r_um, 0],
        [x0_um + r_um, y1_um - r_um, Math.PI / 2],
        [x0_um + r_um, y0_um + r_um, Math.PI],
    ];
    const path = [];
    for (const [cx, cy, a0] of corners) {
        for (let i = 0; i <= quarter; i++) {
            const a = a0 + (Math.PI / 2) * (i / quarter);
            path.push({ x: Math.round(cx + r_um * Math.cos(a)), y: Math.round(cy + r_um * Math.sin(a)) });
        }
    }
    return path;
}

// Signed area in um2: positive for outer boundaries, negative for holes.
export function path_area_um2(path) {
    return area(path);
}

export function union_all(paths) {
    return union(paths, FillRule.NonZero);
}

export function subtract(subject, clip) {
    return difference(subject, clip, FillRule.NonZero);
}

export function intersect_paths(subject, clip) {
    return intersect(subject, clip, FillRule.NonZero);
}

// Fast clip of every path to an axis-aligned rectangle (Clipper2's RectClip, linear time).
// Each path is clipped on its own, so holes keep their orientation.
export function clip_to_rect(paths, x0_um, y0_um, x1_um, y1_um) {
    if (!paths.length) return [];
    return rectClip({ left: Math.round(x0_um), top: Math.round(y0_um), right: Math.round(x1_um), bottom: Math.round(y1_um) }, paths);
}

const kJoin = { round: JoinType.Round, miter: JoinType.Miter, square: JoinType.Square };

// Grows (delta_um > 0) or shrinks closed regions. Holes move the opposite way, so +kerf/2 on a
// layer grows its outline and shrinks its openings, which is what kerf compensation needs.
export function offset(paths, delta_um, join = 'round', tol_um = kChordTolUm, miter_limit = 2.0) {
    if (!(join in kJoin)) throw new Error(`offset: unknown join "${join}"`);
    return inflatePaths(paths, delta_um, kJoin[join], EndType.Polygon, miter_limit, tol_um);
}

export function area_mm2(paths) {
    return Math.abs(areaPaths(paths)) / (kUmPerMm * kUmPerMm);
}

export function bounds_mm(paths) {
    const b = getBoundsPaths(paths);
    return {
        x0: b.left / kUmPerMm,
        y0: b.top / kUmPerMm,
        x1: b.right / kUmPerMm,
        y1: b.bottom / kUmPerMm,
    };
}
