// Curve motifs (SPEC 8.4, M4) as cubic Bezier nodes in the motif's local frame: mm, x along the
// radius (outwards), origin at the motif's centre, length along x and width across. The worker
// flattens them; the UI converts any of them (and a petal) into an editable shape with the same
// nodes. No geometry library here, so the main thread can use it.
// Scroll: a spiral curl on a stem. Ruyi: a three-lobed cloud head on a stem. Ogee: a pointed
// onion arch with S-curved flanks. Lotus: a centre petal with two side petals.
import { nodes_through } from '../geom/bezier.js';

export const kCurveTypes = ['scroll', 'ruyi', 'ogee', 'lotus'];

const node = (x, y, ix = x, iy = y, ox = x, oy = y) => ({ x, y, ix, iy, ox, oy });

// The closed outline from its lower half (base corner first, the tip left out) and the tip:
// the upper half mirrors the lower across the x axis, in reverse, handles swapped.
function mirrored(lower, tip) {
    const flip = n => ({ x: n.x, y: -n.y, ix: n.ox, iy: -n.oy, ox: n.ix, oy: -n.iy });
    return [...lower, { ...tip, ox: tip.ix, oy: -tip.iy }, ...[...lower].reverse().map(flip)];
}

// A lens of two circular arcs (the petal motif exactly), each arc as two cubics.
function petal_nodes(L, W) {
    const hl = L / 2;
    const hw = Math.min(W / 2, hl * 0.98);
    const R = (hl * hl + hw * hw) / (2 * hw);
    const beta = Math.asin(hl / R);
    const k = (4 / 3) * Math.tan(beta / 4) * R;
    const T = th => ({ x: -Math.sin(th), y: Math.cos(th) });
    const tu0 = T(Math.PI / 2 - beta);
    const tu1 = T(Math.PI / 2 + beta);
    const tl0 = T(-Math.PI / 2 - beta);
    const tl1 = T(-Math.PI / 2 + beta);
    return [
        node(hl, 0, hl - k * tl1.x, -k * tl1.y, hl + k * tu0.x, k * tu0.y),
        node(0, hw, k, hw, -k, hw),
        node(-hl, 0, -hl - k * tu1.x, -k * tu1.y, -hl + k * tl0.x, k * tl0.y),
        node(0, -hw, -k, -hw, k, -hw),
    ];
}

function ogee_nodes(L, W) {
    const X = f => -L / 2 + f * L;
    const Y = f => f * W;
    return mirrored(
        [
            node(X(0), Y(-0.3), X(0), Y(-0.3), X(0.08), Y(-0.46)),
            node(X(0.33), Y(-0.5), X(0.17), Y(-0.5), X(0.5), Y(-0.5)),
            node(X(0.72), Y(-0.17), X(0.62), Y(-0.27), X(0.82), Y(-0.07)),
        ],
        node(X(1), 0, X(0.9), Y(-0.02)),
    );
}

function lotus_nodes(L, W) {
    const X = f => -L / 2 + f * L;
    const Y = f => f * W;
    return mirrored(
        [
            node(X(0), Y(-0.1), X(0), Y(-0.1), X(0.12), Y(-0.32)),
            node(X(0.56), Y(-0.5), X(0.34), Y(-0.52), X(0.5), Y(-0.38)),
            // The notch: the side petal comes in from below and the centre petal leaves almost
            // along the axis, so the material point between them is about 84 degrees wide, not a
            // hairline (a 16 degree point measured G-02).
            node(X(0.44), Y(-0.2), X(0.44), Y(-0.3), X(0.6), Y(-0.22)),
        ],
        node(X(1), 0, X(0.86), Y(-0.18)),
    );
}

// A three-lobed cloud head, rho = R (0.7 + 0.3 cos 3 phi) round its centre, on a narrow stem
// from the inner end. The two back lobes point towards the stem, so they read as curling in.
function ruyi_nodes(L, W) {
    const R = 0.55 * W;
    const c = { x: L / 2 - R, y: 0 };
    const s = 0.1 * W; // stem half-width
    const rho = phi => R * (0.7 + 0.3 * Math.cos(3 * phi));
    // Where the head meets the stem: the angle (round from the back) at which the head is s wide.
    let back = Math.PI - 0.05;
    while (back > Math.PI / 2 && Math.abs(rho(back) * Math.sin(back)) < s) back -= 0.01;
    const pts = [{ x: -L / 2, y: -s }];
    const steps = 36;
    for (let k = 0; k <= steps; k++) {
        const phi = -back + (2 * back * k) / steps;
        pts.push({ x: c.x + rho(phi) * Math.cos(phi), y: c.y + rho(phi) * Math.sin(phi) });
    }
    pts.push({ x: -L / 2, y: s });
    return nodes_through(pts, new Set([0, 1, steps + 1, steps + 2]));
}

// A band along a stem and a spiral of `turns` turns that tightens to 45% of its radius. The band
// is at most half the spacing between arms, so arms never touch and nothing is enclosed.
function scroll_nodes(L, W, turns) {
    const R0 = W / 2;
    const xc = L / 2 - R0;
    const band = Math.min(W * 0.16, (0.5 * 0.55 * R0) / turns);
    const line = [];
    const stem = Math.max(0, xc + L / 2);
    const n_stem = Math.max(1, Math.round(stem / (R0 * 0.8)));
    for (let k = 0; k < n_stem; k++) line.push({ x: -L / 2 + (stem * k) / n_stem, y: -R0 });
    const n_spiral = Math.max(6, Math.round(10 * turns));
    for (let k = 0; k <= n_spiral; k++) {
        const t = k / n_spiral;
        const th = -Math.PI / 2 + t * turns * 2 * Math.PI;
        const r = R0 * (1 - 0.55 * t);
        line.push({ x: xc + r * Math.cos(th), y: r * Math.sin(th) });
    }
    // Offset each side along the normal; the right side forwards and the left back keeps the
    // outline counter-clockwise.
    const side = s =>
        line.map((p, i) => {
            const a = line[Math.max(0, i - 1)];
            const b = line[Math.min(line.length - 1, i + 1)];
            const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            return { x: p.x + (s * (b.y - a.y) * band) / (2 * l), y: p.y - (s * (b.x - a.x) * band) / (2 * l) };
        });
    const pts = [...side(1), ...side(-1).reverse()];
    const m = line.length;
    return nodes_through(pts, new Set([0, m - 1, m, 2 * m - 1]));
}

// The nodes of a curve motif (or a petal), in its local frame.
export function curve_nodes(m) {
    const L = Math.max(1, m.length_mm);
    const W = Math.max(0.5, m.width_mm);
    switch (m.type) {
        case 'petal':
            return petal_nodes(L, W);
        case 'ogee':
            return ogee_nodes(L, W);
        case 'lotus':
            return lotus_nodes(L, W);
        case 'ruyi':
            return ruyi_nodes(L, W);
        case 'scroll':
            return scroll_nodes(L, W, Math.max(0.25, Math.min(3, m.turns ?? 1.25)));
        default:
            throw new Error(`not a curve motif: "${m.type}"`);
    }
}

// An editable shape motif from a curve motif or petal: the same outline, placement and copies.
export function to_shape(m) {
    const r2 = v => Math.round(v * 100) / 100;
    return {
        type: 'shape',
        r_mm: m.r_mm,
        mult: m.mult ?? 1,
        angle_deg: m.angle_deg ?? 0,
        nodes: curve_nodes(m).map(n => ({ x: r2(n.x), y: r2(n.y), ix: r2(n.ix), iy: r2(n.iy), ox: r2(n.ox), oy: r2(n.oy) })),
    };
}
