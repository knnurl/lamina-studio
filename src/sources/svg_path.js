// SVG path data and curve flattening (SPEC 8.1, import). Parses a path's "d" into subpaths of
// segments (line, cubic; quadratics and arcs become cubics), then flattens them after an affine
// transform, so the chord tolerance holds at real size.
// Assumptions: coordinates are SVG user units; the transform maps them to mm.

const kNumber = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function tokens(d) {
    const out = [];
    let i = 0;
    while (i < d.length) {
        const c = d[i];
        if (/[\s,]/.test(c)) {
            i++;
        } else if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
            out.push(c);
            i++;
        } else {
            kNumber.lastIndex = i;
            const m = kNumber.exec(d);
            if (!m) throw new Error(`bad path data near "${d.slice(i, i + 12)}"`);
            out.push({ n: Number(m[0]), raw: m[0] }); // raw text: arc flags may run together
            i = kNumber.lastIndex;
        }
    }
    return out;
}

const is_num = t => typeof t === 'object';

// Arc flags are single characters that may run on into the next number ("a1 1 0 01 5 5" or
// "a1 1 0 1110 10"), so a flag takes the first character of a number token and leaves the rest.
function arc_args(toks, at) {
    const vals = [];
    let i = at;
    while (vals.length < 7 && i < toks.length && is_num(toks[i])) {
        const t = toks[i];
        if ((vals.length === 3 || vals.length === 4) && t.raw.length > 1 && /^[01]/.test(t.raw)) {
            vals.push(Number(t.raw[0]));
            const rest = t.raw.slice(1);
            toks[i] = { n: Number(rest), raw: rest };
            continue;
        }
        vals.push(t.n);
        i++;
    }
    return { vals, next: i };
}

// Endpoint arc to cubic Beziers (at most 90 degrees each).
function arc_to_cubics(x1, y1, rx, ry, phi_deg, large, sweep, x2, y2) {
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [['L', x2, y2]];
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const phi = (phi_deg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const angle = (ux, uy, vx, vy) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
    const out = [];
    const step = dt / n;
    const k = (4 / 3) * Math.tan(step / 4);
    const point = t => {
        const ex = rx * Math.cos(t);
        const ey = ry * Math.sin(t);
        return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
    };
    const deriv = t => {
        const ex = -rx * Math.sin(t);
        const ey = ry * Math.cos(t);
        return [cos * ex - sin * ey, sin * ex + cos * ey];
    };
    for (let i = 0; i < n; i++) {
        const a = t1 + i * step;
        const b = a + step;
        const p0 = point(a);
        const p3 = point(b);
        const d0 = deriv(a);
        const d3 = deriv(b);
        out.push(['C', p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1]]);
    }
    return out;
}

