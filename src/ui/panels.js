// The step panel (SPEC 11): one step at a time, generated from the registry. Each step shows its
// essential controls; entries marked advanced sit in a "More options" fold at the end, and motif
// cards fold their own advanced parameters. The panel rebuilds only when its structure changes
// (step, layer, motif list, folds); otherwise controls refresh in place, so a slider keeps focus
// while it is dragged.
import { SCHEMA, kMotifTypes, kMotifParams } from '../core/schema.js';
import { kCurveTypes } from '../sources/curves.js';
import { options_for, read_param } from '../core/actions.js';
import { make_control } from './controls.js';
import { el } from './dom.js';
import { panel_parts } from './shell.js';

// Registry panels shown in each step, with the sub-heading over each group.
const kGroups = {
    piece: [{ panel: 'piece' }],
    pattern: [{ panel: 'pattern' }],
    look: [
        { panel: 'material', heading: () => 'Every layer' },
        { panel: 'layers', heading: k => `Layer ${k + 1}` },
        { panel: 'light', heading: () => 'Light' },
    ],
    structure: [
        { panel: 'structure', scope: 'layer', heading: k => `Layer ${k + 1}` },
        { panel: 'structure', scope: 'design', heading: () => 'Dowels and spacers' },
    ],
    make: [{ panel: 'make' }],
};

const shown_if = (entry, design, layer) => !entry.show_if || entry.show_if(design, layer);

export class Panels {
    // app: { design, ui: { step, layer, locks, more }, set_param, set_motif_param, add_motif,
    //        remove_motif, convert_motif, set_layer_locked, set_seed, randomise, toggle_more }
    // extras: { [step]: (container) => void } fills fixed content after a step's controls.
    constructor(app, extras = {}) {
        this.app_ = app;
        this.extras_ = extras;
        this.sig_ = null;
        this.refreshers_ = [];
    }

    signature_() {
        const d = this.app_.design;
        const { step, layer: k, more } = this.app_.ui;
        const layer = d.layers[k];
        const panels = kGroups[step].map(g => g.panel);
        const shown = SCHEMA.filter(e => panels.includes(e.panel) && shown_if(e, d, layer)).map(e => e.id);
        const parts = [step, k, d.layers.length, shown.join(','), [...more].sort().join(',')];
        if (step === 'pattern') parts.push(layer.source.kind, (layer.source.motifs ?? []).map(m => m.type).join(','));
        if (step === 'make') parts.push(Object.keys(d.materials ?? {}).join(','));
        return parts.join('|');
    }

    render() {
        const sig = this.signature_();
        if (sig === this.sig_) {
            for (const refresh of this.refreshers_) refresh();
            return;
        }
        this.sig_ = sig;
        const body = panel_parts().body;
        const keep_scroll = body.scrollTop;
        body.textContent = '';
        this.refreshers_ = [];
        const app = this.app_;
        const d = app.design;
        const { step, layer: k } = app.ui;
        const advanced = [];

        if (step === 'pattern') this.seed_row_(body);
        for (const group of kGroups[step]) {
            const entries = SCHEMA.filter(e => e.panel === group.panel && (!group.scope || e.scope === group.scope) && shown_if(e, d, d.layers[k]));
            const basic = entries.filter(e => e.tier !== 'advanced');
            advanced.push(...entries.filter(e => e.tier === 'advanced'));
            if (!basic.length) continue;
            if (group.heading) body.append(el('h3', { class: 'sub', text: group.heading(k) }));
            for (const entry of basic) body.append(this.control_(entry));
        }
        if (step === 'pattern') this.motif_editor_(body);
        if (this.extras_[step]) this.extras_[step](body);
        if (advanced.length) {
            const box = this.fold_(body, step, 'More options', 'Fewer options');
            for (const entry of advanced) box?.append(this.control_(entry));
        }
        body.scrollTop = keep_scroll;
    }

    control_(entry) {
        const app = this.app_;
        const spec = entry.type === 'select' ? { ...entry, options: options_for(entry, app.design) } : entry;
        const state = entry.lockable ? { locked: () => app.ui.locks.has(entry.id), toggle_lock: () => app.toggle_lock(entry.id) } : {};
        const control = make_control(spec, (value, { coalesce }) => app.set_param(entry, value, coalesce), state);
        const refresh = () => control.refresh(read_param(entry, app.design, app.ui.layer));
        refresh();
        this.refreshers_.push(refresh);
        return control.el;
    }

    // A fold toggled by key (kept in ui.more); returns its content box when open, else null.
    fold_(parent, key, open_text, close_text) {
        const open = this.app_.ui.more.has(key);
        const toggle = el('button', { type: 'button', class: 'more-toggle', 'aria-expanded': String(open), text: open ? close_text : open_text });
        toggle.addEventListener('click', () => this.app_.toggle_more(key));
        parent.append(toggle);
        if (!open) return null;
        const box = el('div', { class: 'more' });
        parent.append(box);
        return box;
    }

