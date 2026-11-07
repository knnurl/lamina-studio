// Depth field mode (SPEC 6.7, M2). One scalar field f(x, y) in [0, 1], folded by the piece's
// symmetry, drives every layer: layer k keeps material where f < level_k, with levels rising from
// the front (field.lo) to the back (field.hi), so the stack nests by construction. The field is
// sampled once on a 0.75 mm grid (cached) and each layer is traced with marching squares.
// Assumptions: micrometres, origin at the symmetry centre, y up.
import { union_fill, simplify_paths } from '../geom/clip.js';
import { fold_point } from '../geom/symmetry.js';
import { kUmPerMm } from '../core/units.js';

const kResMm = 0.75; // 0.5 mm measured 2.25 times slower; linear interpolation keeps smooth fields accurate
const TAU = 2 * Math.PI;
const kKeyOffset = 2 ** 23; // um
const kKeyScale = 2 ** 24;

export const kFieldKinds = ['rings', 'chladni', 'interference', 'rose'];

// A picture source (SPEC M4.5, M5's image field): field.image is { w, h, data, hash }, data being
// base64 grey bytes, row by row from the top. Values are grey / 255 (dark is 0), swapped by
// field.invert. The picture fits inside the piece at zoom 1 and is never folded by the symmetry.
const raster_cache = new Map();

function grey_values(image, blur_px) {
    const key = `${image.hash}|${blur_px}`;
    if (raster_cache.has(key)) return raster_cache.get(key);
    const bin = atob(image.data);
    let v = new Float32Array(image.w * image.h);
    for (let i = 0; i < v.length; i++) v[i] = bin.charCodeAt(i) / 255;
    // Two box passes each way, close to a Gaussian.
    const box = (src, horizontal) => {
        const out = new Float32Array(src.length);
        const n = horizontal ? image.w : image.h;
        const lines = horizontal ? image.h : image.w;
        for (let line = 0; line < lines; line++) {
            const at = i => (horizontal ? line * image.w + i : i * image.w + line);
            let sum = 0;
            for (let i = -blur_px; i <= blur_px; i++) sum += src[at(Math.min(n - 1, Math.max(0, i)))];
            for (let i = 0; i < n; i++) {
                out[at(i)] = sum / (2 * blur_px + 1);
                sum += src[at(Math.min(n - 1, i + blur_px + 1))] - src[at(Math.max(0, i - blur_px))];
            }
        }
        return out;
    };
    if (blur_px > 0) for (let pass = 0; pass < 2; pass++) v = box(box(v, true), false);
    raster_cache.set(key, v);
    if (raster_cache.size > 6) raster_cache.delete(raster_cache.keys().next().value);
    return v;
}

// Samples the picture over the bounds at kResMm (outside the picture reads as 1, far and light).
function sample_image(f, b) {
    const img = f.image;
    const step = kResMm * kUmPerMm;
    const nx = Math.ceil((b.x1 - b.x0) / step) + 1;
    const ny = Math.ceil((b.y1 - b.y0) / step) + 1;
    const out = new Float32Array(nx * ny).fill(1);
    if (!img?.data) return { v: out, nx, ny, step, x0: b.x0, y0: b.y0 };
    const cx = (b.x0 + b.x1) / 2 / kUmPerMm;
    const cy = (b.y0 + b.y1) / 2 / kUmPerMm;
    const mm_per_px = Math.min((b.x1 - b.x0) / kUmPerMm / img.w, (b.y1 - b.y0) / kUmPerMm / img.h) / Math.max(0.1, f.zoom ?? 1);
    const g = grey_values(img, Math.max(0, Math.round((f.smooth_mm ?? 0) / mm_per_px)));
    const at = (i, j) => g[Math.min(img.h - 1, Math.max(0, j)) * img.w + Math.min(img.w - 1, Math.max(0, i))];
    for (let j = 0; j < ny; j++) {
        const y = (b.y0 + j * step) / kUmPerMm;
        const py = (cy - y) / mm_per_px + img.h / 2 - 0.5;
        if (py < -0.5 || py > img.h - 0.5) continue;
        for (let i = 0; i < nx; i++) {
            const x = (b.x0 + i * step) / kUmPerMm;
            const px = (x - cx) / mm_per_px + img.w / 2 - 0.5;
            if (px < -0.5 || px > img.w - 0.5) continue;
            const i0 = Math.floor(px);
            const j0 = Math.floor(py);
            const fx = px - i0;
            const fy = py - j0;
            const val = at(i0, j0) * (1 - fx) * (1 - fy) + at(i0 + 1, j0) * fx * (1 - fy) + at(i0, j0 + 1) * (1 - fx) * fy + at(i0 + 1, j0 + 1) * fx * fy;
            out[j * nx + i] = f.invert ? 1 - val : val;
        }
    }
    return { v: out, nx, ny, step, x0: b.x0, y0: b.y0 };
}

