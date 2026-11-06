// Builds the static shell: the design steps in the sidebar, the view tabs and the status bar.
// The steps follow SPEC 11 in decision order. Their controls arrive in M1 from the SCHEMA registry.
import { el } from './dom.js';

const kSteps = [
    { id: 'piece', title: 'Piece', hint: 'Outline, size and number of layers' },
    { id: 'material', title: 'Material and colour', hint: 'Sheet, thickness and finish per layer' },
    { id: 'layers', title: 'Layers', hint: 'Stack order, gaps and what each layer shows' },
    { id: 'pattern', title: 'Pattern', hint: 'Generators, symmetry and imported artwork' },
    { id: 'structure', title: 'Structure', hint: 'Islands, bridges, dowels and spacers' },
    { id: 'light', title: 'Light', hint: 'Unlit or backlit' },
    { id: 'make', title: 'Make', hint: 'Sheets, checks and export' },
];

const kTabs = [
    { id: '3d', label: '3D', ready: true },
    { id: '2d', label: '2D', ready: true },
    { id: 'layer', label: 'Layer', ready: true },
    { id: 'sheets', label: 'Sheets', ready: true },
];

// The body element of a design step, for panels to fill.
export function step_body(id) {
    return document.querySelector(`.step[data-step="${id}"] .step-body`);
}

export function build_shell() {
    const side = document.getElementById('side');
    kSteps.forEach((step, i) => {
        const details = el('details', { class: 'step', 'data-step': step.id });
        if (i === 0) details.open = true;
        details.append(
            el('summary', {}, [
                el('span', { class: 'step-num', text: String(i + 1).padStart(2, '0') }),
                el('span', { class: 'step-title', text: step.title }),
                el('span', { class: 'step-hint', text: step.hint }),
            ]),
            el('div', { class: 'step-body', text: 'Controls arrive in M1.' }),
        );
        side.append(details);
    });

    const tabs = document.getElementById('tabs');
    for (const tab of kTabs) {
        const button = el('button', {
            class: 'tab',
            type: 'button',
            role: 'tab',
            'aria-selected': String(tab.id === '3d'),
            'data-view': tab.id,
            text: tab.label,
        });
        if (!tab.ready) {
            button.disabled = true;
            button.title = 'Arrives in M1';
        }
        tabs.append(button);
    }
}

export function set_status(level, text) {
    document.getElementById('status-light').dataset.level = level;
    document.getElementById('status-text').textContent = text;
}

export function show_stage_message(text) {
    const stage = document.getElementById('stage');
    stage.append(el('div', { class: 'stage-msg', text }));
}
