// Layer view (SPEC 10): one layer, flat, for inspecting and editing. Material is drawn in the
// layer's colour; bridges, islands (by policy), locators for glue-on islands from the layer in
// front, and check boxes (red fatal, amber warning) are drawn over it. Click an island to cycle
// its policy, or a lattice cell to paint it; drag a bridge to move it (Alt-click resets it); drag
// a shape's nodes and handles on its first copy (every copy follows through the rebuild), and
// double-click its outline to add a node or a node to delete it; the wheel zooms at the cursor;
// drag pans; double-click elsewhere refits.
// Assumptions: paths in micrometres, y up; the canvas works in mm; shape nodes in local mm.
import { kUmPerMm } from '../core/units.js';
import { flatten_shape, move_anchor, move_handle, nearest_on_shape, split_segment, delete_node } from '../geom/bezier.js';
import { to_domain, all_copies } from '../geom/sketch.js';

const kCloseLoopPx = 10; // a pen stroke ending this near its start closes

const kNodePx = 7; // pick radius for nodes and handles
const r2 = v => Math.round(v * 100) / 100;
const rounded = nodes => nodes.map(n => ({ x: r2(n.x), y: r2(n.y), ix: r2(n.ix), iy: r2(n.iy), ox: r2(n.ox), oy: r2(n.oy) }));

const kPolicyColour = { bridge: '#b4f03c', glue: '#46b4ff', drop: '#8f849f' };

