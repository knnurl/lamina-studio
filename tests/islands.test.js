// Islands, bridges, island policies and fabrication checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base_design } from '../src/core/design.js';
import { build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { components } from '../src/pipeline/islands.js';
import { check_level } from '../src/core/check_level.js';
import { kPresets } from '../src/core/presets.js';

const ring = (r_mm, w_mm, tie_mm = 0) => ({ type: 'ring', r_mm, w_mm, tie_mm, mult: 1, angle_deg: 0 });

// Layer 1 of 3 with two concentric tie-0 slot rings: a ring island and a disc island inside it.
function nested_rings() {
    const d = base_design(3);
    d.layers[0].source.motifs = [ring(60, 8), ring(30, 6)];
    return d;
}

test('nested rings: both islands bridged, chained to the body', () => {
    const b = build_design(nested_rings()).layers[0];
    assert.equal(b.islands.length, 2);
    assert.equal(b.unbridged.length, 0);
    assert.equal(components(b.material).length, 1, 'one piece after bridging');
    const by_island = id => b.bridges.filter(x => x.island === id);
    const [outer, inner] = [...b.islands].sort((p, q) => q.area_mm2 - p.area_mm2);
    assert.equal(by_island(outer.id).length, 3, 'large islands get three bridges');
    assert.equal(by_island(inner.id).length, 2);
    for (const x of by_island(outer.id)) assert.ok(Math.abs(x.length_mm - 8) < 0.05, `outer bridge ${x.length_mm}`);
    for (const x of by_island(inner.id)) assert.ok(Math.abs(x.length_mm - 6) < 0.05, `inner bridge ${x.length_mm}`);
});

test('bridges are spread at least 60 degrees apart around their island', () => {
    const b = build_design(nested_rings()).layers[0];
    const outer = [...b.islands].sort((p, q) => q.area_mm2 - p.area_mm2)[0];
    const angles = b.bridges.filter(x => x.island === outer.id).map(x => Math.atan2(x.a.y, x.a.x));
    for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
            const t = Math.abs(angles[i] - angles[j]) % (2 * Math.PI);
            assert.ok(Math.min(t, 2 * Math.PI - t) >= Math.PI / 3 - 1e-6);
        }
    }
});

test('island ids are stable when other things change', () => {
    const a = build_design(nested_rings()).layers[0].islands.map(i => i.id).sort();
    const d = nested_rings();
    d.layers[1].source.motifs = [{ type: 'disc', d_mm: 40 }];
    d.layers[0].overrides.islands[a[0]] = 'drop';
    const b = build_design(d).layers[0].islands.map(i => i.id).sort();
    assert.deepEqual(b, a);
});

test('drop removes an island; glue cuts it loose with a locator on the layer behind', () => {
    const base = build_design(nested_rings());
    const inner = [...base.layers[0].islands].sort((p, q) => p.area_mm2 - q.area_mm2)[0];

    const dropped = nested_rings();
    dropped.layers[0].overrides.islands[inner.id] = 'drop';
    const bd = build_design(dropped).layers[0];
    // The area falls by the island plus its two bridges (each about 6 mm across, 1.2 mm wide, with
    // a short overlap into both sides).
    const fall = base.layers[0].area_mm2 - bd.area_mm2;
    assert.ok(fall > inner.area_mm2 && fall < inner.area_mm2 + 2 * 9 * 1.2, `area fell by ${fall}`);
    assert.equal(bd.bridges.filter(x => x.island === inner.id).length, 0);

    const glued = nested_rings();
    glued.layers[0].overrides.islands[inner.id] = 'glue';
    const bg = build_design(glued);
    assert.equal(bg.layers[0].parts.length, 1);
    assert.equal(bg.layers[1].locators.length, 1, 'scored outline on the layer behind');
    assert.ok(!bg.checks.some(c => c.id === 'G-03'), 'solid layer behind, no gap: fine');

    glued.layers[0].gap_mm = 3;
    assert.ok(build_design(glued).checks.some(c => c.id === 'G-03' && c.severity === 'fatal'), 'a gap leaves it floating');

    glued.layers[0].gap_mm = 0;
    glued.layers[1].source.motifs = [{ type: 'disc', d_mm: 70 }];
    assert.ok(build_design(glued).checks.some(c => c.id === 'G-03'), 'an opening behind leaves nothing to sit on');
});

test('an override turns a fatal finding into an allowed one', () => {
    const d = nested_rings();
    const inner = [...build_design(d).layers[0].islands].sort((p, q) => p.area_mm2 - q.area_mm2)[0];
    d.layers[0].overrides.islands[inner.id] = 'glue';
    d.layers[0].gap_mm = 3;
    assert.equal(check_level(build_design(d).checks), 'bad');
    d.check_overrides.push('G-03@0');
    const checks = build_design(d).checks;
    assert.ok(checks.find(c => c.id === 'G-03').overridden);
    assert.equal(check_level(checks), 'warn');
});

