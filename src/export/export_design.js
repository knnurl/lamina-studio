// Design export (SPEC 9): kerf-compensated cut files for every layer, glue-on part and spacer,
// packed onto stock sheets per material, plus design.json, checks.txt and the assembly sheet, in
// one zip. Deterministic: the same design gives the same bytes (the optional preview PNG aside).
// Kerf: cut paths are the design offset by +kerf/2 with round joins (the beam is round), so
// outlines grow and holes shrink and the cut part comes out at its design size.
// Assumptions: geometry in micrometres, y up; drawings in mm with the origin bottom-left.
import { offset, path_area_um2 } from '../geom/clip.js';
import { material_of } from '../core/design.js';
import { mm_to_um, kUmPerMm } from '../core/units.js';
import { drawing_to_svg } from './svg.js';
import { drawing_to_dxf } from './dxf.js';
import { zip_store } from './zip_store.js';
import { pack } from './pack.js';
import { assembly_html } from './assembly.js';

const kKerfTolUm = 5;

const slug = name => (name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
const pad2 = n => String(n).padStart(2, '0');

function kerf(paths, kerf_mm) {
    return paths.length ? offset(paths, mm_to_um(kerf_mm / 2), 'round', kKerfTolUm) : [];
}

function bounds_um(groups) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const paths of groups) {
        for (const path of paths) {
            for (const p of path) {
                x0 = Math.min(x0, p.x);
                y0 = Math.min(y0, p.y);
                x1 = Math.max(x1, p.x);
                y1 = Math.max(y1, p.y);
            }
        }
    }
    return { x0, y0, x1, y1 };
}

// Everything that gets cut: { key, file, label, material, cut, score, engrave, copies, w, h, b }.
export function export_parts(design, built, registration) {
    const parts = [];
    const add = part => {
        const b = bounds_um([part.cut]);
        parts.push({ score: [], engrave: [], copies: 1, ...part, b, w: (b.x1 - b.x0) / kUmPerMm, h: (b.y1 - b.y0) / kUmPerMm });
    };
    built.forEach((l, k) => {
        const layer = design.layers[k];
        const mat = material_of(design, layer);
        add({
            key: `L${pad2(k + 1)}`,
            file: `layers/L${pad2(k + 1)}`,
            label: `Layer ${k + 1}`,
            material: layer.material,
            cut: kerf(l.material, mat.kerf_mm),
            score: l.locators,
            engrave: l.ids,
        });
        l.parts.forEach((p, i) => {
            add({
                key: `L${pad2(k + 1)}-glue-${pad2(i + 1)}`,
                file: `parts/L${pad2(k + 1)}_glue_${pad2(i + 1)}`,
                label: `Glue-on part ${i + 1} of layer ${k + 1}`,
                material: layer.material,
                cut: kerf(p, mat.kerf_mm),
            });
        });
    });
    for (const s of registration.spacers) {
        const stock = design.spacers.stock_material;
        add({
            key: `gap${pad2(s.gap + 1)}-${s.kind}`,
            file: `parts/gap${pad2(s.gap + 1)}_${s.kind}_x${s.copies}`,
            label: `Spacer ${s.kind}, behind layer ${s.gap + 1}`,
            material: stock,
            cut: kerf(s.paths, material_of(design, { material: stock }).kerf_mm),
            copies: s.copies,
        });
    }
    return parts;
}

// Moves a part so its bounding box's bottom-left sits at (x_mm, y_mm), turned 90 degrees if asked.
function placer(part, x_mm, y_mm, rotated) {
    const { b } = part;
    const dx = mm_to_um(x_mm);
    const dy = mm_to_um(y_mm);
    return path =>
        path.map(p =>
            rotated
                ? { x: Math.round(b.y1 - p.y + dx), y: Math.round(p.x - b.x0 + dy) }
                : { x: Math.round(p.x - b.x0 + dx), y: Math.round(p.y - b.y0 + dy) },
        );
}

