// Sheet packing (SPEC 9.2): bounding-box skyline packing, bottom-left, rotation 0 or 90 degrees,
// largest parts first, first fit across the sheets already open. Deterministic: the same parts in
// the same order give the same layout. Not true-shape nesting: small parts do not go inside other
// parts' holes.
// Units: mm. Each skyline starts at the usable area's bottom-left (inside the sheet margin).

const kEps = 1e-9;

function new_sheet(W, s) {
    return { skyline: [{ x: 0, y: 0, w: W + s }], placed: [] };
}

// Lowest y at which a box w wide can rest from skyline segment i, or null.
function rest_y(skyline, i, w, W, s) {
    if (skyline[i].x + w > W + s + kEps) return null;
    let y = 0;
    let span = 0;
    for (let j = i; span < w - kEps; j++) {
        if (j >= skyline.length) return null;
        y = Math.max(y, skyline[j].y);
        span += skyline[j].w;
    }
    return y;
}

function raise(skyline, box) {
    const next = [];
    for (const seg of skyline) {
        const a = seg.x;
        const b = seg.x + seg.w;
        if (b <= box.x + kEps || a >= box.x + box.w - kEps) next.push(seg);
        else {
            if (a < box.x) next.push({ x: a, y: seg.y, w: box.x - a });
            if (b > box.x + box.w) next.push({ x: box.x + box.w, y: seg.y, w: b - box.x - box.w });
        }
    }
    next.push({ x: box.x, y: box.y + box.h, w: box.w });
    next.sort((p, q) => p.x - q.x);
    return next.reduce((acc, seg) => {
        const last = acc[acc.length - 1];
        if (last && Math.abs(last.y - seg.y) < kEps) last.w += seg.w;
        else acc.push({ ...seg });
        return acc;
    }, []);
}

// Best bottom-left spot for the item on one sheet, or null.
function spot(sheet_state, item, W, H, s) {
    let best = null;
    for (const rotated of [false, true]) {
        const w = (rotated ? item.h : item.w) + s;
        const h = (rotated ? item.w : item.h) + s;
        sheet_state.skyline.forEach((seg, i) => {
            const y = rest_y(sheet_state.skyline, i, w, W, s);
            if (y === null || y + h > H + s + kEps) return;
            const top = y + h;
            if (!best || top < best.y + best.h - kEps || (Math.abs(top - best.y - best.h) < kEps && seg.x < best.x)) {
                best = { x: seg.x, y, w, h, rotated };
            }
        });
    }
    return best;
}

// items: [{ key, w, h }], one per copy. sheet: { w_mm, h_mm, margin_mm, spacing_mm }.
// Returns { sheets: [[{ key, x, y, rotated }]], unplaced: [key] }; x, y are the placed box's
// bottom-left corner in sheet coordinates (mm).
export function pack(items, sheet) {
    const W = sheet.w_mm - 2 * sheet.margin_mm;
    const H = sheet.h_mm - 2 * sheet.margin_mm;
    const s = sheet.spacing_mm;
    const order = items
        .map((item, i) => ({ ...item, i }))
        .sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h) || a.i - b.i);
    const states = [];
    const unplaced = [];
    for (const item of order) {
        const fits_at_all = (item.w <= W + kEps && item.h <= H + kEps) || (item.h <= W + kEps && item.w <= H + kEps);
        if (!fits_at_all) {
            unplaced.push(item.key);
            continue;
        }
        let target = null;
        let box = null;
        for (const state of states) {
            box = spot(state, item, W, H, s);
            if (box) {
                target = state;
                break;
            }
        }
        if (!target) {
            target = new_sheet(W, s);
            states.push(target);
            box = spot(target, item, W, H, s);
        }
        target.skyline = raise(target.skyline, box);
        target.placed.push({ key: item.key, x: box.x + sheet.margin_mm, y: box.y + sheet.margin_mm, rotated: box.rotated });
    }
    return { sheets: states.map(st => st.placed), unplaced };
}
