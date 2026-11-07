// The design document (SPEC 5): the single source of truth. Every output is a pure function of it.
// Units are mm here; geometry converts to integer micrometres. A null material-dependent value
// means "use the material preset".
import { kMotifTypes, kMotifParams } from './schema.js';

export const kSchemaVersion = 1;

// Starting values; the calibration test card replaces them (SPEC 5.1, 9.4).
export const kMaterials = {
    ply3: {
        label: 'Birch plywood 3 mm',
        thickness_mm: 3,
        kerf_mm: 0.2,
        min_web_mm: 1.5,
        min_bridge_mm: 1.2,
        min_hole_mm: 1.0,
        look: { colour: '#d8b98c', translucent: false },
        measured: false,
    },
    mdf3: {
        label: 'MDF 3 mm',
        thickness_mm: 3,
        kerf_mm: 0.2,
        min_web_mm: 1.5,
        min_bridge_mm: 1.2,
        min_hole_mm: 1.0,
        look: { colour: '#9c7b5b', translucent: false },
        measured: false,
    },
    acr3: {
        label: 'Acrylic 3 mm, opaque',
        thickness_mm: 3,
        kerf_mm: 0.15,
        min_web_mm: 2.0,
        min_bridge_mm: 1.5,
        min_hole_mm: 1.0,
        look: { colour: '#202024', translucent: false },
        measured: false,
    },
    acr3t: {
        label: 'Acrylic 3 mm, translucent',
        thickness_mm: 3,
        kerf_mm: 0.15,
        min_web_mm: 2.0,
        min_bridge_mm: 1.5,
        min_hole_mm: 1.0,
        look: { colour: '#f2f2f2', translucent: true },
        measured: false,
    },
};

// Finish palettes, front to back. Colours are blended across however many layers there are, or
// repeated in turn (the design's palette_spread). A design can also carry its own palette
// (palette "custom", colours in palette_custom).
export const kPalettes = {
    orb: { label: 'Orb', stops: ['#a7a9b0', '#ff4a2a', '#3a7bd5', '#e9e4da', '#c8321e', '#243a8f', '#14101c'] },
    acid: { label: 'Acid', stops: ['#c4f24a', '#8cc152', '#5e8f3a', '#5b2f80', '#331a4d', '#120a1c'] },
    ember: { label: 'Ember', stops: ['#ffd27a', '#ffb340', '#ff7a2e', '#e0482a', '#9c2a2a', '#2a1010'] },
    ice: { label: 'Ice', stops: ['#eef7ff', '#a9d4ff', '#5aa8f0', '#2f6fd0', '#243b8a', '#0d1230'] },
    walnut: { label: 'Walnut to birch', stops: ['#2a1d14', '#4a3424', '#78553a', '#a8814f', '#d9bf8f', '#efe3c6'] },
    mono: { label: 'Mono', stops: ['#f2f2f2', '#c8c8c8', '#9a9a9a', '#6c6c6c', '#404040', '#161616'] },
    uv: { label: 'UV neon', stops: ['#f4ff3a', '#3dff8b', '#00e1ff', '#ff2bd6', '#8f2bff', '#170630'] },
    sunset: { label: 'Psy sunset', stops: ['#ffe36e', '#ffa53d', '#ff5e5b', '#d6336c', '#7b2cbf', '#22053f'] },
    aurora: { label: 'Aurora', stops: ['#c2fff1', '#45f0b3', '#22b8b0', '#3a7bff', '#7d3cf0', '#160a38'] },
    vapor: { label: 'Vaporwave', stops: ['#ffd6f6', '#ff71ce', '#b967ff', '#01cdfe', '#05ffa1', '#1b1035'] },
    toxic: { label: 'Toxic', stops: ['#eaff3b', '#a3ff12', '#2ee36f', '#0f9a77', '#124a5c', '#06141f'] },
    spectrum: { label: 'Spectrum', stops: ['#ff3b3b', '#ff9f1c', '#ffe74c', '#3ddc84', '#2ec4ff', '#5b5bff', '#b04bff'] },
    fire_ice: { label: 'Fire and ice', stops: ['#ffd166', '#ff6b35', '#d62828', '#3a0ca3', '#4cc9f0', '#e6fbff'] },
    candy: { label: 'Candy', stops: ['#fff4fb', '#ffc2e2', '#ff8fc7', '#c77dff', '#7f5af0', '#2c1a5c'] },
    deep_sea: { label: 'Deep sea', stops: ['#c9fff4', '#5ee6d0', '#1fb3c7', '#167a9e', '#103f6e', '#071633'] },
    forest: { label: 'Forest', stops: ['#dff5a6', '#9ccc5a', '#5a9440', '#2f6230', '#1b3d27', '#0b1a12'] },
    gold: { label: 'Gold and black', stops: ['#fff1b8', '#f2c94c', '#c9972b', '#8a6418', '#3d2c0c', '#0d0a05'] },
    copper: { label: 'Copper and teal', stops: ['#f6c28b', '#d98e5b', '#b0613a', '#2a9d8f', '#1d6b63', '#0b2b2a'] },
};

