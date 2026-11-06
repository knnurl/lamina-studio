// Parameter registry (SPEC 11): every control is declared once here, and the UI is generated from it.
// Entry fields:
//   id        path under the scope's root ('outline.w_mm'), or a name when get/set are given
//   scope     'design' (root), 'piece' (design.piece) or 'layer' (the selected layer)
//   panel     sidebar step the control appears in (not 'step', which is a slider's increment)
//   type      'range' | 'select' | 'colour' | 'toggle'
//   tier      'basic' or 'advanced' (advanced controls show only in Advanced mode)
//   options   for select: [[value, label], ...] or a function (design) -> that list
//   show_if   optional (design, layer) -> bool
//   get / set optional accessors (design, layer) -> value and (design, layer, value), for controls
//             that are not a plain path
//   randomisable, lockable: whether Randomise may change it, and whether it has a lock

export const kMotifTypes = {
    disc: { label: 'Centre opening', params: ['d_mm'], replicated: false },
    window: { label: 'Windows', params: ['r_mm', 'size_mm', 'sides', 'rot_deg', 'mult', 'angle_deg'], replicated: true },
    petal: { label: 'Petals', params: ['r_mm', 'length_mm', 'width_mm', 'mult', 'angle_deg'], replicated: true },
    ring: { label: 'Arc slots', params: ['r_mm', 'w_mm', 'tie_mm', 'mult', 'angle_deg'], replicated: true },
    ray: { label: 'Rays', params: ['r0_mm', 'r1_mm', 'w0_mm', 'w1_mm', 'mult', 'angle_deg'], replicated: true },
};

