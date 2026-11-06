// Header tools: presets, seed stepping, Randomise, undo and redo on the left; Basic or Advanced,
// open and save on the right. Returns refresh() for state that follows the design and history.
import { kPresets } from '../core/presets.js';
import { el } from './dom.js';

function button(text, title, on_click, cls = 'tool') {
    const b = el('button', { type: 'button', class: cls, title, 'aria-label': title, text });
    b.addEventListener('click', on_click);
    return b;
}

export function build_header(app) {
    const left = document.getElementById('tools-left');
    const right = document.getElementById('tools-right');

    const presets = el('select', { class: 'tool-select', 'aria-label': 'Start from a preset' });
    presets.append(el('option', { value: '', text: 'Presets' }));
    for (const p of kPresets) presets.append(el('option', { value: p.id, text: p.name }));
    presets.addEventListener('change', () => {
        if (presets.value) app.load_preset(presets.value);
        presets.value = '';
    });

    const seed = el('input', { type: 'number', class: 'seed', min: 0, step: 1, 'aria-label': 'Seed' });
    seed.addEventListener('change', () => app.set_seed(Math.max(0, Math.round(Number(seed.value) || 0))));
    const prev = button('←', 'Previous seed', () => app.set_seed(Math.max(0, app.design.seed - 1)));
    const next = button('→', 'Next seed', () => app.set_seed(app.design.seed + 1));
    const randomise = button(
        'Randomise',
        'New pattern from a random seed. Locked values and kept layers stay.',
        () => app.set_seed(Math.floor(Math.random() * 1e6)),
        'btn',
    );
    const undo = button('↶', 'Undo (Ctrl+Z)', () => app.undo());
    const redo = button('↷', 'Redo (Ctrl+Shift+Z)', () => app.redo());
    left.append(presets, el('div', { class: 'seed-group' }, [prev, seed, next]), randomise, undo, redo);

    const basic = button('Basic', 'Show the main controls', () => app.set_tier('basic'), 'seg-btn');
    const advanced = button('Advanced', 'Show every control', () => app.set_tier('advanced'), 'seg-btn');
    const file = el('input', { type: 'file', accept: '.json,application/json', hidden: '' });
    file.addEventListener('change', () => {
        if (file.files[0]) app.open(file.files[0]);
        file.value = '';
    });
    right.append(
        el('div', { class: 'seg', role: 'group', 'aria-label': 'Detail' }, [basic, advanced]),
        button('Open', 'Open a saved design (.lamina.json)', () => file.click()),
        button('Save', 'Save this design as .lamina.json', () => app.save()),
        file,
    );

    return {
        refresh() {
            if (document.activeElement !== seed) seed.value = app.design.seed;
            undo.disabled = !app.store.can_undo();
            redo.disabled = !app.store.can_redo();
            basic.setAttribute('aria-pressed', String(app.ui.tier === 'basic'));
            advanced.setAttribute('aria-pressed', String(app.ui.tier === 'advanced'));
        },
    };
}
