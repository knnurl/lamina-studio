// Calibration test card (SPEC 9.4): one 150 x 100 mm cut, with no kerf compensation, that measures
// kerf, import scale, minimum web, bridge, hole, dowel fit and fit clearance on the lab laser, plus
// a five-colour score ramp. Engraved labels name every feature, and the title names the file
// format, so a cut card records which import route it came from.
// Assumptions: y up, origin at the card's bottom-left corner, all dimensions nominal (as drawn).
import {
    rect_path,
    rounded_rect_path,
    circle_path,
    subtract,
    union_all,
    path_area_um2,
} from '../geom/clip.js';
import { mm_to_um } from '../core/units.js';
import { text_strokes } from './stroke_font.js';
import { drawing_to_svg } from './svg.js';
import { drawing_to_dxf } from './dxf.js';
import { zip_store } from './zip_store.js';
import { kLadders } from '../core/calibrate.js';

export const kCard = {
    width_mm: 150,
    height_mm: 100,
    corner_mm: 4,
    kerf_square: { x_mm: 6, y_mm: 61, size_mm: kLadders.kerf_square_mm },
    web: { x_mm: 33, y_mm: 64, slot_w_mm: 4, slot_h_mm: 14, webs_mm: kLadders.webs_mm },
    key: { x_mm: 81, y_mm: 62, w_mm: 10, h_mm: 16 },
    dowel: { x_mm: 101, y_mm: 72, pitch_mm: 6.5, holes_mm: kLadders.dowel_holes_mm },
    bridge: { x_mm: 6, y_mm: 40, pitch_mm: 12, window_mm: 9, island_mm: 5, bridges_mm: kLadders.bridges_mm },
    hole: { x_mm: 84, y_mm: 45, pitch_mm: 6, holes_mm: kLadders.holes_mm },
    ramp: { x_mm: 125, y0_mm: 41, y1_mm: 51, pitch_mm: 4.5, count: 5 },
    notch: { x_mm: 8, pitch_mm: 16, base_w_mm: 10, depth_mm: 8, clearances_mm: kLadders.clearances_mm },
};

const kHoleTolUm = 5; // fine flattening for holes whose size is being measured

const um = mm_to_um;
const rect_mm = (x0, y0, x1, y1) => rect_path(um(x0), um(y0), um(x1), um(y1));
const hole_mm = (cx, cy, d) => circle_path(um(cx), um(cy), um(d / 2), { tol_um: kHoleTolUm, fit: 'outside' });
const tenths = v => String(Math.round(v * 10));
const hundredths = v => String(Math.round(v * 100));

// The card's cut geometry: holes, notches and drop-outs removed, bridged islands added back.
function card_material() {
    const c = kCard;
    const holes = [];
    const keep = [];

    const ks = c.kerf_square;
    holes.push(rect_mm(ks.x_mm, ks.y_mm, ks.x_mm + ks.size_mm, ks.y_mm + ks.size_mm));

    let x = c.web.x_mm;
    for (let i = 0; i <= c.web.webs_mm.length; i++) {
        holes.push(rect_mm(x, c.web.y_mm, x + c.web.slot_w_mm, c.web.y_mm + c.web.slot_h_mm));
        x += c.web.slot_w_mm + (c.web.webs_mm[i] ?? 0);
    }

    holes.push(rect_mm(c.key.x_mm, c.key.y_mm, c.key.x_mm + c.key.w_mm, c.key.y_mm + c.key.h_mm));

    c.dowel.holes_mm.forEach((d, i) => holes.push(hole_mm(c.dowel.x_mm + i * c.dowel.pitch_mm, c.dowel.y_mm, d)));

    const b = c.bridge;
    const inset = (b.window_mm - b.island_mm) / 2;
    b.bridges_mm.forEach((w, i) => {
        const x0 = b.x_mm + i * b.pitch_mm;
        const y_mid = b.y_mm + b.window_mm / 2;
        holes.push(rect_mm(x0, b.y_mm, x0 + b.window_mm, b.y_mm + b.window_mm));
        keep.push(rect_mm(x0 + inset, b.y_mm + inset, x0 + inset + b.island_mm, b.y_mm + inset + b.island_mm));
        // Bridges overlap the card and the island by 0.5 mm so the union joins them.
        keep.push(rect_mm(x0 - 0.5, y_mid - w / 2, x0 + inset + 0.5, y_mid + w / 2));
        keep.push(rect_mm(x0 + b.window_mm - inset - 0.5, y_mid - w / 2, x0 + b.window_mm + 0.5, y_mid + w / 2));
    });

    c.hole.holes_mm.forEach((d, i) => holes.push(hole_mm(c.hole.x_mm + i * c.hole.pitch_mm, c.hole.y_mm, d)));

    const n = c.notch;
    n.clearances_mm.forEach((cl, i) => {
        const x0 = n.x_mm + i * n.pitch_mm;
        holes.push(rect_mm(x0, -1, x0 + n.base_w_mm + cl, n.depth_mm));
    });

    const outline = rounded_rect_path(0, 0, um(c.width_mm), um(c.height_mm), um(c.corner_mm));
    return union_all([...subtract([outline], holes), ...keep]);
}

