// Calibration: the test card's measurements become physical material limits, and the design uses
// them (checks, dowel holes, kerf in exports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, measured_material, kLadders } from '../src/core/calibrate.js';
import { kCard } from '../src/export/test_card.js';
import { kMaterials, material_of, migrate } from '../src/core/design.js';
import { preset_by_id } from '../src/core/presets.js';
import { build_design } from '../src/pipeline/compose.js';
import { hole_d_mm } from '../src/pipeline/registration.js';
import { export_parts } from '../src/export/export_design.js';

// A card cut with a 0.18 mm kerf: the piece is 20 - 0.18, the hole 20 + 0.18.
const kCut = { p_mm: 19.82, h_mm: 20.18, web_mm: 1.2, bridge_mm: 1.0, hole_mm: 0.8, dowel_hole_mm: 3.05, notch_mm: 0.05, score_line: 3 };

test('the formulas of SPEC 9.4', () => {
    const r = calibrate(kCut);
    assert.equal(r.ok, true, r.problems.join(' '));
    assert.equal(r.kerf_mm, 0.18);
    assert.equal(r.scale_mm, 20);
    assert.equal(r.min_web_mm, 1.02);
    assert.equal(r.min_bridge_mm, 0.82);
    assert.equal(r.min_hole_mm, 0.98);
    assert.equal(r.dowel_clearance_mm, 0.23);
    assert.equal(r.fit_clearance_mm, 0.41);
});

test('a wrong import scale, a swapped reading or an absurd kerf stops the save', () => {
    assert.match(calibrate({ ...kCut, p_mm: 14.86, h_mm: 15.14 }).problems.join(), /Scale check failed/);
    assert.match(calibrate({ ...kCut, p_mm: 20.18, h_mm: 19.82 }).problems.join(), /must be larger/);
    assert.match(calibrate({ ...kCut, p_mm: 19.2, h_mm: 20.8 }).problems.join(), /implausible/);
    assert.equal(calibrate({ ...kCut, p_mm: '' }).ok, false);
});

test('the card and the calculator share one set of ladders', () => {
    assert.equal(kCard.web.webs_mm, kLadders.webs_mm);
    assert.equal(kCard.bridge.bridges_mm, kLadders.bridges_mm);
    assert.equal(kCard.dowel.holes_mm, kLadders.dowel_holes_mm);
    assert.equal(kCard.notch.clearances_mm, kLadders.clearances_mm);
});

test('a measured material drives the checks, the dowel hole and the export kerf', () => {
    const d = preset_by_id('orb');
    const m = measured_material(kMaterials.ply3, calibrate(kCut), kCut);
    d.materials.ply3 = m;
    const design = migrate(d);
    assert.equal(material_of(design, design.layers[0]).kerf_mm, 0.18);
    assert.ok(material_of(design, design.layers[0]).label.endsWith('(measured)'));
    assert.equal(hole_d_mm(design), 3.23);
    const b = build_design(design);
    const l1 = export_parts(design, b.layers, b.registration).find(p => p.key === 'L01');
    assert.ok(Math.abs(l1.w - 290.18) < 0.02, `cut width ${l1.w}`);
});
