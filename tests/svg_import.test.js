// SVG import: units, transforms, shapes, fill rules, groups, files, and the private fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { read_svg, import_svg_files, parse_xml } from '../src/sources/svg_import.js';
import { parse_path } from '../src/sources/svg_path.js';
import { union_fill, area_mm2 } from '../src/geom/clip.js';
import { to_flat } from '../src/geom/pack.js';
import { design_from_import, migrate } from '../src/core/design.js';
import { build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';

const svg = (attrs, body) => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const um = layer => layer.polys.map(p => p.map(([x, y]) => ({ x: Math.round(x * 1000), y: Math.round(y * 1000) })));
const area = (layer, even_odd = true) => area_mm2(union_fill(um(layer), even_odd));
const bbox = layer => {
    const pts = layer.polys.flat();
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('units: viewBox scaled to mm width and height', () => {
    const r = read_svg(svg('width="100mm" height="50mm" viewBox="0 0 200 100"', '<rect width="200" height="100"/>'));
    const b = bbox(r.layers[0]);
    assert.ok(near(b.w, 100, 1e-9) && near(b.h, 50, 1e-9));
});

test('units: px is 1/96 in, but 1/72 in in Illustrator files', () => {
    const plain = read_svg(svg('width="96" height="96" viewBox="0 0 96 96"', '<rect width="96" height="96"/>'));
    assert.ok(near(bbox(plain.layers[0]).w, 25.4, 1e-9));
    const ai = read_svg('<!-- Generator: Adobe Illustrator 22.0.0 -->\n' + svg('width="72px" height="72px" viewBox="0 0 72 72"', '<rect width="72" height="72"/>'));
    assert.equal(ai.illustrator, true);
    assert.ok(near(bbox(ai.layers[0]).w, 25.4, 1e-9));
    const pt = read_svg(svg('width="72pt" height="36pt"', '<rect width="96" height="48"/>'));
    assert.ok(near(bbox(pt.layers[0]).w, 25.4, 1e-9), 'no viewBox: user units are px');
});

test('nested transforms: translate, scale, rotate about a point', () => {
    const r = read_svg(
        svg('width="100mm" height="100mm" viewBox="0 0 100 100"', '<g transform="translate(10 10) scale(2)"><rect width="10" height="5" transform="rotate(90 5 2.5)"/></g>'),
    );
    const b = bbox(r.layers[0]);
    assert.ok(near(b.w, 10, 1e-6) && near(b.h, 20, 1e-6), JSON.stringify(b));
    assert.ok(near(area(r.layers[0]), 200, 1e-3));
});

// Flattening at 0.02 mm can lose at most perimeter x 0.02 mm2 of a convex curved shape.
const kTolMm = 0.02;

test('shapes: circle, ellipse, rounded rect and polygon areas', () => {
    const doc = body => read_svg(svg('width="100mm" height="100mm" viewBox="0 0 100 100"', body)).layers[0];
    assert.ok(near(area(doc('<circle cx="50" cy="50" r="20"/>')), Math.PI * 400, 2 * Math.PI * 20 * kTolMm));
    assert.ok(near(area(doc('<ellipse cx="50" cy="50" rx="30" ry="10"/>')), Math.PI * 300, 2 * Math.PI * 30 * kTolMm));
    const rr = area(doc('<rect x="10" y="10" width="40" height="20" rx="5"/>'));
    assert.ok(near(rr, 40 * 20 - (4 - Math.PI) * 25, 2 * Math.PI * 5 * kTolMm), `rounded rect ${rr}`);
    assert.ok(near(area(doc('<polygon points="0,0 40,0 40,30"/>')), 600, 1e-6));
});

test('path arcs: a semicircle, with flags written apart or run together', () => {
    for (const d of ['M0 0 A10 10 0 0 1 20 0 Z', 'M0,0a10,10,0,0,1,20,0z', 'M0 0a10 10 0 0120 0z']) {
        const sub = parse_path(d);
        assert.equal(sub.length, 1, d);
        const r = read_svg(svg('width="50mm" height="50mm" viewBox="0 0 50 50"', `<path d="${d}"/>`));
        assert.ok(near(area(r.layers[0]), (Math.PI * 100) / 2, Math.PI * 10 * kTolMm), `${d}: ${area(r.layers[0])}`);
    }
});

test('fill rules: nested contours of the same direction make a hole under even-odd only', () => {
    const r = read_svg(svg('width="100mm" height="100mm" viewBox="0 0 100 100"', '<path d="M0 0H60V60H0Z M20 20H40V40H20Z"/>'));
    assert.ok(near(area(r.layers[0], true), 3600 - 400, 1e-6));
    assert.ok(near(area(r.layers[0], false), 3600, 1e-6));
});

test('open paths, lines and text are counted, hidden elements skipped', () => {
    const r = read_svg(
        svg(
            'width="100mm" height="100mm" viewBox="0 0 100 100"',
            '<rect width="10" height="10"/><path d="M0 0 L50 50"/><line x1="0" y1="0" x2="5" y2="5"/>' +
                '<text x="1" y="1">hi</text><rect width="90" height="90" style="display:none"/><defs><rect width="99" height="99"/></defs>',
        ),
    );
    assert.equal(r.layers[0].polys.length, 1);
    assert.equal(r.layers[0].open, 2);
    assert.equal(r.layers[0].skipped, 1);
});

test('two top-level groups become two layers, the last drawn in front', () => {
    const r = read_svg(
        svg('width="100mm" height="100mm" viewBox="0 0 100 100"', '<g id="Back"><rect width="100" height="100"/></g><g data-name="Front"><circle cx="50" cy="50" r="10"/></g>'),
    );
    assert.deepEqual(r.layers.map(l => l.name), ['Front', 'Back']);
});

test('the XML reader copes with a DOCTYPE subset, comments, CDATA and entities', () => {
    const root = parse_xml('<!DOCTYPE svg [ <!ENTITY a "b"> ]><!-- c --><svg><![CDATA[ <x/> ]]><g id="a&amp;b"/></svg>');
    const s = root.children[0];
    assert.equal(s.name, 'svg');
    assert.equal(s.children.length, 1);
    assert.equal(s.children[0].attrs.id, 'a&b');
});

test('several files: one layer each in natural name order, centred, with a silhouette outline', () => {
    const file = (name, body) => ({ name, text: svg('width="100mm" height="100mm" viewBox="0 0 100 100"', body) });
    const r = import_svg_files([
        file('part-10.svg', '<rect x="0" y="0" width="100" height="100"/>'),
        file('part-2.svg', '<rect x="25" y="25" width="50" height="50"/>'),
    ]);
    assert.deepEqual(r.layers.map(l => l.name), ['part-2', 'part-10']);
    const xs = r.layers[1].paths.flat().map(p => p.x);
    assert.equal(Math.min(...xs) + Math.max(...xs), 0, 'centred on the origin');
    assert.equal(r.outline.length, 1);
    assert.ok(near(area_mm2(r.outline), 10000, 1e-6));
});

const kFixture = 'data/fixtures/37_mandala/';
const have_fixture = fs.existsSync(kFixture);

test('private fixture: the purchased 7-layer mandala imports at 291 mm and builds without a fatal finding', { skip: !have_fixture && 'private fixture absent' }, () => {
    const files = fs.readdirSync(kFixture).map(name => ({ name, text: fs.readFileSync(kFixture + name, 'utf8') }));
    const r = import_svg_files(files);
    assert.ok(near(r.size_mm.w, 290.9, 0.2) && near(r.size_mm.h, 290.9, 0.2), JSON.stringify(r.size_mm));
    assert.deepEqual(r.layers.map(l => l.paths.length), [62, 245, 425, 473, 393, 281, 1]);
    const design = migrate(design_from_import({ layers: r.layers.map(l => ({ name: l.name, paths: to_flat(l.paths) })), outline: to_flat(r.outline), size_mm: r.size_mm }, '37 Mandala'));
    const b = build_design(design);
    const fatal = [...b.checks, ...slow_checks(design, b.layers)].filter(c => c.severity === 'fatal');
    assert.deepEqual(fatal, []);
    assert.ok(b.layers.every(l => l.islands.length === 0));
});
