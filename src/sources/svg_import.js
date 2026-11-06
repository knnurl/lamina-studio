// SVG import (SPEC 8.1). Pure JS (no DOMParser), so it runs in the worker and in Node tests.
// - Units: width/height/viewBox honoured with mm, cm, in, pt, pc, px. A px is 1/96 in, except in
//   Illustrator files, whose px are points (1/72 in): the purchased 7-layer mandala, 824.7 px
//   square, is about 291 mm from Illustrator and would be 218 mm at 96 per inch.
// - Shapes: path, rect (rounded too), circle, ellipse, polygon, under nested transforms. Curves
//   and arcs are flattened at 0.02 mm after transforming to mm. Open paths, lines and polylines
//   cannot be material and are counted, not drawn. Text, defs, clip paths and hidden elements are
//   skipped.
// - Layers: one file gives one layer, unless its top level holds two or more groups with
//   geometry; then each group is a layer, the last drawn being the front.
// - Every closed shape is material; the layer's fill rule (even-odd by default, the cut-file
//   convention) decides holes.
import { parse_path, flatten_subpaths } from './svg_path.js';
import { union_all, union_fill, path_area_um2 } from '../geom/clip.js';

const kTolMm = 0.02;
const kSkip = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'script', 'linearGradient', 'radialGradient', 'filter']);

function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
        const k = e.toLowerCase();
        if (k === 'amp') return '&';
        if (k === 'lt') return '<';
        if (k === 'gt') return '>';
        if (k === 'quot') return '"';
        if (k === 'apos') return "'";
        if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
        return String.fromCodePoint(parseInt(k.slice(1), 10));
    });
}

// A minimal XML reader: elements and attributes. Comments, processing instructions, CDATA and
// DOCTYPE (with an internal subset, as Illustrator writes) are skipped; text is ignored.
export function parse_xml(text) {
    const root = { name: '#root', attrs: {}, children: [] };
    const stack = [root];
    const n = text.length;
    let i = 0;
    while (i < n) {
        const lt = text.indexOf('<', i);
        if (lt < 0) break;
        // \x3c is "<": the source must not hold a literal comment opener (it is inlined in a script).
        if (text.startsWith('\x3c!--', lt)) {
            const e = text.indexOf('-->', lt + 4);
            i = e < 0 ? n : e + 3;
            continue;
        }
        if (text.startsWith('<![CDATA[', lt)) {
            const e = text.indexOf(']]>', lt);
            i = e < 0 ? n : e + 3;
            continue;
        }
        if (text.startsWith('<?', lt)) {
            const e = text.indexOf('?>', lt);
            i = e < 0 ? n : e + 2;
            continue;
        }
        if (text.startsWith('<!', lt)) {
            let depth = 0;
            let j = lt + 2;
            for (; j < n; j++) {
                const c = text[j];
                if (c === '[') depth++;
                else if (c === ']') depth--;
                else if (c === '>' && depth <= 0) break;
            }
            i = j + 1;
            continue;
        }
        let j = lt + 1;
        let quote = null;
        for (; j < n; j++) {
            const c = text[j];
            if (quote) {
                if (c === quote) quote = null;
            } else if (c === '"' || c === "'") quote = c;
            else if (c === '>') break;
        }
        const body = text.slice(lt + 1, j);
        i = j + 1;
        if (body.startsWith('/')) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        const self_closing = body.endsWith('/');
        const inner = self_closing ? body.slice(0, -1) : body;
        const m = /^([^\s/>]+)/.exec(inner);
        if (!m) continue;
        const el = { name: m[1], attrs: {}, children: [] };
        const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        const rest = inner.slice(m[0].length);
        let a;
        while ((a = re.exec(rest))) el.attrs[a[1]] = decode(a[3] ?? a[4]);
        stack[stack.length - 1].children.push(el);
        if (!self_closing) stack.push(el);
    }
    return root;
}

const kUnitMm = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, q: 0.25 };

