// App controller: the design store, UI state, header and panels, the geometry worker and the
// preview. Every edit goes through the store (one undo step per action or slider drag); every new
// design is rebuilt in the worker, latest wins, and shown in the preview.
import { Store } from '../core/store.js';
import { migrate, piece_radius_mm } from '../core/design.js';
import { preset_by_id } from '../core/presets.js';
import { generate_stack } from '../core/generate.js';
import { write_param } from '../core/actions.js';
import { unpack_paths } from '../geom/pack.js';
import { Panels } from './panels.js';
import { build_header } from './header.js';
import { build_make_extras } from './make_panel.js';
import { set_status } from './shell.js';
import { save_bytes } from './dom.js';

const kDesignKey = 'lamina-design';
const kTierKey = 'lamina-tier';

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

function make_builder(worker, preview) {
    let busy = false;
    let pending = null;
    async function run(design) {
        busy = true;
        try {
            const t0 = performance.now();
            const result = await worker.call('build', design);
            const layers = result.layers.map(l => ({ ...l, material: unpack_paths(l.packed) }));
            const t1 = performance.now();
            preview.show(design, layers);
            const t2 = performance.now();
            set_status(
                'ok',
                `${design.name}: ${layers.length} layers. Geometry ${result.ms.toFixed(0)} ms, ` +
                    `round trip ${(t1 - t0).toFixed(0)} ms, preview ${(t2 - t1).toFixed(0)} ms.`,
            );
        } catch (err) {
            set_status('bad', `Build failed: ${err.message}`);
        }
        busy = false;
        if (pending) {
            const next = pending;
            pending = null;
            run(next);
        }
    }
    return design => {
        if (busy) pending = design;
        else run(design);
    };
}

export function start_app({ worker, preview }) {
    const store = new Store(restore_design() ?? preset_by_id('orb'));
    const ui = { layer: 0, tier: storage_get(kTierKey) === 'advanced' ? 'advanced' : 'basic', locks: new Set() };
    let panels;
    let header;

    const render_ui = () => {
        ui.layer = Math.min(ui.layer, store.design.layers.length - 1);
        panels.render();
        header.refresh();
    };
    const edit = (mutate, coalesce_key = null) => store.update(mutate, { coalesce_key });
    const current = d => d.layers[ui.layer];

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

    panels = new Panels(app, { make: build_make_extras(worker) });
    header = build_header(app);
    const build = make_builder(worker, preview);
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
