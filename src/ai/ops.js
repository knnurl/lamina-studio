// Validated design edits for the assistant (SPEC M4.5). Every operation names a registry control or
// a change to one layer's motifs. Values are checked against the registry and clamped to its
// ranges, so the assistant can set only what the controls could. apply_ops works on a copy and
// reports, in plain words for the model, what it changed and what it refused.
// Layers and motifs are numbered from 1 here (layer 1 is the front), as the UI shows them.
import { SCHEMA, kMotifTypes, kMotifParams } from '../core/schema.js';
import { write_param, options_for } from '../core/actions.js';
import { new_motif } from '../core/motif_defaults.js';
import { generate_stack, kStyles } from '../core/generate.js';

const kById = new Map(SCHEMA.map(e => [e.id, e]));

// Rounds to the control's step, keeping its decimal places (0.05 stays 0.05, not 0.0500000001).
function to_step(v, step) {
    if (!step) return v;
    const places = (String(step).split('.')[1] ?? '').length;
    return Number((Math.round(v / step) * step).toFixed(places));
}

// A value for a range or select spec: { value } or { error }; note says when it was clamped.
function check_value(spec, value, options) {
    const type = spec.type ?? 'range';
    if (type === 'range') {
        const v = Number(value);
        if (!Number.isFinite(v)) return { error: `needs a number, got ${JSON.stringify(value)}` };
        const clamped = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v));
        const out = to_step(clamped, spec.step);
        return { value: out, note: clamped !== v ? `clamped to ${out} (range ${spec.min} to ${spec.max})` : null };
    }
    if (type === 'select') {
        const ids = (options ?? spec.options ?? []).map(o => (Array.isArray(o) ? o[0] : o));
        return ids.includes(value) ? { value } : { error: `must be one of ${ids.join(', ')}` };
    }
    if (type === 'toggle') return typeof value === 'boolean' ? { value } : { error: 'needs true or false' };
    if (type === 'colour') return /^#[0-9a-f]{6}$/i.test(String(value)) ? { value: String(value).toLowerCase() } : { error: 'needs a colour like #a1b2c3' };
    return { error: `controls of type ${type} cannot be set here` };
}

function check_nodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length < 3) return 'nodes needs at least three nodes';
    for (const n of nodes) {
        for (const k of ['x', 'y', 'ix', 'iy', 'ox', 'oy']) if (!Number.isFinite(Number(n?.[k]))) return `every node needs numbers x, y, ix, iy, ox, oy`;
    }
    return null;
}

// A complete, valid motif from the model's partial one: missing parameters take the defaults the
// "Add openings" menu uses. Returns { motif, notes } or { error }.
export function clean_motif(input, design, layer) {
    const type = input?.type;
    if (!(type in kMotifTypes)) return { error: `unknown motif type ${JSON.stringify(type)}; use one of ${Object.keys(kMotifTypes).join(', ')}` };
    const motif = new_motif(type, design, layer);
    const notes = [];
    for (const key of kMotifTypes[type].params) {
        if (!(key in input)) continue;
        const r = check_value(kMotifParams[key], input[key]);
        if (r.error) return { error: `${type}.${key} ${r.error}` };
        motif[key] = r.value;
        if (r.note) notes.push(`${type}.${key} ${r.note}`);
    }
    if (type === 'lattice' && input.cells && typeof input.cells === 'object') {
        motif.cells = Object.fromEntries(Object.entries(input.cells).filter(([, v]) => v === 'solid'));
    }
    if (type === 'art') {
        // Artwork paths come only from draw_artwork; edits move, scale, turn or repeat them.
        if (!Array.isArray(input.paths) || !(input.src_w_mm > 0)) return { error: 'artwork comes from draw_artwork; edit its x_mm, y_mm, width_mm, angle_deg or repeat instead' };
        motif.paths = input.paths;
        motif.src_w_mm = input.src_w_mm;
    }
    if (type === 'shape' && 'nodes' in input) {
        const bad = check_nodes(input.nodes);
        if (bad) return { error: `shape.${bad}` };
        motif.nodes = input.nodes.map(n => Object.fromEntries(['x', 'y', 'ix', 'iy', 'ox', 'oy'].map(k => [k, Number(n[k])])));
    }
    const known = new Set(['type', ...kMotifTypes[type].params, 'cells', 'nodes', 'paths', 'src_w_mm']);
    for (const key of Object.keys(input)) if (!known.has(key)) notes.push(`${type}: ignored unknown field ${key}`);
    return { motif, notes };
}

function layer_of(design, n) {
    const k = Math.round(Number(n)) - 1;
    if (!(k >= 0 && k < design.layers.length)) return { error: `layer ${JSON.stringify(n)} does not exist; layers are 1 to ${design.layers.length}` };
    return { k };
}

