// Runs the assistant's tools against the studio (SPEC M4.5). Each tool returns content for the
// model: short text, and pictures where it needs to see. Every design change goes through the
// store as one undo step.
// ctx: { design(), replace(design), build(design) -> layers (unpacked), check(design) -> checks,
//        import_svg(text) -> import result, capture_3d() -> PNG bytes or null,
//        pictures: Map, add_picture({ data, mime_type, source }) -> id, gemini_key }
import { apply_ops, design_summary } from './ops.js';
import { make_picture } from './sdk.js';
import { draw_stack } from '../ui/start_screen.js';
import { import_into_layer, piece_radius_mm } from '../core/design.js';
import { bytes_to_base64 } from '../image/raster.js';
import { picture_raster } from '../image/photo.js';

const kLookPx = 768; // pictures for the model: enough to judge, small enough to send often

const canvas_png = canvas => new Promise(resolve => canvas.toBlob(async blob => resolve(new Uint8Array(await blob.arrayBuffer())), 'image/png'));
const image_block = (data, media_type = 'image/png') => ({ type: 'image', source: { type: 'base64', media_type, data } });

function fast_findings(checks) {
    const fatal = checks.filter(c => c.severity === 'fatal' && !c.overridden);
    const warn = checks.filter(c => c.severity !== 'fatal' || c.overridden);
    return { fatal: fatal.map(c => `${c.id} layer ${c.layer + 1}: ${c.message}`), warnings: warn.map(c => `${c.id} layer ${c.layer + 1}: ${c.message}`) };
}

// One layer drawn flat, with its glue-on parts in place and its bridges, on a dark ground.
function draw_layer(canvas, design, layer) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#07050b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of layer.material.flat()) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
    }
    const s = (canvas.width * 0.92) / (Math.max(x1 - x0, y1 - y0) || 1);
    const tx = p => canvas.width / 2 + (p.x - (x0 + x1) / 2) * s;
    const ty = p => canvas.height / 2 - (p.y - (y0 + y1) / 2) * s;
    const trace = paths => {
        const path = new Path2D();
        for (const p of paths) {
            if (!p.length) continue;
            path.moveTo(tx(p[0]), ty(p[0]));
            for (const q of p.slice(1)) path.lineTo(tx(q), ty(q));
            path.closePath();
        }
        return path;
    };
    ctx.fillStyle = design.layers[0]?.finish.colour ?? '#d8c09a';
    ctx.fill(trace(layer.look ?? layer.material), 'evenodd');
    ctx.fillStyle = '#b4f03c';
    for (const b of layer.bridges) ctx.fill(trace([b.rect]));
}

