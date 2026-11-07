// Symmetry engine (SPEC 6.2 step 2): replicates paths around the piece centre (the origin).
// Copies are made before any boolean union, so every copy is exact. A mirrored copy is reversed to
// stay counter-clockwise: otherwise it would cancel its original under the non-zero fill rule
// wherever they overlap.

const rotation = a => [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a)];
const kMirrorX = [1, 0, 0, -1]; // reflect across the x axis (y -> -y)
const kMirrorY = [-1, 0, 0, 1]; // reflect across the y axis (x -> -x)

function multiply(p, q) {
    return [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];
}

// Rotational order of a symmetry: the angle a motif's own copies ("copies per repeat") divide.
export function rotation_order(sym) {
    return sym.kind === 'rot' || sym.kind === 'dihedral' ? Math.max(1, Math.round(sym.n)) : 1;
}

// The 2 x 2 matrices of the symmetry group, phase applied, identity first.
export function symmetry_matrices(sym) {
    const n = rotation_order(sym);
    const out = [];
    switch (sym.kind) {
        case 'rot':
        case 'dihedral':
            for (let k = 0; k < n; k++) out.push(rotation((2 * Math.PI * k) / n));
            if (sym.kind === 'dihedral') {
                for (let k = 0; k < n; k++) out.push(multiply(rotation((2 * Math.PI * k) / n), kMirrorX));
            }
            break;
        case 'mirror_x':
            out.push([1, 0, 0, 1], kMirrorY);
            break;
        case 'mirror_xy':
            out.push([1, 0, 0, 1], kMirrorY, kMirrorX, [-1, 0, 0, -1]);
            break;
        case 'none':
            out.push([1, 0, 0, 1]);
            break;
        default:
            throw new Error(`unknown symmetry "${sym.kind}"`);
    }
    const phase = rotation(((sym.phase_deg ?? 0) * Math.PI) / 180);
    return out.map(m => multiply(phase, m));
}

export function transform_path(path, m) {
    const out = path.map(p => ({
        x: Math.round(m[0] * p.x + m[1] * p.y),
        y: Math.round(m[2] * p.x + m[3] * p.y),
    }));
    return m[0] * m[3] - m[1] * m[2] < 0 ? out.reverse() : out;
}

export function rotate_path(path, angle_rad) {
    return transform_path(path, rotation(angle_rad));
}

export function replicate(paths, sym) {
    const out = [];
    for (const m of symmetry_matrices(sym)) for (const path of paths) out.push(transform_path(path, m));
    return out;
}

const TAU = 2 * Math.PI;

// The fundamental domain as an angular range [a0, a1) (radians) plus a point test.
export function fundamental_domain(sym) {
    const n = rotation_order(sym);
    const norm = a => ((a % TAU) + TAU) % TAU;
    switch (sym.kind) {
        case 'rot':
            return { a0: 0, a1: TAU / n, contains: p => norm(Math.atan2(p.y, p.x)) < TAU / n - 1e-12 };
        case 'dihedral':
            return { a0: 0, a1: Math.PI / n, contains: p => norm(Math.atan2(p.y, p.x)) < Math.PI / n - 1e-12 };
        case 'mirror_x':
            return { a0: -Math.PI / 2, a1: Math.PI / 2, contains: p => p.x >= 0 };
        case 'mirror_xy':
            return { a0: 0, a1: Math.PI / 2, contains: p => p.x >= 0 && p.y >= 0 };
        default:
            return { a0: -Math.PI, a1: Math.PI, contains: () => true };
    }
}

// Maps a point (any unit) into the fundamental domain: the inverse of the copy that holds it, phase
// removed first. Edits on any copy land on the domain copy, and fields fold the same way.
export function fold_point(p, sym) {
    const ph = (-(sym.phase_deg ?? 0) * Math.PI) / 180;
    const x = p.x * Math.cos(ph) - p.y * Math.sin(ph);
    const y = p.x * Math.sin(ph) + p.y * Math.cos(ph);
    switch (sym.kind) {
        case 'mirror_x':
            return { x: Math.abs(x), y };
        case 'mirror_xy':
            return { x: Math.abs(x), y: Math.abs(y) };
        case 'rot':
        case 'dihedral': {
            const wedge = TAU / rotation_order(sym);
            let a = ((Math.atan2(y, x) % wedge) + wedge) % wedge;
            if (sym.kind === 'dihedral' && a > wedge / 2) a = wedge - a;
            const r = Math.hypot(x, y);
            return { x: r * Math.cos(a), y: r * Math.sin(a) };
        }
        default:
            return { x, y };
    }
}

// How many angular sectors a polar ring needs so the domain's edges fall on cell edges.
export function sector_multiple(sym) {
    const n = rotation_order(sym);
    if (sym.kind === 'dihedral') return 2 * n;
    if (sym.kind === 'rot') return n;
    if (sym.kind === 'mirror_xy') return 4;
    if (sym.kind === 'mirror_x') return 2;
    return 1;
}
