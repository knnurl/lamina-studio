// Seeded pattern generator for primitive pieces (M1). It picks a centre opening and a few concentric
// bands, each with one motif type, and repeats them through the stack. Openings shrink from front
// to back and alternate layers turn half a step, so looking into the piece reads as depth: the
// orb references' nested look, made from primitives. The back layer stays solid.
// Generated layers are island-free by construction (arc slots always keep a tie), and opening sizes
// are capped against their neighbours so webs stay well above the minimum.
import { rng_for } from './rng.js';
import { rotation_order } from '../geom/symmetry.js';

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
const r1 = v => Math.round(v * 10) / 10;

function make_bands(rng, inner_mm, from_mm, count, types) {
    const weights = Array.from({ length: count }, () => rng.range(0.7, 1.3));
    const total = weights.reduce((a, b) => a + b, 0);
    const span_all = inner_mm * 0.97 - from_mm;
    let r = from_mm;
    return weights.map(w => {
        const span = (span_all * w) / total;
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
        };
        r += span;
        return band;
    });
}

function band_motif(band, n, depth, k) {
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
        default:
            throw new Error(`unknown band type "${band.type}"`);
    }
}

// Fills every unlocked layer of a draft design with a generated pattern. options.lock_n keeps the
// symmetry repeat count; options.types limits the motif types used.
export function generate_stack(design, seed, { lock_n = false, types = kTypes } = {}) {
    const rng = rng_for(seed, 'stack');
    const sym = design.piece.symmetry;
    if (!lock_n && (sym.kind === 'rot' || sym.kind === 'dihedral')) sym.n = rng.pick([6, 8, 8, 10, 12, 12, 16]);
    const n = rotation_order(sym);
    const ring0 = design.layers[0].frame_ring_mm;
    const inner = pattern_radius_mm(design.piece.outline) - ring0;
    const disc_frac = rng.range(0.16, 0.36);
    const bands = make_bands(rng, inner, inner * (disc_frac + 0.08), rng.int(2, 4), types);
    // Frame rings widen towards the back, so the border steps inwards like a stacked mandala.
    const ring_step = rng.range(0, 0.035) * inner;

    const count = design.layers.length;
    const patterned = count > 1 ? count - 1 : 1;
    design.layers.forEach((layer, k) => {
        if (layer.locked) return;
        layer.frame_ring_mm = r1(ring0 + k * ring_step);
        if (k >= patterned) {
            layer.source.motifs = [];
            return;
        }
        const depth = patterned > 1 ? k / (patterned - 1) : 0;
        const motifs = [{ type: 'disc', d_mm: r1(2 * inner * disc_frac * (1 - 0.55 * depth)) }];
        for (const band of bands) if (depth <= band.reach) motifs.push(band_motif(band, n, depth, k));
        layer.source.motifs = motifs;
    });
    design.seed = seed >>> 0;
}
