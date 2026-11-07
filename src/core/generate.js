// Seeded pattern generator for primitive pieces (M1). It picks a centre opening and a few concentric
// bands, each with one motif type, and repeats them through the stack. Openings shrink from front
// to back and alternate layers turn half a step, so looking into the piece reads as depth: the
// orb references' nested look, made from primitives. The back layer stays solid.
// Generated layers are island-free by construction (arc slots always keep a tie), and opening sizes
// are capped against their neighbours so webs stay well above the minimum.
import { rng_for } from './rng.js';
import { rotation_order, fundamental_domain } from '../geom/symmetry.js';

// How far from the centre bands may reach. Circles and polygons fill their circumradius (polygon
// corners clip the outer band); rectangles and arches reach towards their far corners, so the
// whole outline carries pattern and the frame ring clips the outer bands.
function pattern_radius_mm(outline) {
    switch (outline.kind) {
        case 'rect':
            return Math.hypot(outline.w_mm, outline.h_mm) * 0.46;
        case 'arch':
            return Math.hypot(outline.w_mm / 2, outline.h_mm - outline.w_mm / 2) * 0.92;
        default:
            return outline.w_mm / 2;
    }
}

const kTypes = ['window', 'window', 'petal', 'ring', 'ray'];

// Motif types per generator style (SPEC M2 to M4). Classic is the M1 mix, kept unchanged so
// existing designs regenerate identically.
export const kStyles = {
    classic: kTypes,
    lattice: ['lattice', 'fret', 'lattice', 'window'],
    circuit: ['circuit'],
    mandala: ['lotus', 'ogee', 'ruyi', 'scroll', 'petal', 'lotus', 'ring', 'window'],
};

// The share of the piece one copy of the fundamental domain covers.
function domain_share(sym) {
    switch (sym.kind) {
        case 'mirror_x':
            return 1 / 2;
        case 'mirror_xy':
            return 1 / 4;
        case 'rot':
        case 'dihedral':
            return 1 / (rotation_order(sym) * (sym.kind === 'dihedral' ? 2 : 1));
        default:
            return 1;
    }
}

// Circuit style (M3): every patterned layer carries one circuit over the area inside its frame
// ring, with its own seed, so the traces behind show through the slots in front. Strands, gaps and
// ends are shared through the stack, traces thin out towards the back, and the front layer may be
// bars over the slotted layers behind. The back layer stays solid.
function generate_circuit(design, seed, lock_n) {
    const rng = rng_for(seed, 'circuit-stack');
    const sym = design.piece.symmetry;
    if (!lock_n && (sym.kind === 'rot' || sym.kind === 'dihedral')) sym.n = rng.pick([4, 6, 6, 8, 8, 12]);
    const o = design.piece.outline;
    const ring0 = design.layers[0].frame_ring_mm;
    const strands = rng.pick([1, 2, 2, 3, 3, 4]);
    const strand_mm = r1(rng.range(1.8, 2.6));
    const gap_mm = r1(rng.range(1.7, 2.4));
    const terminal = rng.pick(['mix', 'mix', 'drop', 'bulb', 'ring', 'via']);
    const straight = r2(rng.range(0.55, 0.85));
    const front_bars = rng.chance(0.4);
    const density = rng.range(0.35, 0.6);
    const reach = rng.range(0.5, 0.9);
    const ring_step = rng.range(0, 1.5);
    const round = o.kind === 'circle' || o.kind === 'polygon';
    const pitch_mm = strands * strand_mm + strands * gap_mm;
    const count = design.layers.length;
    const patterned = count > 1 ? count - 1 : 1;
    design.layers.forEach((layer, k) => {
        if (layer.locked || layer.source.kind !== 'primitive') return; // imported artwork is kept
        layer.frame_ring_mm = r1(ring0 + k * ring_step);
        if (k >= patterned) {
            layer.source.motifs = [];
            return;
        }
        const depth = patterned > 1 ? k / (patterned - 1) : 0;
        const w = r1(o.w_mm - 2 * layer.frame_ring_mm);
        const h = r1((round ? o.w_mm : o.h_mm) - 2 * layer.frame_ring_mm);
        const starts = ((2 * w + 2 * h) * domain_share(sym)) / pitch_mm;
        layer.source.motifs = [
            {
                type: 'circuit',
                polarity: k === 0 && front_bars ? 'bars' : 'slots',
                area_w_mm: w,
                area_h_mm: h,
                reach_mm: round ? r1(w / 2) : 0,
                r0_mm: round ? r1(w * 0.09) : 0,
                strands,
                strand_mm,
                gap_mm,
                traces: Math.max(2, Math.round(starts * density * (1 - 0.4 * depth))),
                length: Math.max(4, Math.round((reach * Math.max(w, h)) / pitch_mm)),
                straight,
                terminal,
                seed: rng_for(seed, 'circuit', k).int(0, 9999),
            },
        ];
    });
    design.seed = seed >>> 0;
}