function length_mm(value, dpi) {
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|in|pt|pc|px|q)?\s*$/i.exec(value ?? '');
    if (!m) return null;
    const unit = (m[2] || 'px').toLowerCase();
    return Number(m[1]) * (unit === 'px' ? 25.4 / dpi : kUnitMm[unit]);
}

const mul = (p, q) => [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
];

function parse_transform(s) {
    let m = [1, 0, 0, 1, 0, 0];
    if (!s) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let t;
    while ((t = re.exec(s))) {
        const v = t[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
        let k;
        switch (t[1]) {
            case 'matrix':
                k = v.slice(0, 6);
                break;
            case 'translate':
                k = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
                break;
            case 'scale':
                k = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
                break;
            case 'rotate': {
                const r = ((v[0] ?? 0) * Math.PI) / 180;
                const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
                k = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], rot), [1, 0, 0, 1, -v[1], -v[2]]) : rot;
                break;
            }
            case 'skewX':
                k = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
                break;
            case 'skewY':
                k = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
                break;
        }
        m = mul(m, k);
    }
    return m;
}

const num = (v, d = 0) => (v === undefined || v === '' ? d : Number.parseFloat(v));

function hidden(el) {
    const style = el.attrs.style ?? '';
    return el.attrs.display === 'none' || el.attrs.visibility === 'hidden' || /display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style);
}

