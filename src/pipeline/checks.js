// Fabrication checks (SPEC 7). Fast checks run with every build; slow checks (morphology over the
// whole layer) run separately, debounced, so dragging a slider stays fluid. Every result names a
// layer and boxes in mm for the overlay. Fatal results block export unless overridden; an override
// is keyed "<id>@<layer index>" in design.check_overrides.
// Assumptions: material is the design geometry before kerf (kerf is applied at export).
import { offset, subtract, intersect_paths, area_mm2, path_area_um2 } from '../geom/clip.js';
import { components, bbox_mm } from './islands.js';
import { kBridgeLongMm } from './islands.js';
import { material_of } from '../core/design.js';
import { mm_to_um, kUmPerMm } from '../core/units.js';

const kMaxBoxes = 60;
const kGlueCoverage = 0.6;

function result(design, id, severity, layer, message, boxes = []) {
    const key = `${id}@${layer}`;
    const overridden = severity === 'fatal' && (design.check_overrides ?? []).includes(key);
    return { id, key, severity, layer, message, boxes: boxes.slice(0, kMaxBoxes), overridden };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// built: build_design() layers, front first.
export function fast_checks(design, built) {
    const out = [];
    const n = design.layers.length;
    built.forEach((b, k) => {
        const layer = design.layers[k];
        const mat = material_of(design, layer);
        if (b.unbridged.length) {
            const boxes = b.islands.filter(i => b.unbridged.includes(i.id)).map(i => i.bbox);
            out.push(result(design, 'G-01', 'fatal', k, `Layer ${k + 1}: ${plural(b.unbridged.length, 'island', 'islands')} could not be bridged and would fall out.`, boxes));
        }
        const pieces = components(b.material).length;
        if (pieces > 1) {
            out.push(result(design, 'G-04', 'fatal', k, `Layer ${k + 1} falls apart into ${pieces} pieces.`));
        }
        const weak = b.bridges.filter(br => br.w_mm < mat.min_bridge_mm - 1e-9 || br.length_mm > kBridgeLongMm);
        if (weak.length) {
            out.push(
                result(design, 'W-03', 'warn', k, `Layer ${k + 1}: ${plural(weak.length, 'bridge is', 'bridges are')} under ${mat.min_bridge_mm} mm wide or over ${kBridgeLongMm} mm long.`,
                    weak.map(br => bbox_mm([br.rect]))),
            );
        }
        if (b.parts.length) {
            const behind = built[k + 1];
            if (layer.gap_mm > 0) {
                out.push(result(design, 'G-03', 'fatal', k, `Layer ${k + 1}: glue-on islands need no gap behind this layer.`, b.parts.map(p => bbox_mm([p[0]]))));
            } else {
                const floating = b.parts.filter(p => {
                    if (!behind) return true;
                    const covered = area_mm2(intersect_paths([p[0]], behind.material));
                    return covered < kGlueCoverage * area_mm2([p[0]]);
                });
                if (floating.length) {
                    out.push(result(design, 'G-03', 'fatal', k, `Layer ${k + 1}: ${plural(floating.length, 'glue-on island has', 'glue-on islands have')} too little material behind to sit on.`, floating.map(p => bbox_mm([p[0]]))));
                }
            }
        }
        const stock = material_of(design, { material: design.spacers.stock_material }).thickness_mm;
        const ratio = layer.gap_mm / stock;
        if (k < n - 1 && layer.gap_mm > 0 && Math.abs(ratio - Math.round(ratio)) > 1e-6) {
            out.push(result(design, 'W-04', 'warn', k, `Layer ${k + 1}: a ${layer.gap_mm} mm gap is not a whole number of ${stock} mm spacers.`));
        }
    });

    const back = design.layers[n - 1];
    const back_built = built[n - 1];
    if (design.piece.lighting.mode === 'backlit' && !material_of(design, back).look.translucent && back_built && back_built.open_fraction < 0.01) {
        out.push(result(design, 'W-06', 'warn', n - 1, 'Backlit, but the back layer is solid and opaque, so no light gets through.'));
    }
    const front_mat = material_of(design, design.layers[0]);
    if (design.layers[0].frame_ring_mm < front_mat.min_web_mm) {
        out.push(result(design, 'W-07', 'warn', 0, `The front frame ring is thinner than the ${front_mat.min_web_mm} mm minimum web.`));
    }
    return out;
}

// Regions of material narrower than width_mm: what an opening (shrink then grow) removes.
// - Miter joins with a high limit rebuild ordinary corners and sharp opening tips exactly, so
//   only real necks and material spikes remain.
// - Integer rounding leaves micron slivers along long curved edges; re-opening the result by
//   kNoiseUm removes anything narrower than 0.02 mm. A real neck is hundreds of microns wide.
const kMiterLimit = 20;
const kNoiseUm = 10;

function thin_regions(material, width_mm, min_area_mm2) {
    const half = mm_to_um(width_mm / 2);
    const opened = offset(offset(material, -half, 'miter', undefined, kMiterLimit), half, 'miter', undefined, kMiterLimit);
    const raw = subtract(material, opened);
    if (!raw.length) return [];
    const denoised = offset(offset(raw, -kNoiseUm, 'miter', undefined, kMiterLimit), kNoiseUm, 'miter', undefined, kMiterLimit);
    const min_um2 = min_area_mm2 * kUmPerMm * kUmPerMm;
    return denoised.filter(p => path_area_um2(p) > min_um2);
}

export function slow_checks(design, built) {
    const out = [];
    built.forEach((b, k) => {
        const mat = material_of(design, design.layers[k]);
        const min_area = Math.max(0.05, 0.1 * mat.min_web_mm * mat.min_web_mm);
        // Bridges are meant to be thinner than webs and have their own check (W-03).
        const bridge_zone = b.bridges.length ? offset(b.bridges.map(br => br.rect), mm_to_um(0.5), 'miter') : [];
        const not_bridge = (paths, area_mm2) => {
            if (!bridge_zone.length || !paths.length) return paths;
            return subtract(paths, bridge_zone).filter(p => path_area_um2(p) > area_mm2 * kUmPerMm * kUmPerMm);
        };
        const thin = not_bridge(thin_regions(b.material, mat.min_web_mm, min_area), min_area);
        if (thin.length) {
            const severe = not_bridge(thin_regions(b.material, mat.kerf_mm, 0.01), 0.01);
            if (severe.length) {
                out.push(result(design, 'G-02', 'fatal', k, `Layer ${k + 1}: webs thinner than the ${mat.kerf_mm} mm kerf would be cut away.`, severe.map(p => bbox_mm([p]))));
            }
            out.push(result(design, 'W-01', 'warn', k, `Layer ${k + 1}: ${plural(thin.length, 'web is', 'webs are')} thinner than ${mat.min_web_mm} mm.`, thin.map(p => bbox_mm([p]))));
        }
        const small = b.material.filter(p => {
            if (path_area_um2(p) >= 0) return false;
            const box = bbox_mm([p]);
            return Math.min(box.x1 - box.x0, box.y1 - box.y0) < mat.min_hole_mm;
        });
        if (small.length) {
            out.push(result(design, 'W-02', 'warn', k, `Layer ${k + 1}: ${plural(small.length, 'hole is', 'holes are')} smaller than ${mat.min_hole_mm} mm.`, small.map(p => bbox_mm([p]))));
        }
    });
    return out;
}
