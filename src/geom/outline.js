// Piece outlines (SPEC 4.1), centred on the origin, which is also the symmetry centre. For an arch
// the origin is the centre of its round top, so radial patterns sit in the arch like a halo.
// Returns paths in micrometres, counter-clockwise.
import { circle_path, rounded_rect_path, regular_polygon_path, circle_segments } from './clip.js';
import { mm_to_um } from '../core/units.js';
import { from_flat } from './pack.js';

function arch_path(w_um, h_um) {
    const r = w_um / 2;
    const bottom = -Math.max(h_um - r, 1000);
    const steps = Math.max(2, Math.ceil(circle_segments(r) / 2));
    const path = [
        { x: -r, y: bottom },
        { x: r, y: bottom },
    ];
    for (let i = 0; i <= steps; i++) {
        const a = (Math.PI * i) / steps;
        path.push({ x: Math.round(r * Math.cos(a)), y: Math.round(r * Math.sin(a)) });
    }
    return path;
}

export function outline_paths(outline) {
    const w = mm_to_um(outline.w_mm);
    const h = mm_to_um(outline.h_mm);
    switch (outline.kind) {
        case 'circle':
            return [circle_path(0, 0, w / 2)];
        case 'rect': {
            const r = Math.min(mm_to_um(outline.corner_r_mm ?? 0), w / 2, h / 2);
            return [rounded_rect_path(-w / 2, -h / 2, w / 2, h / 2, r)];
        }
        case 'polygon': {
            const n = Math.max(3, Math.round(outline.sides));
            return [regular_polygon_path(0, 0, w / 2, n, -Math.PI / 2 + Math.PI / n)]; // flat bottom
        }
        case 'arch':
            return [arch_path(w, h)];
        case 'custom':
            // An imported silhouette, kept in the design as flat micrometre arrays.
            return from_flat(outline.custom ?? []);
        default:
            throw new Error(`unknown outline "${outline.kind}"`);
    }
}
