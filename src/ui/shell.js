// The static shell (SPEC 11): the step bar in the top bar, one step panel with Back and Next, the
// view tabs, the layer strip under the preview, and the status bar. Five steps in decision order;
// each opens the view it needs. Panels fill the step panel from the SCHEMA registry.
import { el } from './dom.js';

export const kSteps = [
    { id: 'piece', title: 'Piece', view: '3d', guide: 'Choose the outline, its size, how many layers it has and its symmetry.' },
    { id: 'pattern', title: 'Pattern', view: '3d', guide: 'Pick a style and roll variations, then shape the chosen layer. Pick layers in the strip under the preview.' },
    { id: 'look', title: 'Look', view: '3d', guide: 'Material, colour and spacing for each layer, and how the piece is lit.' },
    { id: 'structure', title: 'Structure', view: 'layer', guide: 'Bridges hold loose parts, dowels line the layers up, spacers set the gaps. The Layer view shows them.' },
    { id: 'make', title: 'Make', view: 'sheets', guide: 'Check, then download the cut files. The Sheets view shows what goes on the laser.' },
];

const kTabs = [
    { id: '3d', label: '3D' },
    { id: '2d', label: '2D' },
    { id: 'layer', label: 'Layer' },
    { id: 'sheets', label: 'Sheets' },
];

// The parts of the step panel, for panels and the app to fill and wire.
export function panel_parts() {
    const q = id => document.getElementById(id);
    return { kicker: q('panel-kicker'), title: q('panel-title'), guide: q('panel-guide'), body: q('panel-body'), back: q('panel-back'), next: q('panel-next') };
}

export function build_shell() {
    const bar = document.getElementById('steps');
    kSteps.forEach((step, i) => {
        if (i) bar.append(el('span', { class: 'step-chev', 'aria-hidden': 'true', text: '›' }));
        const button = el('button', { type: 'button', class: 'step-btn', 'data-step-go': step.id, title: step.guide }, [
            el('span', { class: 'step-dot', text: String(i + 1) }),
            el('span', { class: 'step-name', text: step.title }),
        ]);
        bar.append(button);
    });

    const tabs = document.getElementById('tabs');
    for (const tab of kTabs) {
        tabs.append(el('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(tab.id === '3d'), 'data-view': tab.id, text: tab.label }));
    }
}

// Marks the current step in the bar (earlier steps show a tick) and fills the panel heading.
export function show_step(id) {
    const i = kSteps.findIndex(s => s.id === id);
    document.querySelectorAll('.step-btn').forEach((b, j) => {
        b.classList.toggle('done', j < i);
        if (j === i) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
        b.querySelector('.step-dot').textContent = j < i ? '✓' : String(j + 1);
    });
    const parts = panel_parts();
    const step = kSteps[i];
    parts.kicker.textContent = `Step ${i + 1} of ${kSteps.length}`;
    parts.title.textContent = step.title;
    parts.guide.textContent = step.guide;
    parts.back.disabled = i === 0;
    parts.next.disabled = i === kSteps.length - 1;
    parts.next.textContent = i < kSteps.length - 1 ? `Next: ${kSteps[i + 1].title} ›` : 'Last step';
}

export function set_status(level, text) {
    document.getElementById('status-light').dataset.level = level;
    document.getElementById('status-text').textContent = text;
}

export function show_stage_message(text) {
    const stage = document.getElementById('stage');
    stage.append(el('div', { class: 'stage-msg', text }));
}
