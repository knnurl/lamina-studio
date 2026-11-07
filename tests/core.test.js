// Design model, registry actions, undo store, seeded generator and presets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng_for, hash_str } from '../src/core/rng.js';
import { base_design, migrate, palette_colour, set_layer_count, set_custom_palette, kPalettes, kMinStops, kMaxStops, kSchemaVersion } from '../src/core/design.js';
import { SCHEMA, schema_entry } from '../src/core/schema.js';
import { write_param, read_param, options_for } from '../src/core/actions.js';
import { Store, kUndoDepth } from '../src/core/store.js';
import { generate_stack } from '../src/core/generate.js';
import { kPresets } from '../src/core/presets.js';

test('rng streams are deterministic and independent', () => {
    const a = rng_for(42, 'layer', 3);
    const b = rng_for(42, 'layer', 3);
    const seq = r => Array.from({ length: 5 }, () => r.next());
    assert.deepEqual(seq(a), seq(b));
    assert.notDeepEqual(seq(rng_for(42, 'layer', 3)), seq(rng_for(42, 'layer', 4)));
    assert.equal(hash_str('lamina'), hash_str('lamina'));
    const r = rng_for(1, 'x');
    for (let i = 0; i < 200; i++) {
        const v = r.int(2, 5);
        assert.ok(Number.isInteger(v) && v >= 2 && v <= 5);
    }
});

test('palettes interpolate from the first stop to the last', () => {
    assert.equal(palette_colour('mono', 0, 5), '#f2f2f2');
    assert.equal(palette_colour('mono', 4, 5), '#161616');
    assert.equal(palette_colour('mono', 0, 1), '#f2f2f2');
});

