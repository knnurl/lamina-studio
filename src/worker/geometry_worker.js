// Geometry worker entry (SPEC 13.3). All geometry runs here; the UI thread renders and edits only.
// Protocol: request {id, type, payload}, reply {id, ok, result} or {id, ok: false, error}.
// Typed arrays anywhere in a result are transferred, not copied.
import { build_design } from '../pipeline/compose.js';
import { pack_paths } from '../geom/pack.js';
import { test_card_zip } from '../export/test_card.js';

function build(design) {
    const built = build_design(design);
    return {
        ms: built.ms,
        layers: built.layers.map(l => ({
            id: l.id,
            area_mm2: l.area_mm2,
            open_fraction: l.open_fraction,
            packed: pack_paths(l.material),
        })),
    };
}

const kHandlers = {
    ping: () => ({ pong: true }),
    build,
    test_card_zip,
};

function transferables(value, out = []) {
    if (ArrayBuffer.isView(value)) out.push(value.buffer);
    else if (Array.isArray(value)) for (const v of value) transferables(v, out);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) transferables(v, out);
    return out;
}

self.onmessage = event => {
    const { id, type, payload } = event.data;
    try {
        const handler = kHandlers[type];
        if (!handler) throw new Error(`unknown request "${type}"`);
        const result = handler(payload);
        self.postMessage({ id, ok: true, result }, transferables(result));
    } catch (err) {
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
};