// Fret tile sizes in grid units (width, height), as in sources/lattice.js.
const kFretTiles = { greek: [5, 5], double: [6, 5], tfret: [6, 6] };
const r2 = v => Math.round(v * 20) / 20;
const r1 = v => Math.round(v * 10) / 10;

function make_bands(rng, inner_mm, from_mm, count, types, seed) {
    const weights = Array.from({ length: count }, () => rng.range(0.7, 1.3));
    const total = weights.reduce((a, b) => a + b, 0);
    const span_all = inner_mm * 0.97 - from_mm;
    let r = from_mm;
    return weights.map((w, i) => {
        const span = (span_all * w) / total;
        // Style extras come from their own stream, so classic bands draw exactly as before.
        const extra = rng_for(seed, 'band', i);
        const band = {
            r0: r,
            r1: r + span,
            type: rng.pick(types),
            sides: rng.pick([0, 3, 4, 4, 6, 8]),
            rot: rng.pick([0, 0, 45, 90]),
            mult: rng.pick([1, 1, 1, 2]),
            alternate: rng.chance(0.5),
            reach: rng.range(0.45, 1.0), // deepest layer (0 front .. 1 back) the band reaches
            tie_mm: rng.range(2.5, 6),
            taper: rng.range(0, 0.6),
            pattern: extra.pick(Object.keys(kFretTiles)),
            lattice_seed: extra.int(0, 9999),
            open: extra.range(0.5, 1),
            cell_div: extra.int(2, 4),
            turns: extra.range(0.9, 1.6),
        };
        r += span;
        return band;
    });
}

