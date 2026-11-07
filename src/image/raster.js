// Grey rasters (SPEC M4.5, M5): pure functions on byte arrays, shared by the picture field, photos,
// depth maps and the engraved back plate. Rows run from the top; grey 0 is black.
// Assumptions: rasters are small enough to hold in memory (a 600 DPI plate is at most a few tens
// of megapixels).

export const kLuma = [0.2126, 0.7152, 0.0722];
// prep_portrait.py's grey for engraving: red-leaning, which keeps skin light and lips and eyes dark.
export const kRedLean = [0.55, 0.33, 0.12];

export function bytes_to_base64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

export function base64_to_bytes(data) {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// FNV-1a over the bytes: a short name for caches, so they never hold the bytes as a key.
export function fnv_hash(bytes) {
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
    return (h >>> 0).toString(36);
}

// RGBA bytes to grey bytes with the given channel weights.
export function grey_of(rgba, weights = kLuma) {
    const [wr, wg, wb] = weights;
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(wr * rgba[4 * i] + wg * rgba[4 * i + 1] + wb * rgba[4 * i + 2]);
    return out;
}

// Area-average shrink so the longest side is at most max_px (never enlarges).
export function shrink(grey, w, h, max_px) {
    const k = Math.min(1, max_px / Math.max(w, h));
    if (k === 1) return { grey, w, h };
    const nw = Math.max(1, Math.round(w * k));
    const nh = Math.max(1, Math.round(h * k));
    const out = new Uint8Array(nw * nh);
    for (let j = 0; j < nh; j++) {
        const y0 = (j * h) / nh;
        const y1 = ((j + 1) * h) / nh;
        for (let i = 0; i < nw; i++) {
            const x0 = (i * w) / nw;
            const x1 = ((i + 1) * w) / nw;
            let sum = 0;
            let area = 0;
            for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
                const fy = Math.min(y + 1, y1) - Math.max(y, y0);
                for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
                    const a = fy * (Math.min(x + 1, x1) - Math.max(x, x0));
                    sum += a * grey[y * w + x];
                    area += a;
                }
            }
            out[j * nw + i] = Math.round(sum / area);
        }
    }
    return { grey: out, w: nw, h: nh };
}

// Evens out the tones: each tone becomes its percentile in the picture (the middle of its rank),
// so layers sliced at even levels cut equal areas (SPEC M5, tone bands). Plain histogram
// equalisation maps the darkest tone to 0 however common it is, and a large dark ground then
// squeezes every other band.
export function equalise(grey) {
    const hist = new Float64Array(256);
    for (const v of grey) hist[v]++;
    const map = new Uint8Array(256);
    let below = 0;
    for (let v = 0; v < 256; v++) {
        map[v] = Math.round((255 * (below + hist[v] / 2)) / grey.length);
        below += hist[v];
    }
    return grey.map(v => map[v]);
}

// The bands a raster cuts into n layers, as the photo flow and the field slice them: bright is
// near, levels evenly spaced from 1/n (front) to 1 (back). Returns grey bytes, front lightest.
export function band_preview(grey, n) {
    const out = new Uint8Array(grey.length);
    for (let i = 0; i < grey.length; i++) {
        const k = Math.min(n - 1, Math.floor((1 - grey[i] / 255) * n)); // the front-most layer with material here
        out[i] = Math.round(255 - (215 * k) / Math.max(1, n - 1));
    }
    return out;
}

// The picture field's raster: { w, h, data (base64 grey), hash }.
export function raster(grey, w, h) {
    return { w, h, data: bytes_to_base64(grey), hash: `${w}x${h}-${fnv_hash(grey)}` };
}