// Applies one operation to d in place; returns { done } or { error }.
function apply_one(d, op) {
    switch (op?.op) {
        case 'set': {
            const entry = kById.get(op.id);
            if (!entry) return { error: `no control ${JSON.stringify(op.id)}` };
            let k = 0;
            if (entry.scope === 'layer') {
                const l = layer_of(d, op.layer);
                if (l.error) return l;
                k = l.k;
            }
            const options = entry.type === 'select' ? options_for(entry, d) : null;
            const r = check_value(entry, op.value, options);
            if (r.error) return { error: `${op.id} ${r.error}` };
            write_param(entry, d, k, r.value);
            const where = entry.scope === 'layer' ? ` on layer ${k + 1}` : '';
            return { done: `set ${op.id}${where} to ${JSON.stringify(r.value)}${r.note ? `, ${r.note}` : ''}` };
        }
        case 'set_motifs':
        case 'add_motif': {
            const l = layer_of(d, op.layer);
            if (l.error) return l;
            const layer = d.layers[l.k];
            if (layer.source.kind !== 'primitive') return { error: `layer ${l.k + 1} holds imported artwork; remove it before adding motifs` };
            const list = op.op === 'add_motif' ? [op.motif] : op.motifs;
            if (!Array.isArray(list)) return { error: `${op.op} needs ${op.op === 'add_motif' ? 'a motif' : 'a motifs list'}` };
            const cleaned = [];
            const notes = [];
            for (const m of list) {
                const r = clean_motif(m, d, layer);
                if (r.error) return { error: r.error };
                cleaned.push(r.motif);
                notes.push(...r.notes);
            }
            if (op.op === 'add_motif') layer.source.motifs.push(...cleaned);
            else layer.source.motifs = cleaned;
            const what = op.op === 'add_motif' ? `added ${cleaned[0].type}` : `set ${cleaned.length} motifs (${cleaned.map(m => m.type).join(', ')})`;
            return { done: `${what} on layer ${l.k + 1}${notes.length ? `; ${notes.join('; ')}` : ''}` };
        }
        case 'update_motif': {
            const l = layer_of(d, op.layer);
            if (l.error) return l;
            const layer = d.layers[l.k];
            const i = Math.round(Number(op.index)) - 1;
            const old = layer.source.motifs?.[i];
            if (!old) return { error: `layer ${l.k + 1} has no motif ${JSON.stringify(op.index)}; it has ${layer.source.motifs?.length ?? 0}` };
            const r = clean_motif({ ...old, ...op.fields, type: old.type }, d, layer);
            if (r.error) return { error: r.error };
            layer.source.motifs[i] = r.motif;
            return { done: `updated motif ${i + 1} (${old.type}) on layer ${l.k + 1}${r.notes.length ? `; ${r.notes.join('; ')}` : ''}` };
        }
        case 'remove_motif': {
            const l = layer_of(d, op.layer);
            if (l.error) return l;
            const motifs = d.layers[l.k].source.motifs ?? [];
            const i = Math.round(Number(op.index)) - 1;
            if (!motifs[i]) return { error: `layer ${l.k + 1} has no motif ${JSON.stringify(op.index)}` };
            const [gone] = motifs.splice(i, 1);
            return { done: `removed motif ${i + 1} (${gone.type}) from layer ${l.k + 1}` };
        }
        case 'generate': {
            if (op.style !== undefined) {
                if (!(op.style in kStyles)) return { error: `style must be one of ${Object.keys(kStyles).join(', ')}` };
                d.generator.style = op.style;
            }
            const seed = Math.max(0, Math.round(Number(op.seed ?? d.seed + 1)));
            generate_stack(d, seed, { lock_n: op.keep_repeats !== false });
            return { done: `generated a ${d.generator.style} pattern from seed ${seed}` };
        }
        case 'keep_layer': {
            const l = layer_of(d, op.layer);
            if (l.error) return l;
            d.layers[l.k].locked = op.keep !== false;
            return { done: `layer ${l.k + 1} is ${d.layers[l.k].locked ? 'kept' : 'no longer kept'} when generating` };
        }
        case 'rename': {
            const name = String(op.name ?? '').trim().slice(0, 80);
            if (!name) return { error: 'rename needs a name' };
            d.name = name;
            return { done: `renamed the piece ${JSON.stringify(name)}` };
        }
        default:
            return { error: `unknown operation ${JSON.stringify(op?.op)}` };
    }
}

// Applies ops in order to a copy of design. An invalid operation is skipped and reported; the
// rest still apply. Returns { design, done: [text], errors: [text] }.
export function apply_ops(design, ops) {
    const d = structuredClone(design);
    const done = [];
    const errors = [];
    if (!Array.isArray(ops) || !ops.length) return { design: d, done, errors: ['ops needs at least one operation'] };
    ops.forEach((op, n) => {
        try {
            const r = apply_one(d, op);
            if (r.error) errors.push(`operation ${n + 1}: ${r.error}`);
            else done.push(r.done);
        } catch (err) {
            errors.push(`operation ${n + 1}: ${err.message}`);
        }
    });
    return { design: d, done, errors };
}

const round = v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

function motif_summary(m) {
    const out = {};
    for (const [k, v] of Object.entries(m)) {
        if (k === 'cells') continue;
        if (k === 'paths') {
            out.contours = v.length;
            continue;
        }
        if (k === 'nodes') out.nodes = v.map(n => Object.fromEntries(Object.entries(n).map(([a, b]) => [a, round(b)])));
        else out[k] = round(v);
    }
    if (m.type === 'lattice') out.painted_cells = Object.keys(m.cells ?? {}).length;
    return out;
}

// The design as the model reads it: everything it can change, nothing bulky.
export function design_summary(design) {
    const p = design.piece;
    const field = p.depth_mode === 'field' ? { ...p.field, image: p.field.image ? `${p.field.image.w} x ${p.field.image.h} picture` : undefined } : undefined;
    return {
        name: design.name,
        seed: design.seed,
        style: design.generator?.style,
        palette: design.palette,
        piece: { outline: p.outline, symmetry: p.symmetry, depth_mode: p.depth_mode, field, lighting: p.lighting },
        layers: design.layers.map((l, k) => ({
            layer: k + 1,
            colour: l.finish.colour,
            material: l.material,
            gap_mm: l.gap_mm,
            frame_ring_mm: l.frame_ring_mm,
            kept: !!l.locked,
            ...(l.source.kind === 'svg'
                ? { artwork: { name: l.source.name, contours: l.source.paths?.length ?? 0 } }
                : { motifs: (l.source.motifs ?? []).map(motif_summary) }),
        })),
    };
}
