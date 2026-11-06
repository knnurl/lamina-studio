// SVG cut-file writer (SPEC 9.1): mm page with a mm viewBox, one group per laser layer, hairline
// strokes in pure RGB, no fills. SVG is y down, so y is flipped against the page height.
import { kLayers, used_layers, um_text } from './drawing.js';
import { mm_to_um } from '../core/units.js';

const kStrokeMm = '0.025'; // about 0.001 in: a hairline vector for the Epilog driver

export function drawing_to_svg(drawing) {
    const w = um_text(mm_to_um(drawing.width_mm));
    const h_um = mm_to_um(drawing.height_mm);
    const point = p => `${um_text(p.x)} ${um_text(h_um - p.y)}`;
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        // \x21 is "!": the source must not contain a literal HTML comment opener, because the bundle
        // is inlined in a script element (tools/build.js refuses it).
        '<\x21-- Lamina Studio cut file. Open in an RGB document; units are millimetres. -->',
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${um_text(h_um)}mm" ` +
            `viewBox="0 0 ${w} ${um_text(h_um)}">`,
    ];
    for (const name of used_layers(drawing)) {
        lines.push(`<g id="${name}" fill="none" stroke="${kLayers[name].rgb}" stroke-width="${kStrokeMm}">`);
        for (const item of drawing.items) {
            if (item.layer !== name) continue;
            const [first, ...rest] = item.points;
            const d = `M${point(first)}` + rest.map(p => ` L${point(p)}`).join('') + (item.closed ? ' Z' : '');
            lines.push(`<path d="${d}"/>`);
        }
        lines.push('</g>');
    }
    lines.push('</svg>', '');
    return lines.join('\n');
}