// scales: the value is a length that follows the piece when it is resized. Structural widths
// (ties) do not scale, because their minimum is set by the material, not the design.
export const kMotifParams = {
    d_mm: { label: 'Diameter', min: 1, max: 1200, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    r_mm: { label: 'Radius', min: 0, max: 600, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    size_mm: { label: 'Size', min: 0.5, max: 600, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    sides: { label: 'Sides (0 is round)', min: 0, max: 12, step: 1, unit: '', scales: false, tier: 'basic' },
    rot_deg: { label: 'Turn', min: -180, max: 180, step: 1, unit: 'deg', scales: false, tier: 'advanced' },
    length_mm: { label: 'Length', min: 1, max: 600, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    width_mm: { label: 'Width', min: 0.5, max: 300, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    w_mm: { label: 'Width', min: 0.5, max: 300, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    tie_mm: { label: 'Tie width', min: 0, max: 60, step: 0.1, unit: 'mm', scales: false, tier: 'advanced' },
    r0_mm: { label: 'Inner radius', min: 0, max: 600, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    r1_mm: { label: 'Outer radius', min: 0, max: 600, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    w0_mm: { label: 'Inner width', min: 0, max: 200, step: 0.5, unit: 'mm', scales: true, tier: 'advanced' },
    w1_mm: { label: 'Outer width', min: 0, max: 200, step: 0.5, unit: 'mm', scales: true, tier: 'basic' },
    mult: { label: 'Copies per repeat', min: 1, max: 6, step: 1, unit: '', scales: false, tier: 'basic' },
    angle_deg: { label: 'Offset', min: -180, max: 180, step: 0.5, unit: 'deg', scales: false, tier: 'basic' },
};

const kind_is = (...kinds) => d => kinds.includes(d.piece.outline.kind);
const sym_is = (...kinds) => d => kinds.includes(d.piece.symmetry.kind);

export const SCHEMA = [
    {
        id: 'outline.kind',
        scope: 'piece',
        panel: 'piece',
        label: 'Outline',
        type: 'select',
        options: [
            ['circle', 'Circle'],
            ['rect', 'Rectangle'],
            ['polygon', 'Polygon'],
            ['arch', 'Arch'],
        ],
        tier: 'basic',
    },
    {
        id: 'outline.w_mm',
        scope: 'piece',
        panel: 'piece',
        label: 'Width',
        type: 'range',
        min: 50,
        max: 1200,
        step: 1,
        unit: 'mm',
        tier: 'basic',
        desc: 'Diameter for circles and polygons. The pattern scales with it.',
    },
    {
        id: 'outline.h_mm',
        scope: 'piece',
        panel: 'piece',
        label: 'Height',
        type: 'range',
        min: 50,
        max: 900,
        step: 1,
        unit: 'mm',
        tier: 'basic',
        show_if: kind_is('rect', 'arch'),
    },
    {
        id: 'outline.sides',
        scope: 'piece',
        panel: 'piece',
        label: 'Sides',
        type: 'range',
        min: 3,
        max: 16,
        step: 1,
        unit: '',
        tier: 'basic',
        show_if: kind_is('polygon'),
    },
    {
        id: 'outline.corner_r_mm',
        scope: 'piece',
        panel: 'piece',
        label: 'Corner radius',
        type: 'range',
        min: 0,
        max: 100,
        step: 0.5,
        unit: 'mm',
        tier: 'advanced',
        show_if: kind_is('rect'),
    },
    {
        id: 'layer_count',
        scope: 'design',
        panel: 'piece',
        label: 'Layers',
        type: 'range',
        min: 1,
        max: 40,
        step: 1,
        unit: '',
        tier: 'basic',
        get: d => d.layers.length,
    },
    {
        id: 'symmetry.kind',
        scope: 'piece',
        panel: 'pattern',
        label: 'Symmetry',
        type: 'select',
        options: [
            ['none', 'None'],
            ['rot', 'Rotate'],
            ['dihedral', 'Kaleidoscope'],
            ['mirror_x', 'Mirror'],
            ['mirror_xy', 'Mirror both ways'],
        ],
        tier: 'basic',
    },
    {
        id: 'symmetry.n',
        scope: 'piece',
        panel: 'pattern',
        label: 'Repeats',
        type: 'range',
        min: 2,
        max: 36,
        step: 1,
        unit: '',
        tier: 'basic',
        show_if: sym_is('rot', 'dihedral'),
        randomisable: true,
        lockable: true,
    },
    {
        id: 'symmetry.phase_deg',
        scope: 'piece',
        panel: 'pattern',
        label: 'Turn the pattern',
        type: 'range',
        min: 0,
        max: 360,
        step: 0.5,
        unit: 'deg',
        tier: 'advanced',
    },
    {
        id: 'palette',
        scope: 'design',
        panel: 'material',
        label: 'Palette',
        type: 'select',
        tier: 'basic',
        options: null, // filled from kPalettes by the UI, which imports design.js
    },
    {
        id: 'all_material',
        scope: 'design',
        panel: 'material',
        label: 'Material for every layer',
        type: 'select',
        tier: 'basic',
        options: null, // filled from kMaterials by the UI
        get: d => (d.layers.every(l => l.material === d.layers[0].material) ? d.layers[0].material : ''),
    },
    {
        id: 'material',
        scope: 'layer',
        panel: 'layers',
        label: 'Material',
        type: 'select',
        tier: 'advanced',
        options: null,
    },
    {
        id: 'finish.colour',
        scope: 'layer',
        panel: 'layers',
        label: 'Colour',
        type: 'colour',
        tier: 'basic',
    },
    {
        id: 'gap_mm',
        scope: 'layer',
        panel: 'layers',
        label: 'Gap behind',
        type: 'range',
        min: 0,
        max: 30,
        step: 0.5,
        unit: 'mm',
        tier: 'basic',
        desc: '0 glues this layer to the next. Spacers are cut from the same sheets.',
    },
    {
        id: 'frame_ring_mm',
        scope: 'layer',
        panel: 'layers',
        label: 'Frame ring',
        type: 'range',
        min: 0,
        max: 80,
        step: 0.5,
        unit: 'mm',
        tier: 'basic',
        desc: 'Solid border that holds the pattern together.',
    },
    {
        id: 'lighting.mode',
        scope: 'piece',
        panel: 'light',
        label: 'Lighting',
        type: 'select',
        options: [
            ['unlit', 'Unlit'],
            ['backlit', 'Backlit'],
        ],
        tier: 'basic',
    },
    {
        id: 'lighting.colour',
        scope: 'piece',
        panel: 'light',
        label: 'Light colour',
        type: 'colour',
        tier: 'basic',
        show_if: d => d.piece.lighting.mode === 'backlit',
    },
    {
        id: 'sheet_size',
        scope: 'design',
        panel: 'make',
        label: 'Stock sheet',
        type: 'select',
        tier: 'basic',
        options: null, // filled from kSheetPresets by the UI
        get: d => `${d.sheet.w_mm}x${d.sheet.h_mm}`,
    },
];

export function schema_entry(id) {
    const entry = SCHEMA.find(e => e.id === id);
    if (!entry) throw new Error(`no schema entry "${id}"`);
    return entry;
}

export function get_path(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function set_path(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const parent = keys.reduce((o, k) => o[k], obj);
    parent[last] = value;
}
