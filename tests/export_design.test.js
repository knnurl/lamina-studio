// Sheet packing and the design export: kerf, sheets, files, determinism, blocking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack } from '../src/export/pack.js';
import { assembly_html } from '../src/export/assembly.js';
import { export_design, export_parts, layout_sheets } from '../src/export/export_design.js';
import { build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { preset_by_id } from '../src/core/presets.js';
import { bounds_mm, path_area_um2 } from '../src/geom/clip.js';

const kSheet = { w_mm: 600, h_mm: 400, margin_mm: 4, spacing_mm: 3 };

function boxes(sheet_items, sizes) {
    return sheet_items.map(p => {
        const { w, h } = sizes[p.key];
        return p.rotated ? { x0: p.x, y0: p.y, x1: p.x + h, y1: p.y + w } : { x0: p.x, y0: p.y, x1: p.x + w, y1: p.y + h };
    });
}

test('packing: inside the margins, never overlapping, deterministic', () => {
    const items = [];
    const sizes = {};
    for (let i = 0; i < 5; i++) items.push({ key: `disc${i}`, w: 290.2, h: 290.2 });
    for (let i = 0; i < 12; i++) items.push({ key: `puck${i}`, w: 9.3, h: 9.3 });
    items.push({ key: 'bar', w: 380, h: 40 });
    for (const it of items) sizes[it.key] = it;
    const a = pack(items, kSheet);
    assert.deepEqual(a, pack(items, kSheet));
    assert.equal(a.unplaced.length, 0);
    for (const sheet of a.sheets) {
        const bs = boxes(sheet, sizes);
        for (const b of bs) {
            assert.ok(b.x0 >= 4 - 1e-9 && b.y0 >= 4 - 1e-9 && b.x1 <= 596 + 1e-9 && b.y1 <= 396 + 1e-9, JSON.stringify(b));
        }
        for (let i = 0; i < bs.length; i++) {
            for (let j = i + 1; j < bs.length; j++) {
                const p = bs[i];
                const q = bs[j];
                const apart = p.x1 + 3 - 1e-9 <= q.x0 || q.x1 + 3 - 1e-9 <= p.x0 || p.y1 + 3 - 1e-9 <= q.y0 || q.y1 + 3 - 1e-9 <= p.y0;
                assert.ok(apart, `boxes ${i} and ${j} overlap or are closer than the spacing`);
            }
        }
    }
    assert.equal(a.sheets.length, 3, 'two discs per sheet; small parts fill earlier sheets first');
    assert.ok(a.sheets[0].some(p => p.key.startsWith('puck')), 'pucks go into the first sheet\'s spare strip');
});

test('packing turns a part when only the other way fits, and reports parts too big', () => {
    const tall = pack([{ key: 'tall', w: 300, h: 550 }], kSheet);
    assert.equal(tall.sheets[0][0].rotated, true);
    const huge = pack([{ key: 'huge', w: 700, h: 100 }], kSheet);
    assert.deepEqual(huge.unplaced, ['huge']);
});

test('kerf: outlines grow and holes shrink by the kerf', () => {
    const d = preset_by_id('orb');
    const b = build_design(d);
    const parts = export_parts(d, b.layers, b.registration);
    const l1 = parts.find(p => p.key === 'L01');
    assert.ok(Math.abs(l1.w - 290.2) < 0.02, `cut width ${l1.w}`);
    // The centre opening of layer 1: design diameter vs cut diameter.
    const design_hole = b.layers[0].material.filter(p => path_area_um2(p) < 0).sort((p, q) => path_area_um2(p) - path_area_um2(q))[0];
    const cut_hole = l1.cut.filter(p => path_area_um2(p) < 0).sort((p, q) => path_area_um2(p) - path_area_um2(q))[0];
    const width = p => bounds_mm([p]).x1 - bounds_mm([p]).x0;
    assert.ok(Math.abs(width(design_hole) - width(cut_hole) - 0.2) < 0.02);
});

test('the export holds every file, sheets per material, and is byte-identical run to run', () => {
    const d = preset_by_id('orb');
    d.layers[2].gap_mm = 3;
    d.layers.at(-1).material = 'acr3t';
    const b = build_design(d);
    const checks = [...b.checks, ...slow_checks(d, b.layers)];
    const out = export_design(d, b.layers, b.registration, checks);
    assert.deepEqual(out.bytes, export_design(d, b.layers, b.registration, checks).bytes);
    const text = new TextDecoder().decode(out.bytes);
    for (const name of ['design.json', 'checks.txt', 'assembly.html', 'layers/L01.svg', 'layers/L08.dxf', 'parts/gap03_puck_x3.svg']) {
        assert.ok(text.includes(`lamina_orb/${name}`), name);
    }
    assert.deepEqual(out.summary.sheets.map(s => s.material).sort(), ['acr3t', 'ply3'], 'materials never share a sheet');
    assert.deepEqual(out.summary.unplaced, []);
    const { sheets } = layout_sheets(d, export_parts(d, b.layers, b.registration));
    assert.ok(sheets.every(s => s.placements.length > 0));
});

test('the assembly sheet escapes the design name and lists every layer', () => {
    const d = preset_by_id('sun');
    d.name = 'Sun <script>alert(1)</script>';
    const b = build_design(d);
    const parts = export_parts(d, b.layers, b.registration);
    const html = assembly_html(d, b.layers, b.registration, [], parts, layout_sheets(d, parts).sheets);
    assert.ok(!html.includes('<script>alert(1)'), 'name is escaped');
    assert.ok(html.includes('Sun &lt;script&gt;'));
    assert.equal((html.match(/<figcaption>Layer \d+<\/figcaption>/g) ?? []).length, d.layers.length);
});