test('every palette has valid colours and its own name', () => {
    const labels = new Set();
    for (const [id, p] of Object.entries(kPalettes)) {
        assert.ok(p.stops.length >= kMinStops && p.stops.length <= kMaxStops, id);
        for (const c of p.stops) assert.match(c, /^#[0-9a-f]{6}$/, id);
        assert.ok(!labels.has(p.label), p.label);
        labels.add(p.label);
    }
    assert.ok(Object.keys(kPalettes).length >= 18);
});

test('spread "repeat" gives each layer the next colour in turn, "blend" runs front to back', () => {
    const d = base_design(9);
    const stops = kPalettes.orb.stops;
    write_param(schema_entry('palette_spread'), d, 0, 'repeat');
    assert.deepEqual(d.layers.map(l => l.finish.colour), d.layers.map((_, k) => stops[k % stops.length]));
    write_param(schema_entry('palette_spread'), d, 0, 'blend');
    assert.deepEqual(d.layers.map(l => l.finish.colour), d.layers.map((_, k) => palette_colour('orb', k, 9)));
});

test('a custom palette is kept with the design, offered as Custom, and survives a reopen', () => {
    const d = base_design(4);
    const palette = schema_entry('palette');
    assert.ok(!options_for(palette, d).some(([id]) => id === 'custom'));
    set_custom_palette(d, ['#FF0000', 'not a colour', '#0000ff']);
    assert.equal(d.palette, 'custom');
    assert.deepEqual(d.palette_custom, ['#ff0000', '#0000ff']);
    assert.equal(d.layers[0].finish.colour, '#ff0000');
    assert.equal(d.layers[3].finish.colour, '#0000ff');
    assert.ok(options_for(palette, d).some(([id]) => id === 'custom'));
    assert.throws(() => set_custom_palette(d, ['#ff0000']), /2 to 8 colours/);
    set_custom_palette(d, Array(12).fill('#123456'));
    assert.equal(d.palette_custom.length, kMaxStops);
    set_custom_palette(d, ['#ff0000', '#00ff00', '#0000ff']);
    write_param(palette, d, 0, 'ice');
    assert.deepEqual(d.palette_custom, ['#ff0000', '#00ff00', '#0000ff']);
    write_param(palette, d, 0, 'custom');
    assert.equal(d.layers[0].finish.colour, '#ff0000');
    const reopened = migrate(JSON.parse(JSON.stringify(d)));
    assert.equal(reopened.palette, 'custom');
    assert.deepEqual(reopened.layers.map(l => l.finish.colour), d.layers.map(l => l.finish.colour));
    const old = migrate({ app: 'lamina', schema: 1, layers: [{}, {}] });
    assert.equal(old.palette_spread, 'blend');
    assert.equal(old.palette_custom, null);
});

test('migrate fills missing fields, keeps values and rejects foreign files', () => {
    const old = { app: 'lamina', schema: 1, name: 'Old', layers: [{ gap_mm: 4 }, {}] };
    const d = migrate(old);
    assert.equal(d.name, 'Old');
    assert.equal(d.layers.length, 2);
    assert.equal(d.layers[0].gap_mm, 4);
    assert.equal(d.layers[1].frame_ring_mm, 12);
    assert.equal(d.piece.outline.kind, 'circle');
    assert.equal(d.schema, kSchemaVersion);
    assert.throws(() => migrate({ app: 'other' }), /not a Lamina design/);
    assert.throws(() => migrate({ app: 'lamina', schema: kSchemaVersion + 1 }), /newer than this studio/);
});

test('every registry entry sits in a real panel, and range entries have a numeric step', () => {
    const panels = ['piece', 'material', 'layers', 'pattern', 'structure', 'light', 'make'];
    for (const entry of SCHEMA) {
        assert.ok(panels.includes(entry.panel), `${entry.id} has panel "${entry.panel}"`);
        if (entry.type === 'range') assert.equal(typeof entry.step, 'number', entry.id);
    }
});

test('every select entry has options and every entry reads a value', () => {
    const d = base_design(4);
    for (const entry of SCHEMA) {
        if (entry.type === 'select') assert.ok(options_for(entry, d).length > 0, entry.id);
        assert.notEqual(read_param(entry, d, 0), undefined, entry.id);
    }
});

test('layer count adds before the back layer and keeps ids in order', () => {
    const d = base_design(3);
    d.layers[1].source.motifs = [{ type: 'disc', d_mm: 50 }];
    set_layer_count(d, 5);
    assert.deepEqual(d.layers.map(l => l.id), ['L1', 'L2', 'L3', 'L4', 'L5']);
    assert.equal(d.layers[3].source.motifs.length, 1, 'new layers copy the last patterned layer');
    assert.equal(d.layers[4].source.motifs.length, 0, 'the back layer stays solid');
    set_layer_count(d, 2);
    assert.equal(d.layers.length, 2);
    assert.equal(d.layers[1].source.motifs.length, 0, 'the back layer survives removal');
});

test('resizing the piece scales motif lengths but not ties', () => {
    const d = base_design(2);
    d.layers[0].source.motifs = [{ type: 'ring', r_mm: 100, w_mm: 10, tie_mm: 3, mult: 1, angle_deg: 0 }];
    write_param(schema_entry('outline.w_mm'), d, 0, 580);
    const m = d.layers[0].source.motifs[0];
    assert.equal(d.piece.outline.w_mm, 580);
    assert.equal(m.r_mm, 200);
    assert.equal(m.w_mm, 20);
    assert.equal(m.tie_mm, 3);
});

test('sheet and material controls write through to the design', () => {
    const d = base_design(3);
    write_param(schema_entry('sheet_size'), d, 0, '300x300');
    assert.deepEqual([d.sheet.w_mm, d.sheet.h_mm], [300, 300]);
    write_param(schema_entry('all_material'), d, 0, 'acr3');
    assert.ok(d.layers.every(l => l.material === 'acr3'));
    write_param(schema_entry('gap_mm'), d, 1, 6);
    assert.equal(d.layers[1].gap_mm, 6);
});

test('undo and redo walk the history; slider drags coalesce into one step', () => {
    let t = 0;
    const store = new Store(base_design(2), { now: () => t });
    store.update(d => (d.name = 'A'));
    for (const w of [300, 310, 320]) {
        t += 100;
        store.update(d => (d.piece.outline.w_mm = w), { coalesce_key: 'w' });
    }
    assert.equal(store.design.piece.outline.w_mm, 320);
    store.undo();
    assert.equal(store.design.piece.outline.w_mm, 290, 'one undo reverts the whole drag');
    assert.equal(store.design.name, 'A');
    store.undo();
    assert.equal(store.design.name, 'Untitled');
    assert.equal(store.undo(), false);
    store.redo();
    store.redo();
    assert.equal(store.design.piece.outline.w_mm, 320);
});

test('the undo history is capped', () => {
    const store = new Store(base_design(1));
    for (let i = 0; i < kUndoDepth + 20; i++) store.update(d => (d.seed = i));
    let steps = 0;
    while (store.undo()) steps++;
    assert.equal(steps, kUndoDepth);
});

test('the generator is deterministic, honours locks and keeps the back layer solid', () => {
    const a = base_design(6);
    const b = base_design(6);
    generate_stack(a, 99);
    generate_stack(b, 99);
    assert.deepEqual(a, b);
    assert.equal(a.layers.at(-1).source.motifs.length, 0);

    const c = base_design(6);
    c.piece.symmetry.n = 7;
    c.layers[2].locked = true;
    c.layers[2].source.motifs = [{ type: 'disc', d_mm: 12 }];
    generate_stack(c, 5, { lock_n: true });
    assert.equal(c.piece.symmetry.n, 7);
    assert.deepEqual(c.layers[2].source.motifs, [{ type: 'disc', d_mm: 12 }]);
});

test('there are at least five presets, each a valid design', () => {
    assert.ok(kPresets.length >= 5);
    for (const p of kPresets) {
        const d = p.make();
        assert.deepEqual(migrate(d), d, `${p.id} survives a save and reopen unchanged`);
        assert.ok(d.layers.slice(0, -1).some(l => l.source.motifs.length > 0), `${p.id} has openings`);
    }
});
