// The drawing the cut-file writers consume (SPEC 9.1): a page in mm and items, each a polyline in
// integer micrometres (y up, origin bottom-left) on one laser operation layer.
// { width_mm, height_mm, items: [{ layer, closed, points: [{x, y}] }] }
// Items keep their order: writers emit them as given, so callers put engraving and scoring first,
// then cut holes, then outlines.
// There is no guide layer: Epilog vectors every colour it is sent, mapped or not, so guides live only
// in previews and the assembly sheet.

// aci: AutoCAD colour index for DXF; rgb: the same colour for SVG. Pure RGB primaries, because
// Epilog colour mapping matches RGB values exactly.
export const kLayers = {
    ENGRAVE: { aci: 3, rgb: '#00FF00' },
    RAMP_1: { aci: 5, rgb: '#0000FF' },
    RAMP_2: { aci: 4, rgb: '#00FFFF' },
    RAMP_3: { aci: 6, rgb: '#FF00FF' },
    RAMP_4: { aci: 2, rgb: '#FFFF00' },
    RAMP_5: { aci: 30, rgb: '#FF7F00' },
    SCORE: { aci: 5, rgb: '#0000FF' },
    CUT: { aci: 1, rgb: '#FF0000' },
};

// Layers in a stable order: the order of kLayers, filtered to those the drawing uses.
export function used_layers(drawing) {
    const used = new Set(drawing.items.map(item => item.layer));
    for (const name of used) if (!(name in kLayers)) throw new Error(`unknown layer "${name}"`);
    return Object.keys(kLayers).filter(name => used.has(name));
}

// Formats an integer micrometre value as millimetres with no float noise: 12345 -> "12.345".
export function um_text(value_um) {
    if (!Number.isInteger(value_um)) throw new Error(`not an integer micrometre value: ${value_um}`);
    const sign = value_um < 0 ? '-' : '';
    const abs = Math.abs(value_um);
    const whole = Math.floor(abs / 1000);
    const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
    return sign + whole + (frac ? '.' + frac : '');
}
