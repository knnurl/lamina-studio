// Single-stroke font for engraved labels and layer IDs (SPEC 6.4). Defined in-repo, so there is no
// font licence to carry. Glyphs sit on a 4 x 6 grid (width x cap height); corners are chamfered,
// which suits the studio's look and keeps every glyph a few straight strokes.
// Assumptions: uppercase only (input is upper-cased); an unknown character is an error, never
// silently dropped. Output is open polylines in integer micrometres, y up.
import { mm_to_um } from '../core/units.js';

const kO = '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0';
const kGlyphs = {
    A: ['0,0 0,4 2,6 4,4 4,0', '0,3 4,3'],
    B: ['0,0 0,6 3,6 4,5 4,4 3,3 0,3', '3,3 4,2 4,1 3,0 0,0'],
    C: ['4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5'],
    D: ['0,0 0,6 3,6 4,5 4,1 3,0 0,0'],
    E: ['4,0 0,0 0,6 4,6', '0,3 3,3'],
    F: ['0,0 0,6 4,6', '0,3 3,3'],
    G: ['4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3'],
    H: ['0,0 0,6', '4,0 4,6', '0,3 4,3'],
    I: ['1,0 3,0', '2,0 2,6', '1,6 3,6'],
    J: ['4,6 4,1 3,0 1,0 0,1'],
    K: ['0,0 0,6', '4,6 0,2', '1.5,3.5 4,0'],
    L: ['0,6 0,0 4,0'],
    M: ['0,0 0,6 2,3 4,6 4,0'],
    N: ['0,0 0,6 4,0 4,6'],
    O: [kO],
    P: ['0,0 0,6 3,6 4,5 4,4 3,3 0,3'],
    Q: [kO, '2,2 4,0'],
    R: ['0,0 0,6 3,6 4,5 4,4 3,3 0,3', '2,3 4,0'],
    S: ['4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1'],
    T: ['0,6 4,6', '2,6 2,0'],
    U: ['0,6 0,1 1,0 3,0 4,1 4,6'],
    V: ['0,6 2,0 4,6'],
    W: ['0,6 1,0 2,3 3,0 4,6'],
    X: ['0,0 4,6', '0,6 4,0'],
    Y: ['0,6 2,3 4,6', '2,3 2,0'],
    Z: ['0,6 4,6 0,0 4,0'],
    0: [kO, '1,1 3,5'],
    1: ['1,5 2,6 2,0', '1,0 3,0'],
    2: ['0,5 1,6 3,6 4,5 4,4 0,0 4,0'],
    3: ['0,5 1,6 3,6 4,5 4,4 3,3 1,3', '3,3 4,2 4,1 3,0 1,0 0,1'],
    4: ['3,0 3,6 0,2 4,2'],
    5: ['4,6 0,6 0,3 3,3 4,2 4,1 3,0 0,0'],
    6: ['4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3'],
    7: ['0,6 4,6 1,0'],
    8: ['1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3'],
    9: ['4,3 1,3 0,4 0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1'],
    '.': ['1.6,0 2.4,0 2.4,0.8 1.6,0.8 1.6,0'],
    ',': ['2.4,0.8 2.4,0 1.6,-1'],
    ':': ['1.6,1 2.4,1 2.4,1.8 1.6,1.8 1.6,1', '1.6,4 2.4,4 2.4,4.8 1.6,4.8 1.6,4'],
    '-': ['0.5,3 3.5,3'],
    '+': ['0,3 4,3', '2,1 2,5'],
    '=': ['0,2 4,2', '0,4 4,4'],
    '/': ['0,0 4,6'],
    '(': ['3,6 1,4 1,2 3,0'],
    ')': ['1,6 3,4 3,2 1,0'],
    '^': ['2,0 2,6', '0,4 2,6 4,4'],
    ' ': [],
};

const kGlyphW = 4;
const kCapH = 6;
const kAdvance = 6; // glyph width plus a 2-unit gap

const kStrokes = Object.fromEntries(
    Object.entries(kGlyphs).map(([ch, strokes]) => [
        ch,
        strokes.map(s => s.split(' ').map(p => p.split(',').map(Number))),
    ]),
);

export function has_glyph(ch) {
    return ch in kStrokes;
}

export function text_width_mm(text, cap_mm) {
    if (!text.length) return 0;
    return ((text.length - 1) * kAdvance + kGlyphW) * (cap_mm / kCapH);
}

// Returns open polylines ({x, y} in micrometres) for text with its baseline at y_mm.
// align: 'left' starts at x_mm, 'centre' centres the text on x_mm, 'right' ends it at x_mm.
export function text_strokes(text, { x_mm, y_mm, cap_mm, align = 'left' }) {
    const upper = String(text).toUpperCase();
    const unit = cap_mm / kCapH;
    const width = text_width_mm(upper, cap_mm);
    const x0 = { left: x_mm, centre: x_mm - width / 2, right: x_mm - width }[align];
    if (x0 === undefined) throw new Error(`unknown text align "${align}"`);
    const out = [];
    [...upper].forEach((ch, i) => {
        if (!has_glyph(ch)) throw new Error(`stroke font has no glyph for "${ch}"`);
        const left = x0 + i * kAdvance * unit;
        for (const stroke of kStrokes[ch]) {
            out.push(stroke.map(([gx, gy]) => ({ x: mm_to_um(left + gx * unit), y: mm_to_um(y_mm + gy * unit) })));
        }
    });
    return out;
}
