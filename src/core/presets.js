// Starting designs (SPEC 11): at least five primitive demos for M1. Each is a base design plus
// outline, symmetry, palette and a generator seed, so presets stay small and reproducible.
import { base_design, apply_palette } from './design.js';
import { generate_stack } from './generate.js';

function preset(name, { layers = 8, outline, symmetry, palette, seed, lighting, frame_ring_mm, style = 'classic' }) {
    const design = base_design(layers);
    design.name = name;
    design.generator.style = style;
    Object.assign(design.piece.outline, outline);
    Object.assign(design.piece.symmetry, symmetry);
    if (lighting) Object.assign(design.piece.lighting, lighting);
    // A backlit piece needs light to get through: translucent acrylic at the back.
    if (design.piece.lighting.mode === 'backlit') design.layers.at(-1).material = 'acr3t';
    if (frame_ring_mm !== undefined) for (const layer of design.layers) layer.frame_ring_mm = frame_ring_mm;
    apply_palette(design, palette);
    generate_stack(design, seed, { lock_n: true });
    return design;
}

export const kPresets = [
    {
        id: 'lattice',
        name: 'Lattice orb',
        make: () =>
            preset('Lattice orb', {
                layers: 12,
                outline: { kind: 'circle', w_mm: 290 },
                symmetry: { kind: 'dihedral', n: 8 },
                palette: 'orb',
                seed: 6, // from a rendered sweep of seeds 1 to 8: the densest, closest to the orb
                style: 'lattice',
            }),
    },
    {
        id: 'circuit',
        name: 'Circuit panel',
        make: () =>
            preset('Circuit panel', {
                layers: 6,
                outline: { kind: 'rect', w_mm: 380, h_mm: 280 },
                symmetry: { kind: 'mirror_xy' },
                palette: 'acid',
                seed: 7, // from a rendered sweep of seeds 1 to 8: bars in front, the richest routing
                frame_ring_mm: 12, // room for the dowels in the ring: a bars front layer shares little else
                style: 'circuit',
            }),
    },
    {
        id: 'mandala',
        name: 'Mandala',
        make: () =>
            preset('Mandala', {
                layers: 10,
                outline: { kind: 'circle', w_mm: 290 },
                symmetry: { kind: 'dihedral', n: 12 },
                palette: 'ember',
                seed: 7, // from a rendered sweep of seeds 1 to 12: a lotus ring inside a ring of arc slots
                style: 'mandala',
            }),
    },
    {
        id: 'orb',
        name: 'Orb',
        make: () =>
            preset('Orb', {
                outline: { kind: 'circle', w_mm: 290 },
                symmetry: { kind: 'dihedral', n: 8 },
                palette: 'orb',
                seed: 5,
            }),
    },
    {
        id: 'rose',
        name: 'Rose window',
        make: () =>
            preset('Rose window', {
                layers: 10,
                outline: { kind: 'circle', w_mm: 290 },
                symmetry: { kind: 'dihedral', n: 12 },
                palette: 'ember',
                seed: 4,
            }),
    },
    {
        id: 'gate',
        name: 'Acid gate',
        make: () =>
            preset('Acid gate', {
                outline: { kind: 'arch', w_mm: 240, h_mm: 330 },
                symmetry: { kind: 'dihedral', n: 10 },
                palette: 'acid',
                seed: 4,
            }),
    },
    {
        id: 'lantern',
        name: 'Hex lantern',
        make: () =>
            preset('Hex lantern', {
                outline: { kind: 'polygon', w_mm: 290, sides: 6 },
                symmetry: { kind: 'rot', n: 6 },
                palette: 'ice',
                seed: 5,
                lighting: { mode: 'backlit', colour: '#46b4ff' },
            }),
    },
    {
        id: 'sun',
        name: 'Walnut sun',
        make: () =>
            preset('Walnut sun', {
                layers: 6,
                outline: { kind: 'circle', w_mm: 290 },
                symmetry: { kind: 'dihedral', n: 16 },
                palette: 'walnut',
                seed: 2,
                frame_ring_mm: 10,
            }),
    },
];

export function preset_by_id(id) {
    const p = kPresets.find(x => x.id === id);
    if (!p) throw new Error(`no preset "${id}"`);
    return p.make();
}
