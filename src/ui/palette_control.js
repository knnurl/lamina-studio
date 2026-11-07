// Palette picker for the Look step (SPEC 11): a swatch for every palette, front colour on the
// left, then the current palette's colours, front to back, to change, add to, take from or
// reverse. Any such change makes the design's own palette, "Custom", saved with the design.
// refresh() updates in place, so a colour being picked keeps its focus.
import { kPalettes, palette_stops, kMinStops, kMaxStops } from '../core/design.js';
import { el } from './dom.js';

const gradient = stops => `linear-gradient(90deg, ${stops.join(', ')})`;

// app: { design, set_palette_stops(colours, coalesce_key) }; pick(id) chooses a palette by name.
export function make_palette_control(app, pick) {
    const grid = el('div', { class: 'palette-grid', role: 'radiogroup', 'aria-label': 'Palette' });
    const stops_box = el('div', { class: 'palette-stops' });
    const tool = (text, title) => el('button', { type: 'button', class: 'tool small', text, title, 'aria-label': title });
    const add = tool('+', 'Add a colour at the back');
    const remove = tool('−', 'Take away the back colour');
    const reverse = tool('Reverse', 'Swap the colours front to back');
    const row = el('div', { class: 'ctl ctl-palette' }, [
        el('div', { class: 'ctl-head' }, [el('span', { class: 'ctl-title', text: 'Palette' })]),
        grid,
        el('div', { class: 'ctl-head' }, [el('span', { class: 'ctl-title', text: 'Colours, front to back' })]),
        el('div', { class: 'palette-edit' }, [stops_box, add, remove, reverse]),
    ]);

    const stops = () => palette_stops(app.design);
    add.addEventListener('click', () => app.set_palette_stops([...stops(), stops().at(-1)]));
    remove.addEventListener('click', () => app.set_palette_stops(stops().slice(0, -1)));
    reverse.addEventListener('click', () => app.set_palette_stops([...stops()].reverse()));

    function swatch(id, label, colours) {
        const bar = el('span', { class: 'swatch-bar' });
        bar.style.background = gradient(colours);
        const b = el('button', { type: 'button', class: 'swatch', role: 'radio', title: label, 'data-id': id }, [bar, el('span', { class: 'swatch-name', text: label })]);
        b.addEventListener('click', () => pick(id));
        return b;
    }

    let has_custom = null;
    let custom_bar = null;
    let inputs = [];
    function refresh() {
        const d = app.design;
        if (!!d.palette_custom !== has_custom) {
            has_custom = !!d.palette_custom;
            grid.textContent = '';
            for (const [id, p] of Object.entries(kPalettes)) grid.append(swatch(id, p.label, p.stops));
            if (has_custom) {
                const b = swatch('custom', 'Custom', d.palette_custom);
                custom_bar = b.firstChild;
                grid.append(b);
            }
        }
        if (has_custom) custom_bar.style.background = gradient(d.palette_custom);
        for (const b of grid.children) b.setAttribute('aria-checked', String(b.dataset.id === d.palette));

        const colours = stops();
        if (inputs.length !== colours.length) {
            stops_box.textContent = '';
            inputs = colours.map((_, i) => {
                const input = el('input', { type: 'color', 'aria-label': `Palette colour ${i + 1}` });
                input.addEventListener('input', () => {
                    const next = [...stops()];
                    next[i] = input.value;
                    app.set_palette_stops(next, `palette_custom.${i}`);
                });
                stops_box.append(input);
                return input;
            });
        }
        inputs.forEach((input, i) => {
            if (document.activeElement !== input) input.value = colours[i];
        });
        add.disabled = colours.length >= kMaxStops;
        remove.disabled = colours.length <= kMinStops;
    }

    return { el: row, refresh };
}
