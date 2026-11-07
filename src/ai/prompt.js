// The assistant's system prompt and tools (SPEC M4.5). The prompt is generated from the registry,
// so it always matches the controls, and it is the same text every time, so it caches.
import { SCHEMA, kMotifTypes, kMotifParams } from '../core/schema.js';
import { kStyles } from '../core/generate.js';
import { kMaterials, kPalettes } from '../core/design.js';

const kMotifNotes = {
    disc: 'a round opening at the centre (not repeated)',
    window: 'a polygon (sides 3 to 12) or circle (sides 0) opening at radius r_mm',
    petal: 'a pointed lens along the radius',
    ring: 'arc slots round the circle at radius r_mm, w_mm wide, with ties tie_mm wide between them (tie 0 cuts a full ring, which needs bridges)',
    ray: 'a tapered spoke from r0_mm to r1_mm',
    lattice: 'a maze lattice in the band r0_mm to r1_mm: bars are material, cells are openings; openness removes dead-end walls; seed varies it',
    fret: 'a Greek key band at radius r_mm, w_mm wide',
    scroll: 'a spiral curl on a stem; not symmetric, so under kaleidoscope symmetry put angle_deg at 90 / repeats',
    ruyi: 'a three-lobed cloud head on a stem',
    ogee: 'a pointed onion arch',
    lotus: 'a centre petal with two side petals',
    shape: 'a free outline of cubic Bezier nodes in local mm (x along the radius, origin at r_mm); every node is {x, y, ix, iy, ox, oy}: the anchor and its in and out handles',
    circuit: 'circuit traces routed with 45-degree turns over a centred area; polarity slots cuts the traces, bars keeps them as material over an opened area',
};

function control_line(e) {
    const type = e.type ?? 'range';
    let values = '';
    if (type === 'range') values = `${e.min} to ${e.max}${e.unit ? ` ${e.unit}` : ''}`;
    else if (type === 'select' && Array.isArray(e.options)) values = e.options.map(o => (Array.isArray(o) ? o[0] : o)).join(' | ');
    else if (type === 'select') values = 'see the lists below';
    else if (type === 'colour') values = '#rrggbb';
    else if (type === 'toggle') values = 'true | false';
    return `- ${e.id} (${e.scope}${e.scope === 'layer' ? ', needs layer' : ''}): ${e.label}; ${values}`;
}

function param_line(key) {
    const p = kMotifParams[key];
    if ((p.type ?? 'range') === 'select') return `${key}: ${p.options.map(o => o[0]).join(' | ')}`;
    return `${key}: ${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ''}`;
}

