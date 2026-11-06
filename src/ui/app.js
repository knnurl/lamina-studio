// App controller: the design store, UI state, header and panels, the geometry worker and the
// views. Every edit goes through the store (one undo step per action or slider drag). Every new
// design is rebuilt in the worker, latest wins, and shown; the slow checks follow, debounced.
import { Store } from '../core/store.js';
import { migrate, piece_radius_mm } from '../core/design.js';
import { preset_by_id } from '../core/presets.js';
import { generate_stack } from '../core/generate.js';
import { write_param } from '../core/actions.js';
import { unpack_paths } from '../geom/pack.js';
import { check_level } from '../core/check_level.js';
import { LayerView } from '../preview/layer_view.js';
import { Render2D } from '../preview/render2d.js';
import { SheetsView } from '../preview/sheets_view.js';
import { Panels } from './panels.js';
import { build_header } from './header.js';
import { build_make_extras } from './make_panel.js';
import { make_checks_view } from './checks_view.js';
import { set_status } from './shell.js';
import { save_bytes } from './dom.js';

const kDesignKey = 'lamina-design';
const kTierKey = 'lamina-tier';
const kCheckDelayMs = 350;
const kPolicies = ['bridge', 'glue', 'drop'];

function storage_get(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storage_set(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage unavailable: autosave is a convenience only.
    }
}

