// Cut-file writers, zip and stroke font: exact output on small drawings, so format regressions show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { um_text } from '../src/export/drawing.js';
import { drawing_to_svg } from '../src/export/svg.js';
import { drawing_to_dxf } from '../src/export/dxf.js';
import { zip_store, crc32 } from '../src/export/zip_store.js';
import { text_strokes, text_width_mm, has_glyph } from '../src/export/stroke_font.js';

// A 10 x 5 mm page: a 2 mm square cut at (1, 1) and an engraved line from (0, 0) to (3, 4).
const kDrawing = {
    width_mm: 10,
    height_mm: 5,
    items: [
        {
            layer: 'ENGRAVE',
            closed: false,
            points: [
                { x: 0, y: 0 },
                { x: 3000, y: 4000 },
            ],
        },
        {
            layer: 'CUT',
            closed: true,
            points: [
                { x: 1000, y: 1000 },
                { x: 3000, y: 1000 },
                { x: 3000, y: 3000 },
                { x: 1000, y: 3000 },
            ],
        },
    ],
};

test('micrometres format as millimetres with no float noise', () => {
    assert.equal(um_text(12345), '12.345');
    assert.equal(um_text(1000), '1');
    assert.equal(um_text(1500), '1.5');
    assert.equal(um_text(-50), '-0.05');
    assert.equal(um_text(0), '0');
    assert.throws(() => um_text(1.5), /not an integer/);
});

test('SVG: mm page, one hairline group per layer, y flipped', () => {
    const svg = drawing_to_svg(kDrawing);
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="10mm" height="5mm" viewBox="0 0 10 5">/);
    assert.ok(svg.includes('<g id="ENGRAVE" fill="none" stroke="#00FF00" stroke-width="0.025">\n<path d="M0 5 L3 1"/>'));
    assert.ok(svg.includes('<g id="CUT" fill="none" stroke="#FF0000" stroke-width="0.025">\n<path d="M1 4 L3 4 L3 2 L1 2 Z"/>'));
    assert.ok(svg.indexOf('id="ENGRAVE"') < svg.indexOf('id="CUT"'), 'engrave before cut');
    assert.ok(!svg.includes('fill="#'), 'no fills on vector paths');
});

function dxf_pairs(text) {
    const lines = text.trimEnd().split('\n');
    assert.equal(lines.length % 2, 0);
    const pairs = [];
    for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]]);
    return pairs;
}

test('DXF R12: mm units, layer table with colours, closed and open polylines', () => {
    const pairs = dxf_pairs(drawing_to_dxf(kDrawing));
    const after = (name, code) => pairs[pairs.findIndex(([c, v]) => c === 9 && v === name) + 1];
    assert.deepEqual(after('$ACADVER'), [1, 'AC1009']);
    assert.deepEqual(after('$INSUNITS'), [70, '4']);
    assert.deepEqual(after('$MEASUREMENT'), [70, '1']);
    assert.deepEqual(pairs.at(-1), [0, 'EOF']);

    const layers = [];
    pairs.forEach(([c, v], i) => {
        if (c === 0 && v === 'LAYER') layers.push([pairs[i + 1][1], pairs[i + 3][1]]);
    });
    assert.deepEqual(layers, [
        ['ENGRAVE', '3'],
        ['CUT', '1'],
    ]);

    const polylines = [];
    pairs.forEach(([c, v], i) => {
        if (c !== 0 || v !== 'POLYLINE') return;
        const flag = pairs.slice(i).find(([code]) => code === 70)[1];
        const vertices = [];
        for (let j = i + 1; pairs[j][1] !== 'SEQEND'; j++) {
            if (pairs[j][0] === 0 && pairs[j][1] === 'VERTEX') vertices.push([pairs[j + 2][1], pairs[j + 3][1]]);
        }
        polylines.push({ layer: pairs[i + 1][1], flag, vertices });
    });
    assert.deepEqual(polylines, [
        { layer: 'ENGRAVE', flag: '0', vertices: [['0', '0'], ['3', '4']] },
        { layer: 'CUT', flag: '1', vertices: [['1', '1'], ['3', '1'], ['3', '3'], ['1', '3']] },
    ]);
});

test('unknown layers are rejected', () => {
    const bad = { ...kDrawing, items: [{ layer: 'GUIDE', closed: false, points: [{ x: 0, y: 0 }] }] };
    assert.throws(() => drawing_to_svg(bad), /unknown layer "GUIDE"/);
});

test('crc32 matches zlib', () => {
    const data = new TextEncoder().encode('Lamina Studio test card');
    assert.equal(crc32(data), zlib.crc32(data));
    assert.equal(crc32(new Uint8Array(0)), 0);
});

test('store-only zip: valid records, fixed dates, deterministic', () => {
    const files = [
        { name: 'a.txt', data: 'hello' },
        { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ];
    const zip = zip_store(files);
    assert.deepEqual(zip, zip_store(files));
    const view = new DataView(zip.buffer);
    const eocd = zip.length - 22;
    assert.equal(view.getUint32(eocd, true), 0x06054b50);
    assert.equal(view.getUint16(eocd + 10, true), 2);
    let at = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (const f of files) {
        assert.equal(view.getUint32(at, true), 0x02014b50);
        assert.equal(view.getUint16(at + 10, true), 0, 'stored');
        assert.equal(view.getUint16(at + 14, true), 0x0021, 'DOS date 1980-01-01');
        const size = view.getUint32(at + 24, true);
        const name_len = view.getUint16(at + 28, true);
        const local = view.getUint32(at + 42, true);
        assert.equal(decoder.decode(zip.subarray(at + 46, at + 46 + name_len)), f.name);
        const data_at = local + 30 + view.getUint16(local + 26, true);
        const data = zip.subarray(data_at, data_at + size);
        const expected = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
        assert.deepEqual(new Uint8Array(data), expected);
        assert.equal(view.getUint32(at + 16, true), zlib.crc32(expected));
        at += 46 + name_len;
    }
});

test('stroke font: alignment, width and unknown characters', () => {
    assert.equal(text_width_mm('AB', 6), 10); // 4 + 6 units at 1 mm per unit
    const left = text_strokes('A', { x_mm: 10, y_mm: 0, cap_mm: 6 });
    const right = text_strokes('A', { x_mm: 10, y_mm: 0, cap_mm: 6, align: 'right' });
    const centre = text_strokes('A', { x_mm: 10, y_mm: 0, cap_mm: 6, align: 'centre' });
    const min_x = strokes => Math.min(...strokes.flat().map(p => p.x));
    assert.equal(min_x(left), 10000);
    assert.equal(min_x(right), 6000);
    assert.equal(min_x(centre), 8000);
    assert.throws(() => text_strokes('a~', { x_mm: 0, y_mm: 0, cap_mm: 2 }), /no glyph for "~"/);
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-+=/()^ ') assert.ok(has_glyph(ch), ch);
});