function card_labels(format) {
    const c = kCard;
    const out = [];
    const text = (s, x_mm, y_mm, cap_mm, align = 'left') => out.push(...text_strokes(s, { x_mm, y_mm, cap_mm, align }));
    const header_y = 83.5;
    const row3_header_y = 54.5;

    text(`LAMINA TEST CARD ${format}`, 6, 91.5, 3.5);
    text('NO KERF COMP', 144, 91.5, 2.2, 'right');

    const ks = c.kerf_square;
    text('KERF 20', ks.x_mm + ks.size_mm / 2, header_y, 2.2, 'centre');
    text('P', ks.x_mm + ks.size_mm / 2, ks.y_mm + 7.5, 5, 'centre');

    text('WEB 1/10 MM', c.web.x_mm, header_y, 2.2);
    let x = c.web.x_mm + c.web.slot_w_mm;
    for (const w of c.web.webs_mm) {
        text(tenths(w), x + w / 2, c.web.y_mm - 3.5, 1.8, 'centre');
        x += w + c.web.slot_w_mm;
    }

    text('KEY', c.key.x_mm + c.key.w_mm / 2, c.key.y_mm + 7, 2.2, 'centre');

    text('DOWEL 1/100 MM', 98, header_y, 2.2);
    c.dowel.holes_mm.forEach((d, i) =>
        text(hundredths(d), c.dowel.x_mm + i * c.dowel.pitch_mm, c.dowel.y_mm - 6, 1.8, 'centre'),
    );

    const b = c.bridge;
    text('BRIDGE 1/10 MM', b.x_mm, row3_header_y, 2.2);
    b.bridges_mm.forEach((w, i) =>
        text(tenths(w), b.x_mm + i * b.pitch_mm + b.window_mm / 2, b.y_mm - 3.5, 1.8, 'centre'),
    );

    text('HOLE 1/10 MM', c.hole.x_mm - 2, row3_header_y, 2.2);
    c.hole.holes_mm.forEach((d, i) =>
        text(tenths(d), c.hole.x_mm + i * c.hole.pitch_mm, c.hole.y_mm - 7.5, 1.8, 'centre'),
    );

    text('SCORE', c.ramp.x_mm - 1, row3_header_y, 2.2);
    for (let i = 0; i < c.ramp.count; i++) {
        text(String(i + 1), c.ramp.x_mm + i * c.ramp.pitch_mm, c.ramp.y0_mm - 4.5, 1.8, 'centre');
    }

    const n = c.notch;
    text('FIT NOTCH +1/100 MM', n.x_mm, 14.5, 2.2);
    n.clearances_mm.forEach((cl, i) => {
        const label = cl === 0 ? '0' : `+${hundredths(cl)}`;
        text(label, n.x_mm + i * n.pitch_mm + (n.base_w_mm + cl) / 2, n.depth_mm + 2, 1.8, 'centre');
    });

    text('KERF = (H-P)/2', 104, 26, 2);
    text('(H+P)/2 = 20.00', 104, 21, 2);
    text('WIDTH 150.00', 104, 16, 2);
    return out;
}

