// Controls generated from registry entries (SPEC 11). A control owns its DOM and exposes
// refresh(value) so panels can update values in place without rebuilding (which would drop focus
// mid-drag). Changes are reported through on_change(value, { coalesce }): slider drags coalesce
// into one undo step.
import { el } from './dom.js';

let next_uid = 1;

function format_number(value, step) {
    const decimals = step >= 1 ? 0 : Math.min(3, String(step).split('.')[1]?.length ?? 1);
    return Number(value).toFixed(decimals);
}

// spec: { label, type, min, max, step, unit, options, desc, lockable }
// state: { locked: () => bool, toggle_lock: () => void } for lockable controls
export function make_control(spec, on_change, state = {}) {
    const uid = `ctl-${next_uid++}`;
    const row = el('div', { class: `ctl ctl-${spec.type}` });
    const head = el('div', { class: 'ctl-head' });
    const label = el('label', { for: uid, text: spec.label });
    head.append(label);
    row.append(head);
    if (spec.desc) row.title = spec.desc;

    let refresh;
    switch (spec.type) {
        case 'range': {
            const slider = el('input', { id: uid, type: 'range', min: spec.min, max: spec.max, step: spec.step });
            const number = el('input', {
                type: 'number',
                class: 'ctl-num',
                min: spec.min,
                max: spec.max,
                step: spec.step,
                'aria-label': `${spec.label} value`,
            });
            const unit = el('span', { class: 'ctl-unit', text: spec.unit || '' });
            head.append(number, unit);
            if (spec.lockable) {
                const lock = el('button', { type: 'button', class: 'lock', 'aria-label': `Lock ${spec.label}` });
                const paint = () => {
                    const on = state.locked();
                    lock.setAttribute('aria-pressed', String(on));
                    lock.textContent = on ? '\u{1F512}' : '\u{1F513}';
                    lock.title = on ? 'Locked: Randomise keeps this value' : 'Unlocked: Randomise may change this';
                };
                lock.addEventListener('click', () => {
                    state.toggle_lock();
                    paint();
                });
                paint();
                head.append(lock);
            }
            row.append(slider);
            const clamp = v => Math.min(spec.max, Math.max(spec.min, v));
            slider.addEventListener('input', () => {
                number.value = format_number(slider.value, spec.step);
                on_change(Number(slider.value), { coalesce: true });
            });
            number.addEventListener('change', () => {
                const v = clamp(Number(number.value));
                if (!Number.isFinite(v)) return;
                slider.value = v;
                number.value = format_number(v, spec.step);
                on_change(v, { coalesce: false });
            });
            refresh = value => {
                if (document.activeElement !== slider) slider.value = value;
                if (document.activeElement !== number) number.value = format_number(value, spec.step);
            };
            break;
        }
        case 'select': {
            const select = el('select', { id: uid });
            for (const [value, text] of spec.options) select.append(el('option', { value, text }));
            head.after(select);
            select.addEventListener('change', () => on_change(select.value, { coalesce: false }));
            refresh = value => {
                select.value = value;
            };
            break;
        }
        case 'colour': {
            const input = el('input', { id: uid, type: 'color' });
            head.append(input);
            input.addEventListener('input', () => on_change(input.value, { coalesce: true }));
            refresh = value => {
                if (document.activeElement !== input) input.value = value;
            };
            break;
        }
        case 'toggle': {
            const input = el('input', { id: uid, type: 'checkbox' });
            head.prepend(input);
            input.addEventListener('change', () => on_change(input.checked, { coalesce: false }));
            refresh = value => {
                input.checked = Boolean(value);
            };
            break;
        }
        default:
            throw new Error(`unknown control type "${spec.type}"`);
    }
    return { el: row, refresh };
}
