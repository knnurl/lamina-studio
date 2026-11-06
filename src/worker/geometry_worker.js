// Geometry worker entry (SPEC 13.3). All geometry runs here; the UI thread renders and edits only.
// Protocol: request {id, type, payload}, reply {id, ok, result} or {id, ok: false, error}.
import { boot_demo } from '../dev/boot_demo.js';

const kHandlers = {
    ping: () => ({ pong: true }),
    boot_demo,
};

self.onmessage = event => {
    const { id, type, payload } = event.data;
    try {
        const handler = kHandlers[type];
        if (!handler) throw new Error(`unknown request "${type}"`);
        self.postMessage({ id, ok: true, result: handler(payload) });
    } catch (err) {
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
};
