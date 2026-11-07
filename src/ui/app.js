// App controller: the design store, UI state, the step panel, the geometry worker and the views.
// Every edit goes through the store (one undo step per action or slider drag). Every new design is
// rebuilt in the worker, latest wins, and shown; the slow checks follow, debounced. One step is on
// screen at a time and opens the view it needs (SPEC 11); a start screen and a tour guide newcomers.
import { Store } from '../core/store.js';
import { migrate, design_from_import, import_into_layer, reverse_layers, material_of, base_design } from '../core/design.js';
import { preset_by_id } from '../core/presets.js';
import { generate_stack } from '../core/generate.js';
import { to_shape } from '../sources/curves.js';
import { new_motif } from '../core/motif_defaults.js';
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
import { build_calibrate_panel } from './calibrate_panel.js';
import { set_status, kSteps, show_step, panel_parts } from './shell.js';
import { LayerStrip } from './layer_strip.js';
import { StartScreen } from './start_screen.js';
import { Tour } from './tour.js';
import { AssistantPanel } from './assistant_panel.js';
import { SketchBar } from './sketch_bar.js';
import { to_domain, simplify_line, chaikin, stroke_distance } from '../geom/sketch.js';
import { save_bytes, el } from './dom.js';

const kDesignKey = 'lamina-design';
const kMoreKey = 'lamina-more'; // which steps have "More options" open
const kTourKey = 'lamina-tour-seen';
const kMaterialsKey = 'lamina-materials';

// Measured materials kept in this browser, so new designs start measured.
function material_library() {
    try {
        return JSON.parse(storage_get(kMaterialsKey) ?? '{}');
    } catch {
        return {};
    }
}

const with_library = design => ({ ...design, materials: { ...material_library(), ...design.materials } });
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