// Parses d into subpaths: [{ start: [x, y], segs: [['L', x, y] | ['C', x1, y1, x2, y2, x, y]], closed }]
export function parse_path(d) {
    const toks = tokens(d);
    const subpaths = [];
    let cur = null;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let last_ctrl = null; // for S/T reflection: [x, y, kind]
    let i = 0;
    let cmd = null;
    const begin = () => {
        cur = { start: [x, y], segs: [], closed: false };
        subpaths.push(cur);
    };
    const need = () => {
        if (!cur) begin();
    };
    while (i < toks.length) {
        if (typeof toks[i] === 'string') cmd = toks[i++];
        else if (!cmd) throw new Error('path data must start with a command');
        const rel = cmd !== cmd.toUpperCase();
        const C = cmd.toUpperCase();
        const num = () => {
            if (!is_num(toks[i])) throw new Error(`missing number after ${cmd}`);
            return toks[i++].n;
        };
        switch (C) {
            case 'M': {
                const nx = num() + (rel ? x : 0);
                const ny = num() + (rel ? y : 0);
                x = nx;
                y = ny;
                sx = x;
                sy = y;
                begin();
                cmd = rel ? 'l' : 'L'; // following pairs are line-tos
                last_ctrl = null;
                break;
            }
            case 'L':
            case 'H':
            case 'V': {
                need();
                if (C === 'L') {
                    x = num() + (rel ? x : 0);
                    y = num() + (rel ? y : 0);
                } else if (C === 'H') x = num() + (rel ? x : 0);
                else y = num() + (rel ? y : 0);
                cur.segs.push(['L', x, y]);
                last_ctrl = null;
                break;
            }
            case 'C':
            case 'S': {
                need();
                let x1;
                let y1;
                if (C === 'C') {
                    x1 = num() + (rel ? x : 0);
                    y1 = num() + (rel ? y : 0);
                } else if (last_ctrl && last_ctrl[2] === 'C') {
                    x1 = 2 * x - last_ctrl[0];
                    y1 = 2 * y - last_ctrl[1];
                } else {
                    x1 = x;
                    y1 = y;
                }
                const x2 = num() + (rel ? x : 0);
                const y2 = num() + (rel ? y : 0);
                const nx = num() + (rel ? x : 0);
                const ny = num() + (rel ? y : 0);
                cur.segs.push(['C', x1, y1, x2, y2, nx, ny]);
                last_ctrl = [x2, y2, 'C'];
                x = nx;
                y = ny;
                break;
            }
            case 'Q':
            case 'T': {
                need();
                let qx;
                let qy;
                if (C === 'Q') {
                    qx = num() + (rel ? x : 0);
                    qy = num() + (rel ? y : 0);
                } else if (last_ctrl && last_ctrl[2] === 'Q') {
                    qx = 2 * x - last_ctrl[0];
                    qy = 2 * y - last_ctrl[1];
                } else {
                    qx = x;
                    qy = y;
                }
                const nx = num() + (rel ? x : 0);
                const ny = num() + (rel ? y : 0);
                cur.segs.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
                last_ctrl = [qx, qy, 'Q'];
                x = nx;
                y = ny;
                break;
            }
            case 'A': {
                need();
                const { vals, next } = arc_args(toks, i);
                if (vals.length < 7) throw new Error('arc needs 7 numbers');
                i = next;
                const nx = vals[5] + (rel ? x : 0);
                const ny = vals[6] + (rel ? y : 0);
                cur.segs.push(...arc_to_cubics(x, y, vals[0], vals[1], vals[2], vals[3] ? 1 : 0, vals[4] ? 1 : 0, nx, ny));
                x = nx;
                y = ny;
                last_ctrl = null;
                break;
            }
            case 'Z': {
                if (cur) cur.closed = true;
                x = sx;
                y = sy;
                cur = null;
                last_ctrl = null;
                cmd = null;
                break;
            }
            default:
                throw new Error(`unknown path command ${cmd}`);
        }
    }
    return subpaths;
}

function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function flatten_cubic(p0, p1, p2, p3, tol, out, depth = 0) {
    // Flat enough when both control points are within tol of the chord.
    const dx = p3[0] - p0[0];
    const dy = p3[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1e-12;
    const d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len;
    const d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / len;
    if ((d1 <= tol && d2 <= tol) || depth >= 18) {
        out.push(p3);
        return;
    }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const p01 = mid(p0, p1);
    const p12 = mid(p1, p2);
    const p23 = mid(p2, p3);
    const p012 = mid(p01, p12);
    const p123 = mid(p12, p23);
    const m = mid(p012, p123);
    flatten_cubic(p0, p01, p012, m, tol, out, depth + 1);
    flatten_cubic(m, p123, p23, p3, tol, out, depth + 1);
}

// Flattens parsed subpaths through transform m (2 x 3 affine, user units to mm) at tol_mm.
// Returns { closed: [[[x, y], ...]], open: count }.
export function flatten_subpaths(subpaths, m, tol_mm) {
    const closed = [];
    let open = 0;
    for (const sp of subpaths) {
        const pts = [apply(m, ...sp.start)];
        let prev = sp.start;
        for (const s of sp.segs) {
            if (s[0] === 'L') pts.push(apply(m, s[1], s[2]));
            else flatten_cubic(apply(m, ...prev), apply(m, s[1], s[2]), apply(m, s[3], s[4]), apply(m, s[5], s[6]), tol_mm, pts);
            prev = s[0] === 'L' ? [s[1], s[2]] : [s[5], s[6]];
        }
        const first = pts[0];
        const last = pts[pts.length - 1];
        const ends_meet = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
        if (sp.closed || (ends_meet && pts.length > 3)) {
            if (ends_meet) pts.pop();
            if (pts.length >= 3) closed.push(pts);
        } else if (sp.segs.length) {
            open++;
        }
    }
    return { closed, open };
}
