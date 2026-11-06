// Fixed content of the Make step, after its registry controls (SPEC 11): export, the check report,
// then the calibration test card.
import { el, save_bytes } from './dom.js';
import { set_status } from './shell.js';

export function build_make_extras(worker, checks_view, on_export) {
    return container => {
        const export_button = el('button', { class: 'btn', type: 'button', text: 'Export cut files' });
        export_button.addEventListener('click', async () => {
            export_button.disabled = true;
            try {
                await on_export();
            } finally {
                export_button.disabled = false;
            }
        });
        container.append(
            el('p', {
                class: 'step-note',
                text:
                    'A zip of SVG and DXF for every sheet, layer and part (kerf applied), the assembly ' +
                    'sheet, the check report and the design file.',
            }),
            export_button,
            el('h3', { class: 'sub', text: 'Checks' }),
        );
        checks_view.attach(container);

        const button = el('button', { class: 'btn ghost', type: 'button', text: 'Download calibration test card' });
        container.append(
            el('h3', { class: 'sub', text: 'Calibration' }),
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
    };
}
