// 2D stacked render (SPEC 10): every layer drawn flat, back to front, in its finish colour with a
// soft drop shadow, in the style of the AngelShadowBox preview. The fast view for very dense
// pieces. Backlit pieces get a glow in the light colour behind the back layer's silhouette.
// Assumptions: paths in micrometres, y up.
import { kUmPerMm } from '../core/units.js';

export class Render2D {
    constructor(container) {
        this.canvas_ = document.createElement('canvas');
        this.canvas_.className = 'layer-canvas render2d';
        this.canvas_.hidden = true;
        container.append(this.canvas_);
        this.data_ = null;
        new ResizeObserver(() => this.draw_()).observe(container);
    }

    set_visible(on) {
        this.canvas_.hidden = !on;
        if (on) this.draw_();
    }

    show(design, built) {
        this.data_ = { design, built };
        if (!this.canvas_.hidden) this.draw_();
    }

    draw_() {
        const canvas = this.canvas_;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h || !this.data_) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const { design, built } = this.data_;

        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of built[built.length - 1].material.flat()) {
            x0 = Math.min(x0, p.x);
            y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x);
            y1 = Math.max(y1, p.y);
        }
        const scale = Math.min(w / ((x1 - x0) / kUmPerMm), h / ((y1 - y0) / kUmPerMm)) * 0.88;
        const ox = w / 2 - (((x0 + x1) / 2) * scale) / kUmPerMm;
        const oy = h / 2 + (((y0 + y1) / 2) * scale) / kUmPerMm;
        const trace = paths => {
            const path = new Path2D();
            for (const p of paths) {
                path.moveTo(ox + (p[0].x / kUmPerMm) * scale, oy - (p[0].y / kUmPerMm) * scale);
                for (let i = 1; i < p.length; i++) path.lineTo(ox + (p[i].x / kUmPerMm) * scale, oy - (p[i].y / kUmPerMm) * scale);
                path.closePath();
            }
            return path;
        };

        if (design.piece.lighting.mode === 'backlit') {
            ctx.save();
            ctx.shadowColor = design.piece.lighting.colour;
            ctx.shadowBlur = 40;
            ctx.fillStyle = design.piece.lighting.colour;
            ctx.fill(trace(built[built.length - 1].material.filter(p => p.length > 2)), 'evenodd');
            ctx.restore();
        }
        for (let k = built.length - 1; k >= 0; k--) {
            const path = trace(built[k].material);
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
            ctx.shadowBlur = 6 + Math.min(10, design.layers[k].gap_mm);
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 3;
            ctx.fillStyle = design.layers[k].finish.colour;
            ctx.fill(path, 'evenodd');
            ctx.restore();
        }
    }
}
