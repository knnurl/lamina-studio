// Top bar actions (SPEC 11): the assistant, undo and redo, New (the start screen), Open and
// Save. Presets and Randomise live on the start screen and in the Pattern step. Returns
// refresh() for state that follows the history.
import { el } from './dom.js';

function button(text, title, on_click, cls = 'tool') {
    const b = el('button', { type: 'button', class: cls, title, 'aria-label': title, text });
    b.addEventListener('click', on_click);
    return b;
}

export function build_header(app) {
    const right = document.getElementById('tools-right');
    const undo = button('↶', 'Undo (Ctrl+Z)', () => app.undo());
    const redo = button('↷', 'Redo (Ctrl+Shift+Z)', () => app.redo());
    const file = el('input', { type: 'file', accept: '.json,application/json', hidden: '' });
    file.addEventListener('change', () => {
        if (file.files[0]) app.open(file.files[0]);
        file.value = '';
    });
    const assistant = button('✦ Assistant', 'Design and edit by conversation (your own Claude key)', () => app.toggle_assistant(), 'btn ghost assistant-toggle');
    right.append(
        assistant,
        undo,
        redo,
        button('New', 'Start a new piece from a preset or a blank outline', () => app.show_start()),
        button('Open', 'Open a saved design (.lamina.json)', () => file.click()),
        button('Save', 'Save this design as .lamina.json', () => app.save()),
        file,
    );
    return {
        refresh() {
            assistant.setAttribute('aria-pressed', String(!!app.assistant_open));
            undo.disabled = !app.store.can_undo();
            redo.disabled = !app.store.can_redo();
        },
        open_file: () => file.click(),
    };
}
