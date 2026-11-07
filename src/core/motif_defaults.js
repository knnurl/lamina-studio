// Starting values for a new motif, relative to the space inside the layer's frame ring (SPEC 8).
// Shared by the "Add openings" menu and the assistant, which fills in any parameter it leaves out.
import { piece_radius_mm } from './design.js';
import { to_shape } from '../sources/curves.js';

export function new_motif(type, design, layer) {
    const r = Math.max(10, piece_radius_mm(design.piece) - layer.frame_ring_mm);
    const v = x => Math.round(x * r * 10) / 10;
    switch (type) {
        case 'disc':
            return { type, d_mm: v(0.6) };
        case 'window':
            return { type, r_mm: v(0.55), size_mm: v(0.14), sides: 4, rot_deg: 0, mult: 1, angle_deg: 0 };
        case 'petal':
            return { type, r_mm: v(0.6), length_mm: v(0.22), width_mm: v(0.09), mult: 1, angle_deg: 0 };
        case 'ring':
            return { type, r_mm: v(0.78), w_mm: v(0.06), tie_mm: 3, mult: 1, angle_deg: 0 };
        case 'ray':
            return { type, r0_mm: v(0.3), r1_mm: v(0.9), w0_mm: 0, w1_mm: v(0.08), mult: 1, angle_deg: 0 };
        case 'lattice':
            return { type, grid: 'polar', r0_mm: v(0.35), r1_mm: v(0.95), cell_mm: v(0.08), bar_mm: 2.2, openness: 0.4, seed: 1, cells: {} };
        case 'fret':
            return { type, pattern: 'double', r_mm: v(0.8), w_mm: v(0.14), bar_mm: 2, tiles: 3 };
        case 'scroll': {
            // Not symmetric: off the mirror lines under a kaleidoscope.
            const sym = design.piece.symmetry;
            const angle_deg = sym.kind === 'dihedral' ? Math.round(900 / Math.max(1, sym.n)) / 10 : 0;
            return { type, r_mm: v(0.6), length_mm: v(0.22), width_mm: v(0.08), turns: 1.25, mult: 1, angle_deg };
        }
        case 'ruyi':
            return { type, r_mm: v(0.6), length_mm: v(0.2), width_mm: v(0.16), mult: 1, angle_deg: 0 };
        case 'ogee':
            return { type, r_mm: v(0.6), length_mm: v(0.24), width_mm: v(0.12), mult: 1, angle_deg: 0 };
        case 'lotus':
            return { type, r_mm: v(0.6), length_mm: v(0.22), width_mm: v(0.16), mult: 1, angle_deg: 0 };
        case 'shape':
            return to_shape({ type: 'petal', r_mm: v(0.6), length_mm: v(0.22), width_mm: v(0.09), mult: 1, angle_deg: 0 });
        case 'circuit':
            return { type, polarity: 'slots', area_w_mm: v(2), area_h_mm: v(2), reach_mm: v(1), r0_mm: v(0.2), strands: 2, strand_mm: 2, gap_mm: 2, traces: 16, length: 18, straight: 0.7, terminal: 'mix', seed: 1 };
        case 'art':
            // Artwork comes from SVG (the assistant's draw_artwork, or a logo); empty until then.
            return { type, x_mm: 0, y_mm: 0, width_mm: v(0.5), angle_deg: 0, repeat: 'once', paths: [], src_w_mm: 0 };
        default:
            throw new Error(`unknown opening type "${type}"`);
    }
}
