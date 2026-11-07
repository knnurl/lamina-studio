// Spotlight tour (SPEC 11): about a minute, six stops, each lighting up one part of the editor with
// a short note. Back, Next and Skip; Escape closes it. Offered on the start screen and once after
// the first piece opens.
import { el } from './dom.js';

const kStops = [
    { target: '#steps', text: 'Five steps take you from an outline to cut files. Work through them in order, or click any step to jump to it.' },
    { target: '#panel', text: 'Each step shows only what it needs. "More options" at the bottom of a step holds the rest.' },
    { target: '#stage', text: 'The preview follows the step: 3D while you design, the Layer view for structure, the Sheets to make. Drag to turn it; the tabs switch views by hand.' },
    { target: '#layer-strip', text: 'Every layer, front first. Click one to edit it in the Pattern, Look and Structure steps. The eye hides a layer in the preview, and All layers sends your changes to every layer.' },
    { target: '#panel-next', text: 'Next takes you to the following step. Nothing is locked, so go back any time.' },
    { target: '.status', text: 'The light turns amber for warnings and red for anything that would break when cut. The Make step lists each one with a box on the layer.' },
];

export class Tour {
    constructor(root) {
        this.root_ = root;
        this.at_ = 0;
        this.on_key_ = e => {
            if (e.key === 'Escape') this.stop();
            if (e.key === 'ArrowRight') this.go_(1);
            if (e.key === 'ArrowLeft') this.go_(-1);
        };
        this.on_resize_ = () => this.place_();
    }

    start() {
        this.at_ = 0;
        this.root_.hidden = false;
        document.addEventListener('keydown', this.on_key_);
        window.addEventListener('resize', this.on_resize_);
        this.render_();
    }

    stop() {
        this.root_.hidden = true;
        this.root_.textContent = '';
        document.removeEventListener('keydown', this.on_key_);
        window.removeEventListener('resize', this.on_resize_);
    }

    go_(delta) {
        const next = this.at_ + delta;
        if (next < 0) return;
        if (next >= kStops.length) {
            this.stop();
            return;
        }
        this.at_ = next;
        this.render_();
    }

    render_() {
        const stop = kStops[this.at_];
        this.root_.textContent = '';
        const spot = el('div', { class: 'tour-spot' });
        const back = el('button', { type: 'button', class: 'btn ghost', text: 'Back' });
        back.disabled = this.at_ === 0;
        back.addEventListener('click', () => this.go_(-1));
        const next = el('button', { type: 'button', class: 'btn', text: this.at_ === kStops.length - 1 ? 'Done' : 'Next' });
        next.addEventListener('click', () => this.go_(1));
        const skip = el('button', { type: 'button', class: 'more-toggle', text: 'Skip the tour' });
        skip.addEventListener('click', () => this.stop());
        const bubble = el('div', { class: 'tour-bubble', role: 'dialog', 'aria-label': 'Tour' }, [
            el('span', { class: 'panel-kicker', text: `${this.at_ + 1} of ${kStops.length}` }),
            el('p', { text: stop.text }),
            el('div', { class: 'tour-buttons' }, [skip, el('span', { class: 'spacer' }), back, next]),
        ]);
        this.root_.append(spot, bubble);
        this.place_();
        next.focus();
    }

    // The spotlight hugs the target; the bubble sits below it, or above when there is no room.
    place_() {
        const spot = this.root_.querySelector('.tour-spot');
        const bubble = this.root_.querySelector('.tour-bubble');
        const target = document.querySelector(kStops[this.at_]?.target);
        if (!spot || !bubble || !target) return;
        const r = target.getBoundingClientRect();
        const pad = 6;
        Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
        const bw = Math.min(360, window.innerWidth - 32);
        const left = Math.max(16, Math.min(window.innerWidth - bw - 16, r.left + r.width / 2 - bw / 2));
        bubble.style.width = `${bw}px`;
        bubble.style.left = `${left}px`;
        const below = r.bottom + pad + 12;
        const bh = bubble.offsetHeight;
        bubble.style.top = below + bh < window.innerHeight - 8 ? `${below}px` : `${Math.max(8, r.top - pad - 12 - bh)}px`;
        // A tall target: the bubble goes beside it when there is room (the step panel), else just
        // inside its top edge (the preview).
        if (r.height > window.innerHeight * 0.6) {
            bubble.style.top = `${Math.max(8, r.top + 48)}px`;
            if (r.right + 24 + bw < window.innerWidth) bubble.style.left = `${r.right + 24}px`;
        }
    }
}