// A smaller copy of a picture for the model (JPEG, at most kLookPx).
async function for_model(picture) {
    const blob = await (await fetch(`data:${picture.mime_type};base64,${picture.data}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const k = Math.min(1, kLookPx / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * k), Math.round(bitmap.height * k));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
    return image_block(bytes_to_base64(bytes), 'image/jpeg');
}

export function make_tool_runner(ctx) {
    return async function run_tool(name, input) {
        switch (name) {
            case 'edit_design': {
                const r = apply_ops(ctx.design(), input.ops);
                if (r.done.length) ctx.replace(r.design);
                const layers = r.done.length ? await ctx.build(r.design) : null;
                const lines = [`Done: ${r.done.length ? r.done.join('; ') : 'nothing'}.`];
                if (r.errors.length) lines.push(`Refused: ${r.errors.join('; ')}.`);
                if (layers) lines.push(`Open fraction by layer: ${layers.map((l, k) => `${k + 1}: ${Math.round(l.open_fraction * 100)}%`).join(', ')}.`);
                lines.push(`Design now: ${JSON.stringify(design_summary(ctx.design()))}`);
                return { content: lines.join('\n'), is_error: !r.done.length };
            }
            case 'check_design': {
                const design = ctx.design();
                const [layers, checks] = await Promise.all([ctx.build(design), ctx.check(design)]);
                const f = fast_findings(checks);
                return {
                    content: JSON.stringify({
                        status: f.fatal.length ? 'fatal problems to fix' : f.warnings.length ? 'warnings only' : 'all checks pass',
                        fatal: f.fatal,
                        warnings: f.warnings,
                        layers: layers.map((l, k) => ({ layer: k + 1, open: Math.round(l.open_fraction * 100) / 100, islands: l.islands.length, cut_m: Math.round(l.cut_length_mm / 100) / 10 })),
                    }),
                };
            }
            case 'look': {
                const design = ctx.design();
                if (input.view === '3d') {
                    const png = await ctx.capture_3d();
                    if (png) return { content: [image_block(bytes_to_base64(png)), { type: 'text', text: 'The 3D preview.' }] };
                }
                const layers = await ctx.build(design);
                const canvas = document.createElement('canvas');
                canvas.width = kLookPx;
                canvas.height = kLookPx;
                let caption = 'Every layer stacked, seen from the front: openings show the layers behind.';
                if (input.view === 'layer') {
                    const k = Math.min(layers.length, Math.max(1, input.layer ?? 1)) - 1;
                    draw_layer(canvas, design, layers[k]);
                    caption = `Layer ${k + 1} alone: material in colour, bridges in green.`;
                } else {
                    const ctx2 = canvas.getContext('2d');
                    ctx2.fillStyle = '#07050b';
                    ctx2.fillRect(0, 0, canvas.width, canvas.height);
                    draw_stack(canvas, design, layers);
                }
                return { content: [image_block(bytes_to_base64(await canvas_png(canvas))), { type: 'text', text: caption }] };
            }
            case 'draw_artwork': {
                const design = ctx.design();
                const k = input.layer - 1;
                if (!design.layers[k]) return { content: `Layer ${input.layer} does not exist.`, is_error: true };
                const result = await ctx.import_svg(input.svg);
                const art = result.layers[0];
                if (!art?.paths?.length) return { content: `The SVG had no filled, closed shapes (${result.notes.join('; ') || 'open paths and strokes are ignored'}).`, is_error: true };
                const next = structuredClone(design);
                if (input.as === 'material') {
                    import_into_layer(next, k, { name: 'artwork.svg', paths: art.paths });
                } else {
                    // Openings: centre the artwork on its own box, then place it.
                    let x0 = Infinity;
                    let x1 = -Infinity;
                    let y0 = Infinity;
                    let y1 = -Infinity;
                    for (const flat of art.paths) {
                        for (let i = 0; i + 1 < flat.length; i += 2) {
                            x0 = Math.min(x0, flat[i]);
                            x1 = Math.max(x1, flat[i]);
                            y0 = Math.min(y0, flat[i + 1]);
                            y1 = Math.max(y1, flat[i + 1]);
                        }
                    }
                    const cx = (x0 + x1) / 2;
                    const cy = (y0 + y1) / 2;
                    const src_w_mm = (x1 - x0) / 1000;
                    const paths = art.paths.map(flat => flat.map((v, i) => Math.round(v - (i % 2 ? cy : cx))));
                    const width_mm = input.width_mm ?? Math.min(src_w_mm, piece_radius_mm(next.piece));
                    if (next.layers[k].source.kind !== 'primitive') next.layers[k].source = { kind: 'primitive', motifs: [] };
                    next.layers[k].source.motifs.push({ type: 'art', x_mm: input.x_mm ?? 0, y_mm: input.y_mm ?? 0, width_mm: Math.round(width_mm * 10) / 10, angle_deg: 0, repeat: input.repeat ? 'around' : 'once', paths, src_w_mm });
                }
                ctx.replace(next);
                const layers = await ctx.build(next);
                const f = fast_findings((await ctx.check(next)).filter(c => c.layer === k));
                return {
                    content: `Placed ${art.paths.length} contours on layer ${input.layer} as ${input.as}. Islands on the layer: ${layers[k].islands.length} (bridged automatically). Layer ${input.layer} checks: ${f.fatal.length ? `fatal: ${f.fatal.join('; ')}` : 'no fatal problems'}${f.warnings.length ? `; warnings: ${f.warnings.join('; ')}` : ''}.`,
                };
            }
            case 'make_picture': {
                if (!ctx.gemini_key) return { content: 'No Gemini key is set, so pictures cannot be made. Draw artwork instead.', is_error: true };
                const picture = await make_picture(ctx.gemini_key, input.description, input.aspect ?? '1:1');
                const id = ctx.add_picture({ ...picture, source: input.description });
                return { content: [await for_model(picture), { type: 'text', text: `Picture ${id}, from the image model. Trace it with trace_picture, or redraw parts with draw_artwork.` }] };
            }
            case 'trace_picture': {
                const picture = ctx.pictures.get(input.picture);
                if (!picture) return { content: `There is no picture ${input.picture}. Pictures so far: ${[...ctx.pictures.keys()].join(', ') || 'none'}.`, is_error: true };
                const image = await picture_raster(picture);
                const next = structuredClone(ctx.design());
                next.piece.depth_mode = 'field';
                Object.assign(next.piece.field, {
                    kind: 'image',
                    image,
                    // Depth pictures are bright where near; near belongs at the front, where levels are low.
                    invert: input.mode === 'depth' ? !input.invert : !!input.invert,
                    smooth_mm: Math.min(6, Math.max(0, input.smooth_mm ?? 1)),
                    zoom: Math.min(4, Math.max(0.5, input.zoom ?? 1)),
                    lo: Math.min(0.9, Math.max(0.05, input.front_fill ?? 0.3)),
                    hi: 1,
                });
                ctx.replace(next);
                const layers = await ctx.build(next);
                const f = fast_findings(await ctx.check(next));
                return {
                    content: `Traced picture ${input.picture} by ${input.mode} into ${layers.length} layers. Open fraction by layer: ${layers.map((l, k) => `${k + 1}: ${Math.round(l.open_fraction * 100)}%`).join(', ')}. ${f.fatal.length ? `Fatal: ${f.fatal.join('; ')}.` : 'No fatal problems.'}${f.warnings.length ? ` Warnings: ${f.warnings.length}.` : ''} Use look to compare with the picture.`,
                };
            }
            default:
                return { content: `There is no tool ${name}.`, is_error: true };
        }
    };
}
