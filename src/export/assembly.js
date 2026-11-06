// Assembly sheet (SPEC 9.3): a printable page (the browser saves it as PDF) with the stack table,
// build steps, layer thumbnails and any warnings or allowed findings. Light theme for paper.
// Deterministic: no dates, no randomness.
import { material_of, layer_thickness_mm } from '../core/design.js';
import { dowel_length_mm } from '../pipeline/registration.js';
import { kUmPerMm } from '../core/units.js';

const esc = s =>
    String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function outline_text(o) {
    switch (o.kind) {
        case 'circle':
            return `${o.w_mm} mm circle`;
        case 'rect':
            return `${o.w_mm} x ${o.h_mm} mm rectangle`;
        case 'polygon':
            return `${o.w_mm} mm ${o.sides}-sided polygon`;
        case 'arch':
            return `${o.w_mm} x ${o.h_mm} mm arch`;
        default:
            return o.kind;
    }
}

function thumbnail(material, colour) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of material.flat()) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
    }
    const f = v => (v / kUmPerMm).toFixed(1);
    const d = material.map(path => 'M' + path.map(p => `${f(p.x)} ${f(-p.y)}`).join('L') + 'Z').join('');
    const pad = 2;
    const vb = `${f(x0 - pad * kUmPerMm)} ${f(-y1 - pad * kUmPerMm)} ${f(x1 - x0 + 2 * pad * kUmPerMm)} ${f(y1 - y0 + 2 * pad * kUmPerMm)}`;
    return `<svg viewBox="${vb}" width="150" height="150"><path d="${d}" fill="${esc(colour)}" fill-rule="evenodd" stroke="#333" stroke-width="0.4"/></svg>`;
}

export function assembly_html(design, built, registration, checks, parts, sheets) {
    const n = design.layers.length;
    const reg = design.registration;
    const drilled_from = reg.through_front ? 1 : 2;
    const total_mm = design.layers.reduce((s, l, k) => s + layer_thickness_mm(design, l) + (k < n - 1 ? l.gap_mm : 0), 0);
    const cut_m = built.reduce((s, l) => s + l.cut_length_mm, 0) / 1000;
    const sheet_counts = {};
    for (const s of sheets) sheet_counts[s.material] = (sheet_counts[s.material] ?? 0) + 1;
    const spacer_for = k => registration.spacers.find(s => s.gap === k);

    const rows = design.layers
        .map((layer, k) => {
            const mat = material_of(design, layer);
            const sp = spacer_for(k);
            const glue = built[k].parts.length;
            return `<tr>
<td>${k + 1}${k === 0 ? ' (front)' : k === n - 1 ? ' (back)' : ''}</td>
<td>${esc(mat.label)}</td>
<td>${layer_thickness_mm(design, layer)} mm</td>
<td><span class="sw" style="background:${esc(layer.finish.colour)}"></span>${esc(layer.finish.colour)}</td>
<td>${k < n - 1 ? `${layer.gap_mm} mm` : ''}</td>
<td>${sp ? `${plural(sp.copies, sp.kind === 'puck' ? 'puck' : 'ring')}` : ''}</td>
<td>${glue ? plural(glue, 'glue-on part') : ''}</td>
<td>${k + 1 >= drilled_from && registration.dowels.length ? 'yes' : 'no'}</td>
</tr>`;
        })
        .join('\n');

    const glue_steps = [];
    built.forEach((l, k) => {
        if (l.parts.length) {
            glue_steps.push(`<li>Glue the ${plural(l.parts.length, 'loose part')} cut from layer ${k + 1} onto layer ${k + 2}, inside the scored outlines.</li>`);
        }
    });
    const gaps = registration.spacers.map(s => `behind layer ${s.gap + 1}: ${plural(s.copies, s.kind === 'puck' ? 'puck' : 'ring')}`);
    const findings = checks.filter(c => c.severity !== 'info');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(design.name)}: assembly</title>
<style>
body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1626; background: #fff; margin: 24px auto; max-width: 900px; padding: 0 16px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
.sub { color: #5c5270; margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
th { color: #5c5270; font-weight: 600; }
.sw { display: inline-block; width: 12px; height: 12px; border: 1px solid #999; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 16px; margin: 0; }
.facts div { background: #f6f3fa; padding: 8px 10px; border-radius: 6px; }
.facts b { display: block; font-size: 12px; color: #5c5270; font-weight: 600; }
.thumbs { display: flex; flex-wrap: wrap; gap: 12px; }
.thumbs figure { margin: 0; text-align: center; font-size: 12px; color: #5c5270; }
.warn { color: #a86300; }
.fatal { color: #c62f4a; }
@media print { body { margin: 0; } h2 { break-after: avoid; } .thumbs, table { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${esc(design.name)}</h1>
<p class="sub">Lamina Studio assembly sheet. Print it, or save it as PDF from the browser.</p>

<div class="facts">
<div><b>Piece</b>${outline_text(design.piece.outline)}, ${plural(n, 'layer')}, ${total_mm.toFixed(1)} mm deep</div>
<div><b>Sheets</b>${Object.entries(sheet_counts).map(([m, c]) => `${c} x ${esc(material_of(design, { material: m }).label)}, ${design.sheet.w_mm} x ${design.sheet.h_mm} mm`).join('<br>') || 'none'}</div>
<div><b>Dowels</b>${registration.dowels.length ? `${registration.dowels.length} x ${reg.dowel_d_mm} mm, ${dowel_length_mm(design)} mm long (holes ${registration.hole_d_mm.toFixed(2)} mm)` : 'none'}</div>
<div><b>Cutting</b>${cut_m.toFixed(1)} m of cut line, ${plural(parts.reduce((s, p) => s + p.copies, 0), 'part')}</div>
</div>

<h2>Stack, front to back</h2>
<table>
<tr><th>Layer</th><th>Material</th><th>Thickness</th><th>Finish</th><th>Gap behind</th><th>Spacers</th><th>Loose parts</th><th>Drilled</th></tr>
${rows}
</table>

<h2>Build steps</h2>
<ol>
<li>Cut the sheets. On each sheet run green (engrave) and blue (score) before red (cut), so parts are marked before they drop out.</li>
<li>Finish each layer in the colour listed above before assembly. Keep paint out of the dowel holes.</li>
${glue_steps.join('\n')}
${registration.dowels.length ? `<li>Push the ${plural(registration.dowels.length, 'dowel')} through the back layer (layer ${n}).</li>
<li>Stack layers ${n - 1} to ${drilled_from} onto the dowels, matching the engraved numbers (hidden on the face under the layer in front; the arrow points up)${gaps.length ? `, with spacers ${gaps.join('; ')}` : ''}.</li>` : `<li>Stack the layers from the back (layer ${n}) to the front, aligning their outlines.</li>`}
${drilled_from === 2 ? '<li>Glue the front layer (layer 1) on last, aligned by its outline. It is not drilled, so the dowels stay hidden.</li>' : ''}
</ol>

<h2>Layers</h2>
<div class="thumbs">
${built.map((l, k) => `<figure>${thumbnail(l.material, design.layers[k].finish.colour)}<figcaption>Layer ${k + 1}</figcaption></figure>`).join('\n')}
</div>
${findings.length ? `
<h2>Checks</h2>
<ul>
${findings.map(c => `<li class="${c.severity === 'fatal' ? 'fatal' : 'warn'}">${esc(c.id)}: ${esc(c.message)}${c.overridden ? ' Allowed by the designer.' : ''}</li>`).join('\n')}
</ul>` : ''}
</body>
</html>
`;
}