function band_motif(band, n, depth, k, sym) {
    const span = band.r1 - band.r0;
    const rc = (band.r0 + band.r1) / 2;
    const copies = n * band.mult;
    const arc = (2 * Math.PI * rc) / copies;
    const s = 1 - 0.55 * depth;
    const angle_deg = band.alternate && k % 2 ? r1(180 / copies) : 0;
    const common = { mult: band.mult, angle_deg };
    switch (band.type) {
        case 'window':
            return {
                type: 'window',
                r_mm: r1(rc),
                size_mm: r1(Math.min(span * 0.8, arc * 0.75) * s),
                sides: band.sides,
                rot_deg: band.rot,
                ...common,
            };
        case 'petal': {
            const length = span * 0.85 * (0.6 + 0.4 * s);
            return {
                type: 'petal',
                r_mm: r1(rc),
                length_mm: r1(length),
                width_mm: r1(Math.min(arc * 0.6, length * 0.55) * s),
                ...common,
            };
        }
        case 'ring':
            return {
                type: 'ring',
                r_mm: r1(rc),
                w_mm: r1(span * 0.6 * s),
                tie_mm: r1(band.tie_mm * (1 + depth)),
                ...common,
            };
        case 'ray': {
            const w1 = arc * 0.45 * s;
            return {
                type: 'ray',
                r0_mm: r1(band.r0 + span * 0.1),
                r1_mm: r1(band.r1 - span * 0.05),
                w0_mm: r1(w1 * band.taper),
                w1_mm: r1(w1),
                ...common,
            };
        }
        case 'lotus':
        case 'ogee':
        case 'ruyi': {
            // Symmetric about their axis, so they sit on mirror lines like petals.
            const length = span * 0.85 * (0.6 + 0.4 * s);
            const slim = band.type === 'ogee' ? 0.6 : 0.9;
            return {
                type: band.type,
                r_mm: r1(rc),
                length_mm: r1(length),
                width_mm: r1(Math.min(arc * (band.type === 'ogee' ? 0.8 : 0.85), length * slim) * s),
                ...common,
            };
        }
        case 'scroll': {
            // Not symmetric: under a kaleidoscope it sits mid-way between mirror lines and
            // shares the wedge with its mirror image, so it takes half the width.
            const dihedral = sym.kind === 'dihedral';
            const length = span * 0.85 * (0.6 + 0.4 * s);
            return {
                type: 'scroll',
                r_mm: r1(rc),
                length_mm: r1(length),
                width_mm: r1(Math.min(arc * (dihedral ? 0.36 : 0.7), length * 0.7) * s),
                turns: r2(band.turns),
                mult: band.mult,
                angle_deg: r1(angle_deg + (dihedral ? 90 / copies : 0)),
            };
        }
        case 'lattice': {
            // One maze per band, the same through the stack: deeper layers keep more walls and
            // thicker bars, so the lattice closes up towards the back.
            const cell = Math.max(4, span / band.cell_div);
            return {
                type: 'lattice',
                grid: 'polar',
                r0_mm: r1(band.r0),
                r1_mm: r1(band.r1),
                cell_mm: r1(cell),
                bar_mm: r1(Math.max(2, cell * 0.2) * (1 + 0.35 * depth)),
                openness: r2(band.open * (0.7 - 0.5 * depth)),
                seed: band.lattice_seed,
            };
        }
        case 'fret': {
            const [tile_w, tile_h] = kFretTiles[band.pattern];
            const dom = fundamental_domain(sym);
            const w_band = span * 0.92;
            const unit = w_band / tile_h;
            return {
                type: 'fret',
                pattern: band.pattern,
                r_mm: r1(rc),
                w_mm: r1(w_band),
                bar_mm: r1(Math.min(unit * 0.62, Math.max(1.8, unit * 0.42) * (1 + 0.3 * depth))),
                tiles: Math.max(1, Math.round((rc * (dom.a1 - dom.a0)) / (unit * tile_w))),
            };
        }
        default:
            throw new Error(`unknown band type "${band.type}"`);
    }
}

// Fills every unlocked layer of a draft design with a generated pattern. options.lock_n keeps the
// symmetry repeat count; options.types overrides the motif types of the design's style.
export function generate_stack(design, seed, { lock_n = false, types = null } = {}) {
    if (!types && design.generator?.style === 'circuit') return generate_circuit(design, seed, lock_n);
    types = types ?? kStyles[design.generator?.style] ?? kTypes;
    const rng = rng_for(seed, 'stack');
    const sym = design.piece.symmetry;
    if (!lock_n && (sym.kind === 'rot' || sym.kind === 'dihedral')) sym.n = rng.pick([6, 8, 8, 10, 12, 12, 16]);
    const n = rotation_order(sym);
    const ring0 = design.layers[0].frame_ring_mm;
    const inner = pattern_radius_mm(design.piece.outline) - ring0;
    const disc_frac = rng.range(0.16, 0.36);
    const bands = make_bands(rng, inner, inner * (disc_frac + 0.08), rng.int(2, 4), types, seed);
    // Frame rings widen towards the back, so the border steps inwards like a stacked mandala.
    const ring_step = rng.range(0, 0.035) * inner;

    const count = design.layers.length;
    const patterned = count > 1 ? count - 1 : 1;
    design.layers.forEach((layer, k) => {
        if (layer.locked || layer.source.kind !== 'primitive') return; // imported artwork is kept
        layer.frame_ring_mm = r1(ring0 + k * ring_step);
        if (k >= patterned) {
            layer.source.motifs = [];
            return;
        }
        const depth = patterned > 1 ? k / (patterned - 1) : 0;
        const motifs = [{ type: 'disc', d_mm: r1(2 * inner * disc_frac * (1 - 0.55 * depth)) }];
        for (const band of bands) if (depth <= band.reach) motifs.push(band_motif(band, n, depth, k, sym));
        layer.source.motifs = motifs;
    });
    design.seed = seed >>> 0;
}