export function system_prompt() {
    const controls = SCHEMA.map(control_line).join('\n');
    const motifs = Object.entries(kMotifTypes)
        .map(([type, t]) => `- ${type} (${t.label}): ${kMotifNotes[type] ?? ''}. Fields: ${t.params.map(param_line).join('; ')}`)
        .join('\n');
    return `You are the design assistant inside Lamina Studio, a browser studio for layered laser-cut art: mandalas, orbs, shadow boxes and festival panels. You design and edit pieces by calling tools that change the user's design, then you check and look at the result before you finish.

How a piece works
- A piece is a stack of flat sheets (layers). Layer 1 is the front, nearest the viewer; the last layer is the back. Each layer is cut from 3 mm sheet. Openings are cut out; what is left is material.
- Looking into the piece, openings in front reveal the layers behind, so depth comes from openings that close up towards the back. Good stacks usually shrink openings and widen frame rings layer by layer, leave the back layer solid or nearly solid, and turn alternate layers half a step so edges show.
- Motifs on a layer are drawn once on the +x axis, centred at radius r_mm from the centre, and repeated round the piece by its symmetry. mult copies sit in each repeat; angle_deg turns them. The frame ring is a solid border kept round each layer.
- Field mode slices one shared field into every layer instead of per-layer motifs.

Cutting rules
- Webs between openings must stay at least the material's minimum web (1.5 mm in ply and MDF, 2 mm in acrylic); thinner webs break or burn away. Bridges are added automatically to hold loose parts, but a part held only by long thin bridges is fragile.
- check_design reports findings. Fatal ones (G-01 to G-05) block export: always fix them before you finish. Warnings (W-..) are allowed when they are deliberate; say so.

How to work
1. If the request is unclear in a way that changes the result, ask one short question. Otherwise decide and build.
2. Change the design with edit_design, several related operations per call. Layers and motifs are numbered from 1.
3. Run check_design after a round of edits. Use look when the visual result matters: after a first build, after big changes, and before you finish. Do not look after every small edit.
4. Fix what the checks or your eyes find, then finish with two or three plain sentences: what you made and anything the user should know. British English.
- Keep the user's work unless they ask you to replace it. Use generate for a fast starting point, then shape it by hand with motif edits.
- For artwork the motifs cannot make (an animal, an emblem, lettering, a scene), use draw_artwork with clean SVG paths.

Controls for edit_design op "set" (id, value, and layer when the control is per layer)
${controls}

Motif types for add_motif, set_motifs and update_motif
${motifs}

Lists
- styles for generate: ${Object.keys(kStyles).join(', ')}
- palettes: ${Object.keys(kPalettes).join(', ')}
- materials: ${Object.keys(kMaterials).join(', ')}
- symmetry kinds: none, rot (rotate n times), dihedral (kaleidoscope: rotate and mirror, n repeats), mirror_x, mirror_xy

draw_artwork
- Write an SVG whose viewBox is in millimetres, centred on the area it should cover. Use filled, closed paths only (strokes are ignored). Holes follow the even-odd rule, so a shape inside a shape cuts back.
- as "openings" cuts the filled shapes out of the layer; as "material" makes the filled shapes the whole layer (everything else is cut away, so keep it joined to a frame).
- Keep every bar and gap at least 2 mm wide at the size you place it. Fewer, bolder shapes cut better than fine detail.

Pictures
- make_picture asks an image model for a picture to trace. Describe flat, bold shapes in a few distinct tones on a plain background, as for a layered papercut; avoid gradients, fine texture and text.
- trace_picture slices a picture into the layers by tone (or by depth, nearest at the front). Look at the result and adjust levels, smoothing or framing until it reads well.`;
}

const kOp = {
    type: 'object',
    properties: {
        op: { type: 'string', enum: ['set', 'set_motifs', 'add_motif', 'update_motif', 'remove_motif', 'generate', 'keep_layer', 'rename'] },
        id: { type: 'string', description: 'set: the control id' },
        value: { description: 'set: the new value' },
        layer: { type: 'integer', description: 'the layer, from 1 (front)' },
        motif: { type: 'object', description: 'add_motif: a motif with its type and any fields; missing fields take defaults' },
        motifs: { type: 'array', items: { type: 'object' }, description: 'set_motifs: the layer’s complete motif list' },
        index: { type: 'integer', description: 'update_motif, remove_motif: the motif, from 1' },
        fields: { type: 'object', description: 'update_motif: the fields to change' },
        style: { type: 'string', description: 'generate: the style' },
        seed: { type: 'integer', description: 'generate: the seed' },
        keep_repeats: { type: 'boolean', description: 'generate: keep the symmetry repeat count (default true)' },
        keep: { type: 'boolean', description: 'keep_layer: true keeps the layer when generating' },
        name: { type: 'string', description: 'rename: the piece’s name' },
    },
    required: ['op'],
};

