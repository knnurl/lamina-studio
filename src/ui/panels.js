// Sidebar step panels, generated from the registry (SPEC 11). Each step rebuilds only when its
// structure changes (layer count, selected layer, motif list, Basic or Advanced); otherwise its
// controls refresh in place, so a slider keeps focus while it is dragged.
import { SCHEMA, kMotifTypes, kMotifParams } from '../core/schema.js';
import { options_for, read_param } from '../core/actions.js';
import { make_control } from './controls.js';
import { el } from './dom.js';
import { step_body } from './shell.js';

const kSteps = ['piece', 'material', 'layers', 'pattern', 'structure', 'light', 'make'];

function visible(entry, design, layer, tier) {
    if (entry.tier === 'advanced' && tier !== 'advanced') return false;
    return !entry.show_if || entry.show_if(design, layer);
}

export class Panels {
    // app: { design, ui: { layer, tier, locks }, set_param, set_motif_param, add_motif,
    //        remove_motif, set_layer_locked, select_layer }
    // extras: { make: (container) => void } fills fixed content after a step's controls.
    constructor(app, extras = {}) {
        this.app_ = app;
        this.extras_ = extras;
        this.sig_ = {};
        this.refreshers_ = {};
    }

    render() {
        for (const step of kSteps) this.render_step_(step);
    }

    signature_(step) {
        const d = this.app_.design;
        const { layer: k, tier } = this.app_.ui;
        const layer = d.layers[k];
        const shown = SCHEMA.filter(e => e.panel === step && visible(e, d, layer, tier)).map(e => e.id);
        const parts = [tier, shown.join(',')];
        if (step === 'piece') parts.push(d.piece.outline.custom ? 'custom' : '');
        if (step === 'layers') parts.push(d.layers.length, k);
        if (step === 'pattern') parts.push(k, layer.source.kind, (layer.source.motifs ?? []).map(m => m.type).join(','));
        if (step === 'structure') parts.push(k);
        return parts.join('|');
    }

    render_step_(step) {
        const sig = this.signature_(step);
        if (sig === this.sig_[step]) {
            for (const refresh of this.refreshers_[step]) refresh();
            return;
        }
        this.sig_[step] = sig;
        const body = step_body(step);
        body.textContent = '';
        const refreshers = (this.refreshers_[step] = []);
        const d = this.app_.design;
        const { layer: k, tier } = this.app_.ui;

        if (step === 'layers') {
            const strip = this.layer_strip_();
            body.append(strip.el);
            refreshers.push(strip.refresh);
        }
        const heading = { layers: `Layer ${k + 1}`, pattern: 'Symmetry', structure: `Islands on layer ${k + 1}` }[step];
        if (heading) body.append(el('h3', { class: 'sub', text: heading }));

        for (const entry of SCHEMA.filter(e => e.panel === step && visible(e, d, d.layers[k], tier))) {
            const spec = entry.type === 'select' ? { ...entry, options: options_for(entry, d) } : entry;
            const state = entry.lockable
                ? { locked: () => this.app_.ui.locks.has(entry.id), toggle_lock: () => this.app_.toggle_lock(entry.id) }
                : {};
            const control = make_control(spec, (value, { coalesce }) => this.app_.set_param(entry, value, coalesce), state);
            body.append(control.el);
            const refresh = () => control.refresh(read_param(entry, this.app_.design, this.app_.ui.layer));
            refresh();
            refreshers.push(refresh);
        }

        if (step === 'pattern') this.motif_editor_(body, refreshers);
        if (this.extras_[step]) this.extras_[step](body);
    }

    layer_strip_() {
        const d = this.app_.design;
        const strip = el('div', { class: 'layer-strip', role: 'listbox', 'aria-label': 'Layers, front first' });
        d.layers.forEach((layer, k) => {
            const chip = el('button', {
                type: 'button',
                class: 'layer-chip',
                role: 'option',
                'aria-selected': String(k === this.app_.ui.layer),
                title: `Layer ${k + 1}${k === 0 ? ' (front)' : k === d.layers.length - 1 ? ' (back)' : ''}`,
            });
            chip.append(el('span', { class: 'swatch' }), el('span', { text: String(k + 1) }));
            chip.firstChild.style.background = layer.finish.colour;
            chip.addEventListener('click', () => this.app_.select_layer(k));
            strip.append(chip);
        });
        const refresh = () => {
            [...strip.children].forEach((chip, k) => {
                chip.firstChild.style.background = this.app_.design.layers[k].finish.colour;
            });
        };
        return { el: strip, refresh };
    }

    motif_editor_(body, refreshers) {
        const app = this.app_;
        const k = app.ui.layer;
        const tier = app.ui.tier;
        const layer = app.design.layers[k];
        body.append(el('h3', { class: 'sub', text: `Pattern of layer ${k + 1}` }));

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
            refreshers.push(() => rule.refresh(app.design.layers[app.ui.layer].source.fill_rule ?? 'evenodd'));
            const remove = el('button', { type: 'button', class: 'btn ghost', text: 'Remove artwork' });
            remove.addEventListener('click', () => app.remove_artwork());
            body.append(rule.el, remove);
            return;
        }

        const keep = make_control({ type: 'toggle', label: 'Keep this layer when randomising' }, value =>
            app.set_layer_locked(value),
        );
        body.append(keep.el);
        refreshers.push(() => keep.refresh(app.design.layers[app.ui.layer].locked));
        keep.refresh(layer.locked);

        if (!layer.source.motifs.length) {
            body.append(el('p', { class: 'step-note', text: 'No openings: this layer is solid.' }));
        }
        layer.source.motifs.forEach((motif, i) => {
            const card = el('div', { class: 'motif' });
            const remove = el('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove', text: '×' });
            remove.addEventListener('click', () => app.remove_motif(i));
            card.append(el('div', { class: 'motif-head' }, [el('span', { text: kMotifTypes[motif.type].label }), remove]));
            for (const key of kMotifTypes[motif.type].params) {
                const p = kMotifParams[key];
                if (p.tier === 'advanced' && tier !== 'advanced') continue;
                const control = make_control({ ...p, type: 'range' }, (value, { coalesce }) =>
                    app.set_motif_param(i, key, value, coalesce),
                );
                card.append(control.el);
                const refresh = () => control.refresh(app.design.layers[app.ui.layer].source.motifs[i]?.[key] ?? 0);
                refresh();
                refreshers.push(refresh);
            }
            body.append(card);
        });

        const type = el('select', { 'aria-label': 'Opening type' });
        for (const [id, t] of Object.entries(kMotifTypes)) type.append(el('option', { value: id, text: t.label }));
        const add = el('button', { type: 'button', class: 'btn ghost', text: 'Add openings' });
        add.addEventListener('click', () => app.add_motif(type.value));
        body.append(el('div', { class: 'add-row' }, [type, add]));
    }
}