// format: 'SVG' or 'DXF', engraved in the title.
export function build_test_card(format) {
    const c = kCard;
    const items = card_labels(format).map(points => ({ layer: 'ENGRAVE', closed: false, points }));
    for (let i = 0; i < c.ramp.count; i++) {
        const x = um(c.ramp.x_mm + i * c.ramp.pitch_mm);
        items.push({
            layer: `RAMP_${i + 1}`,
            closed: false,
            points: [
                { x, y: um(c.ramp.y0_mm) },
                { x, y: um(c.ramp.y1_mm) },
            ],
        });
    }
    const material = card_material();
    const holes = material.filter(p => path_area_um2(p) < 0);
    const outers = material.filter(p => path_area_um2(p) > 0);
    for (const points of [...holes, ...outers]) items.push({ layer: 'CUT', closed: true, points });
    return { width_mm: c.width_mm, height_mm: c.height_mm, items };
}

export function test_card_instructions() {
    return `LAMINA STUDIO CALIBRATION TEST CARD
===================================

test_card.svg and test_card.dxf are the same 150 x 100 mm card. Cut ONE of
them; the engraved title says which. Nothing is kerf compensated: every
feature is cut at its nominal (drawn) size.

IN ADOBE ILLUSTRATOR
1. Use an RGB document (File > Document Color Mode > RGB). CMYK shifts the
   colours, and Epilog colour mapping then misses them.
2. DXF: import at original size, units millimetres. SVG: open it directly.
3. Before printing, check the card measures 150 x 100 mm on the artboard.

EPILOG JOB MANAGER COLOUR MAPPING (all vector)
  Green    #00FF00  ENGRAVE  labels: light marking
  Blue     #0000FF  RAMP 1   score test: lowest power
  Cyan     #00FFFF  RAMP 2
  Magenta  #FF00FF  RAMP 3
  Yellow   #FFFF00  RAMP 4
  Orange   #FF7F00  RAMP 5   score test: highest power
  Red      #FF0000  CUT      through cut
Run the green and ramp colours before red, so parts are marked before they
drop out.

MEASURE (calipers)
  P = the 20 mm square piece that drops out (engraved P)
  H = the square hole it leaves
  kerf = (H - P) / 2
  Scale check: (H + P) / 2 must be 20.00 +/- 0.05 mm. If it is not, the
  import scale is wrong. Fix the import before trusting anything else.
  The card's width should be 150.00 mm minus about one kerf.

RECORD
  WEB    (tenths of a mm) thinnest web that survived intact.
         Physical web = nominal - kerf.
  BRIDGE (tenths) thinnest bridge that held during cutting, and the
         thinnest one that snaps off cleanly by hand.
  HOLE   (tenths) smallest hole that cut cleanly and opened fully.
         Physical hole = nominal + kerf.
  DOWEL  (hundredths) the hole a 3 mm dowel slides into snugly.
  FIT    (+hundredths) the notch the KEY slides into snugly, flat in the
         plane of the sheet. Gap = clearance + 2 x kerf.
  SCORE  the ramp line that marks cleanly without cutting through.
  Also: material, thickness, and Epilog speed, power and frequency for each
  colour, lens and focus.

Keep the card and these numbers. Lamina's Calibrate panel turns them into
a measured material preset.
`;
}

export function test_card_zip() {
    const bytes = zip_store([
        { name: 'test_card.svg', data: drawing_to_svg(build_test_card('SVG')) },
        { name: 'test_card.dxf', data: drawing_to_dxf(build_test_card('DXF')) },
        { name: 'test_card_instructions.txt', data: test_card_instructions() },
    ]);
    return { name: 'lamina_test_card.zip', bytes };
}