// The raw field at (x, y) in mm, in [0, 1].
function value(f, x, y) {
    const lambda = Math.max(1, f.scale_mm);
    const r = Math.hypot(x, y);
    const th = Math.atan2(y, x);
    switch (f.kind) {
        case 'chladni': {
            const L = lambda * 4;
            const m = Math.max(1, Math.round(f.k));
            const n = m + 2;
            const v = Math.cos((Math.PI * m * x) / L) * Math.cos((Math.PI * n * y) / L) - Math.cos((Math.PI * n * x) / L) * Math.cos((Math.PI * m * y) / L);
            return 0.5 + 0.25 * v;
        }
        case 'interference': {
            const d = lambda * (1 + f.a);
            const r1 = Math.hypot(x - d, y);
            const r2 = Math.hypot(x + d, y);
            return 0.5 + 0.25 * (Math.cos((TAU * r1) / lambda) + Math.cos((TAU * r2) / lambda));
        }
        case 'rose':
            return 0.5 + 0.5 * Math.cos(Math.max(1, Math.round(f.k)) * th) * Math.cos((TAU * r) / lambda + f.a);
        case 'rings':
        default:
            return 0.5 + 0.5 * Math.cos((TAU * r) / lambda + f.a * Math.sin(Math.max(1, Math.round(f.k)) * th));
    }
}

const sample_cache = new Map();

// Samples the field over the bounds (micrometres) at kResMm, cached by field, symmetry and bounds.
function sample(f, sym, b) {
    const key = f.kind === 'image' ? JSON.stringify(['image', f.image?.hash, f.zoom, f.smooth_mm, !!f.invert, b]) : JSON.stringify([f.kind, f.scale_mm, f.k, f.a, sym, b]);
    if (sample_cache.has(key)) return sample_cache.get(key);
    if (f.kind === 'image') {
        const grid = sample_image(f, b);
        sample_cache.set(key, grid);
        if (sample_cache.size > 8) sample_cache.delete(sample_cache.keys().next().value);
        return grid;
    }
    const step = kResMm * kUmPerMm;
    const nx = Math.ceil((b.x1 - b.x0) / step) + 1;
    const ny = Math.ceil((b.y1 - b.y0) / step) + 1;
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        const y = (b.y0 + j * step) / kUmPerMm;
        for (let i = 0; i < nx; i++) {
            const x = (b.x0 + i * step) / kUmPerMm;
            // Folded into the fundamental domain, so the field is as symmetric as the piece.
            const q = fold_point({ x, y }, sym);
            v[j * nx + i] = value(f, q.x, q.y);
        }
    }
    const grid = { v, nx, ny, step, x0: b.x0, y0: b.y0 };
    sample_cache.set(key, grid);
    if (sample_cache.size > 8) sample_cache.delete(sample_cache.keys().next().value);
    return grid;
}

