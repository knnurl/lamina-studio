// Geometry worker entry (SPEC 13.3). All geometry runs here; the UI thread renders and edits only.
// Protocol: request {id, type, payload}, reply {id, ok, result} or {id, ok: false, error}.
// Typed arrays anywhere in a result are transferred, not copied.
// 'build' is fast and runs on every edit; 'check' runs the slow checks on the last build of the
// same design (cached by its JSON), so the UI can debounce it.
import { build_design } from '../pipeline/compose.js';
import { slow_checks } from '../pipeline/checks.js';
import { dowel_length_mm } from '../pipeline/registration.js';
import { pack_paths } from '../geom/pack.js';
import { test_card_zip } from '../export/test_card.js';

let cache = { key: null, built: null };

function built_for(design) {
    const key = JSON.stringify(design);
    if (cache.key !== key) cache = { key, built: build_design(design) };
    return cache.built;
}

function build(design) {
    const built = built_for(design);
    const reg = built.registration;
    return {
        ms: built.ms,
        checks: built.checks,
        registration: {
            dowels_mm: reg.dowels.map(p => ({ x: p.x / 1000, y: p.y / 1000 })),
            hole_d_mm: reg.hole_d_mm,
            dowel_length_mm: dowel_length_mm(design),
            spacers: reg.spacers.map(s => ({ kind: s.kind, gap: s.gap, copies: s.copies })),
        },
        layers: built.layers.map(l => ({
            id: l.id,
            area_mm2: l.area_mm2,
            open_fraction: l.open_fraction,
            cut_length_mm: l.cut_length_mm,
            packed: pack_paths(l.material),
            islands: l.islands.map(i => ({ id: i.id, policy: i.policy, area_mm2: i.area_mm2, bbox: i.bbox, outer: pack_paths([i.outer]) })),
            bridges: l.bridges.map(b => ({ island: b.island, length_mm: b.length_mm, w_mm: b.w_mm, rect: pack_paths([b.rect]) })),
            parts: l.parts.map(p => pack_paths(p)),
            locators: pack_paths(l.locators),
            ids: pack_paths(l.ids),
            unbridged: l.unbridged,
        })),
    };
}

function check(design) {
    const t0 = performance.now();
    const built = built_for(design);
    const checks = [...built.checks, ...slow_checks(design, built.layers)];
    return { checks, ms: performance.now() - t0 };
}

const kHandlers = {
    ping: () => ({ pong: true }),
    build,
    check,
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
