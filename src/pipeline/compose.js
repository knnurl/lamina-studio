// Layer composition (SPEC 6.2 steps 1 to 3): openings from the layer's motifs, clipped to the area
// inside its frame ring, cut from the piece outline. Contours under kMicroAreaUm2 (boolean
// crumbs) are dropped. There is no blanket open/close: measured on the Orb preset it cost 288 ms
// of a 300 ms build and changed the area by 2 mm2 in 464,000. Thin webs are found by the checks,
// which compute that morphology once anyway.
// Assumptions: geometry in micrometres, origin at the symmetry centre.
import { offset, subtract, intersect_paths, area_mm2, path_area_um2 } from '../geom/clip.js';
import { outline_paths } from '../geom/outline.js';
import { layer_openings } from '../sources/motifs.js';
import { mm_to_um } from '../core/units.js';

const kMicroAreaUm2 = 50000; // 0.05 mm2

function drop_crumbs(paths) {
    return paths.filter(p => Math.abs(path_area_um2(p)) >= kMicroAreaUm2);
}

export function compose_layer(design, k) {
    const layer = design.layers[k];
    const outline = outline_paths(design.piece.outline);
    const ring_um = mm_to_um(layer.frame_ring_mm ?? 0);
    const inner = ring_um > 0 ? offset(outline, -ring_um) : outline;
    const openings = layer_openings(layer, design.piece.symmetry);
    const cut = openings.length && inner.length ? intersect_paths(openings, inner) : [];
    const material = cut.length ? drop_crumbs(subtract(outline, cut)) : outline;
    return { outline, inner, material };
}

// Every layer, front first. Returns material paths plus simple stats and the time taken.
export function build_design(design) {
    const t0 = performance.now();
    const layers = design.layers.map((layer, k) => {
        const { outline, material } = compose_layer(design, k);
        const solid_mm2 = area_mm2(outline);
        const area = area_mm2(material);
        return { id: layer.id, material, area_mm2: area, open_fraction: solid_mm2 > 0 ? 1 - area / solid_mm2 : 0 };
    });
    return { layers, ms: performance.now() - t0 };
}
