// Layer composition (SPEC 6.2 steps 1 to 3): openings from the layer's motifs, clipped to the area
// inside its frame ring, cut from the piece outline. Contours under kMicroAreaUm2 (boolean
// crumbs) are dropped. There is no blanket open/close: measured on the Orb preset it cost 288 ms
// of a 300 ms build and changed the area by 2 mm2 in 464,000. Thin webs are found by the checks,
// which compute that morphology once anyway.
// Assumptions: geometry in micrometres, origin at the symmetry centre.
import { offset, subtract, intersect_paths, area_mm2, path_area_um2, union_fill } from '../geom/clip.js';
import { from_flat } from '../geom/pack.js';
import { field_material, field_level } from '../sources/field.js';
import { outline_paths } from '../geom/outline.js';
import { layer_openings } from '../sources/motifs.js';
import { mm_to_um } from '../core/units.js';
import { material_of } from '../core/design.js';
import { resolve_islands } from './islands.js';
import { register_geometry, spacer_layout, hole_d_mm } from './registration.js';
import { hash_str } from '../core/rng.js';
import { fast_checks } from './checks.js';

const kMicroAreaUm2 = 50000; // 0.05 mm2

function drop_crumbs(paths) {
    return paths.filter(p => Math.abs(path_area_um2(p)) >= kMicroAreaUm2);
}

export function compose_layer(design, k) {
    const layer = design.layers[k];
    const outline = outline_paths(design.piece.outline);
    if (layer.source.kind === 'svg') {
        // Imported artwork is material (SPEC 8.1): filled by its rule, clipped to the outline.
        const art = union_fill(from_flat(layer.source.paths ?? []), layer.source.fill_rule !== 'nonzero');
        return { outline, inner: outline, material: drop_crumbs(intersect_paths(art, outline)) };
    }
    const ring_um = mm_to_um(layer.frame_ring_mm ?? 0);
    const inner = ring_um > 0 ? offset(outline, -ring_um) : outline;
    if (design.piece.depth_mode === 'field') {
        // Field mode (SPEC 6.7): the layer is the field below its level, plus its frame ring.
        const level = field_level(design.piece, k, design.layers.length);
        const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const p of outline.flat()) {
            b.x0 = Math.min(b.x0, p.x);
            b.y0 = Math.min(b.y0, p.y);
            b.x1 = Math.max(b.x1, p.x);
            b.y1 = Math.max(b.y1, p.y);
        }
        const fm = field_material(design.piece, level, b);
        if (fm === null) return { outline, inner, material: outline };
        // A morphological opening at half the minimum web removes the necks a field makes at
        // its saddle points: the laser would cut them away anyway (they would fail G-02).
        const half = mm_to_um(material_of(design, layer).min_web_mm / 2);
        const opened = offset(offset(fm, -half, 'miter'), half, 'miter');
        const ring = ring_um > 0 ? subtract(outline, inner) : [];
        return { outline, inner, material: drop_crumbs(union_fill([...intersect_paths(opened, outline), ...ring], false)) };
    }
    const openings = layer_openings(layer, design.piece.symmetry);
    const cut = openings.length && inner.length ? intersect_paths(openings, inner) : [];
    const material = cut.length ? drop_crumbs(subtract(outline, cut)) : outline;
    return { outline, inner, material };
}

function perimeter_mm(paths) {
    let sum = 0;
    for (const p of paths) {
        for (let i = 0; i < p.length; i++) {
            const a = p[i];
            const b = p[(i + 1) % p.length];
            sum += Math.hypot(b.x - a.x, b.y - a.y);
        }
    }
    return sum / 1000;
}

// Stage caches (SPEC 6.2): geometry is a pure function of its inputs, so edits that do not touch a
// layer's geometry (colour, gaps, lighting, sheet) reuse it. Least recently used entries go first.
const kCacheSize = 64;
const layer_cache = new Map();
const reg_cache = new Map();

function cached(map, key, make) {
    if (map.has(key)) {
        const value = map.get(key);
        map.delete(key);
        map.set(key, value);
        return value;
    }
    const value = make();
    map.set(key, value);
    if (map.size > kCacheSize) map.delete(map.keys().next().value);
    return value;
}

const short_key = text => `${hash_str(text).toString(36)}.${text.length}`;

// Every layer, front first, with islands resolved, then the stack-level stages: locators for
// glue-on islands are scored on the layer behind, and registration adds dowel holes, engraved IDs
// and spacers. Returns layers, registration, the fast checks and the time taken.
// Each layer carries cache_key, which changes whenever its final geometry can change, and
// material_key, which changes only when its cut material can (its geometry, the dowel holes).
export function build_design(design) {
    const t0 = performance.now();
    const shape_key = JSON.stringify([design.piece.outline, design.piece.symmetry]);
    const layers = design.layers.map((layer, k) => {
        const bridge_w_mm = layer.bridge?.w_mm ?? material_of(design, layer).min_bridge_mm;
        const field = design.piece.depth_mode === 'field' ? [design.piece.field, k, design.layers.length] : null;
        const key = short_key(shape_key + JSON.stringify([layer.id, layer.source, layer.frame_ring_mm, layer.island_policy, layer.bridge, layer.overrides, bridge_w_mm, field]));
        const geo = cached(layer_cache, key, () => {
            const { outline, material: raw } = compose_layer(design, k);
            return { ...resolve_islands(raw, layer, bridge_w_mm), solid_mm2: area_mm2(outline) };
        });
        return { id: layer.id, key, ...geo, locators: [] };
    });
    layers.forEach((l, k) => {
        if (l.parts.length && layers[k + 1]) layers[k + 1].locators.push(...l.parts.map(p => p[0]));
    });
    // hole_d_mm follows the measured dowel clearance of the material, so it is part of the key.
    const reg_key = short_key(layers.map(l => l.key).join('|') + JSON.stringify(design.registration) + hole_d_mm(design));
    const geo = cached(reg_cache, reg_key, () => register_geometry(design, layers));
    const holes_key = JSON.stringify([geo.dowels, geo.r_hole, design.registration.through_front]);
    layers.forEach((l, k) => {
        l.material = geo.materials[k];
        l.ids = geo.ids[k];
        l.cache_key = `${l.key}/${reg_key}`;
        l.material_key = short_key(`${l.key}|${holes_key}|${k > 0}`);
    });
    const spacing = spacer_layout(design, geo.dowels, geo.r_hole);
    const registration = { dowels: geo.dowels, hole_d_mm: geo.hole_d_mm, spacers: spacing.spacers, warnings: [...geo.warnings, ...spacing.warnings] };
    for (const l of layers) {
        l.area_mm2 = area_mm2(l.material);
        l.open_fraction = l.solid_mm2 > 0 ? 1 - l.area_mm2 / l.solid_mm2 : 0;
        l.cut_length_mm = perimeter_mm(l.material) + perimeter_mm(l.parts.flat());
    }
    const checks = fast_checks(design, layers, registration);
    return { layers, registration, checks, ms: performance.now() - t0 };
}