test('thin webs: true positives at the right size, bridges not counted', () => {
    const webbed = gap => {
        const d = base_design(2);
        d.piece.symmetry = { kind: 'none', n: 1, phase_deg: 0 };
        const half = 20 / Math.SQRT2; // squares of side 20 mm
        d.layers[0].source.motifs = [0, 180].map(angle_deg => ({
            type: 'window', r_mm: 10 + gap / 2, size_mm: 2 * half, sides: 4, rot_deg: 45, mult: 1, angle_deg,
        }));
        const b = build_design(d);
        return slow_checks(d, b.layers);
    };
    const one = webbed(1.0);
    assert.deepEqual(one.map(c => c.id), ['W-01']);
    const box = one[0].boxes[0];
    assert.ok(Math.abs(box.x1 - box.x0 - 1.0) < 0.01 && Math.abs(box.y1 - box.y0 - 20) < 0.05);
    assert.deepEqual(webbed(0.1).map(c => c.id).sort(), ['G-02', 'W-01']);
    assert.deepEqual(webbed(3.0), []);

    const d = nested_rings();
    const b = build_design(d);
    assert.ok(!slow_checks(d, b.layers).some(c => c.id === 'W-01'), '1.2 mm bridges are not thin webs');
});

test('long bridges warn', () => {
    const d = base_design(2);
    d.layers[0].source.motifs = [ring(60, 20)];
    assert.ok(build_design(d).checks.some(c => c.id === 'W-03'));
});

test('gaps must be whole spacers; a backlit piece needs light through the back', () => {
    const d = base_design(3);
    d.layers[0].gap_mm = 4;
    d.layers[1].gap_mm = 6;
    const w04 = build_design(d).checks.filter(c => c.id === 'W-04');
    assert.deepEqual(w04.map(c => c.layer), [0]);

    d.piece.lighting.mode = 'backlit';
    assert.ok(build_design(d).checks.some(c => c.id === 'W-06'));
    d.layers.at(-1).material = 'acr3t';
    assert.ok(!build_design(d).checks.some(c => c.id === 'W-06'));
});

test('no preset has a fatal finding', () => {
    for (const p of kPresets) {
        const d = p.make();
        const b = build_design(d);
        const fatal = [...b.checks, ...slow_checks(d, b.layers)].filter(c => c.severity === 'fatal');
        assert.deepEqual(fatal.map(c => c.key), [], p.id);
    }
});

test('concentric islands get distinct IDs, so policies and bridges stay per island', () => {
    const d = base_design(3);
    d.layers[0].source.motifs = [ring(90, 6), ring(80, 6), ring(70, 6), ring(60, 6)];
    const b = build_design(d).layers[0];
    assert.equal(b.islands.length, 4, 'three rings and the centre disc, all centred on the origin');
    assert.equal(new Set(b.islands.map(i => i.id)).size, 4);
    // Shared IDs mixed the islands' bridges, so extra bridges found no room: each island gets the
    // count its area asks for (two under 2500 mm2, three above).
    for (const i of b.islands) {
        const want = i.area_mm2 < 2500 ? 2 : 3;
        assert.equal(b.bridges.filter(x => x.island === i.id).length, want, `island of ${i.area_mm2.toFixed(0)} mm2`);
    }
});

test('a dragged bridge keeps its angle, and only that island changes', () => {
    const d = nested_rings();
    const before = build_design(d).layers[0];
    const [outer, inner] = [...before.islands].sort((p, q) => q.area_mm2 - p.area_mm2);
    d.layers[0].overrides.bridge_angles = { [outer.id]: [45, 165] };
    const after = build_design(d).layers[0];
    const own = after.bridges.filter(x => x.island === outer.id);
    assert.equal(own.length, 2);
    const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    assert.ok(gap(own[0].angle_deg, 45) < 3, `first at ${own[0].angle_deg}`);
    assert.ok(gap(own[1].angle_deg, 165) < 3, `second at ${own[1].angle_deg}`);
    assert.deepEqual(after.unbridged, []);
    assert.equal(components(after.material).length, 1);
    const inner_before = before.bridges.filter(x => x.island === inner.id).map(x => x.angle_deg);
    const inner_after = after.bridges.filter(x => x.island === inner.id).map(x => x.angle_deg);
    assert.equal(inner_after.length, inner_before.length);
});

test('islands packed among islands all reach the body (spanning tree, not nearest three only)', () => {
    // A grid of small discs cut free by a lattice of slots: every disc's nearest neighbours are
    // other discs, so only a group-to-group tie reaches the body.
    const d = base_design(2);
    d.piece.outline = { kind: 'rect', w_mm: 160, h_mm: 160 };
    d.piece.symmetry = { kind: 'none', n: 1, phase_deg: 0 };
    d.piece.depth_mode = 'field';
    d.piece.field = { kind: 'chladni', scale_mm: 14, k: 5, a: 0, lo: 0.42, hi: 1 };
    const b = build_design(d).layers[0];
    assert.ok(b.islands.length > 20, `${b.islands.length} islands`);
    assert.deepEqual(b.unbridged, []);
    assert.equal(components(b.material).length, 1);
});
