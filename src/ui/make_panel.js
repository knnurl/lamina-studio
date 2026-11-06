// Make step (SPEC 11). M1 starts with the calibration test card; sheets, checks and export follow.
import { el, save_bytes } from './dom.js';
import { step_body, set_status } from './shell.js';

export function build_make_panel(worker) {
    const body = step_body('make');
    body.textContent = '';
    body.closest('details').open = true;
    const button = el('button', { class: 'btn', type: 'button', text: 'Download calibration test card' });
    body.append(
        el('p', {
            class: 'step-note',
            text:
                'Cut this first on a new laser or material. It measures kerf, import scale, minimum ' +
                'web, bridge, hole, dowel fit and fit clearance. Instructions are in the zip.',
        }),
        button,
    );
    button.addEventListener('click', async () => {
        button.disabled = true;
        set_status('busy', 'Building the test card');
        try {
            const { name, bytes } = await worker.call('test_card_zip');
            save_bytes(name, bytes, 'application/zip');
            set_status('ok', `Saved ${name}: SVG, DXF and instructions.`);
        } catch (err) {
            set_status('bad', `Test card failed: ${err.message}`);
        } finally {
            button.disabled = false;
        }
    });
}
