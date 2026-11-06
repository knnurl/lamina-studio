// Sheets view (SPEC 10): the packed stock sheets exactly as they will be exported, one under the
// other, as SVG (cut red, score blue, engrave green; strokes thickened for the screen).
import { drawing_to_svg } from '../export/svg.js';
import { kMaterials } from '../core/design.js';
import { unpack_paths } from '../geom/pack.js';

export class SheetsView {
    constructor(container) {
        this.root_ = document.createElement('div');
        this.root_.className = 'sheets-view';
        this.root_.hidden = true;
        container.append(this.root_);
    }

    set_visible(on) {
        this.root_.hidden = !on;
    }

    show_message(text) {
        this.root_.textContent = '';
        const p = document.createElement('p');
        p.className = 'step-note';
        p.textContent = text;
        this.root_.append(p);
    }

    // result: the worker's 'sheets' reply.
    show(result) {
        this.root_.textContent = '';
        const total = {};
        for (const s of result.sheets) total[s.material] = (total[s.material] ?? 0) + 1;
        for (const s of result.sheets) {
            const points = unpack_paths(s.points);
            const drawing = {
                width_mm: s.width_mm,
                height_mm: s.height_mm,
                items: points.map((p, i) => ({ layer: s.layers[i], closed: s.closed[i], points: p })),
            };
            const figure = document.createElement('figure');
            figure.className = 'sheet';
            figure.innerHTML = drawing_to_svg(drawing)
                .replace(/^<\?xml[^>]*>\s*/, '')
                .replace(/\x3c!--[\s\S]*?--\x3e\s*/, '') // \x3c is "<": no literal comment opener in an inline script
                .replace(/stroke-width="0.025"/g, 'stroke-width="0.6"');
            const caption = document.createElement('figcaption');
            caption.textContent = `Sheet ${s.number} of ${total[s.material]}: ${kMaterials[s.material]?.label ?? s.material}, ${s.width_mm} x ${s.height_mm} mm`;
            figure.append(caption);
            this.root_.append(figure);
        }
        if (result.unplaced.length) {
            const p = document.createElement('p');
            p.className = 'step-note';
            p.textContent = `Too big for the sheet: ${result.unplaced.join(', ')}.`;
            this.root_.append(p);
        }
    }
}