// A palette of the design's own has this many colours.
export const kMinStops = 2;
export const kMaxStops = 8;

export const kSheetPresets = {
    '600x400': { label: '600 x 400 mm', w_mm: 600, h_mm: 400 },
    '400x300': { label: '400 x 300 mm', w_mm: 400, h_mm: 300 },
    '300x300': { label: '300 x 300 mm', w_mm: 300, h_mm: 300 },
};

function hex_to_rgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgb_to_hex(rgb) {
    return '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// Colour for layer k of n from a list of colours: blended in RGB from the first at the front to
// the last at the back, or, with spread "repeat", the colours in turn.
export function stops_colour(stops, k, n, spread = 'blend') {
    if (spread === 'repeat') return stops[k % stops.length];
    if (n <= 1) return stops[0];
    const t = (k / (n - 1)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    const f = t - i;
    const a = hex_to_rgb(stops[i]);
    const b = hex_to_rgb(stops[i + 1]);
    return rgb_to_hex(a.map((c, j) => c + (b[j] - c) * f));
}

// Colour for layer k of n from a named palette, blended (an unknown name falls back to Orb).
export function palette_colour(palette_id, k, n) {
    return stops_colour((kPalettes[palette_id] ?? kPalettes.orb).stops, k, n);
}

// The design's palette colours, front to back: its own when the palette is "custom".
export function palette_stops(design) {
    if (design.palette === 'custom' && design.palette_custom?.length >= kMinStops) return design.palette_custom;
    return (kPalettes[design.palette] ?? kPalettes.orb).stops;
}

export function default_layer(k, n, palette_id = 'orb') {
    return {
        id: `L${k + 1}`,
        material: 'ply3',
        thickness_mm: null,
        gap_mm: 0,
        finish: { kind: 'paint', colour: palette_colour(palette_id, k, n) },
        frame_ring_mm: 12,
        locked: false,
        source: { kind: 'primitive', motifs: [] },
        island_policy: 'bridge',
        bridge: { w_mm: null, max: 4 },
        overrides: { islands: {}, bridge_angles: {}, locks: [], edits: [] },
    };
}

export function base_design(layer_count = 8) {
    return {
        app: 'lamina',
        schema: kSchemaVersion,
        name: 'Untitled',
        seed: 1,
        palette: 'orb',
        palette_custom: null,
        palette_spread: 'blend',
        materials: {},
        generator: { style: 'classic' },
        piece: {
            outline: { kind: 'circle', w_mm: 290, h_mm: 290, sides: 8, corner_r_mm: 0 },
            symmetry: { kind: 'dihedral', n: 8, phase_deg: 0 },
            lighting: { mode: 'unlit', colour: '#ff5b2e' },
            depth_mode: 'per_layer',
            field: { kind: 'rings', scale_mm: 24, k: 8, a: 0.6, lo: 0.3, hi: 1, zoom: 1, smooth_mm: 1, invert: false, image: null },
        },
        machine: { id: 'epilog_fusion_pro_48', bed_w_mm: 1219, bed_h_mm: 914 },
        sheet: { w_mm: 600, h_mm: 400, margin_mm: 4, spacing_mm: 3 },
        registration: { dowel_d_mm: 3, count: 3, through_front: false, ids: true },
        spacers: { style: 'pucks', stock_material: 'ply3' },
        layers: Array.from({ length: layer_count }, (_, k) => default_layer(k, layer_count)),
        frame: null,
        tiling: null,
        check_overrides: [],
    };
}

const is_plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Copies keys missing from target out of defaults, recursively for plain objects.
function fill_missing(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (!(key in target)) target[key] = structuredClone(value);
        else if (is_plain(value) && is_plain(target[key])) fill_missing(target[key], value);
    }
    return target;
}

// Opens any saved design: checks it is a Lamina file, upgrades older schemas, fills new fields.
export function migrate(input) {
    if (!is_plain(input) || input.app !== 'lamina') throw new Error('not a Lamina design file');
    if (!Number.isInteger(input.schema) || input.schema > kSchemaVersion) {
        throw new Error(`design schema ${input.schema} is newer than this studio (${kSchemaVersion})`);
    }
    const design = structuredClone(input);
    const n = Array.isArray(design.layers) && design.layers.length ? design.layers.length : 8;
    fill_missing(design, base_design(n));
    design.layers = design.layers.map((layer, k) => fill_missing(layer, default_layer(k, n, design.palette)));
    design.schema = kSchemaVersion;
    return design;
}

// The design's own (measured) materials override the built-in table (SPEC 5.1).
export function material_of(design, layer) {
    return design.materials?.[layer.material] ?? kMaterials[layer.material] ?? kMaterials.ply3;
}

export function layer_thickness_mm(design, layer) {
    return layer.thickness_mm ?? material_of(design, layer).thickness_mm;
}

export function piece_radius_mm(piece) {
    const o = piece.outline;
    if (o.kind === 'rect' || o.kind === 'arch') return Math.min(o.w_mm, o.h_mm) / 2;
    return o.w_mm / 2;
}

// Slices a picture raster (a photo's tones or depth) into the layers (SPEC M5): field mode, bright
// parts near, each layer cutting an equal share of the picture's tones (levels 1/n to 1), and the
// picture covering the whole outline.
export function apply_photo(design, image) {
    const n = design.layers.length;
    const o = design.piece.outline;
    const w_mm = o.w_mm;
    const h_mm = o.kind === 'rect' || o.kind === 'arch' ? o.h_mm : o.w_mm;
    const fit = Math.min(w_mm / image.w, h_mm / image.h);
    const cover = Math.max(w_mm / image.w, h_mm / image.h);
    design.piece.depth_mode = 'field';
    Object.assign(design.piece.field, {
        kind: 'image',
        image,
        invert: true,
        zoom: Math.min(4, Math.round((cover / fit) * 100) / 100),
        smooth_mm: 1,
        lo: Math.round((1 / n) * 100) / 100,
        hi: 1,
    });
    return design;
}

// Applies a palette (by default the design's own choice again) to every layer's finish colour.
export function apply_palette(design, palette_id = design.palette) {
    design.palette = palette_id;
    const stops = palette_stops(design);
    const n = design.layers.length;
    design.layers.forEach((layer, k) => {
        layer.finish.colour = stops_colour(stops, k, n, design.palette_spread);
    });
}

// Makes colours (front to back) the design's own palette and applies it. Keeps the valid
// #rrggbb colours, at most kMaxStops; throws if fewer than kMinStops are left.
export function set_custom_palette(design, colours) {
    const stops = colours.filter(c => /^#[0-9a-f]{6}$/i.test(String(c))).map(c => c.toLowerCase()).slice(0, kMaxStops);
    if (stops.length < kMinStops) throw new Error(`a palette needs ${kMinStops} to ${kMaxStops} colours like #a1b2c3`);
    design.palette_custom = stops;
    apply_palette(design, 'custom');
}

// Sets the layer count. New layers are copies of the last patterned layer, inserted before the
// back layer, so the back stays solid; removal takes from just in front of the back.
export function set_layer_count(design, count) {
    const n = Math.max(1, Math.min(40, Math.round(count)));
    const layers = design.layers;
    while (layers.length < n) {
        const template = layers.length > 1 ? layers[layers.length - 2] : layers[0];
        layers.splice(Math.max(layers.length - 1, 0), 0, structuredClone(template));
    }
    while (layers.length > n) layers.splice(Math.max(layers.length - 2, 0), 1);
    layers.forEach((layer, k) => {
        layer.id = `L${k + 1}`;
    });
    apply_palette(design, design.palette);
}

const svg_source = l => ({ kind: 'svg', name: l.name, fill_rule: 'evenodd', paths: l.paths });

// A new design from imported SVG layers (front first): a custom outline from the artwork's
// silhouette, no symmetry, no frame rings (the artwork brings its own border).
// imported: the worker's import_svg result (paths and outline as flat micrometre arrays).
export function design_from_import(imported, name) {
    const n = imported.layers.length;
    const design = base_design(n);
    design.name = name;
    design.piece.outline = {
        kind: 'custom',
        w_mm: Math.round(imported.size_mm.w * 10) / 10,
        h_mm: Math.round(imported.size_mm.h * 10) / 10,
        sides: 8,
        corner_r_mm: 0,
        custom: imported.outline,
    };
    design.piece.symmetry = { kind: 'none', n: 8, phase_deg: 0 };
    design.layers.forEach((layer, k) => {
        layer.frame_ring_mm = 0;
        layer.source = svg_source(imported.layers[k]);
    });
    return design;
}

// Puts one imported layer's artwork on layer k of an existing design.
export function import_into_layer(design, k, imported_layer) {
    design.layers[k].source = svg_source(imported_layer);
    design.layers[k].frame_ring_mm = 0;
}

// Reverses the stack (front becomes back), renumbering layers and reapplying the palette.
export function reverse_layers(design) {
    design.layers.reverse();
    design.layers.forEach((layer, k) => {
        layer.id = `L${k + 1}`;
    });
    apply_palette(design, design.palette);
}

// Scales every length a motif has (positions and sizes, not structural widths such as ties), so a
// pattern follows the piece when the piece is resized.
export function scale_motifs(design, factor) {
    for (const layer of design.layers) {
        for (const motif of layer.source.motifs ?? []) {
            for (const key of kMotifTypes[motif.type]?.params ?? []) {
                if (kMotifParams[key].scales && typeof motif[key] === 'number') {
                    motif[key] = Math.round(motif[key] * factor * 100) / 100;
                }
            }
        }
    }
}
