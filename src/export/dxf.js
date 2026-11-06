// DXF R12 (AC1009) cut-file writer (SPEC 9.1). Header carries $INSUNITS 4 (mm) and $MEASUREMENT 1,
// like the DXFs already proven at the lab. One LAYER table entry per operation with its colour;
// every item is a POLYLINE (closed for cuts, open for strokes) with VERTEX entities in mm, y up.
// R12 needs no handles, so the file stays small and hard to get wrong.
import { kLayers, used_layers, um_text } from './drawing.js';
import { mm_to_um } from '../core/units.js';

export function drawing_to_dxf(drawing) {
    const out = [];
    const put = (code, value) => out.push(String(code).padStart(3, ' '), String(value));
    const layers = used_layers(drawing);

    put(0, 'SECTION');
    put(2, 'HEADER');
    put(9, '$ACADVER');
    put(1, 'AC1009');
    put(9, '$INSUNITS');
    put(70, 4);
    put(9, '$MEASUREMENT');
    put(70, 1);
    put(9, '$EXTMIN');
    put(10, '0.0');
    put(20, '0.0');
    put(9, '$EXTMAX');
    put(10, um_text(mm_to_um(drawing.width_mm)));
    put(20, um_text(mm_to_um(drawing.height_mm)));
    put(0, 'ENDSEC');

    put(0, 'SECTION');
    put(2, 'TABLES');
    put(0, 'TABLE');
    put(2, 'LTYPE');
    put(70, 1);
    put(0, 'LTYPE');
    put(2, 'CONTINUOUS');
    put(70, 0);
    put(3, 'Solid line');
    put(72, 65);
    put(73, 0);
    put(40, '0.0');
    put(0, 'ENDTAB');
    put(0, 'TABLE');
    put(2, 'LAYER');
    put(70, layers.length);
    for (const name of layers) {
        put(0, 'LAYER');
        put(2, name);
        put(70, 0);
        put(62, kLayers[name].aci);
        put(6, 'CONTINUOUS');
    }
    put(0, 'ENDTAB');
    put(0, 'ENDSEC');

    put(0, 'SECTION');
    put(2, 'ENTITIES');
    for (const item of drawing.items) {
        put(0, 'POLYLINE');
        put(8, item.layer);
        put(66, 1);
        put(10, '0.0');
        put(20, '0.0');
        put(30, '0.0');
        put(70, item.closed ? 1 : 0);
        for (const p of item.points) {
            put(0, 'VERTEX');
            put(8, item.layer);
            put(10, um_text(p.x));
            put(20, um_text(p.y));
            put(30, '0.0');
        }
        put(0, 'SEQEND');
        put(8, item.layer);
    }
    put(0, 'ENDSEC');
    put(0, 'EOF');
    return out.join('\n') + '\n';
}
