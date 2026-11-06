// Geometry worker entry (SPEC 13.3). All geometry runs here; the UI thread renders and edits only.
// Protocol: request {id, type, payload}, reply {id, ok, result} or {id, ok: false, error}.
// A result's top-level Uint8Array fields are transferred, not copied.
import { boot_demo } from '../dev/boot_demo.js';
import { test_card_zip } from '../export/test_card.js';

const kHandlers = {
    ping: () => ({ pong: true }),
    boot_demo,
    test_card_zip,
};

function transferables(result) {
    if (!result || typeof result !== 'object') return [];
    return Object.values(result)
        .filter(v => v instanceof Uint8Array)
        .map(v => v.buffer);
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