// Path data for the basic shapes, so everything goes through one parser and flattener.
function shape_d(el) {
    const a = el.attrs;
    switch (el.name) {
        case 'path':
            return a.d ?? '';
        case 'rect': {
            const x = num(a.x);
            const y = num(a.y);
            const w = num(a.width);
            const h = num(a.height);
            if (!(w > 0 && h > 0)) return '';
            let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
            let ry = a.ry !== undefined ? num(a.ry) : rx;
            rx = Math.min(rx, w / 2);
            ry = Math.min(ry, h / 2);
            if (!(rx > 0 && ry > 0)) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
            return (
                `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}` +
                `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
                `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`
            );
        }
        case 'circle':
        case 'ellipse': {
            const cx = num(a.cx);
            const cy = num(a.cy);
            const rx = el.name === 'circle' ? num(a.r) : num(a.rx);
            const ry = el.name === 'circle' ? num(a.r) : num(a.ry);
            if (!(rx > 0 && ry > 0)) return '';
            return `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
        }
        case 'polygon': {
            const v = (a.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
            if (v.length < 6) return '';
            let d = `M${v[0]},${v[1]}`;
            for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]},${v[i + 1]}`;
            return d + 'Z';
        }
        default:
            return null;
    }
}

// Collects closed polygons (mm) under el into acc.
function walk(el, m, acc) {
    if (kSkip.has(el.name) || hidden(el)) return;
    const here = mul(m, parse_transform(el.attrs.transform));
    if (el.name === 'line' || el.name === 'polyline') {
        acc.open++;
        return;
    }
    if (el.name === 'text' || el.name === 'use' || el.name === 'image') {
        acc.skipped++;
        return;
    }
    const d = shape_d(el);
    if (d) {
        const { closed, open } = flatten_subpaths(parse_path(d), here, kTolMm);
        acc.polys.push(...closed);
        acc.open += open;
        return;
    }
    for (const child of el.children) walk(child, here, acc);
}

const has_geometry = el => ['path', 'rect', 'circle', 'ellipse', 'polygon'].includes(el.name) || el.children.some(has_geometry);

function group_name(el, i) {
    return el.attrs['inkscape:label'] ?? el.attrs['data-name'] ?? el.attrs.id ?? `Layer ${i + 1}`;
}

// Parses one SVG file into layers of closed polygons in mm (y up, in the file's own frame).
// Returns { layers: [{ name, polys, open, skipped }], dpi, illustrator }, layers front first.
export function read_svg(text, { split_groups = true } = {}) {
    const illustrator = /Generator:\s*Adobe Illustrator/i.test(text);
    const dpi = illustrator ? 72 : 96;
    const root = parse_xml(text).children.find(e => e.name === 'svg' || e.name.endsWith(':svg'));
    if (!root) throw new Error('not an SVG file');
    const vb = (root.attrs.viewBox ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const w_mm = length_mm(root.attrs.width, dpi);
    const h_mm = length_mm(root.attrs.height, dpi);
    let s = 25.4 / dpi;
    let minx = 0;
    let miny = 0;
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        [minx, miny] = vb;
        if (w_mm && h_mm) s = Math.min(w_mm / vb[2], h_mm / vb[3]);
        else if (w_mm) s = w_mm / vb[2];
        else if (h_mm) s = h_mm / vb[3];
    }
    // User units to mm, with y flipped (SVG is y down, Lamina is y up).
    const base = mul([s, 0, 0, -s, 0, 0], mul([1, 0, 0, 1, -minx, -miny], parse_transform(root.attrs.transform)));

    const groups = root.children.filter(e => e.name === 'g' && !hidden(e) && has_geometry(e));
    const layers = [];
    if (split_groups && groups.length >= 2) {
        groups.forEach((g, i) => {
            const acc = { polys: [], open: 0, skipped: 0 };
            walk(g, base, acc);
            if (acc.polys.length) layers.push({ name: group_name(g, i), ...acc });
        });
        const loose = { polys: [], open: 0, skipped: 0 };
        for (const e of root.children) if (!groups.includes(e)) walk(e, base, loose);
        if (loose.polys.length) layers.push({ name: 'Ungrouped', ...loose });
        layers.reverse(); // last drawn is the front
    } else {
        const acc = { polys: [], open: 0, skipped: 0 };
        for (const e of root.children) walk(e, base, acc);
        if (acc.polys.length) layers.push({ name: 'Layer 1', ...acc });
    }
    return { layers, dpi, illustrator };
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Turns files into importable layers: one file is split by groups, several files give one layer
// each (front first by natural file name order). Artwork is centred on the origin, converted to
// integer micrometres, and the union silhouette becomes a custom outline.
// files: [{ name, text }]. Returns { layers: [{ name, paths, open, skipped }], outline, size_mm,
// dpi_note }.
export function import_svg_files(files) {
    const sorted = [...files].sort((a, b) => natural(a.name, b.name));
    const read = sorted.map(f => ({ file: f.name, ...read_svg(f.text, { split_groups: files.length === 1 }) }));
    let layers;
    if (read.length === 1) {
        layers = read[0].layers;
    } else {
        layers = read
            .map(r => ({
                name: r.file.replace(/\.svg$/i, ''),
                polys: r.layers.flatMap(l => l.polys),
                open: r.layers.reduce((n, l) => n + l.open, 0),
                skipped: r.layers.reduce((n, l) => n + l.skipped, 0),
            }))
            .filter(l => l.polys.length);
    }
    if (!layers.length) throw new Error('no closed shapes found');

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const l of layers) {
        for (const p of l.polys) {
            for (const [x, y] of p) {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x);
                y1 = Math.max(y1, y);
            }
        }
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const to_um = poly => poly.map(([x, y]) => ({ x: Math.round((x - cx) * 1000), y: Math.round((y - cy) * 1000) }));
    const out = layers.map(l => {
        const paths = l.polys.map(to_um);
        return { name: l.name, paths, open: l.open, skipped: l.skipped };
    });

    // Silhouette: every layer's material (even-odd), unioned, holes dropped.
    const solids = out.map(l => union_fill(l.paths, true));
    const outline = union_all(solids.flat()).filter(p => path_area_um2(p) > 0);
    const notes = [...new Set(read.map(r => (r.illustrator ? 'Illustrator file: 72 px per inch' : null)).filter(Boolean))];
    return { layers: out, outline, size_mm: { w: x1 - x0, h: y1 - y0 }, notes };
}