// Engraving and scoring first, then holes, then outlines, so parts are marked before they drop.
function drawing(width_mm, height_mm, placed) {
    const engrave = [];
    const score = [];
    const holes = [];
    const outers = [];
    for (const { part, move } of placed) {
        for (const s of part.engrave) engrave.push({ layer: 'ENGRAVE', closed: false, points: move(s) });
        for (const s of part.score) score.push({ layer: 'SCORE', closed: true, points: move(s) });
        for (const c of part.cut) (path_area_um2(c) < 0 ? holes : outers).push({ layer: 'CUT', closed: true, points: move(c) });
    }
    return { width_mm, height_mm, items: [...engrave, ...score, ...holes, ...outers] };
}

function checks_text(checks) {
    if (!checks.length) return 'All checks pass.\n';
    return checks
        .map(c => `${c.severity.toUpperCase().padEnd(5)} ${c.id}  ${c.message}${c.overridden ? '  (allowed by the designer)' : ''}`)
        .join('\n') + '\n';
}

// Lays out every part on stock sheets, one set of sheets per material.
export function layout_sheets(design, parts) {
    const by_material = new Map();
    for (const part of parts) {
        if (!by_material.has(part.material)) by_material.set(part.material, []);
        by_material.get(part.material).push(part);
    }
    const sheets = [];
    const unplaced = [];
    for (const [material, group] of [...by_material.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const items = [];
        for (const part of group) for (let c = 0; c < part.copies; c++) items.push({ key: `${part.key}#${c + 1}`, w: part.w, h: part.h });
        const result = pack(items, design.sheet);
        unplaced.push(...result.unplaced);
        result.sheets.forEach(placements => sheets.push({ material, placements }));
    }
    return { sheets, unplaced };
}

// files for the zip, plus a summary. preview_png: optional Uint8Array from the 3D view.
export function export_design(design, built, registration, checks, { preview_png = null } = {}) {
    const parts = export_parts(design, built, registration);
    const by_key = new Map(parts.map(p => [p.key, p]));
    const root = `lamina_${slug(design.name)}`;
    const files = [];
    const add_drawing = (path, d) => {
        files.push({ name: `${root}/${path}.svg`, data: drawing_to_svg(d) });
        files.push({ name: `${root}/${path}.dxf`, data: drawing_to_dxf(d) });
    };

    const { sheets, unplaced } = layout_sheets(design, parts);
    const per_material = {};
    sheets.forEach(sheet => {
        per_material[sheet.material] = (per_material[sheet.material] ?? 0) + 1;
        const placed = sheet.placements.map(pl => {
            const part = by_key.get(pl.key.split('#')[0]);
            return { part, move: placer(part, pl.x, pl.y, pl.rotated) };
        });
        add_drawing(`sheets/sheet_${pad2(per_material[sheet.material])}_${sheet.material}`, drawing(design.sheet.w_mm, design.sheet.h_mm, placed));
    });

    const margin = 5;
    for (const part of parts) {
        add_drawing(part.file, drawing(part.w + 2 * margin, part.h + 2 * margin, [{ part, move: placer(part, margin, margin, false) }]));
    }

    files.push({ name: `${root}/design.json`, data: JSON.stringify(design, null, 2) + '\n' });
    files.push({ name: `${root}/checks.txt`, data: checks_text(checks) });
    files.push({ name: `${root}/assembly.html`, data: assembly_html(design, built, registration, checks, parts, sheets) });
    if (preview_png) files.push({ name: `${root}/preview.png`, data: preview_png });

    return {
        name: `${root}.zip`,
        bytes: zip_store(files),
        summary: {
            files: files.length,
            sheets: Object.entries(per_material).map(([material, count]) => ({ material, count })),
            parts: parts.reduce((n, p) => n + p.copies, 0),
            unplaced,
        },
    };
}
