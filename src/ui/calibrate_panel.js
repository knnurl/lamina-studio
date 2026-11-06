// Calibrate form (SPEC 9.4): enter what the cut test card measured, see the physical limits it
// implies, and save them as a measured material. Measurements are not design parameters, so this
// is a plain form, not registry controls.
import { kLadders, calibrate, measured_material } from '../core/calibrate.js';
import { kMaterials, material_of } from '../core/design.js';
import { el } from './dom.js';

function field(label, input) {
    return el('label', { class: 'cal-field' }, [el('span', { text: label }), input]);
}

function select(values, format, initial) {
    const s = el('select');
    for (const v of values) s.append(el('option', { value: String(v), text: format(v) }));
    s.value = String(initial);
    return s;
}

export function build_calibrate_panel(container, app) {
    const ids = Object.keys({ ...kMaterials, ...app.design.materials });
    const material = select(ids, id => material_of(app.design, { material: id }).label, app.design.layers[0].material);
    const p = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'e.g. 19.82' });
    const h = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'e.g. 20.18' });
    const web = select(kLadders.webs_mm, v => `${Math.round(v * 10)} (${v} mm)`, 1.5);
    const bridge = select(kLadders.bridges_mm, v => `${Math.round(v * 10)} (${v} mm)`, 1.2);
    const hole = select(kLadders.holes_mm, v => `${Math.round(v * 10)} (${v} mm)`, 1.0);
    const dowel = select(kLadders.dowel_holes_mm, v => `${Math.round(v * 100)} (${v.toFixed(2)} mm)`, 3.1);
    const notch = select(kLadders.clearances_mm, v => (v ? `+${Math.round(v * 100)}` : '0') + ` (${v.toFixed(2)} mm)`, 0.1);
    const score = select(Array.from({ length: kLadders.ramp_count }, (_, i) => i + 1), v => `Line ${v}`, 2);
    const out = el('div', { class: 'cal-result', 'aria-live': 'polite' });
    const save = el('button', { type: 'button', class: 'btn', text: 'Save measured material' });

    const inputs = () => ({
        p_mm: p.value,
        h_mm: h.value,
        web_mm: web.value,
        bridge_mm: bridge.value,
        hole_mm: hole.value,
        dowel_hole_mm: dowel.value,
        notch_mm: notch.value,
        score_line: score.value,
    });

    function update() {
        const r = calibrate(inputs());
        out.textContent = '';
        if (r.problems.length) {
            for (const problem of r.problems) out.append(el('p', { class: 'cal-problem', text: problem }));
        } else {
            const rows = [
                ['Kerf', `${r.kerf_mm} mm`],
                ['Scale check', `${r.scale_mm.toFixed(2)} mm, good`],
                ['Minimum web', `${r.min_web_mm} mm`],
                ['Minimum bridge', `${r.min_bridge_mm} mm`],
                ['Minimum hole', `${r.min_hole_mm} mm`],
                ['Dowel clearance', `${r.dowel_clearance_mm} mm (hole ${(kLadders.dowel_mm + r.dowel_clearance_mm).toFixed(2)} mm for 3 mm dowels)`],
                ['Fit clearance', `${r.fit_clearance_mm} mm`],
            ];
            out.append(el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
        }
        save.disabled = !r.ok;
    }

    for (const input of [p, h]) input.addEventListener('input', update);
    for (const s of [material, web, bridge, hole, dowel, notch, score]) s.addEventListener('change', update);
    save.addEventListener('click', () => {
        const r = calibrate(inputs());
        if (!r.ok) return;
        const base = material_of(app.design, { material: material.value });
        app.save_measured_material(material.value, measured_material(base, r, inputs()));
    });

    container.append(
        el('h3', { class: 'sub', text: 'Enter the measurements' }),
        el('div', { class: 'cal-grid' }, [
            field('Material cut', material),
            field('P: the 20 mm piece (mm)', p),
            field('H: its hole (mm)', h),
            field('Thinnest web that survived', web),
            field('Thinnest bridge that held', bridge),
            field('Smallest clean hole', hole),
            field('Dowel hole that fits', dowel),
            field('Notch the key fits', notch),
            field('Score line that marks cleanly', score),
        ]),
        out,
        save,
    );
    update();
}
