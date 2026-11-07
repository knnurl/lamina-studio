// Applies a schema control's value to a design, including the controls that are not a plain path
// (layer count, palette and its spread, material for all layers, sheet size) and resizing, which also scales
// the pattern. Also supplies the option lists that come from the design tables.
import { get_path, set_path } from './schema.js';
import {
    kMaterials,
    kPalettes,
    kSheetPresets,
    set_layer_count,
    apply_palette,
    scale_motifs,
    piece_radius_mm,
    material_of,
} from './design.js';

export function options_for(entry, design) {
    if (entry.options) return typeof entry.options === 'function' ? entry.options(design) : entry.options;
    switch (entry.id) {
        case 'palette': {
            const named = Object.entries(kPalettes).map(([id, p]) => [id, p.label]);
            return design.palette_custom ? [...named, ['custom', 'Custom']] : named;
        }
        case 'all_material':
        case 'material':
            return Object.keys({ ...kMaterials, ...design.materials }).map(id => [id, material_of(design, { material: id }).label]);
        case 'sheet_size':
            return Object.entries(kSheetPresets).map(([id, s]) => [id, s.label]);
        default:
            throw new Error(`no options for "${entry.id}"`);
    }
}

function scope_root(entry, design, layer_index) {
    if (entry.scope === 'piece') return design.piece;
    if (entry.scope === 'layer') return design.layers[layer_index];
    return design;
}

export function read_param(entry, design, layer_index) {
    if (entry.get) return entry.get(design, design.layers[layer_index]);
    if (entry.id === 'bridge.w_mm') {
        const layer = design.layers[layer_index];
        return layer.bridge.w_mm ?? material_of(design, layer).min_bridge_mm;
    }
    return get_path(scope_root(entry, design, layer_index), entry.id);
}

// Mutates design (a draft) so the control reads value.
export function write_param(entry, design, layer_index, value) {
    switch (entry.id) {
        case 'layer_count':
            set_layer_count(design, value);
            return;
        case 'palette':
            apply_palette(design, value);
            return;
        case 'palette_spread':
            design.palette_spread = value;
            apply_palette(design);
            return;
        case 'all_material':
            for (const layer of design.layers) layer.material = value;
            return;
        case 'sheet_size': {
            const preset = kSheetPresets[value];
            design.sheet.w_mm = preset.w_mm;
            design.sheet.h_mm = preset.h_mm;
            return;
        }
        case 'outline.w_mm':
        case 'outline.h_mm': {
            const before = piece_radius_mm(design.piece);
            set_path(design.piece, entry.id, value);
            const after = piece_radius_mm(design.piece);
            if (before > 0 && after !== before) scale_motifs(design, after / before);
            return;
        }
        default:
            set_path(scope_root(entry, design, layer_index), entry.id, value);
    }
}
