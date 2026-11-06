// Lamina Studio entry: builds the shell, starts the geometry worker and the 3D preview, then hands
// over to the app controller.
import { build_shell, set_status, show_stage_message } from './ui/shell.js';
import { init_theme } from './ui/theme.js';
import { start_worker } from './worker/client.js';
import { StackPreview } from './preview/three_stack.js';
import { start_app } from './ui/app.js';

function boot() {
    build_shell();
    init_theme(document.getElementById('theme-toggle'));
    set_status('busy', 'Starting the geometry worker');
    const worker = start_worker();

    let preview;
    try {
        preview = new StackPreview(document.getElementById('stage'));
    } catch {
        show_stage_message('The 3D preview needs WebGL, which this browser could not start.');
        preview = { show() {}, set_visible() {} };
    }
    start_app({ worker, preview, stage: document.getElementById('stage') });
}

boot();