// Tool definitions. make_picture is offered only with a picture key.
export function tools({ pictures = false } = {}) {
    const list = [
        {
            name: 'edit_design',
            description: 'Change the design with a list of operations, applied in order as one undo step. Invalid operations are skipped and reported; values are clamped to each control’s range. Returns what changed, what was refused, and the design afterwards.',
            input_schema: { type: 'object', properties: { ops: { type: 'array', items: kOp, minItems: 1 } }, required: ['ops'] },
        },
        {
            name: 'check_design',
            description: 'Run every fabrication check on the current design. Returns fatal problems and warnings with their layers, and per-layer open fraction, islands and cut length.',
            input_schema: { type: 'object', properties: {} },
        },
        {
            name: 'look',
            description: 'See the current design as a picture: front (all layers stacked, as seen from the front), 3d (the 3D preview), or layer (one layer, with its bridges).',
            input_schema: {
                type: 'object',
                properties: { view: { type: 'string', enum: ['front', '3d', 'layer'] }, layer: { type: 'integer', description: 'layer: which layer, from 1' } },
                required: ['view'],
            },
        },
        {
            name: 'draw_artwork',
            description: 'Place SVG artwork on a layer, either cut out as openings or as the layer’s whole material. Returns what was imported and the checks for that layer.',
            input_schema: {
                type: 'object',
                properties: {
                    layer: { type: 'integer', description: 'the layer, from 1' },
                    svg: { type: 'string', description: 'a complete SVG document; viewBox in mm' },
                    as: { type: 'string', enum: ['openings', 'material'] },
                    width_mm: { type: 'number', description: 'scale the artwork to this width (openings only)' },
                    x_mm: { type: 'number', description: 'centre of the artwork from the piece centre (openings only)' },
                    y_mm: { type: 'number', description: 'centre of the artwork from the piece centre, up is positive (openings only)' },
                    repeat: { type: 'boolean', description: 'openings only: repeat round the piece by its symmetry (default false)' },
                },
                required: ['layer', 'svg', 'as'],
            },
        },
        {
            name: 'trace_picture',
            description: 'Slice a picture from this conversation into the layers as an image field: by tone, or by depth with the nearest parts at the front. Returns the layers’ open fractions and checks.',
            input_schema: {
                type: 'object',
                properties: {
                    picture: { type: 'string', description: 'the picture id, as given when it appeared' },
                    mode: { type: 'string', enum: ['tone', 'depth'] },
                    invert: { type: 'boolean', description: 'swap light and dark (or near and far)' },
                    smooth_mm: { type: 'number', description: 'blur before slicing, 0 to 6 mm' },
                    zoom: { type: 'number', description: '1 fits the picture inside the piece; larger crops in' },
                    front_fill: { type: 'number', description: 'how much of the front layer stays material, 0.05 to 0.9' },
                },
                required: ['picture', 'mode'],
            },
        },
    ];
    if (pictures) {
        list.push({
            name: 'make_picture',
            description: 'Ask an image model for a picture to trace into layers. The picture appears in the conversation with an id.',
            input_schema: {
                type: 'object',
                properties: {
                    description: { type: 'string', description: 'what to draw, worded for a layered papercut: flat, bold shapes in a few tones on a plain background' },
                    aspect: { type: 'string', enum: ['1:1', '4:5', '5:4', '3:4', '4:3', '16:9', '9:16'] },
                },
                required: ['description'],
            },
        });
    }
    // Large inputs (SVG) stream as they are written; the loop validates them before running.
    return list.map(t => ({ ...t, eager_input_streaming: true }));
}

// Checks a tool input against its schema's required fields and basic types. Returns an error
// message, or null when it is usable.
export function invalid_input(tool, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'the input must be an object';
    for (const key of tool.input_schema.required ?? []) if (!(key in input)) return `missing ${key}`;
    for (const [key, spec] of Object.entries(tool.input_schema.properties ?? {})) {
        if (!(key in input) || !spec.type) continue;
        const v = input[key];
        const ok =
            spec.type === 'string' ? typeof v === 'string' :
            spec.type === 'integer' ? Number.isInteger(v) :
            spec.type === 'number' ? typeof v === 'number' && Number.isFinite(v) :
            spec.type === 'boolean' ? typeof v === 'boolean' :
            spec.type === 'array' ? Array.isArray(v) :
            spec.type === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : true;
        if (!ok) return `${key} must be ${spec.type === 'integer' ? 'a whole number' : `a ${spec.type}`}`;
        if (spec.enum && !spec.enum.includes(v)) return `${key} must be one of ${spec.enum.join(', ')}`;
    }
    return null;
}