function restore_design() {
    try {
        const raw = storage_get(kDesignKey);
        return raw ? migrate(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
}

// Sensible starting values for new openings, relative to the space inside the frame ring.
function new_motif(type, design, layer) {
    const r = Math.max(10, piece_radius_mm(design.piece) - layer.frame_ring_mm);
    const v = x => Math.round(x * r * 10) / 10;
    switch (type) {
        case 'disc':
            return { type, d_mm: v(0.6) };
        case 'window':
            return { type, r_mm: v(0.55), size_mm: v(0.14), sides: 4, rot_deg: 0, mult: 1, angle_deg: 0 };
        case 'petal':
            return { type, r_mm: v(0.6), length_mm: v(0.22), width_mm: v(0.09), mult: 1, angle_deg: 0 };
        case 'ring':
            return { type, r_mm: v(0.78), w_mm: v(0.06), tie_mm: 3, mult: 1, angle_deg: 0 };
        case 'ray':
            return { type, r0_mm: v(0.3), r1_mm: v(0.9), w0_mm: 0, w1_mm: v(0.08), mult: 1, angle_deg: 0 };
        default:
            throw new Error(`unknown opening type "${type}"`);
    }
}

const slug = name => (name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function unpack_layer(l) {
    return {
        ...l,
        material: unpack_paths(l.packed),
        islands: l.islands.map(i => ({ ...i, outer: unpack_paths(i.outer)[0] })),
        bridges: l.bridges.map(b => ({ ...b, rect: unpack_paths(b.rect)[0] })),
        parts: l.parts.map(unpack_paths),
        locators: unpack_paths(l.locators),
        ids: unpack_paths(l.ids),
    };
}

function status_line(design, built, checks, pending) {
    const cut_m = built.layers.reduce((s, l) => s + l.cut_length_mm, 0) / 1000;
    const fatal = checks.filter(c => c.severity === 'fatal' && !c.overridden).length;
    const warn = checks.filter(c => c.severity === 'warn' || c.overridden).length;
    let verdict;
    if (fatal) verdict = `${plural(fatal, 'problem')} to fix` + (warn ? `, ${plural(warn, 'warning')}` : '');
    else if (warn) verdict = plural(warn, 'warning');
    else verdict = pending ? 'checking' : 'all checks pass';
    return `${design.name}: ${plural(design.layers.length, 'layer')}, ${cut_m.toFixed(1)} m of cutting. ` +
        `${verdict[0].toUpperCase()}${verdict.slice(1)}. Geometry ${built.ms.toFixed(0)} ms.`;
}

export function start_app({ worker, preview, stage }) {
    const store = new Store(restore_design() ?? preset_by_id('orb'));
    const ui = {
        layer: 0,
        view: '3d',
        tier: storage_get(kTierKey) === 'advanced' ? 'advanced' : 'basic',
        locks: new Set(),
    };
    const state = { built: null, built_for: null, checks: [], checks_for: null };
    let panels;
    let header;
    let layer_view;
    let render2d;
    let sheets_view;
    let checks_view;
    let sheets_timer = null;

    // The exploded-view slider floats over the 3D view.
    const explode = document.createElement('label');
    explode.className = 'explode';
    explode.innerHTML = '<span>Explode</span><input type="range" min="0" max="1" step="0.01" value="0" aria-label="Explode the stack">';
    explode.querySelector('input').addEventListener('input', e => preview.set_explode?.(Number(e.target.value)));
    stage.append(explode);

    // Sheets are laid out on demand, only while the Sheets view is open.
    function schedule_sheets() {
        clearTimeout(sheets_timer);
        if (ui.view !== 'sheets' || !state.built_for) return;
        const design = state.built_for;
        sheets_timer = setTimeout(async () => {
            try {
                const result = await worker.call('sheets', design);
                if (design === store.design) sheets_view.show(result);
            } catch (err) {
                sheets_view.show_message(`Could not lay out the sheets: ${err.message}`);
            }
        }, 250);
    }

    const edit = (mutate, coalesce_key = null) => store.update(mutate, { coalesce_key });
    const current = d => d.layers[ui.layer];

    function render_layer_view() {
        if (!state.built) return;
        const d = state.built_for;
        const k = Math.min(ui.layer, state.built.layers.length - 1);
        const o = d.piece.outline;
        layer_view.show({
            key: `${o.kind}|${o.w_mm}|${o.h_mm}|${k}`,
            colour: d.layers[k].finish.colour,
            built: state.built.layers[k],
            checks: (state.checks_for === d ? state.checks : state.built.checks).filter(c => c.layer === k),
            dowels: state.built.registration.dowels_mm,
            hole_d_mm: state.built.registration.hole_d_mm,
            drilled: k > 0 || d.registration.through_front,
        });
    }

    function render_status() {
        if (!state.built) return;
        const fresh = state.checks_for === state.built_for;
        const checks = fresh ? state.checks : state.built.checks;
        const level = check_level(checks);
        set_status(level === 'ok' && !fresh ? 'busy' : level, status_line(state.built_for, state.built, checks, !fresh));
        checks_view.update(checks, !fresh);
    }

    function render_ui() {
        ui.layer = Math.min(ui.layer, store.design.layers.length - 1);
        panels.render();
        header.refresh();
        for (const tab of document.querySelectorAll('#tabs .tab')) {
            tab.setAttribute('aria-selected', String(tab.dataset.view === ui.view));
        }
        render_layer_view();
    }

    const app = {
        store,
        ui,
        get design() {
            return store.design;
        },
        set_param(entry, value, coalesce) {
            edit(d => write_param(entry, d, ui.layer, value), coalesce ? `${entry.id}@${ui.layer}` : null);
        },
        set_motif_param(i, key, value, coalesce) {
            edit(d => {
                current(d).source.motifs[i][key] = value;
            }, coalesce ? `motif@${ui.layer}.${i}.${key}` : null);
        },
        add_motif(type) {
            edit(d => current(d).source.motifs.push(new_motif(type, d, current(d))));
        },
        remove_motif(i) {
            edit(d => current(d).source.motifs.splice(i, 1));
        },
        set_layer_locked(value) {
            edit(d => {
                current(d).locked = value;
            });
        },
        select_layer(k) {
            ui.layer = k;
            render_ui();
        },
        show_layer(k) {
            ui.layer = k;
            app.set_view('layer');
        },
        set_view(view) {
            ui.view = view;
            preview.set_visible(view === '3d');
            explode.hidden = view !== '3d';
            render2d.set_visible(view === '2d');
            layer_view.set_visible(view === 'layer');
            sheets_view.set_visible(view === 'sheets');
            if (view === 'sheets') {
                sheets_view.show_message('Laying out the sheets...');
                schedule_sheets();
            }
            render_ui();
        },
        cycle_island(island) {
            const k = ui.layer;
            const next = kPolicies[(kPolicies.indexOf(island.policy) + 1) % kPolicies.length];
            edit(d => {
                const islands = d.layers[k].overrides.islands;
                if (next === (d.layers[k].island_policy ?? 'bridge')) delete islands[island.id];
                else islands[island.id] = next;
            });
            set_status('busy', `Island set to ${next}.`);
        },
        toggle_override(key) {
            edit(d => {
                const list = d.check_overrides;
                const at = list.indexOf(key);
                if (at >= 0) list.splice(at, 1);
                else list.push(key);
            });
        },
        toggle_lock(id) {
            if (ui.locks.has(id)) ui.locks.delete(id);
            else ui.locks.add(id);
        },
        set_tier(tier) {
            ui.tier = tier;
            storage_set(kTierKey, tier);
            render_ui();
        },
        set_seed(seed) {
            edit(d => generate_stack(d, seed, { lock_n: ui.locks.has('symmetry.n') }));
        },
        load_preset(id) {
            ui.layer = 0;
            store.replace(preset_by_id(id));
        },
        undo: () => store.undo(),
        redo: () => store.redo(),
        save() {
            const json = JSON.stringify(store.design, null, 2) + '\n';
            save_bytes(`${slug(store.design.name)}.lamina.json`, new TextEncoder().encode(json), 'application/json');
            set_status('ok', `Saved ${slug(store.design.name)}.lamina.json`);
        },
        open(file) {
            file.text()
                .then(text => {
                    const design = migrate(JSON.parse(text));
                    ui.layer = 0;
                    store.replace(design);
                })
                .catch(err => set_status('bad', `Could not open ${file.name}: ${err.message}`));
        },
    };
    checks_view = make_checks_view(app);
    layer_view = new LayerView(stage, { on_island_click: island => app.cycle_island(island) });
    render2d = new Render2D(stage);
    sheets_view = new SheetsView(stage);
    app.export_zip = async () => {
        const design = store.design;
        set_status('busy', 'Exporting');
        try {
            const preview_png = preview.capture_png ? await preview.capture_png().catch(() => null) : null;
            const result = await worker.call('export_zip', { design, preview_png });
            if (result.blocked) {
                set_status('bad', `Export blocked by ${result.problems.length === 1 ? 'a problem' : `${result.problems.length} problems`}: ${result.problems.join(' ')} Fix them, or allow them in the check list.`);
                return;
            }
            save_bytes(result.name, result.bytes, 'application/zip');
            const sheets = result.summary.sheets.map(s => `${s.count} sheet${s.count === 1 ? '' : 's'} of ${s.material}`).join(', ');
            set_status('ok', `Saved ${result.name}: ${sheets}, ${result.summary.parts} parts, ${result.summary.files} files.`);
        } catch (err) {
            set_status('bad', `Export failed: ${err.message}`);
        }
    };
    panels = new Panels(app, { make: build_make_extras(worker, checks_view, () => app.export_zip()) });
    header = build_header(app);
    for (const tab of document.querySelectorAll('#tabs .tab')) {
        tab.addEventListener('click', () => {
            if (!tab.disabled) app.set_view(tab.dataset.view);
        });
    }

    // Builds run latest-wins; the slow checks follow once edits pause.
    let busy = false;
    let queued = null;
    let check_timer = null;
    async function build(design) {
        if (busy) {
            queued = design;
            return;
        }
        busy = true;
        try {
            const result = await worker.call('build', design);
            state.built = { ...result, layers: result.layers.map(unpack_layer) };
            state.built_for = design;
            preview.show(design, state.built.layers);
            render2d.show(design, state.built.layers);
            render_layer_view();
            schedule_sheets();
            render_status();
            clearTimeout(check_timer);
            check_timer = setTimeout(() => run_checks(design), kCheckDelayMs);
        } catch (err) {
            set_status('bad', `Build failed: ${err.message}`);
        }
        busy = false;
        if (queued) {
            const next = queued;
            queued = null;
            build(next);
        }
    }
    async function run_checks(design) {
        if (design !== store.design) return;
        try {
            const result = await worker.call('check', design);
            if (design !== store.design || design !== state.built_for) return;
            state.checks = result.checks;
            state.checks_for = design;
            render_status();
            render_layer_view();
        } catch (err) {
            set_status('bad', `Checks failed: ${err.message}`);
        }
    }

    let save_timer = null;
    store.subscribe(design => {
        render_ui();
        build(design);
        clearTimeout(save_timer);
        save_timer = setTimeout(() => storage_set(kDesignKey, JSON.stringify(design)), 400);
    });

    document.addEventListener('keydown', event => {
        const typing = event.target.closest?.('input[type=number], input[type=text], select');
        if (typing || !(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) app.undo();
        else if ((key === 'z' && event.shiftKey) || key === 'y') app.redo();
        else return;
        event.preventDefault();
    });

    render_ui();
    build(store.design);
    return app;
}
