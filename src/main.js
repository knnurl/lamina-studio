// Lamina Studio entry: builds the shell, starts the geometry worker and shows the M0 boot stack,
// which proves the worker, Clipper2 and the three.js preview work together from a single file.
import { build_shell, set_status, show_stage_message } from './ui/shell.js';
import { init_theme } from './ui/theme.js';
import { start_worker } from './worker/client.js';
import { StackPreview } from './preview/three_stack.js';

async function boot() {
    build_shell();
    init_theme(document.getElementById('theme-toggle'));
    set_status('busy', 'Starting the geometry worker');

    let preview;
    try {
        preview = new StackPreview(document.getElementById('stage'));
    } catch (err) {
        show_stage_message('The 3D preview needs WebGL, which this browser could not start.');
        set_status('bad', `3D preview unavailable: ${err.message}`);
        return;
    }

    try {
        const worker = start_worker();
        const t0 = performance.now();
        const demo = await worker.call('boot_demo', { layers: 6, radius_mm: 150 });
        const t1 = performance.now();
        preview.set_layers(demo.layers);
        const t2 = performance.now();
        set_status(
            'ok',
            `Engine ready: ${demo.layers.length} demo layers. Worker start and geometry ` +
                `${(t1 - t0).toFixed(0)} ms, preview ${(t2 - t1).toFixed(0)} ms.`,
        );
    } catch (err) {
        set_status('bad', `Geometry worker failed: ${err.message}`);
    }
}

boot();
