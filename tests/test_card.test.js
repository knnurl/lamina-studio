// The calibration test card: its features measure what the instructions say, at nominal size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build_test_card, test_card_zip, kCard } from '../src/export/test_card.js';
import { bounds_mm, path_area_um2 } from '../src/geom/clip.js';

const card = build_test_card('SVG');
const cuts = card.items.filter(i => i.layer === 'CUT').map(i => i.points);
const outers = cuts.filter(p => path_area_um2(p) > 0);
const holes = cuts.filter(p => path_area_um2(p) < 0);
const size = p => {
    const b = bounds_mm([p]);
    return { w: +(b.x1 - b.x0).toFixed(3), h: +(b.y1 - b.y0).toFixed(3), b };
};

function inside(pt, path) {
    let hit = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        const a = path[i];
        const b = path[j];
        if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
}

test('one outer contour, 150 x 100 mm: every bridged island stays attached', () => {
    assert.equal(outers.length, 1);
    assert.deepEqual(bounds_mm(outers), { x0: 0, y0: 0, x1: 150, y1: 100 });
    // kerf square + 8 web slots + key + 7 dowels + 6 windows x 2 + 6 holes
    assert.equal(holes.length, 1 + 8 + 1 + 7 + 12 + 6);
});

test('holes are cut before the outline', () => {
    const last_cut = card.items.filter(i => i.layer === 'CUT').at(-1).points;
    assert.equal(last_cut, outers[0]);
    const first_cut = card.items.findIndex(i => i.layer === 'CUT');
    assert.ok(card.items.slice(0, first_cut).every(i => i.layer !== 'CUT'));
});

test('kerf square and key are exact nominal rectangles', () => {
    const squares = holes.filter(p => p.length === 4).map(size);
    assert.ok(squares.some(s => s.w === 20 && s.h === 20), 'kerf square 20 x 20');
    assert.ok(squares.some(s => s.w === 10 && s.h === 16), 'key 10 x 16');
});

test('web ladder webs are the nominal widths', () => {
    const slots = holes
        .map(size)
        .filter(s => s.w === kCard.web.slot_w_mm && s.h === kCard.web.slot_h_mm)
        .sort((a, b) => a.b.x0 - b.b.x0);
    assert.equal(slots.length, kCard.web.webs_mm.length + 1);
    const webs = slots.slice(1).map((s, i) => +(s.b.x0 - slots[i].b.x1).toFixed(3));
    assert.deepEqual(webs, kCard.web.webs_mm);
});

test('dowel and ladder holes clear their nominal diameter (circumscribed polygons)', () => {
    const round = holes.filter(p => p.length > 12); // rectangles have 4 vertices, bridge windows 8
    const nominal = [...kCard.dowel.holes_mm, ...kCard.hole.holes_mm];
    assert.equal(round.length, nominal.length);
    for (const p of round) {
        // The vertex mean is a regular polygon's exact centre; the bounding box centre is not
        // when the side count is odd.
        const cx = p.reduce((s, v) => s + v.x, 0) / p.length;
        const cy = p.reduce((s, v) => s + v.y, 0) / p.length;
        let inscribed = Infinity;
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
            const dx = p[i].x - p[j].x;
            const dy = p[i].y - p[j].y;
            const dist = Math.abs(dx * (p[j].y - cy) - dy * (p[j].x - cx)) / Math.hypot(dx, dy);
            inscribed = Math.min(inscribed, dist);
        }
        const d_mm = (2 * inscribed) / 1000;
        const match = nominal.find(n => Math.abs(n - d_mm) < 0.004);
        assert.ok(match !== undefined, `inscribed diameter ${d_mm.toFixed(4)} mm matches no nominal hole`);
        assert.ok(d_mm >= match - 0.002, `hole ${match} mm is ${d_mm.toFixed(4)} mm inside, too tight`);
    }
});

test('fit notches are 10 mm plus the stated clearances', () => {
    const depth_um = kCard.notch.depth_mm * 1000;
    const tops = outers[0].filter(p => p.y === depth_um).map(p => p.x).sort((a, b) => a - b);
    const widths = [];
    for (let i = 0; i < tops.length; i += 2) widths.push(+((tops[i + 1] - tops[i]) / 1000).toFixed(3));
    assert.deepEqual(
        widths,
        kCard.notch.clearances_mm.map(c => +(kCard.notch.base_w_mm + c).toFixed(3)),
    );
});

test('engraving sits on material: on the card or on the P and KEY drop-outs only', () => {
    const dropouts = holes.filter(p => {
        const s = size(p);
        return (s.w === 20 && s.h === 20) || (s.w === 10 && s.h === 16);
    });
    for (const item of card.items.filter(i => i.layer === 'ENGRAVE')) {
        for (const pt of item.points) {
            assert.ok(inside(pt, outers[0]), `engraving outside the card at ${pt.x}, ${pt.y}`);
            const in_hole = holes.find(h => inside(pt, h));
            assert.ok(!in_hole || dropouts.includes(in_hole), `engraving over a hole at ${pt.x}, ${pt.y}`);
        }
    }
});

test('the score ramp has five lines on five colour layers', () => {
    const ramp = card.items.filter(i => i.layer.startsWith('RAMP_')).map(i => i.layer);
    assert.deepEqual(ramp, ['RAMP_1', 'RAMP_2', 'RAMP_3', 'RAMP_4', 'RAMP_5']);
});

test('the zip is deterministic and holds the three files', () => {
    const a = test_card_zip();
    assert.equal(a.name, 'lamina_test_card.zip');
    assert.deepEqual(a.bytes, test_card_zip().bytes);
    const text = new TextDecoder().decode(a.bytes);
    for (const name of ['test_card.svg', 'test_card.dxf', 'test_card_instructions.txt']) {
        assert.ok(text.includes(name), name);
    }
});