function point_in_path(p, path) {
    let inside = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        const a = path[i];
        const b = path[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

// Distance from p to segment a-b.
function seg_dist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

export class LayerView {
    // Callbacks, with points in micrometres:
    //   on_island_click(island)          a click on an island
    //   on_cell_click(point)             a click anywhere else (cell paint)
    //   on_bridge_drag(bridge, angle_deg) a bridge dropped at a new angle around its island
    //   on_bridge_reset(bridge)          an Alt-click on a bridge
    //   on_shape_edit(motif, nodes, drag) new nodes for the shape motif at index motif; drag is
    //                                    an ID shared by every move of one drag (one undo step)
    //   on_sketch({ points, closed })    a finished stroke, in world micrometres
    //   on_erase(point, tol)             an eraser click, with the pick radius in micrometres
    constructor(container, { on_island_click, on_cell_click, on_bridge_drag, on_bridge_reset, on_shape_edit, on_sketch, on_erase }) {
        this.container_ = container;
        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'layer-canvas';
        this.canvas_.hidden = true;
        this.legend_ = document.createElement('div');
        this.legend_.className = 'layer-legend';
        this.legend_.hidden = true;
        this.legend_.innerHTML =
            '<span class="key bridge"></span>bridged island <span class="key glue"></span>glue-on ' +
            '<span class="key drop"></span>dropped <span class="key dowel"></span>dowel ' +
            '<span class="key id"></span>engraved number. Click an island to change it, or a lattice ' +
            'cell to make it solid (again to clear). Drag a bridge to move it, Alt-click to reset it. ' +
            "Drag a shape's nodes and handles; double-click its outline to add a node, a node to delete it. " +
            'Wheel zooms, drag pans, double-click refits. Boxes mark check findings.';
        container.append(this.canvas_, this.legend_);
        this.ctx_ = this.canvas_.getContext('2d');
        this.view_ = null; // { scale px per mm, ox, oy }
        this.data_ = null;
        this.on_island_click_ = on_island_click;
        this.on_cell_click_ = on_cell_click;
        this.on_bridge_drag_ = on_bridge_drag;
        this.on_bridge_reset_ = on_bridge_reset;
        this.on_shape_edit_ = on_shape_edit;
        this.on_sketch_ = on_sketch;
        this.on_erase_ = on_erase;
        this.guide_ = null; // { from, to } in micrometres while a bridge is dragged
        this.drags_ = 0;
        this.tool_ = 'select'; // or pen, line, circle, rect, erase
        this.draft_ = null; // the stroke being drawn, in world micrometres
        window.addEventListener('keydown', e => {
            if (!this.draft_) return;
            if (e.key === 'Escape') this.draft_ = null;
            if (e.key === 'Enter' && this.draft_?.tool === 'line') this.finish_line_(false);
            this.draw_();
        });

        let drag = null;
        this.canvas_.addEventListener('pointerdown', e => {
            if (this.tool_ !== 'select') {
                if (this.view_) this.sketch_down_(e);
                return;
            }
            const node = this.node_at_(e.offsetX, e.offsetY);
            const bridge = node ? null : this.bridge_at_(e.offsetX, e.offsetY);
            drag = { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, moved: false, node, bridge, alt: e.altKey, id: ++this.drags_ };
            this.canvas_.setPointerCapture(e.pointerId);
        });
        this.canvas_.addEventListener('pointermove', e => {
            if (this.draft_ && this.view_) {
                this.sketch_move_(e);
                return;
            }
            if (!drag || !this.view_) return;
            const dx = e.offsetX - drag.x;
            const dy = e.offsetY - drag.y;
            if (Math.abs(e.offsetX - drag.x0) + Math.abs(e.offsetY - drag.y0) > 3) drag.moved = true;
            if (drag.moved && drag.node) {
                // The node follows the pointer at once; the material follows the rebuild.
                const { shape, index, which } = drag.node;
                const sh = this.data_.shapes[shape];
                const p = this.shape_local_(sh, this.to_world_(e.offsetX, e.offsetY));
                const nodes = rounded(which === 'anchor' ? move_anchor(sh.nodes, index, p.x, p.y) : move_handle(sh.nodes, index, which, p.x, p.y));
                sh.nodes = nodes;
                this.draw_();
                this.on_shape_edit_?.(sh.motif, nodes, `drag${drag.id}`);
            } else if (drag.moved && drag.bridge) {
                // A guide from the island's centre to the pointer: the new bridge angle.
                const island = this.data_.built.islands.find(i => i.id === drag.bridge.island);
                if (island) this.guide_ = { from: island.centre, to: this.to_world_(e.offsetX, e.offsetY) };
                this.draw_();
            } else if (drag.moved) {
                this.view_.ox += dx;
                this.view_.oy += dy;
                drag.x = e.offsetX;
                drag.y = e.offsetY;
                this.draw_();
            }
        });
        this.canvas_.addEventListener('pointerup', e => {
            if (this.tool_ !== 'select') {
                this.sketch_up_(e);
                return;
            }
            if (drag?.bridge && drag.moved && this.guide_) {
                const { from, to } = this.guide_;
                this.on_bridge_drag_?.(drag.bridge, (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
            } else if (drag?.bridge && drag.alt && !drag.moved) {
                this.on_bridge_reset_?.(drag.bridge);
            } else if (drag && !drag.moved && !drag.node && !this.segment_at_(e.offsetX, e.offsetY)) {
                this.click_(e.offsetX, e.offsetY);
            }
            this.guide_ = null;
            drag = null;
        });
        this.canvas_.addEventListener(
            'wheel',
            e => {
                if (!this.view_) return;
                e.preventDefault();
                const f = Math.exp(-e.deltaY * 0.0015);
                this.view_.ox = e.offsetX - (e.offsetX - this.view_.ox) * f;
                this.view_.oy = e.offsetY - (e.offsetY - this.view_.oy) * f;
                this.view_.scale *= f;
                this.draw_();
            },
            { passive: false },
        );
        this.canvas_.addEventListener('dblclick', e => {
            if (this.tool_ === 'line') {
                this.finish_line_(false);
                return;
            }
            if (this.tool_ !== 'select') return;
            // On a node: delete it. On a shape's outline: add a node there. Elsewhere: refit.
            const node = this.node_at_(e.offsetX, e.offsetY);
            if (node?.which === 'anchor') {
                const sh = this.data_.shapes[node.shape];
                this.on_shape_edit_?.(sh.motif, delete_node(sh.nodes, node.index), null);
                return;
            }
            const seg = this.segment_at_(e.offsetX, e.offsetY);
            if (seg) {
                const sh = this.data_.shapes[seg.shape];
                this.on_shape_edit_?.(sh.motif, rounded(split_segment(sh.nodes, seg.seg, seg.t)), null);
                return;
            }
            this.view_ = null;
            this.draw_();
        });
        new ResizeObserver(() => this.draw_()).observe(container);
    }

    // The drawing tool: select (the default editing), pen, line, circle, rect or erase.
    set_tool(tool) {
        this.tool_ = tool;
        this.draft_ = null;
        this.canvas_.dataset.tool = tool;
        this.draw_();
    }

    sketch_down_(e) {
        const p = this.to_world_(e.offsetX, e.offsetY);
        this.canvas_.setPointerCapture(e.pointerId);
        if (this.tool_ === 'erase') {
            this.on_erase_?.(p, (8 / this.view_.scale) * kUmPerMm);
            return;
        }
        if (this.tool_ === 'pen') this.draft_ = { tool: 'pen', points: [p], down: true };
        else if (this.tool_ === 'circle' || this.tool_ === 'rect') this.draft_ = { tool: this.tool_, start: p, end: p, down: true };
        else if (this.tool_ === 'line') {
            if (!this.draft_) this.draft_ = { tool: 'line', points: [p, p] };
            else {
                const first = this.to_screen_(this.draft_.points[0]);
                // Clicking the first point again closes the shape.
                if (this.draft_.points.length > 3 && Math.hypot(first.x - e.offsetX, first.y - e.offsetY) < kCloseLoopPx) {
                    this.finish_line_(true);
                    return;
                }
                this.draft_.points.splice(-1, 1, p, p);
            }
        }
        this.draw_();
    }

    sketch_move_(e) {
        const d = this.draft_;
        const p = this.to_world_(e.offsetX, e.offsetY);
        if (d.tool === 'pen' && d.down) {
            const last = this.to_screen_(d.points[d.points.length - 1]);
            if (Math.hypot(last.x - e.offsetX, last.y - e.offsetY) > 1.5) d.points.push(p);
        } else if ((d.tool === 'circle' || d.tool === 'rect') && d.down) d.end = p;
        else if (d.tool === 'line') d.points[d.points.length - 1] = p;
        this.draw_();
    }

    sketch_up_() {
        const d = this.draft_;
        if (!d || !d.down) return;
        if (d.tool === 'pen') {
            const a = this.to_screen_(d.points[0]);
            const b = this.to_screen_(d.points[d.points.length - 1]);
            const closed = d.points.length > 8 && Math.hypot(a.x - b.x, a.y - b.y) < kCloseLoopPx;
            if (d.points.length > 1) this.on_sketch_?.({ points: d.points, closed });
        } else {
            const r = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
            if (r * (this.view_.scale / kUmPerMm) > 3) {
                const points =
                    d.tool === 'circle'
                        ? Array.from({ length: 48 }, (_, i) => ({ x: d.start.x + r * Math.cos((i / 48) * 2 * Math.PI), y: d.start.y + r * Math.sin((i / 48) * 2 * Math.PI) }))
                        : [d.start, { x: d.end.x, y: d.start.y }, d.end, { x: d.start.x, y: d.end.y }];
                this.on_sketch_?.({ points, closed: true });
            }
        }
        this.draft_ = null;
        this.draw_();
    }

    finish_line_(closed) {
        const d = this.draft_;
        this.draft_ = null;
        if (d?.tool === 'line') {
            const points = d.points.slice(0, -1); // the last point follows the pointer
            if (points.length >= 2) this.on_sketch_?.({ points, closed: closed && points.length >= 3 });
        }
        this.draw_();
    }

    set_visible(on) {
        this.canvas_.hidden = !on;
        this.legend_.hidden = !on;
        if (on) this.draw_();
    }

    // data: { colour, built (one layer from the worker, unpacked), checks (this layer's), key }.
    // The view is refitted when key (piece size and layer) changes.
    show(data) {
        if (this.data_?.key !== data.key) this.view_ = null;
        this.data_ = data;
        if (!this.canvas_.hidden) this.draw_();
    }

    fit_() {
        const { material } = this.data_.built;
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
        const w = this.canvas_.clientWidth;
        const h = this.canvas_.clientHeight;
        const span_x = (x1 - x0) / kUmPerMm || 1;
        const span_y = (y1 - y0) / kUmPerMm || 1;
        const scale = Math.min(w / span_x, h / span_y) * 0.9;
        this.view_ = {
            scale,
            ox: w / 2 - (((x0 + x1) / 2) * scale) / kUmPerMm,
            oy: h / 2 + (((y0 + y1) / 2) * scale) / kUmPerMm,
        };
    }

    to_world_(sx, sy) {
        const v = this.view_;
        return { x: ((sx - v.ox) / v.scale) * kUmPerMm, y: ((v.oy - sy) / v.scale) * kUmPerMm };
    }

    trace_(paths) {
        const v = this.view_;
        const path = new Path2D();
        for (const p of paths) {
            if (!p.length) continue;
            path.moveTo(v.ox + (p[0].x / kUmPerMm) * v.scale, v.oy - (p[0].y / kUmPerMm) * v.scale);
            for (let i = 1; i < p.length; i++) {
                path.lineTo(v.ox + (p[i].x / kUmPerMm) * v.scale, v.oy - (p[i].y / kUmPerMm) * v.scale);
            }
            path.closePath();
        }
        return path;
    }

    // A shape's first copy: local mm to world micrometres, and back. The copy is the motif placed
    // at its radius, turned by its offset plus the symmetry's phase (sh.rot, radians).
    shape_world_(sh, p) {
        const x = sh.r_mm + p.x;
        const c = Math.cos(sh.rot);
        const s = Math.sin(sh.rot);
        return { x: (c * x - s * p.y) * kUmPerMm, y: (s * x + c * p.y) * kUmPerMm };
    }

    shape_local_(sh, w) {
        const c = Math.cos(sh.rot);
        const s = Math.sin(sh.rot);
        const x = (c * w.x + s * w.y) / kUmPerMm;
        const y = (-s * w.x + c * w.y) / kUmPerMm;
        return { x: x - sh.r_mm, y };
    }

    to_screen_(w) {
        const v = this.view_;
        return { x: v.ox + (w.x / kUmPerMm) * v.scale, y: v.oy - (w.y / kUmPerMm) * v.scale };
    }

    // The node or handle under a screen point: { shape, index, which: 'anchor' | 'in' | 'out' }.
    // Handles win a close call over anchors, so a short handle can still be pulled out.
    node_at_(sx, sy) {
        if (!this.data_?.shapes?.length || !this.view_) return null;
        let best = null;
        let best_d = kNodePx;
        this.data_.shapes.forEach((sh, shape) => {
            sh.nodes.forEach((n, index) => {
                for (const [which, x, y, bias] of [
                    ['in', n.ix, n.iy, 0.5],
                    ['out', n.ox, n.oy, 0.5],
                    ['anchor', n.x, n.y, 0],
                ]) {
                    if (which !== 'anchor' && Math.hypot(x - n.x, y - n.y) < 1e-6) continue;
                    const q = this.to_screen_(this.shape_world_(sh, { x, y }));
                    const d = Math.hypot(q.x - sx, q.y - sy) - bias;
                    if (d < best_d) {
                        best_d = d;
                        best = { shape, index, which };
                    }
                }
            });
        });
        return best;
    }

    // The point of a shape's outline under a screen point (within the pick radius).
    segment_at_(sx, sy) {
        if (!this.data_?.shapes?.length || !this.view_) return null;
        const w = this.to_world_(sx, sy);
        for (const [shape, sh] of this.data_.shapes.entries()) {
            const near = nearest_on_shape(sh.nodes, this.shape_local_(sh, w));
            if (near.d * this.view_.scale <= kNodePx) return { shape, seg: near.seg, t: near.t };
        }
        return null;
    }

    click_(sx, sy) {
        if (!this.data_ || !this.view_) return;
        const p = this.to_world_(sx, sy);
        const hit = this.data_.built.islands.find(i => point_in_path(p, i.outer));
        if (hit) this.on_island_click_(hit);
        else this.on_cell_click_?.(p);
    }

    // The bridge under a screen point, within half its width or 5 px, whichever is more.
    bridge_at_(sx, sy) {
        if (!this.data_ || !this.view_) return null;
        const p = this.to_world_(sx, sy);
        const px_um = (5 / this.view_.scale) * kUmPerMm;
        return this.data_.built.bridges.find(b => seg_dist(p, b.a, b.b) <= Math.max((b.w_mm * kUmPerMm) / 2, px_um)) ?? null;
    }

    draw_() {
        const canvas = this.canvas_;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = this.ctx_;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!this.data_) return;
        if (!this.view_) this.fit_();
        const { built, colour, checks } = this.data_;
        const css = getComputedStyle(document.documentElement);

        ctx.fillStyle = colour;
        ctx.fill(this.trace_(built.material), 'evenodd');
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke(this.trace_(built.material));

        ctx.fillStyle = 'rgba(180, 240, 60, 0.85)';
        for (const b of built.bridges) ctx.fill(this.trace_([b.rect]));

        for (const island of built.islands) {
            ctx.setLineDash(island.policy === 'bridge' ? [] : [5, 4]);
            ctx.strokeStyle = kPolicyColour[island.policy];
            ctx.lineWidth = 2;
            ctx.stroke(this.trace_([island.outer]));
        }
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = kPolicyColour.glue;
        ctx.lineWidth = 1.5;
        if (built.locators.length) ctx.stroke(this.trace_(built.locators));
        ctx.setLineDash([]);

        const v = this.view_;
        // Engraved layer ID (open strokes) and dowels: solid on drilled layers, dashed where the
        // dowel sits hidden behind an undrilled front layer.
        ctx.strokeStyle = '#00c060';
        ctx.lineWidth = 1.2;
        const ids = new Path2D();
        for (const stroke of built.ids) {
            stroke.forEach((p, i) => {
                const x = v.ox + (p.x / kUmPerMm) * v.scale;
                const y = v.oy - (p.y / kUmPerMm) * v.scale;
                if (i) ids.lineTo(x, y);
                else ids.moveTo(x, y);
            });
        }
        ctx.stroke(ids);
        ctx.strokeStyle = css.getPropertyValue('--cyan').trim();
        ctx.lineWidth = 1.5;
        ctx.setLineDash(this.data_.drilled ? [] : [4, 3]);
        for (const d of this.data_.dowels ?? []) {
            ctx.beginPath();
            ctx.arc(v.ox + d.x * v.scale, v.oy - d.y * v.scale, (this.data_.hole_d_mm / 2 + 2) * v.scale, 0, 2 * Math.PI);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        if (this.guide_) {
            const { from, to } = this.guide_;
            ctx.strokeStyle = kPolicyColour.bridge;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(v.ox + (from.x / kUmPerMm) * v.scale, v.oy - (from.y / kUmPerMm) * v.scale);
            ctx.lineTo(v.ox + (to.x / kUmPerMm) * v.scale, v.oy - (to.y / kUmPerMm) * v.scale);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Shapes: the outline of the first copy, handles and nodes.
        const cyan = css.getPropertyValue('--cyan').trim() || '#46b4ff';
        for (const sh of this.data_.shapes ?? []) {
            const tol = Math.max(0.5 / v.scale, 0.005); // half a pixel, in mm
            const outline = flatten_shape(sh.nodes, tol).map(p => this.to_screen_(this.shape_world_(sh, p)));
            ctx.strokeStyle = cyan;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            for (const n of sh.nodes) {
                const a = this.to_screen_(this.shape_world_(sh, { x: n.x, y: n.y }));
                ctx.strokeStyle = cyan;
                ctx.lineWidth = 1;
                for (const [hx, hy] of [
                    [n.ix, n.iy],
                    [n.ox, n.oy],
                ]) {
                    if (Math.hypot(hx - n.x, hy - n.y) < 1e-6) continue;
                    const h = this.to_screen_(this.shape_world_(sh, { x: hx, y: hy }));
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(h.x, h.y);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(h.x, h.y, 3.5, 0, 2 * Math.PI);
                    ctx.fillStyle = '#14101c';
                    ctx.fill();
                    ctx.stroke();
                }
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#14101c';
                ctx.fillRect(a.x - 4, a.y - 4, 8, 8);
                ctx.strokeRect(a.x - 4, a.y - 4, 8, 8);
            }
        }

        if (this.draft_) {
            const d = this.draft_;
            let pts = d.points;
            let closed = false;
            if (d.tool === 'circle' || d.tool === 'rect') {
                const r = Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y);
                pts = d.tool === 'circle' ? Array.from({ length: 48 }, (_, i) => ({ x: d.start.x + r * Math.cos((i / 48) * 2 * Math.PI), y: d.start.y + r * Math.sin((i / 48) * 2 * Math.PI) })) : [d.start, { x: d.end.x, y: d.start.y }, d.end, { x: d.start.x, y: d.end.y }];
                closed = true;
            }
            const copies = this.data_.sym ? all_copies(to_domain(pts, this.data_.sym), this.data_.sym) : [pts];
            ctx.lineWidth = Math.max(1.5, (this.data_.stroke_mm ?? 2) * v.scale);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            copies.forEach((copy, i) => {
                ctx.strokeStyle = i === 0 ? 'rgba(70, 180, 255, 0.85)' : 'rgba(70, 180, 255, 0.4)';
                ctx.beginPath();
                copy.forEach((q, j) => {
                    const sp = this.to_screen_(q);
                    if (j) ctx.lineTo(sp.x, sp.y);
                    else ctx.moveTo(sp.x, sp.y);
                });
                if (closed) ctx.closePath();
                ctx.stroke();
            });
            ctx.lineCap = 'butt';
        }

        for (const c of checks) {
            const colour_var = c.severity === 'fatal' && !c.overridden ? '--bad' : '--warn';
            ctx.strokeStyle = css.getPropertyValue(colour_var).trim();
            ctx.lineWidth = 2;
            for (const b of c.boxes) {
                const pad = 3;
                ctx.strokeRect(
                    v.ox + b.x0 * v.scale - pad,
                    v.oy - b.y1 * v.scale - pad,
                    (b.x1 - b.x0) * v.scale + 2 * pad,
                    (b.y1 - b.y0) * v.scale + 2 * pad,
                );
            }
        }
    }
}
