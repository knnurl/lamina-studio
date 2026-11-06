// Starts the geometry worker from the bundle inlined in index.html (a Blob URL, so it works from
// file://) and exposes a promise-based request call.

export function start_worker() {
    const source = document.getElementById('lamina-worker-src').textContent;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const pending = new Map();
    let next_id = 1;

    worker.onmessage = event => {
        const { id, ok, result, error } = event.data;
        const request = pending.get(id);
        if (!request) return;
        pending.delete(id);
        if (ok) request.resolve(result);
        else request.reject(new Error(error));
    };
    worker.onerror = event => {
        const err = new Error(event.message || 'geometry worker failed');
        for (const request of pending.values()) request.reject(err);
        pending.clear();
    };

    return {
        call(type, payload) {
            const id = next_id++;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                worker.postMessage({ id, type, payload });
            });
        },
    };
}
