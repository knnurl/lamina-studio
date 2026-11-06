// The check report in the Make step (SPEC 7): one row per finding, worst first. "Show" opens the
// layer in the Layer view; a fatal finding can be allowed through, which is recorded in the design
// and printed on the assembly sheet.
import { el } from './dom.js';

const kOrder = { fatal: 0, warn: 1, info: 2 };

export function make_checks_view(app) {
    const root = el('div', { class: 'checks', 'aria-live': 'polite' });
    let latest = { results: [], pending: true };

    function render() {
        root.textContent = '';
        const { results, pending } = latest;
        if (pending && !results.length) {
            root.append(el('p', { class: 'step-note', text: 'Checking...' }));
            return;
        }
        if (!results.length) {
            root.append(el('p', { class: 'step-note ok', text: 'All checks pass.' }));
            return;
        }
        const sorted = [...results].sort((a, b) => kOrder[a.severity] - kOrder[b.severity] || a.layer - b.layer);
        for (const r of sorted) {
            const level = r.severity === 'fatal' && !r.overridden ? 'bad' : 'warn';
            const row = el('div', { class: 'check-row' }, [
                el('span', { class: 'light', 'data-level': level }),
                el('span', { class: 'check-msg', text: `${r.id}  ${r.message}${r.overridden ? ' (allowed)' : ''}` }),
            ]);
            const actions = el('div', { class: 'check-actions' });
            const show = el('button', { type: 'button', class: 'tool small', text: 'Show' });
            show.addEventListener('click', () => app.show_layer(r.layer));
            actions.append(show);
            if (r.severity === 'fatal') {
                const allow = el('button', {
                    type: 'button',
                    class: 'tool small',
                    text: r.overridden ? 'Block' : 'Allow',
                    title: r.overridden ? 'Block export again' : 'Export anyway; recorded on the assembly sheet',
                });
                allow.addEventListener('click', () => app.toggle_override(r.key));
                actions.append(allow);
            }
            row.append(actions);
            root.append(row);
        }
    }

    render();
    return {
        el: root,
        update(results, pending = false) {
            latest = { results, pending };
            render();
        },
        // Panels rebuild their content, so the report re-attaches to the new container.
        attach(container) {
            container.append(root);
        },
    };
}