    // Randomise and the seed, at the top of the Pattern step.
    seed_row_(body) {
        const app = this.app_;
        const seed = el('input', { type: 'number', class: 'seed', min: 0, step: 1, 'aria-label': 'Seed' });
        seed.addEventListener('change', () => app.set_seed(Math.max(0, Math.round(Number(seed.value) || 0))));
        const step_button = (text, title, delta) => {
            const b = el('button', { type: 'button', class: 'tool', title, 'aria-label': title, text });
            b.addEventListener('click', () => app.set_seed(Math.max(0, app.design.seed + delta)));
            return b;
        };
        const randomise = el('button', {
            type: 'button',
            class: 'btn',
            text: 'Randomise',
            title: 'A new pattern from a random seed. Tries up to 10 and keeps the first with no fatal problem. Locked values and kept layers stay.',
        });
        randomise.addEventListener('click', () => app.randomise());
        body.append(el('div', { class: 'seed-row' }, [randomise, el('div', { class: 'seed-group' }, [step_button('‹', 'Previous seed', -1), seed, step_button('›', 'Next seed', 1)])]));
        const refresh = () => {
            if (document.activeElement !== seed) seed.value = app.design.seed;
        };
        refresh();
        this.refreshers_.push(refresh);
    }

    motif_editor_(body) {
        const app = this.app_;
        const k = app.ui.layer;
        const layer = app.design.layers[k];
        body.append(el('h3', { class: 'sub', text: `Layer ${k + 1}` }));

        if (layer.source.kind === 'svg') {
            const src = layer.source;
            body.append(el('p', { class: 'step-note', text: `Imported artwork: ${src.name}, ${src.paths.length} contours.` }));
            const rule = make_control(
                {
                    type: 'select',
                    label: 'Holes come from',
                    options: [
                        ['evenodd', 'Nesting (cut-line files)'],
                        ['nonzero', 'Direction (filled artwork)'],
                    ],
                },
                value => app.set_layer_fill_rule(value),
            );
            rule.refresh(src.fill_rule ?? 'evenodd');
            this.refreshers_.push(() => rule.refresh(app.design.layers[app.ui.layer].source.fill_rule ?? 'evenodd'));
            const remove = el('button', { type: 'button', class: 'btn ghost', text: 'Remove artwork' });
            remove.addEventListener('click', () => app.remove_artwork());
            body.append(rule.el, remove);
            return;
        }

        const keep = make_control({ type: 'toggle', label: 'Keep this layer when randomising' }, value => app.set_layer_locked(value));
        body.append(keep.el);
        this.refreshers_.push(() => keep.refresh(app.design.layers[app.ui.layer].locked));
        keep.refresh(layer.locked);

        if (!layer.source.motifs.length) body.append(el('p', { class: 'step-note', text: 'No openings: this layer is solid.' }));
        layer.source.motifs.forEach((motif, i) => {
            const card = el('div', { class: 'motif' });
            const remove = el('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove', text: '×' });
            remove.addEventListener('click', () => app.remove_motif(i));
            const head = [el('span', { text: kMotifTypes[motif.type].label })];
            if (motif.type === 'petal' || kCurveTypes.includes(motif.type)) {
                const convert = el('button', { type: 'button', class: 'btn ghost small', text: 'Edit nodes', title: 'Turn into a shape whose nodes you drag in the Layer view' });
                convert.addEventListener('click', () => app.convert_motif(i));
                head.push(convert);
            }
            card.append(el('div', { class: 'motif-head' }, [...head, remove]));
            if (motif.type === 'shape') card.append(el('p', { class: 'step-note', text: 'Drag its nodes and handles in the Layer view. Double-click the outline to add a node, a node to delete it.' }));
            if (motif.type === 'sketch') {
                card.append(el('p', { class: 'step-note', text: `${motif.strokes.length} ${motif.strokes.length === 1 ? 'stroke' : 'strokes'}, drawn in the Layer view and mirrored round the piece.` }));
                const row = el('div', { class: 'add-row' });
                for (const [text, fn] of [
                    ['Draw more', () => app.start_drawing()],
                    ['Smooth', () => app.smooth_sketch()],
                    ['Clean up with AI', () => app.cleanup_sketch()],
                ]) {
                    const b = el('button', { type: 'button', class: 'btn ghost small', text });
                    b.addEventListener('click', fn);
                    row.append(b);
                }
                card.append(row);
            }
            const params = kMotifTypes[motif.type].params;
            const add = key => {
                const p = kMotifParams[key];
                const control = make_control({ ...p, type: p.type ?? 'range' }, (value, { coalesce }) => app.set_motif_param(i, key, value, coalesce));
                const refresh = () => control.refresh(app.design.layers[app.ui.layer].source.motifs[i]?.[key] ?? 0);
                refresh();
                this.refreshers_.push(refresh);
                return control.el;
            };
            for (const key of params.filter(key => kMotifParams[key].tier !== 'advanced')) card.append(add(key));
            const extra = params.filter(key => kMotifParams[key].tier === 'advanced');
            if (extra.length) {
                const box = this.fold_(card, `motif:${i}`, 'More', 'Less');
                for (const key of extra) box?.append(add(key));
            }
            body.append(card);
        });

        const type = el('select', { 'aria-label': 'Opening type' });
        // Artwork arrives from SVG (the assistant, or logo import in M5), not from an empty card.
        for (const [id, t] of Object.entries(kMotifTypes)) if (id !== 'art' && id !== 'sketch') type.append(el('option', { value: id, text: t.label }));
        const add = el('button', { type: 'button', class: 'btn ghost', text: 'Add openings' });
        add.addEventListener('click', () => app.add_motif(type.value));
        body.append(el('div', { class: 'add-row' }, [type, add]));
        const draw = el('button', { type: 'button', class: 'btn ghost', text: 'Draw on this layer' });
        draw.addEventListener('click', () => app.start_drawing());
        body.append(draw);
    }
}
