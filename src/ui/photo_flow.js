// "Layers from a photo" (SPEC M5): choose a photo, choose how it slices (light and dark, depth
// found by AI, or a depth map already), see the bands it will cut, then make the layers. Used by
// the start screen (a new piece) and the Pattern step (the current piece). Resolves with the
// choices, or null when cancelled.
import { el } from './dom.js';
import { decode_image, photo_canvas, field_raster } from '../image/photo.js';
import { grey_of, base64_to_bytes, band_preview } from '../image/raster.js';
import { kDepthModels, depth_backend, estimate_depth } from '../image/depth.js';

const kModes = [
    { id: 'tone', title: 'Light and dark', text: 'Bright parts come forward, dark parts sink back.' },
    { id: 'ai', title: 'Depth, found by AI', text: 'A model running on this computer estimates what is near. The photo never leaves it.' },
    { id: 'map', title: 'It is a depth map', text: 'Bright is near: from a phone camera, Blender or another app.' },
];

function draw_grey(canvas, grey, w, h) {
    canvas.width = w;
    canvas.height = h;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < grey.length; i++) {
        rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = grey[i];
        rgba[4 * i + 3] = 255;
    }
    canvas.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
}

export function open_photo_flow({ fresh = false, layers = 8 } = {}) {
    return new Promise(resolve => {
        const s = { photo: null, name: '', mode: 'tone', model: 'small', even: true, shape: 'fit', layers, depth: new Map(), busy: false };
        const dialog = el('dialog', { class: 'photo-flow', 'aria-label': 'Layers from a photo' });
        const finish = result => {
            dialog.close();
            dialog.remove();
            resolve(result);
        };
        dialog.addEventListener('cancel', e => {
            e.preventDefault();
            if (!s.busy) finish(null);
        });

        const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: '' });
        const choose = el('button', { type: 'button', class: 'btn', text: 'Choose a photo' });
        choose.addEventListener('click', () => file.click());
        const drop = el('div', { class: 'photo-drop' }, [el('p', { text: 'Drop a photo here, or' }), choose, file]);
        const picture = el('canvas', { class: 'photo-preview', 'aria-label': 'The bands the layers will cut' });
        const caption = el('p', { class: 'step-note photo-caption' });
        const status = el('p', { class: 'step-note photo-status', role: 'status' });
        const modes = el('div', { class: 'photo-modes', role: 'radiogroup', 'aria-label': 'Slice by' });
        const model = el('select', { 'aria-label': 'Depth model' });
        const model_row = el('label', { class: 'photo-row' }, [el('span', { text: 'Model' }), model]);
        const model_note = el('p', { class: 'step-note photo-licence' });
        const even = el('input', { type: 'checkbox' });
        even.checked = true;
        const even_row = el('label', { class: 'photo-check', title: 'Spreads the tones so each layer cuts about the same area' }, [even, el('span', { text: 'Even out the tones' })]);
        const shape = el('select', { 'aria-label': 'Shape' }, [el('option', { value: 'fit', text: 'A rectangle that fits the photo' }), el('option', { value: 'round', text: 'Round' })]);
        const count = el('input', { type: 'number', min: 3, max: 20, step: 1, value: layers, 'aria-label': 'Layers' });
        const piece_rows = fresh ? [el('label', { class: 'photo-row' }, [el('span', { text: 'Shape' }), shape]), el('label', { class: 'photo-row' }, [el('span', { text: 'Layers' }), count])] : [];
        const cancel = el('button', { type: 'button', class: 'btn ghost', text: 'Cancel' });
        const go = el('button', { type: 'button', class: 'btn' });
        cancel.addEventListener('click', () => finish(null));

        const grey_for_mode = () => {
            if (s.mode === 'ai') return s.depth.get(s.model) ?? null;
            return { grey: grey_of(s.photo.rgba), w: s.photo.w, h: s.photo.h };
        };

        const render = () => {
            drop.hidden = !!s.photo;
            picture.hidden = again.hidden = !s.photo;
            for (const b of modes.children) b.setAttribute('aria-checked', String(b.dataset.mode === s.mode));
            model_row.hidden = model_note.hidden = s.mode !== 'ai';
            const m = kDepthModels.find(x => x.id === s.model);
            model_note.textContent = m.commercial
                ? 'Small is free for any use (Apache-2.0). Downloaded once, then kept by the browser.'
                : `${m.label} is for non-commercial use only (CC-BY-NC-4.0): fine for your own pieces, not for pieces you sell. Downloaded once, then kept by the browser.`;
            const ready = s.photo && (s.mode !== 'ai' || s.depth.has(s.model));
            go.textContent = s.mode === 'ai' && s.photo && !s.depth.has(s.model) ? 'Find depth' : 'Make the layers';
            go.disabled = !s.photo || s.busy;
            choose.disabled = s.busy;
            if (!s.photo) return;
            const n = fresh ? s.layers : layers;
            if (ready) {
                const g = grey_for_mode();
                const r = field_raster(g.grey, g.w, g.h, { even: s.even });
                draw_grey(picture, band_preview(base64_to_bytes(r.data), n), r.w, r.h);
                caption.textContent = `${s.name}: the ${n} layers, front lightest. Darker parts sit further back.`;
            } else {
                const g = { grey: grey_of(s.photo.rgba), w: s.photo.w, h: s.photo.h };
                const r = field_raster(g.grey, g.w, g.h);
                draw_grey(picture, base64_to_bytes(r.data), r.w, r.h);
                caption.textContent = `${s.name}. Find depth to see the layers.`;
            }
        };

        for (const m of kModes) {
            const b = el('button', { type: 'button', class: 'photo-mode', role: 'radio', 'data-mode': m.id }, [el('strong', { text: m.title }), el('span', { text: m.text })]);
            b.addEventListener('click', () => {
                if (s.busy) return;
                s.mode = m.id;
                render();
            });
            modes.append(b);
        }
        depth_backend().then(backend => {
            for (const m of kDepthModels) {
                const detail = m.id === 'small' ? 'fast' : m.id === 'base' ? 'more detail' : 'most detail, slow';
                model.append(el('option', { value: m.id, text: `${m.label}: ${detail}, ${m.mb[backend]} MB${m.commercial ? '' : ', non-commercial'}` }));
            }
            model.value = s.model;
        });
        model.addEventListener('change', () => {
            s.model = model.value;
            render();
        });
        even.addEventListener('change', () => {
            s.even = even.checked;
            render();
        });
        shape.addEventListener('change', () => {
            s.shape = shape.value;
        });
        count.addEventListener('change', () => {
            s.layers = Math.min(20, Math.max(3, Math.round(Number(count.value) || layers)));
            count.value = s.layers;
            render();
        });

        const load = async blob => {
            status.textContent = 'Opening the photo...';
            try {
                s.photo = await decode_image(blob);
                s.name = blob.name || 'The photo';
                s.depth.clear();
                status.textContent = '';
            } catch {
                status.textContent = 'That file could not be opened as a picture. Try a JPEG or PNG.';
            }
            render();
        };
        file.addEventListener('change', () => {
            if (file.files[0]) load(file.files[0]);
            file.value = '';
        });
        for (const target of [drop, picture]) {
            target.addEventListener('dragover', e => {
                e.preventDefault();
                drop.classList.add('over');
            });
            target.addEventListener('dragleave', () => drop.classList.remove('over'));
            target.addEventListener('drop', e => {
                e.preventDefault();
                drop.classList.remove('over');
                const f = [...(e.dataTransfer?.files ?? [])].find(x => x.type.startsWith('image/'));
                if (f) load(f);
            });
        }
        const again = el('button', { type: 'button', class: 'tool small', text: 'Choose another photo' });
        again.addEventListener('click', () => file.click());

        go.addEventListener('click', async () => {
            if (s.mode === 'ai' && !s.depth.has(s.model)) {
                s.busy = true;
                render();
                try {
                    const found = await estimate_depth(photo_canvas(s.photo), s.model, p => {
                        if (p.phase === 'library') status.textContent = 'Loading the depth library...';
                        else if (p.phase === 'download') status.textContent = `Downloading the depth model: ${Math.round(p.loaded_mb)} of ${Math.round(p.total_mb)} MB`;
                        else status.textContent = 'Finding depth...';
                    });
                    s.depth.set(s.model, found);
                    status.textContent = 'Depth found. Bright is near.';
                } catch (err) {
                    status.textContent = `Depth could not be found: ${err.message}. Check the connection for the first download, or try Light and dark.`;
                }
                s.busy = false;
                render();
                return;
            }
            const g = grey_for_mode();
            finish({
                raster: field_raster(g.grey, g.w, g.h, { even: s.even }),
                mode: s.mode,
                model: s.mode === 'ai' ? s.model : null,
                shape: s.shape,
                layers: s.layers,
                photo: { ...s.photo, name: s.name },
            });
        });

        dialog.append(
            el('h2', { text: fresh ? 'A piece from a photo' : 'Use a photo' }),
            el('div', { class: 'photo-body' }, [
                el('div', { class: 'photo-left' }, [drop, picture, caption, el('div', { class: 'photo-again' }, [again])]),
                el('div', { class: 'photo-right' }, [el('h3', { class: 'sub', text: 'Slice it by' }), modes, model_row, model_note, even_row, ...piece_rows]),
            ]),
            status,
            el('div', { class: 'photo-actions' }, [cancel, go]),
        );
        document.body.append(dialog);
        render();
        dialog.showModal();
        choose.focus();
    });
}
