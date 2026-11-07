// Circuit motif (SPEC 8.3, M3): routing determinism, clearance, connectivity in both polarities,
// and the circuit panel preset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base_design } from '../src/core/design.js';
import { compose_layer, build_design } from '../src/pipeline/compose.js';
import { slow_checks } from '../src/pipeline/checks.js';
import { components } from '../src/pipeline/islands.js';
import { circuit_routes, kTerminals } from '../src/sources/circuit.js';
import { fundamental_domain } from '../src/geom/symmetry.js';
import { preset_by_id } from '../src/core/presets.js';
import { generate_stack } from '../src/core/generate.js';

const kSyms = [
    { kind: 'none', n: 1, phase_deg: 0 },
    { kind: 'mirror_x', n: 1, phase_deg: 0 },
    { kind: 'mirror_xy', n: 1, phase_deg: 0 },
    { kind: 'rot', n: 5, phase_deg: 0 },
    { kind: 'dihedral', n: 6, phase_deg: 0 },
];

const circuit = extra => ({
    type: 'circuit',
    polarity: 'slots',
    area_w_mm: 260,
    area_h_mm: 200,
    reach_mm: 0,
    r0_mm: 0,
    strands: 2,
    strand_mm: 2,
    gap_mm: 2,
    traces: 30,
    length: 20,
    straight: 0.7,
    terminal: 'mix',
    seed: 1,
    ...extra,
});

function panel(sym, motif) {
    const d = base_design(2);
    d.piece.outline = { kind: 'rect', w_mm: 280, h_mm: 220 };
    d.piece.symmetry = sym;
    d.layers[0].frame_ring_mm = 10;
    d.layers[0].source = { kind: 'primitive', motifs: [motif] };
    return d;
}

function seg_dist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

// Smallest distance between two polylines (segments do not cross here, so endpoints suffice).
function line_dist(P, Q) {
    let best = Infinity;
    for (let i = 0; i + 1 < P.length; i++) {
        for (let j = 0; j + 1 < Q.length; j++) {
            best = Math.min(best, seg_dist(P[i], Q[j], Q[j + 1]), seg_dist(P[i + 1], Q[j], Q[j + 1]), seg_dist(Q[j], P[i], P[i + 1]), seg_dist(Q[j + 1], P[i], P[i + 1]));
        }
    }
    return best;
}

test('routing is deterministic for a seed, and a new seed routes differently', () => {
    const sym = kSyms[2];
    const a = circuit_routes(circuit({ seed: 4 }), sym);
    const b = circuit_routes(circuit({ seed: 4 }), sym);
    assert.deepEqual(a, b);
    assert.notDeepEqual(circuit_routes(circuit({ seed: 5 }), sym).traces, a.traces);
    assert.ok(a.traces.length >= 5, `${a.traces.length} traces`);
});

test('clearance: traces keep a clear cell between them and from the domain edges', () => {
    for (const sym of kSyms) {
        for (const seed of [1, 2, 3]) {
            const { lanes, traces } = circuit_routes(circuit({ seed, traces: 60 }), sym);
            const dom = fundamental_domain(sym);
            const p = lanes.p;
            for (const [a, ta] of traces.entries()) {
                for (const [i, j] of ta.cells) {
                    const c = { x: (i + 0.5) * p, y: (j + 0.5) * p };
                    assert.ok(dom.contains(c), 'cells stay in the domain');
                }
                // Own cells more than one step apart are at least two cells apart.
                for (let x = 0; x < ta.cells.length; x++) {
                    for (let y = x + 2; y < ta.cells.length; y++) {
                        const cheb = Math.max(Math.abs(ta.cells[x][0] - ta.cells[y][0]), Math.abs(ta.cells[x][1] - ta.cells[y][1]));
                        assert.ok(cheb >= 2, `${sym.kind} seed ${seed}: trace ${a} touches itself`);
                    }
                }
                for (const tb of traces.slice(a + 1)) {
                    for (const ca of ta.cells) {
                        for (const cb of tb.cells) assert.ok(Math.max(Math.abs(ca[0] - cb[0]), Math.abs(ca[1] - cb[1])) >= 2, `${sym.kind} seed ${seed}: cells too close`);
                    }
                    // So their centrelines are at least 1.41 pitches apart: a strand gap or more
                    // between the bundles' edges.
                    assert.ok(line_dist(ta.points.slice(1), tb.points.slice(1)) >= Math.SQRT2 * p - 2, `${sym.kind} seed ${seed}: centrelines too close`);
                }
            }
        }
    }
});

test('no islands in either polarity, under every symmetry, with every kind of end', () => {
    for (const sym of kSyms) {
        for (const polarity of ['slots', 'bars']) {
            for (const terminal of ['mix', ...kTerminals]) {
                const d = panel(sym, circuit({ polarity, terminal, seed: 2 }));
                const c = compose_layer(d, 0);
                assert.equal(components(c.material).length, 1, `${sym.kind}${sym.n} ${polarity} ${terminal}`);
            }
        }
    }
});

test('a keep-out at the centre: solid in slots, open in bars, and still one piece', () => {
    const sym = { kind: 'dihedral', n: 8, phase_deg: 0 };
    for (const polarity of ['slots', 'bars']) {
        const d = base_design(2);
        d.piece.outline = { kind: 'circle', w_mm: 290 };
        d.piece.symmetry = sym;
        d.layers[0].source = { kind: 'primitive', motifs: [circuit({ polarity, area_w_mm: 266, area_h_mm: 266, reach_mm: 133, r0_mm: 30 })] };
        const c = compose_layer(d, 0);
        assert.equal(components(c.material).length, 1, polarity);
    }
});

test('the circuit panel preset, both polarities and circuit-style variations: no fatal finding', () => {
    const fatal = d => {
        const b = build_design(d);
        return [...b.checks, ...slow_checks(d, b.layers)].filter(c => c.severity === 'fatal').map(c => c.key);
    };
    const made = preset_by_id('circuit');
    assert.equal(made.piece.outline.kind, 'rect');
    assert.equal(made.generator.style, 'circuit');
    assert.deepEqual(fatal(made), []);
    for (const polarity of ['slots', 'bars']) {
        const d = preset_by_id('circuit');
        for (const l of d.layers) for (const m of l.source.motifs) m.polarity = polarity;
        assert.deepEqual(fatal(d), [], polarity);
    }
    for (const seed of [11, 12, 13]) {
        const d = preset_by_id('circuit');
        generate_stack(d, seed, { lock_n: true });
        assert.ok(d.layers.slice(0, -1).every(l => l.source.motifs[0]?.type === 'circuit'));
        assert.deepEqual(fatal(d), [], `seed ${seed}`);
    }
});
