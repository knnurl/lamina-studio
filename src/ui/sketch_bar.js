// Sketch bar (SPEC M4.5): drawing tools over the Layer view. Strokes land on the chosen layer and
// mirror round the piece by its symmetry. Smooth tidies them; Clean up hands them to the assistant.
import { el } from './dom.js';

const kTools = [
    ['select', 'Select', 'Edit and pan, as usual'],
    ['pen', 'Pen', 'Draw freehand; end near the start to close the shape'],
    ['line', 'Line', 'Click points; double-click or Enter to finish, click the first point to close'],
    ['circle', 'Circle', 'Drag from the centre'],
    ['rect', 'Rectangle', 'Drag corner to corner'],
    ['erase', 'Erase', 'Click a stroke to remove it'],
];

export class SketchBar {
    // actions: { tool(t), width(mm), filled(on), smooth(), cleanup() }
    constructor(container, actions) {
        this.root_ = el('div', { class: 'sketch-bar', hidden: '', role: 'toolbar', 'aria-label': 'Sketch tools' });
        this.buttons_ = kTools.map(([id, label, title]) => {
            const b = el('button', { type: 'button', class: 'tool small', text: label, title, 'aria-pressed': String(id === 'select') });
            b.addEventListener('click', () => {
                this.set_tool(id);
                actions.tool(id);
            });
            return [id, b];
        });
        const width = el('input', { type: 'number', class: 'ctl-num', min: 0.5, max: 20, step: 0.5, value: 3, 'aria-label': 'Stroke width in mm' });
        width.addEventListener('change', () => actions.width(Math.min(20, Math.max(0.5, Number(width.value) || 3))));
        const filled = el('input', { type: 'checkbox', checked: '' });
        filled.addEventListener('change', () => actions.filled(filled.checked));
        const smooth = el('button', { type: 'button', class: 'tool small', text: 'Smooth', title: 'Round off the strokes on this layer' });
        smooth.addEventListener('click', () => actions.smooth());
        const cleanup = el('button', { type: 'button', class: 'btn small', text: 'Clean up with AI', title: 'The assistant turns the sketch into clean shapes' });
        cleanup.addEventListener('click', () => actions.cleanup());
        this.root_.append(
            ...this.buttons_.map(([, b]) => b),
            el('span', { class: 'sketch-sep' }),
            el('label', { class: 'sketch-field' }, [el('span', { text: 'Width' }), width, el('span', { text: 'mm' })]),
            el('label', { class: 'sketch-field' }, [filled, el('span', { text: 'Fill closed shapes' })]),
            el('span', { class: 'sketch-sep' }),
            smooth,
            cleanup,
        );
        container.append(this.root_);
    }

    set_tool(id) {
        for (const [t, b] of this.buttons_) b.setAttribute('aria-pressed', String(t === id));
    }

    set_visible(on) {
        this.root_.hidden = !on;
    }
}
