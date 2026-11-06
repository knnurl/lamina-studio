// Layer view (SPEC 10): one layer, flat, for inspecting and editing. Material is drawn in the
// layer's colour; bridges, islands (by policy), locators for glue-on islands from the layer in
// front, and check boxes (red fatal, amber warning) are drawn over it. Click an island to cycle
// its policy; the wheel zooms at the cursor; drag pans; double-click refits.
// Assumptions: paths in micrometres, y up; the canvas works in mm.
import { kUmPerMm } from '../core/units.js';

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

export class LayerView {
    // on_island_click(island) is called with the island under the cursor.
    constructor(container, { on_island_click }) {
        this.container_ = container;
        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'layer-canvas';
        this.canvas_.hidden = true;
        this.legend_ = document.createElement('div');
        this.legend_.className = 'layer-legend';
        this.legend_.hidden = true;
        this.legend_.innerHTML =
            '<span class="key bridge"></span>bridged island <span class="key glue"></span>glue-on ' +
            '<span class="key drop"></span>dropped. Click an island to change it. Wheel zooms, drag ' +
            'pans, double-click refits. Boxes mark check findings.';
        container.append(this.canvas_, this.legend_);
        this.ctx_ = this.canvas_.getContext('2d');
        this.view_ = null; // { scale px per mm, ox, oy }
        this.data_ = null;
        this.on_island_click_ = on_island_click;

        let drag = null;
        this.canvas_.addEventListener('pointerdown', e => {
            drag = { x: e.offsetX, y: e.offsetY, moved: false };
            this.canvas_.setPointerCapture(e.pointerId);
        });
        this.canvas_.addEventListener('pointermove', e => {
            if (!drag || !this.view_) return;
            const dx = e.offsetX - drag.x;
            const dy = e.offsetY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
            if (drag.moved) {
                this.view_.ox += dx;
                this.view_.oy += dy;
                drag.x = e.offsetX;
                drag.y = e.offsetY;
                this.draw_();
            }
        });
        this.canvas_.addEventListener('pointerup', e => {
            if (drag && !drag.moved) this.click_(e.offsetX, e.offsetY);
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
        this.canvas_.addEventListener('dblclick', () => {
            this.view_ = null;
            this.draw_();
        });
        new ResizeObserver(() => this.draw_()).observe(container);
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

    click_(sx, sy) {
        if (!this.data_ || !this.view_) return;
        const p = this.to_world_(sx, sy);
        const hit = this.data_.built.islands.find(i => point_in_path(p, i.outer));
        if (hit) this.on_island_click_(hit);
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
        for (const b of built.bridges) ctx.fill(this.trace_(b.rect));

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
