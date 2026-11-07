// Layer strip (SPEC 11): a thumbnail of every layer under the preview, front first. Clicking one
// selects it for every per-layer control. Each has an eye button that shows or hides the layer in
// the 3D and 2D views (the view only: checks and cut files keep every layer), and "Show all"
// appears while any layer is hidden. A thumbnail redraws only when its layer's material or colour
// changes, so dense lattices cost nothing on edits that leave them alone.
// Assumptions: built layers carry material (micrometres, y up) and material_key.
import { el } from './dom.js';

const kSizePx = 44;
const kEyeShape = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/>';
const kEye = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">${kEyeShape}<circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
const kEyeOff = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">${kEyeShape}<path d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

export class LayerStrip {
    // on_select(k) is called with the clicked layer's index, on_toggle(k) with the index whose eye
    // was clicked, and on_show_all() by "Show all".
    constructor(container, { on_select, on_toggle, on_show_all }) {
        this.container_ = container;
        this.on_select_ = on_select;
        this.on_toggle_ = on_toggle;
        this.items_ = [];
        this.show_all_ = el('button', { type: 'button', class: 'tool small', text: 'Show all', hidden: '' });
        this.show_all_.addEventListener('click', () => on_show_all());
        container.append(el('span', { class: 'strip-label', text: 'Layers' }), this.show_all_);
    }

    // design and its built layers (unpacked), the selected layer index, and the hidden indices.
    show(design, layers, selected, hidden = new Set()) {
        const n = design.layers.length;
        while (this.items_.length < n) this.add_();
        while (this.items_.length > n) this.items_.pop().cell.remove();
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
        let any_hidden = false;
        this.items_.forEach((item, k) => {
            const colour = design.layers[k].finish.colour;
            item.button.setAttribute('aria-selected', String(k === selected));
            item.button.title = `Layer ${k + 1}${k === 0 ? ', the front' : k === n - 1 ? ', the back' : ''}`;
            const off = hidden.has(k);
            any_hidden ||= off;
            if (off !== item.off) {
                item.off = off;
                item.cell.classList.toggle('off', off);
                item.eye.innerHTML = off ? kEyeOff : kEye;
                item.eye.setAttribute('aria-pressed', String(!off));
                item.eye.title = off ? `Show layer ${k + 1} in the preview` : `Hide layer ${k + 1} in the preview (it is still cut)`;
            }
            const layer = layers?.[k];
            const key = layer ? `${layer.material_key}|${colour}|${box}` : null;
            if (!layer || key === item.key) return;
            item.key = key;
            this.draw_(item.canvas, layer.material, colour, { x0, y0, x1, y1 });
        });
        this.show_all_.hidden = !any_hidden;
    }

    add_() {
        const k = this.items_.length;
        const canvas = el('canvas', { class: 'strip-thumb', width: kSizePx, height: kSizePx });
        const button = el('button', { type: 'button', class: 'strip-item', role: 'option' }, [canvas, el('span', { text: `L${k + 1}` })]);
        button.addEventListener('click', () => this.on_select_(k));
        const eye = el('button', { type: 'button', class: 'strip-eye', 'aria-label': `Show layer ${k + 1}` });
        eye.addEventListener('click', () => this.on_toggle_(k));
        this.container_.append(el('div', { class: 'strip-cell', role: 'none' }, [button, eye]));
        this.items_.push({ cell: button.parentElement, button, eye, canvas, key: null, off: null });
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