// A blank piece of a start-screen kind: plain layers in its outline and symmetry.
function blank_design(kind) {
    const d = base_design(kind.blank.layers);
    d.name = `New ${kind.title.toLowerCase()}`;
    Object.assign(d.piece.outline, kind.blank.outline);
    d.piece.symmetry = { ...kind.blank.symmetry };
    d.generator.style = { round: 'mandala', panel: 'circuit' }[kind.id] ?? 'classic';
    return d;
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
    const restored = restore_design();
    const store = new Store(restored ?? with_library(preset_by_id('orb')));
    let saved_more = [];
    try {
        saved_more = JSON.parse(storage_get(kMoreKey) ?? '[]');
    } catch {
        saved_more = [];
    }
    const ui = {
        layer: 0,
        step: 'pattern',
        view: '3d',
        locks: new Set(),
        more: new Set(Array.isArray(saved_more) ? saved_more : []),
        draw: { tool: 'select', width_mm: 3, filled: true },
    };
    const state = { built: null, built_for: null, checks: [], checks_for: null };
    let panels;
    let header;
    let layer_view;
    let render2d;
    let sheets_view;
    let checks_view;
    let unmeasured;
    let strip;
    let start;
    let tour;
    let assistant;
    let sketch_bar;
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
            shapes: shapes_of(store.design, k),
            sym: store.design.piece.symmetry,
            stroke_mm: ui.draw.width_mm,
        });
    }

    // The shape motifs of layer k for node editing, from the current design (not the last
    // build), so nodes follow the pointer while the geometry catches up. rot turns the first copy:
    // the motif's offset plus the symmetry's phase.
    function shapes_of(design, k) {
        const phase = ((design.piece.symmetry.phase_deg ?? 0) * Math.PI) / 180;
        return (design.layers[k]?.source.motifs ?? [])
            .map((m, i) => (m.type === 'shape' ? { motif: i, nodes: m.nodes, r_mm: m.r_mm, rot: phase + ((m.angle_deg ?? 0) * Math.PI) / 180 } : null))
            .filter(Boolean);
    }

    function render_status() {
        if (!state.built) return;
        const fresh = state.checks_for === state.built_for;
        const checks = fresh ? state.checks : state.built.checks;
        const level = check_level(checks);
        set_status(level === 'ok' && !fresh ? 'busy' : level, status_line(state.built_for, state.built, checks, !fresh));
        checks_view.update(checks, !fresh);
        const d = state.built_for;
        unmeasured.hidden = d.layers.every(l => material_of(d, l).measured);
    }

    function render_ui() {
        ui.layer = Math.min(ui.layer, store.design.layers.length - 1);
        show_step(ui.step);
        panels.render();
        header.refresh();
        for (const tab of document.querySelectorAll('#tabs .tab')) {
            tab.setAttribute('aria-selected', String(tab.dataset.view === ui.view));
        }
        render_layer_view();
        strip.show(store.design, state.built?.layers, ui.layer);
    }

    // After the first piece opens, the tour is offered once, in a card over the preview.
    function offer_tour() {
        if (storage_get(kTourKey)) return;
        storage_set(kTourKey, '1');
        const take = el('button', { type: 'button', class: 'btn', text: 'Take the one-minute tour' });
        const later = el('button', { type: 'button', class: 'btn ghost', text: 'Not now' });
        const card = el('div', { class: 'tour-offer', role: 'dialog', 'aria-label': 'Tour' }, [el('p', { text: 'New to Lamina? A one-minute tour shows where everything is.' }), el('div', { class: 'tour-buttons' }, [later, take])]);
        take.addEventListener('click', () => {
            card.remove();
            tour.start();
        });
        later.addEventListener('click', () => card.remove());
        document.querySelector('.view').append(card);
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
        // A petal or curve motif becomes a shape with the same outline, whose nodes can be
        // dragged in the Layer view (SPEC 8.4).
        convert_motif(i) {
            edit(d => {
                const motifs = current(d).source.motifs;
                motifs[i] = to_shape(motifs[i]);
            });
            app.set_view('layer');
            set_status('busy', 'Now a shape: drag its nodes and handles in the Layer view.');
        },
        // New nodes for a shape motif; every move of one drag is one undo step.
        edit_shape(i, nodes, drag) {
            const k = ui.layer;
            edit(d => {
                d.layers[k].source.motifs[i].nodes = nodes;
            }, drag ? `shape@${k}.${i}.${drag}` : null);
        },
        remove_motif(i) {
            edit(d => current(d).source.motifs.splice(i, 1));
        },
        set_layer_fill_rule(rule) {
            edit(d => {
                current(d).source.fill_rule = rule;
            });
        },
        remove_artwork() {
            edit(d => {
                current(d).source = { kind: 'primitive', motifs: [] };
                current(d).frame_ring_mm = 12;
            });
        },
        reverse_layers() {
            edit(d => reverse_layers(d));
            set_status('busy', 'Stack reversed: the front is now the back.');
        },
        async import_svg(files) {
            set_status('busy', `Reading ${files.length === 1 ? files[0].name : `${files.length} files`}`);
            try {
                const texts = await Promise.all([...files].map(async f => ({ name: f.name, text: await f.text() })));
                const result = await worker.call('import_svg', { files: texts });
                const n = result.layers.length;
                const size = `${result.size_mm.w.toFixed(1)} x ${result.size_mm.h.toFixed(1)} mm`;
                const ignored = result.layers.reduce((s, l) => s + l.open + l.skipped, 0);
                const extra = [...result.notes, ignored ? `${ignored} open paths, lines, texts or images ignored` : null].filter(Boolean).join('; ');
                if (n === 1 && files.length === 1) {
                    edit(d => import_into_layer(d, ui.layer, result.layers[0]));
                    set_status('ok', `Imported ${texts[0].name} onto layer ${ui.layer + 1}: ${size}.${extra ? ` ${extra}.` : ''}`);
                } else {
                    const stem = texts[0].name.replace(/\.svg$/i, '').replace(/[-_ ]*(layer)?[-_ ]*\d+$/i, '') || 'Imported';
                    ui.layer = 0;
                    store.replace(with_library(design_from_import(result, stem)));
                    set_status('ok', `Imported ${n} layers (front first): ${size}.${extra ? ` ${extra}.` : ''}`);
                }
            } catch (err) {
                set_status('bad', `Import failed: ${err.message}`);
            }
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
        // A step opens the view it needs; the view tabs still switch by hand.
        set_step(step) {
            ui.step = step;
            panel_parts().body.scrollTop = 0;
            app.set_view(kSteps.find(s => s.id === step).view);
        },
        go_step(delta) {
            const i = kSteps.findIndex(s => s.id === ui.step) + delta;
            if (i >= 0 && i < kSteps.length) app.set_step(kSteps[i].id);
        },
        toggle_more(key) {
            if (ui.more.has(key)) ui.more.delete(key);
            else ui.more.add(key);
            storage_set(kMoreKey, JSON.stringify([...ui.more].filter(k => !k.startsWith('motif:'))));
            render_ui();
        },
        // Sketching (SPEC M4.5): strokes go back into the fundamental domain by the copy they were
        // drawn on, onto the chosen layer's sketch motif, so the symmetry mirrors them.
        add_stroke({ points, closed }) {
            const k = ui.layer;
            const d = store.design;
            if (d.piece.depth_mode === 'field') {
                set_status('warn', 'Sketches cut in per-layer mode. In the Pattern step, set "Layers come from" to each layer its own openings.');
                return;
            }
            if (d.layers[k].source.kind !== 'primitive') {
                set_status('warn', `Layer ${k + 1} holds imported artwork; sketch on another layer.`);
                return;
            }
            let mm = to_domain(points, d.piece.symmetry).map(p => ({ x: p.x / 1000, y: p.y / 1000 }));
            if (mm.length > 4) mm = simplify_line(mm, 0.15);
            const stroke = { closed, fill: closed && ui.draw.filled, width_mm: ui.draw.width_mm, points: mm.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]) };
            edit(dd => {
                const motifs = dd.layers[k].source.motifs;
                let sketch = motifs.find(m => m.type === 'sketch');
                if (!sketch) {
                    sketch = { type: 'sketch', strokes: [] };
                    motifs.push(sketch);
                }
                sketch.strokes.push(stroke);
            });
        },
        erase_stroke(p, tol_um) {
            const k = ui.layer;
            const d = store.design;
            const motifs = d.layers[k].source.motifs ?? [];
            const i = motifs.findIndex(m => m.type === 'sketch');
            if (i < 0) return;
            const q = to_domain([p], d.piece.symmetry)[0];
            const qm = { x: q.x / 1000, y: q.y / 1000 };
            let best = -1;
            let best_d = Infinity;
            motifs[i].strokes.forEach((s, j) => {
                const dist = stroke_distance(qm, s.points.map(([x, y]) => ({ x, y })), s.closed) - s.width_mm / 2;
                if (dist < best_d) {
                    best_d = dist;
                    best = j;
                }
            });
            if (best < 0 || best_d > tol_um / 1000) return;
            edit(dd => {
                const sketch = dd.layers[k].source.motifs[i];
                sketch.strokes.splice(best, 1);
                if (!sketch.strokes.length) dd.layers[k].source.motifs.splice(i, 1);
            });
        },
        smooth_sketch() {
            const k = ui.layer;
            const i = (store.design.layers[k].source.motifs ?? []).findIndex(m => m.type === 'sketch');
            if (i < 0) return set_status('ok', `No sketch on layer ${k + 1} yet.`);
            edit(dd => {
                for (const s of dd.layers[k].source.motifs[i].strokes) {
                    if (s.points.length <= 4) continue; // circles are smooth; rectangles keep their corners
                    const pts = simplify_line(chaikin(s.points.map(([x, y]) => ({ x, y })), s.closed, 2), 0.1);
                    s.points = pts.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
                }
            });
        },
        cleanup_sketch() {
            const k = ui.layer;
            if (!(store.design.layers[k].source.motifs ?? []).some(m => m.type === 'sketch')) return set_status('ok', `No sketch on layer ${k + 1} yet.`);
            assistant.set_open(true);
            assistant.send(`Clean up my sketch on layer ${k + 1}. Look at layer ${k + 1} first. Keep what I drew, but turn the rough strokes into clean shapes: curve or shape motifs, windows, petals, or artwork with draw_artwork. Then remove the sketch motif and check the design.`);
        },
        start_drawing() {
            app.set_view('layer');
            sketch_bar.set_tool('pen');
            ui.draw.tool = 'pen';
            layer_view.set_tool('pen');
        },
        get assistant_open() {
            return !!assistant?.open;
        },
        toggle_assistant() {
            assistant.set_open(!assistant.open);
        },
        // From the start screen: a blank piece of that kind, then the assistant designs it.
        describe(text, kind) {
            ui.layer = 0;
            store.replace(with_library(blank_design(kind)));
            start.hide();
            app.set_step('pattern');
            assistant.set_open(true);
            assistant.send(text);
        },
        show_start() {
            start.show({ continue_name: store.design.name });
        },
        open_preset(id) {
            app.load_preset(id);
            start.hide();
            app.set_step('pattern');
            offer_tour();
        },
        start_blank(kind) {
            ui.layer = 0;
            store.replace(with_library(blank_design(kind)));
            start.hide();
            app.set_step('piece');
            offer_tour();
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
            sketch_bar.set_visible(view === 'layer');
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
        // Cell paint (SPEC 8.2): the worker finds the lattice cell under the click (folded into the
        // fundamental domain), and the click toggles it solid. Clicks off any lattice do nothing.
        async paint_cell(p) {
            const k = ui.layer;
            const design = store.design;
            if (!(design.layers[k]?.source.motifs ?? []).some(m => m.type === 'lattice')) return;
            const hit = await worker.call('cell_at', { design, layer: k, x_um: p.x, y_um: p.y });
            if (!hit || store.design !== design) return;
            edit(d => {
                const motif = d.layers[k].source.motifs[hit.motif];
                motif.cells ??= {};
                if (motif.cells[hit.cell]) delete motif.cells[hit.cell];
                else motif.cells[hit.cell] = 'solid';
            });
        },
        // Bridge drag: the island's bridges become preferred angles, the dragged one at its new
        // angle; each ties to the edge of the opening around the island.
        drag_bridge(bridge, angle_deg) {
            const k = ui.layer;
            const own = state.built.layers[k].bridges.filter(b => b.island === bridge.island);
            const angles = own.map(b => Math.round((b === bridge ? angle_deg : b.angle_deg) * 10) / 10);
            edit(d => {
                const o = d.layers[k].overrides;
                o.bridge_angles ??= {};
                o.bridge_angles[bridge.island] = angles;
            });
            set_status('busy', 'Bridge moved.');
        },
        reset_bridges(bridge) {
            const k = ui.layer;
            if (!store.design.layers[k].overrides.bridge_angles?.[bridge.island]) return;
            edit(d => {
                delete d.layers[k].overrides.bridge_angles[bridge.island];
            });
            set_status('busy', 'Bridges reset to automatic.');
        },
        async randomise() {
            set_status('busy', 'Randomising');
            try {
                const seed = Math.floor(Math.random() * 1e6);
                const result = await worker.call('randomise', { design: store.design, seed, lock_n: ui.locks.has('symmetry.n') });
                store.replace(result.design);
                if (!result.clean) set_status('warn', `No clean variation in ${result.tries} tries; the checks show what to fix.`);
            } catch (err) {
                set_status('bad', `Randomise failed: ${err.message}`);
            }
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
        set_seed(seed) {
            edit(d => generate_stack(d, seed, { lock_n: ui.locks.has('symmetry.n') }));
        },
        save_measured_material(id, material) {
            edit(d => {
                d.materials[id] = material;
            });
            storage_set(kMaterialsKey, JSON.stringify({ ...material_library(), [id]: material }));
            set_status('ok', `Saved ${material.label}: kerf ${material.kerf_mm} mm. Checks and cut files now use it.`);
        },
        load_preset(id) {
            ui.layer = 0;
            store.replace(with_library(preset_by_id(id)));
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
    unmeasured = el('span', { class: 'chip status-chip', text: 'Material not measured yet: cut the test card (Make step)', hidden: '' });
    document.querySelector('.status').append(unmeasured);
    layer_view = new LayerView(stage, {
        on_island_click: island => app.cycle_island(island),
        on_cell_click: p => app.paint_cell(p),
        on_bridge_drag: (bridge, angle_deg) => app.drag_bridge(bridge, angle_deg),
        on_bridge_reset: bridge => app.reset_bridges(bridge),
        on_shape_edit: (i, nodes, drag) => app.edit_shape(i, nodes, drag),
        on_sketch: stroke => app.add_stroke(stroke),
        on_erase: (p, tol) => app.erase_stroke(p, tol),
    });
    sketch_bar = new SketchBar(stage, {
        tool: t => {
            ui.draw.tool = t;
            layer_view.set_tool(t);
        },
        width: mm => {
            ui.draw.width_mm = mm;
            render_layer_view();
        },
        filled: on => {
            ui.draw.filled = on;
        },
        smooth: () => app.smooth_sketch(),
        cleanup: () => app.cleanup_sketch(),
    });
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
    const import_extras = container => {
        const input = el('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: '', hidden: '' });
        input.addEventListener('change', () => {
            if (input.files.length) app.import_svg(input.files);
            input.value = '';
        });
        const button = el('button', { type: 'button', class: 'btn ghost', text: 'Import SVG layers' });
        button.addEventListener('click', () => input.click());
        container.append(
            el('h3', { class: 'sub', text: 'Import' }),
            el('p', {
                class: 'step-note',
                text:
                    'Several files become one layer each, front first by file name. One file with ' +
                    'several groups becomes one layer per group. One plain file goes onto the selected layer.',
            }),
            button,
            input,
        );
    };
    const layer_extras = container => {
        const button = el('button', { type: 'button', class: 'tool small', text: 'Reverse stack order' });
        button.addEventListener('click', () => app.reverse_layers());
        container.append(button);
    };
    panels = new Panels(app, {
        pattern: import_extras,
        look: layer_extras,
        make: build_make_extras(worker, checks_view, () => app.export_zip(), container => build_calibrate_panel(container, app)),
    });
    header = build_header(app);
    for (const tab of document.querySelectorAll('#tabs .tab')) {
        tab.addEventListener('click', () => {
            if (!tab.disabled) app.set_view(tab.dataset.view);
        });
    }
    for (const b of document.querySelectorAll('[data-step-go]')) b.addEventListener('click', () => app.set_step(b.dataset.stepGo));
    panel_parts().back.addEventListener('click', () => app.go_step(-1));
    panel_parts().next.addEventListener('click', () => app.go_step(1));
    strip = new LayerStrip(document.getElementById('layer-strip'), { on_select: k => app.select_layer(k) });
    tour = new Tour(document.getElementById('tour'));
    const svg_input = el('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: '', hidden: '' });
    svg_input.addEventListener('change', () => {
        if (svg_input.files.length) app.import_svg(svg_input.files);
        svg_input.value = '';
    });
    document.body.append(svg_input);
    start = new StartScreen(document.getElementById('start'), {
        build: async design => (await worker.call('build', design)).layers.map(unpack_layer),
        open_preset: id => app.open_preset(id),
        start_blank: kind => app.start_blank(kind),
        close: () => start.hide(),
        open_file: () => {
            start.hide();
            header.open_file();
        },
        import_svg: () => {
            start.hide();
            app.set_step('pattern');
            svg_input.click();
        },
        tour: () => {
            start.hide();
            storage_set(kTourKey, '1');
            tour.start();
        },
        describe: (text, kind) => app.describe(text, kind),
    });
    // The assistant's tools work on the studio through this context (SPEC M4.5).
    assistant = new AssistantPanel(
        document.querySelector('.view'),
        {
            design: () => store.design,
            replace: design => store.replace(design),
            build: async design => (await worker.call('build', design)).layers.map(unpack_layer),
            check: async design => (await worker.call('check', design)).checks,
            import_svg: text => worker.call('import_svg', { files: [{ name: 'artwork.svg', text }] }),
            capture_3d: async () => {
                // The 3D view shows the latest design once its build lands.
                for (let i = 0; i < 40 && state.built_for !== store.design; i++) await new Promise(r => setTimeout(r, 100));
                return preview.capture_png ? await preview.capture_png().catch(() => null) : null;
            },
        },
        { on_open: () => header.refresh() },
    );

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
            strip.show(store.design, state.built.layers, ui.layer);
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

    app.set_step(ui.step);
    build(store.design);
    // A first visit starts on the start screen; a returning visitor opens their last design.
    if (!restored) start.show({ first_visit: true });
    return app;
}
