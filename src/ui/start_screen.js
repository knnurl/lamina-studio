// Start screen (SPEC 11): "What are you making?" Four kinds of piece, each with a gallery of
// matching presets drawn from their real geometry, plus a blank start. Thumbnails are built in
// the worker one at a time and kept for the session. Shows on the first visit and from New.
import { kPresets, preset_by_id } from '../core/presets.js';
import { el } from './dom.js';

export const kKinds = [
    {
        id: 'round',
        title: 'Round wall piece',
        text: 'Mandalas, lattices and orbs, stacked and nested.',
        presets: ['mandala', 'lattice', 'orb', 'rose', 'sun', 'lantern'],
        blank: { outline: { kind: 'circle', w_mm: 290 }, symmetry: { kind: 'dihedral', n: 8, phase_deg: 0 }, layers: 8 },
        icon: '<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3.5"/>',
    },
    {
        id: 'box',
        title: 'Framed shadow box',
        text: 'A deep frame with a scene in layers.',
        presets: [],
        note: 'Box frames and their presets arrive with M6. Start blank for now.',
        blank: { outline: { kind: 'rect', w_mm: 300, h_mm: 300 }, symmetry: { kind: 'mirror_x', n: 1, phase_deg: 0 }, layers: 8 },
        icon: '<rect x="7" y="7" width="34" height="34" rx="2"/><rect x="13" y="13" width="22" height="22" rx="1"/><path d="M17 31l6-8 4 5 3-3 4 6"/>',
    },
    {
        id: 'panel',
        title: 'Festival panel',
        text: 'Large rectangles: circuits, gates and signs.',
        presets: ['circuit', 'gate'],
        blank: { outline: { kind: 'rect', w_mm: 380, h_mm: 280 }, symmetry: { kind: 'mirror_xy', n: 1, phase_deg: 0 }, layers: 6 },
        icon: '<rect x="5" y="11" width="38" height="26" rx="2"/><path d="M11 17h8l4 4h6M11 31h6l4-4h10M33 21v-4h4"/><circle cx="37" cy="17" r="1.8"/>',
    },
    {
        id: 'photo',
        title: 'From a photo',
        text: 'Layers from a picture or a depth map.',
        presets: [],
        note: 'Photo to layers arrives with M5.',
        icon: '<rect x="6" y="10" width="36" height="28" rx="3"/><circle cx="17" cy="19" r="4"/><path d="M9 35l11-10 7 6 5-4 9 8"/>',
    },
];

// Draws a stack's front view: layers back to front in their colours, with a soft shadow.
export function draw_stack(canvas, design, layers) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const l of layers) {
        for (const path of l.material) {
            for (const p of path) {
                if (p.x < x0) x0 = p.x;
                if (p.x > x1) x1 = p.x;
                if (p.y < y0) y0 = p.y;
                if (p.y > y1) y1 = p.y;
            }
        }
    }
    const s = (Math.min(canvas.width, canvas.height) * 0.92) / (Math.max(x1 - x0, y1 - y0) || 1);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    for (let k = layers.length - 1; k >= 0; k--) {
        const path = new Path2D();
        for (const p of layers[k].material) {
            if (!p.length) continue;
            path.moveTo(canvas.width / 2 + (p[0].x - cx) * s, canvas.height / 2 - (p[0].y - cy) * s);
            for (let i = 1; i < p.length; i++) path.lineTo(canvas.width / 2 + (p[i].x - cx) * s, canvas.height / 2 - (p[i].y - cy) * s);
            path.closePath();
        }
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = design.layers[k].finish.colour;
        ctx.fill(path, 'evenodd');
        ctx.restore();
    }
}

