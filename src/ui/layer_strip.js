// Layer strip (SPEC 11): a thumbnail of every layer under the preview, front first. Clicking one
// selects it for every per-layer control. A thumbnail redraws only when its layer's material or
// colour changes, so dense lattices cost nothing on edits that leave them alone.
// Assumptions: built layers carry material (micrometres, y up) and material_key.
import { el } from './dom.js';

const kSizePx = 44;

export class LayerStrip {
    // on_select(k) is called with the clicked layer's index.
    constructor(container, { on_select }) {
        this.container_ = container;
        this.on_select_ = on_select;
        this.items_ = [];
        container.append(el('span', { class: 'strip-label', text: 'Layers' }));
    }

    // design and its built layers (unpacked), and the selected layer index.
    show(design, layers, selected) {
        const n = design.layers.length;
        while (this.items_.length < n) this.add_();
        while (this.items_.length > n) this.items_.pop().button.remove();
        // One scale for every thumbnail: the box round all the layers' material, found again only
        // when some layer's material changed (a scan of every point of a dense stack).
        const keys = (layers ?? []).map(l => l.material_key).join('|');
        if (keys !== this.box_keys_) {
            this.box_keys_ = keys;
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            for (const l of layers ?? []) {
                for (const path of l.material) {
                    for (const p of path) {
                        if (p.x < x0) x0 = p.x;
                        if (p.x > x1) x1 = p.x;
                        if (p.y < y0) y0 = p.y;
                        if (p.y > y1) y1 = p.y;
                    }
                }
            }
            this.b_ = { x0, y0, x1, y1 };
        }
        const { x0, y0, x1, y1 } = this.b_;
        const box = `${x0}|${y0}|${x1}|${y1}`;
        this.items_.forEach((item, k) => {
            const colour = design.layers[k].finish.colour;
            item.button.setAttribute('aria-selected', String(k === selected));
            item.button.title = `Layer ${k + 1}${k === 0 ? ', the front' : k === n - 1 ? ', the back' : ''}`;
            const layer = layers?.[k];
            const key = layer ? `${layer.material_key}|${colour}|${box}` : null;
            if (!layer || key === item.key) return;
            item.key = key;
            this.draw_(item.canvas, layer.material, colour, { x0, y0, x1, y1 });
        });
    }

    add_() {
        const k = this.items_.length;
        const canvas = el('canvas', { class: 'strip-thumb', width: kSizePx, height: kSizePx });
        const button = el('button', { type: 'button', class: 'strip-item', role: 'option' }, [canvas, el('span', { text: `L${k + 1}` })]);
        button.addEventListener('click', () => this.on_select_(k));
        this.container_.append(button);
        this.items_.push({ button, canvas, key: null });
    }

    draw_(canvas, material, colour, b) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(kSizePx * dpr);
        canvas.height = Math.round(kSizePx * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) || 1;
        const s = (canvas.width * 0.9) / span;
        const cx = (b.x0 + b.x1) / 2;
        const cy = (b.y0 + b.y1) / 2;
        const path = new Path2D();
        for (const p of material) {
            if (!p.length) continue;
            path.moveTo(canvas.width / 2 + (p[0].x - cx) * s, canvas.height / 2 - (p[0].y - cy) * s);
            for (let i = 1; i < p.length; i++) path.lineTo(canvas.width / 2 + (p[i].x - cx) * s, canvas.height / 2 - (p[i].y - cy) * s);
            path.closePath();
        }
        ctx.fillStyle = colour;
        ctx.fill(path, 'evenodd');
    }
}
