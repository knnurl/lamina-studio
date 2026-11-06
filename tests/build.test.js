// The built page: deterministic, safe to inline, and the worker bundle runs the geometry core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build_html } from '../tools/build.js';
import { preset_by_id } from '../src/core/presets.js';

const built = build_html();

test('the build is deterministic', () => {
    assert.equal(build_html().html, built.html);
});

test('the page has exactly one worker block and one app script', () => {
    const scripts = built.html.match(/<script\b[^>]*>/g);
    assert.deepEqual(scripts, ['<script type="text/plain" id="lamina-worker-src">', '<script>']);
    assert.equal(built.html.match(/<\/script>/g).length, 2);
    assert.ok(!built.html.includes('/*APP*/') && !built.html.includes('/*WORKER*/'));
});

test('three.js stays out of the worker and Clipper2 out of the app', () => {
    assert.ok(built.app.modules.includes('src/vendor/three/three.core.js'));
    assert.ok(!built.app.modules.some(m => m.includes('clipper2')));
    assert.ok(built.worker.modules.includes('src/vendor/clipper2/clipper2.min.mjs'));
    assert.ok(!built.worker.modules.some(m => m.includes('three')));
});

function start_worker_bundle() {
    const replies = [];
    // structuredClone, as postMessage does; it also re-creates the vm realm's objects in this realm,
    // so strict deep equality works.
    const self = { postMessage: msg => replies.push(structuredClone(msg)) };
    // A worker global has TextEncoder, performance and structuredClone; a bare vm context does not.
    vm.runInContext(built.worker.code, vm.createContext({ self, TextEncoder, performance, structuredClone }));
    return {
        call: (type, payload) => {
            self.onmessage({ data: { id: replies.length + 1, type, payload } });
            return replies.at(-1);
        },
    };
}

test('the worker bundle answers ping and builds a preset design', () => {
    const worker = start_worker_bundle();
    assert.deepEqual(worker.call('ping'), { id: 1, ok: true, result: { pong: true } });

    const design = preset_by_id('orb');
    const reply = worker.call('build', design);
    assert.equal(reply.ok, true, reply.error);
    const layers = reply.result.layers;
    assert.equal(layers.length, design.layers.length);
    for (const layer of layers) {
        assert.ok(layer.packed.xy instanceof Int32Array && layer.packed.starts instanceof Uint32Array);
    }
    // The back layer is solid apart from its dowel holes: a 290 mm disc, flattened at 0.02 mm
    // (about 1.8e-4 short), minus the holes.
    const reg = reply.result.registration;
    assert.equal(reg.dowels_mm.length, 3);
    const holes_mm2 = reg.dowels_mm.length * Math.PI * (reg.hole_d_mm / 2) ** 2;
    const expected = Math.PI * 145 * 145 - holes_mm2;
    assert.ok(Math.abs(layers.at(-1).area_mm2 - expected) / expected < 2.5e-4);
    assert.ok(layers[0].open_fraction > 0.05, 'the front layer has openings');
});

test('the worker bundle builds the test card zip', () => {
    const reply = start_worker_bundle().call('test_card_zip');
    assert.equal(reply.ok, true);
    assert.equal(reply.result.name, 'lamina_test_card.zip');
    assert.ok(reply.result.bytes instanceof Uint8Array);
    assert.equal(new DataView(reply.result.bytes.buffer).getUint32(0, true), 0x04034b50);
});

test('the worker refuses to export while a fatal finding is not allowed', () => {
    const worker = start_worker_bundle();
    const design = preset_by_id('orb');
    design.sheet.w_mm = 250;
    design.sheet.h_mm = 250;
    const blocked = worker.call('export_zip', { design });
    assert.equal(blocked.ok, true);
    assert.equal(blocked.result.blocked, true);
    assert.ok(blocked.result.problems.every(p => p.startsWith('G-05')));
    design.sheet.w_mm = 600;
    design.sheet.h_mm = 400;
    const done = worker.call('export_zip', { design });
    assert.equal(done.result.name, 'lamina_orb.zip');
    assert.ok(done.result.bytes instanceof Uint8Array);
});

test('Randomise keeps the first variation without a fatal finding, deterministically', () => {
    const worker = start_worker_bundle();
    const design = preset_by_id('orb');
    const a = worker.call('randomise', { design, seed: 4242, lock_n: false }).result;
    const b = worker.call('randomise', { design, seed: 4242, lock_n: false }).result;
    assert.equal(a.clean, true);
    assert.ok(a.tries >= 1 && a.tries <= 10);
    assert.deepEqual(a.design, b.design);
    assert.notDeepEqual(a.design.layers[0].source.motifs, design.layers[0].source.motifs);
});

test('the worker reports unknown requests as errors', () => {
    const reply = start_worker_bundle().call('nope');
    assert.equal(reply.ok, false);
    assert.match(reply.error, /unknown request "nope"/);
});