export class StartScreen {
    // actions: { build(design) -> Promise<layers>, open_preset(id), start_blank(kind), close(),
    //            open_file(), import_svg(), tour(), describe(text, kind) }
    constructor(root, actions) {
        this.root_ = root;
        this.actions_ = actions;
        this.kind_ = 'round';
        this.thumbs_ = new Map(); // preset id -> canvas, drawn once
        this.queue_ = Promise.resolve();
        this.first_visit_ = false;
        this.continue_name_ = null;
        root.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !this.first_visit_) this.actions_.close();
        });
    }

    // first_visit hides the way back (there is no design of theirs to go back to).
    show({ first_visit = false, continue_name = null } = {}) {
        this.first_visit_ = first_visit;
        this.continue_name_ = continue_name;
        this.render_();
        this.root_.hidden = false;
        this.root_.querySelector('.kind[aria-pressed="true"]')?.focus();
    }

    hide() {
        this.root_.hidden = true;
    }

    get open() {
        return !this.root_.hidden;
    }

    render_() {
        const a = this.actions_;
        const root = this.root_;
        root.textContent = '';
        const top = el('div', { class: 'start-top' }, [el('span', { class: 'mark', text: 'Lamina' }), el('span', { class: 'start-tag', text: 'layered laser art studio' }), el('span', { class: 'spacer' })]);
        const open = el('button', { type: 'button', class: 'tool', text: 'Open a saved design' });
        open.addEventListener('click', () => a.open_file());
        top.append(open);
        if (!this.first_visit_) {
            const back = el('button', { type: 'button', class: 'btn', text: this.continue_name_ ? `Back to ${this.continue_name_}` : 'Back' });
            back.addEventListener('click', () => a.close());
            top.append(back);
        }

        const kinds = el('div', { class: 'kinds' });
        for (const kind of kKinds) {
            const card = el('button', { type: 'button', class: 'kind', 'aria-pressed': String(kind.id === this.kind_) });
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('viewBox', '0 0 48 48');
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = kind.icon;
            card.append(icon, el('strong', { text: kind.title }), el('span', { text: kind.text }));
            card.addEventListener('click', () => {
                this.kind_ = kind.id;
                this.render_();
                this.root_.querySelector('.kind[aria-pressed="true"]')?.focus();
            });
            kinds.append(card);
        }

        const kind = kKinds.find(k => k.id === this.kind_);
        // Describe it: the assistant builds the piece from words, starting from this kind's blank.
        const words = el('textarea', { class: 'describe-input', rows: 2, placeholder: `Or describe your ${kind.title.toLowerCase()} and the assistant will design it. For example: a 10-layer lotus mandala with a key-fret border, deep blue to gold.`, 'aria-label': 'Describe the piece' });
        const go = el('button', { type: 'button', class: 'btn', text: 'Design it' });
        const describe = () => {
            if (words.value.trim()) a.describe(words.value.trim(), kind);
        };
        go.addEventListener('click', describe);
        words.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                describe();
            }
        });
        const describe_row = kind.blank ? el('div', { class: 'describe-row' }, [words, go]) : null;
        const gallery = el('div', { class: 'gallery' });
        for (const id of kind.presets) gallery.append(this.preset_card_(id));
        if (kind.blank) {
            const blank = el('button', { type: 'button', class: 'preset blank' }, [
                el('span', { class: 'blank-art', text: '+' }),
                el('strong', { text: 'Start blank' }),
                el('small', { text: `${kind.blank.layers} plain layers, ${kind.blank.outline.w_mm}${kind.blank.outline.h_mm ? ` x ${kind.blank.outline.h_mm}` : ''} mm` }),
            ]);
            blank.addEventListener('click', () => a.start_blank(kind));
            gallery.append(blank);
        }
        const note = kind.note ? el('p', { class: 'start-note', text: kind.note }) : null;

        const foot = el('div', { class: 'start-foot' });
        const tour = el('button', { type: 'button', class: 'btn ghost', text: 'Take the one-minute tour' });
        tour.addEventListener('click', () => a.tour());
        const svg = el('button', { type: 'button', class: 'btn ghost', text: 'Import SVG artwork' });
        svg.addEventListener('click', () => a.import_svg());
        foot.append(tour, svg, el('span', { text: 'A preset opens at the Pattern step; a blank start at the Piece step.' }));

        const inner = el('div', { class: 'start-inner' }, [top, el('h2', { text: 'What are you making?' }), kinds, ...(describe_row ? [describe_row] : []), el('h3', { class: 'sub', text: 'Or start from one of these' }), ...(note ? [note] : []), gallery, foot]);
        root.append(inner);
    }

    preset_card_(id) {
        const p = kPresets.find(x => x.id === id);
        const design = preset_by_id(id);
        const o = design.piece.outline;
        let canvas = this.thumbs_.get(id);
        if (!canvas) {
            canvas = el('canvas', { class: 'preset-thumb', width: 320, height: 320, 'aria-hidden': 'true' });
            this.thumbs_.set(id, canvas);
            // One build at a time, so the worker stays free for the editor in between.
            this.queue_ = this.queue_
                .then(() => this.actions_.build(design))
                .then(layers => draw_stack(canvas, design, layers))
                .catch(() => {});
        }
        const card = el('button', { type: 'button', class: 'preset' }, [
            canvas,
            el('strong', { text: p.name }),
            el('small', { text: `${design.layers.length} layers, ${o.w_mm}${o.kind === 'rect' || o.kind === 'arch' ? ` x ${o.h_mm}` : ''} mm` }),
        ]);
        card.addEventListener('click', () => this.actions_.open_preset(id));
        return card;
    }
}