// Marching squares: closed contours (micrometres) around the region where the sampled field is
// below level. Outside the grid reads as 2 (above any level), so every contour closes. A finite
// value keeps border edges interpolating normally: Infinity snapped points onto border samples,
// made zero-length segments, and broke loops where they collided.
export function contours_below(grid, level) {
    const { v, nx, ny, step, x0, y0 } = grid;
    const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 2 : v[j * nx + i]);
    const inside = (i, j) => at(i, j) < level;
    const segs = new Map(); // start key -> [end points]
    const pt = (i0, j0, i1, j1) => {
        const a = at(i0, j0);
        const b = at(i1, j1);
        const t = Math.min(1, Math.max(0, (level - a) / (b - a)));
        return { x: Math.round(x0 + (i0 + (i1 - i0) * t) * step), y: Math.round(y0 + (j0 + (j1 - j0) * t) * step) };
    };
    // Numeric point keys (coordinates within 8 m of the origin): faster than strings.
    const key = p => (p.x + kKeyOffset) * kKeyScale + (p.y + kKeyOffset);
    const add = (p, q) => {
        if (p.x === q.x && p.y === q.y) return;
        const k = key(p);
        if (segs.has(k)) segs.get(k).push(q);
        else segs.set(k, [q]);
    };
    const take = k => {
        const list = segs.get(k);
        const q = list.pop();
        if (!list.length) segs.delete(k);
        return q;
    };
    for (let j = -1; j < ny; j++) {
        for (let i = -1; i < nx; i++) {
            // Corners: a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1); bit set means inside.
            const code = (inside(i, j) ? 1 : 0) | (inside(i + 1, j) ? 2 : 0) | (inside(i + 1, j + 1) ? 4 : 0) | (inside(i, j + 1) ? 8 : 0);
            if (code === 0 || code === 15) continue;
            const S = () => pt(i, j, i + 1, j);
            const E = () => pt(i + 1, j, i + 1, j + 1);
            const N = () => pt(i, j + 1, i + 1, j + 1);
            const W = () => pt(i, j, i, j + 1);
            // Segments run with the inside region on their left, so outers wind counter-clockwise.
            switch (code) {
                case 1: add(S(), W()); break;
                case 2: add(E(), S()); break;
                case 3: add(E(), W()); break;
                case 4: add(N(), E()); break;
                case 5: {
                    const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 < level;
                    if (centre) { add(S(), E()); add(N(), W()); } else { add(S(), W()); add(N(), E()); }
                    break;
                }
                case 6: add(N(), S()); break;
                case 7: add(N(), W()); break;
                case 8: add(W(), N()); break;
                case 9: add(S(), N()); break;
                case 10: {
                    const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 < level;
                    if (centre) { add(W(), S()); add(E(), N()); } else { add(E(), S()); add(W(), N()); }
                    break;
                }
                case 11: add(E(), N()); break;
                case 12: add(W(), E()); break;
                case 13: add(S(), E()); break;
                case 14: add(W(), S()); break;
            }
        }
    }
    // Link segments into loops.
    const loops = [];
    while (segs.size) {
        const start_key = segs.keys().next().value;
        const first = take(start_key);
        const loop = [{ x: Math.floor(start_key / kKeyScale) - kKeyOffset, y: (start_key % kKeyScale) - kKeyOffset }, first];
        let cur = key(first);
        while (segs.has(cur)) {
            const next = take(cur);
            if (key(next) === start_key) break;
            loop.push(next);
            cur = key(next);
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

// Material of one layer in field mode, before the outline clip: the region below the level.
export function field_material(piece, level, bounds_um) {
    if (level >= 1) return null; // everything: the caller keeps the whole outline
    const grid = sample(piece.field, piece.symmetry, bounds_um);
    const loops = contours_below(grid, level);
    // 30 um: within the error of tracing a 0.75 mm grid; measured 15 to 25% faster to open than 15 um.
    return loops.length ? union_fill(simplify_paths(loops, 30), true) : [];
}

export function field_level(piece, k, count) {
    const f = piece.field;
    return count > 1 ? f.lo + ((f.hi - f.lo) * k) / (count - 1) : f.lo;
}
