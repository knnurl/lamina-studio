// Photos to layers (SPEC M5): the raster helpers, and the promise the photo flow makes. Its bands
// preview shows what the field cuts, and evened-out tones give each layer an equal share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shrink, equalise, raster, band_preview, bytes_to_base64, base64_to_bytes, grey_of, kRedLean } from '../src/image/raster.js';
import { base_design, apply_photo } from '../src/core/design.js';
import { field_material, field_level } from '../src/sources/field.js';
import { area_mm2 } from '../src/geom/clip.js';

test('shrink averages areas, base64 round-trips, the hash follows the content', () => {
    const grey = Uint8Array.from([0, 20, 100, 100, 40, 60, 100, 100, 0, 0, 255, 255, 0, 0, 255, 255]);
    const s = shrink(grey, 4, 4, 2);
    assert.deepEqual([s.w, s.h, ...s.grey], [2, 2, 30, 100, 0, 255]);
    assert.equal(shrink(grey, 4, 4, 8).grey, grey, 'never enlarges');
    assert.deepEqual(base64_to_bytes(bytes_to_base64(grey)), grey);
    const r = raster(grey, 4, 4);
    assert.match(r.hash, /^4x4-[0-9a-z]+$/);
    assert.notEqual(raster(Uint8Array.from(grey, v => 255 - v), 4, 4).hash, r.hash);
    // The engraving grey leans red: a red pixel is lighter than in plain luminance.
    assert.ok(grey_of(Uint8Array.from([200, 40, 40, 255]), kRedLean)[0] > grey_of(Uint8Array.from([200, 40, 40, 255]))[0]);
});

test('evening out spreads the tones over the whole range, in order', () => {
    // Mostly dark: 90% of pixels below 30.
    const grey = Uint8Array.from({ length: 1000 }, (_, i) => (i < 900 ? Math.floor(i / 30) : 200 + Math.floor((i - 900) / 2)));
    const even = equalise(grey);
    // Each tone lands at its percentile: the 30 darkest tones hold 3% each, the brightest 0.2%.
    assert.ok(Math.min(...even) <= 5 && Math.max(...even) >= 250, `range ${Math.min(...even)} to ${Math.max(...even)}`);
    for (let i = 1; i < grey.length; i++) if (grey[i] > grey[i - 1]) assert.ok(even[i] >= even[i - 1], 'order kept');
    // About half the pixels are now below the middle.
    const below = even.filter(v => v < 128).length / even.length;
    assert.ok(Math.abs(below - 0.5) < 0.05, `below the middle: ${below}`);
});

// A photo piece over a picture whose grey ramps from black (left) to white (right), shaped by f.
function piece_for(grey, w, h, n = 5) {
    const d = base_design(n);
    Object.assign(d.piece.outline, { kind: 'rect', w_mm: 300, h_mm: (300 * h) / w });
    d.piece.symmetry = { kind: 'none', n: 1, phase_deg: 0 };
    apply_photo(d, raster(grey, w, h));
    d.piece.field.smooth_mm = 0;
    return d;
}
const bounds = d => ({ x0: -150000, y0: (-d.piece.outline.h_mm / 2) * 1000, x1: 150000, y1: (d.piece.outline.h_mm / 2) * 1000 });

test('the bands preview matches what each layer cuts, and the photo fills the outline', () => {
    const w = 120;
    const h = 60;
    const grey = Uint8Array.from({ length: w * h }, (_, i) => Math.round(((i % w) * 255) / (w - 1)));
    const n = 5;
    const d = piece_for(grey, w, h, n);
    assert.equal(d.piece.depth_mode, 'field');
    assert.equal(d.piece.field.zoom, 1, 'a rectangle fitted to the photo needs no zoom');
    const bands = band_preview(grey, n);
    const total = 300 * 150;
    for (let k = 0; k < n - 1; k++) {
        const cut = area_mm2(field_material(d.piece, field_level(d.piece, k, n), bounds(d))) / total;
        // The preview: pixels whose band is k or nearer (bands are lightest at the front).
        const shade_k = Math.round(255 - (215 * k) / (n - 1));
        const shown = bands.filter(v => v >= shade_k).length / bands.length;
        assert.ok(Math.abs(cut - shown) < 0.03, `layer ${k + 1}: cuts ${cut.toFixed(3)}, preview ${shown.toFixed(3)}`);
        // Bright is near: the front layer keeps only the right-hand (white) end.
        if (k === 0) {
            const x_min = Math.min(...field_material(d.piece, field_level(d.piece, 0, n), bounds(d)).flat().map(p => p.x));
            assert.ok(x_min > 0.5 * 150000, `front layer starts at x = ${x_min / 1000} mm`);
        }
    }
    assert.equal(field_material(d.piece, field_level(d.piece, n - 1, n), bounds(d)), null, 'the back layer is solid');
    // A round piece: the photo covers the circle instead of fitting inside it.
    const round = base_design(n);
    Object.assign(round.piece.outline, { kind: 'circle', w_mm: 300 });
    apply_photo(round, raster(grey, w, h));
    assert.equal(round.piece.field.zoom, 2);
});

test('evened-out tones give every layer an equal share of the picture', () => {
    const w = 100;
    const h = 100;
    // A skewed picture: a cubic ramp, mostly dark.
    const grey = Uint8Array.from({ length: w * h }, (_, i) => Math.round(((i % w) / (w - 1)) ** 3 * 255));
    const n = 6;
    const raw = piece_for(grey, w, h, n);
    const even = piece_for(equalise(grey), w, h, n);
    const share = (d, k) => area_mm2(field_material(d.piece, field_level(d.piece, k, n), bounds(d))) / (300 * 300);
    for (let k = 0; k < n - 1; k++) assert.ok(Math.abs(share(even, k) - (k + 1) / n) < 0.03, `layer ${k + 1}: ${share(even, k).toFixed(3)}`);
    // Without evening out, the front layer takes far less than its share.
    assert.ok(share(raw, 0) < 0.6 / n, `raw front share ${share(raw, 0).toFixed(3)}`);
});
