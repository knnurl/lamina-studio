// Geometry worker entry (SPEC 13.3). All geometry runs here; the UI thread renders and edits only.
// Protocol: request {id, type, payload}, reply {id, ok, result} or {id, ok: false, error}.
// Typed arrays anywhere in a result are transferred, not copied.
// 'build' is fast and runs on every edit; 'check' runs the slow checks on the last build of the
// same design (cached by its JSON), so the UI can debounce it.
import { build_design } from '../pipeline/compose.js';
import { slow_checks } from '../pipeline/checks.js';
import { dowel_length_mm } from '../pipeline/registration.js';
import { pack_paths, to_flat } from '../geom/pack.js';
import { import_svg_files } from '../sources/svg_import.js';
import { generate_stack } from '../core/generate.js';
import { fold_point } from '../geom/symmetry.js';
import { lattice_cell_at } from '../sources/lattice.js';
import { test_card_zip } from '../export/test_card.js';
import { export_design, export_parts, sheet_drawings } from '../export/export_design.js';

let cache = { key: null, built: null };

function built_for(design) {
    const key = JSON.stringify(design);
    if (cache.key !== key) cache = { key, built: build_design(design) };
    return cache.built;
}

function build(design) {
    const built = built_for(design);
    const reg = built.registration;
    return {
        ms: built.ms,
        checks: built.checks,
        registration: {
            dowels_mm: reg.dowels.map(p => ({ x: p.x / 1000, y: p.y / 1000 })),
            hole_d_mm: reg.hole_d_mm,
            dowel_length_mm: dowel_length_mm(design),
            spacers: reg.spacers.map(s => ({ kind: s.kind, gap: s.gap, copies: s.copies })),
        },
        layers: built.layers.map(l => ({
            id: l.id,
            material_key: l.material_key,
            area_mm2: l.area_mm2,
            open_fraction: l.open_fraction,
            cut_length_mm: l.cut_length_mm,
            packed: pack_paths(l.material),
            islands: l.islands.map(i => ({ id: i.id, policy: i.policy, area_mm2: i.area_mm2, bbox: i.bbox, centre: i.centre, outer: pack_paths([i.outer]) })),
            bridges: l.bridges.map(b => ({ island: b.island, a: b.a, b: b.b, angle_deg: b.angle_deg, length_mm: b.length_mm, w_mm: b.w_mm, rect: pack_paths([b.rect]) })),
            parts: l.parts.map(p => pack_paths(p)),
            locators: pack_paths(l.locators),
            ids: pack_paths(l.ids),
            unbridged: l.unbridged,
        })),
    };
}

// Exports the design as a zip, unless an un-allowed fatal finding blocks it.
function export_zip({ design, preview_png = null }) {
    const built = built_for(design);
    const checks = [...built.checks, ...slow_checks(design, built.layers)];
    const blocking = checks.filter(c => c.severity === 'fatal' && !c.overridden);
    if (blocking.length) return { blocked: true, problems: blocking.map(c => `${c.id} ${c.message}`) };
    return export_design(design, built.layers, built.registration, checks, { preview_png });
}

// The packed sheets for the Sheets view, as drawings with their items' points packed.
function sheets(design) {
    const built = built_for(design);
    const parts = export_parts(design, built.layers, built.registration);
    const { sheets: drawn, unplaced } = sheet_drawings(design, parts);
    return {
        unplaced,
        sheets: drawn.map(s => ({
            material: s.material,
            number: s.number,
            width_mm: s.drawing.width_mm,
            height_mm: s.drawing.height_mm,
            layers: s.drawing.items.map(i => i.layer),
            closed: s.drawing.items.map(i => i.closed),
            points: pack_paths(s.drawing.items.map(i => i.points)),
        })),
    };
}

// Reads SVG files into importable layers (paths and outline as flat micrometre arrays).
function import_svg({ files }) {
    const r = import_svg_files(files);
    return {
        layers: r.layers.map(l => ({ name: l.name, paths: to_flat(l.paths), open: l.open, skipped: l.skipped })),
        outline: to_flat(r.outline),
        size_mm: r.size_mm,
        notes: r.notes,
    };
}

// Randomise with checks (SPEC 7): up to 10 seeds from `seed`, keeping the first variation with no
// fatal finding (warnings are fine: visual creativity comes first). If none passes, the last is
// returned and the checks will show why.
const kRandomiseTries = 10;

function randomise({ design, seed, lock_n }) {
    let candidate = null;
    for (let i = 0; i < kRandomiseTries; i++) {
        candidate = structuredClone(design);
        generate_stack(candidate, (seed + i * 7919) >>> 0, { lock_n });
        const built = built_for(candidate);
        const fatal = [...built.checks, ...slow_checks(candidate, built.layers)].some(c => c.severity === 'fatal' && !c.overridden);
        if (!fatal) return { design: candidate, tries: i + 1, clean: true };
    }
    return { design: candidate, tries: kRandomiseTries, clean: false };
}

// The lattice cell under a point of layer k (micrometres, on any symmetric copy), for cell paint:
// { motif, cell } with the motif's index and the cell's grid ID, or null. The point is folded into
// the fundamental domain, where the lattice is built, so painting any copy paints them all.
function cell_at({ design, layer, x_um, y_um }) {
    const sym = design.piece.symmetry;
    const p = fold_point({ x: x_um, y: y_um }, sym);
    const motifs = design.layers[layer]?.source.motifs ?? [];
    for (let i = motifs.length - 1; i >= 0; i--) {
        if (motifs[i].type !== 'lattice') continue;
        const cell = lattice_cell_at(motifs[i], sym, p);
        if (cell) return { motif: i, cell };
    }
    return null;
}

function check(design) {
    const t0 = performance.now();
    const built = built_for(design);
    const checks = [...built.checks, ...slow_checks(design, built.layers)];
    return { checks, ms: performance.now() - t0 };
}

const kHandlers = {
    ping: () => ({ pong: true }),
    build,
    check,
    export_zip,
    sheets,
    import_svg,
    randomise,
    test_card_zip,
    cell_at,
};

function transferables(value, out = []) {
    if (ArrayBuffer.isView(value)) out.push(value.buffer);
    else if (Array.isArray(value)) for (const v of value) transferables(v, out);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) transferables(v, out);
    return out;
}

self.onmessage = event => {
    const { id, type, payload } = event.data;
    try {
        const handler = kHandlers[type];
        if (!handler) throw new Error(`unknown request "${type}"`);
        const result = handler(payload);
        self.postMessage({ id, ok: true, result }, transferables(result));
    } catch (err) {
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
};
