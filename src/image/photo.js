// Photos and pictures in the browser (SPEC M5): decode with the camera's orientation applied, keep
// at most kPhotoPx on the longest side, and make the grey raster the picture field slices.
// Browser only (createImageBitmap, OffscreenCanvas).
import { grey_of, shrink, equalise, raster } from './raster.js';

export const kPhotoPx = 1600; // enough for a 270 mm engraved plate at about 150 px per inch of detail
export const kFieldPx = 320; // the picture field's raster: about 1 mm per pixel on a 300 mm piece

// A blob decoded into RGBA at most max_px on its longest side: { rgba, w, h }.
export async function decode_image(blob, max_px = kPhotoPx) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, max_px / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return { rgba: ctx.getImageData(0, 0, w, h).data, w, h };
}

// The photo drawn on a canvas, for the depth model.
export function photo_canvas(photo) {
    const canvas = new OffscreenCanvas(photo.w, photo.h);
    canvas.getContext('2d').putImageData(new ImageData(photo.rgba, photo.w, photo.h), 0, 0);
    return canvas;
}

// Grey bytes (any size) to the field's raster, evened out if asked.
export function field_raster(grey, w, h, { even = false } = {}) {
    const small = shrink(grey, w, h, kFieldPx);
    return raster(even ? equalise(small.grey) : small.grey, small.w, small.h);
}

// An assistant picture ({ data, mime_type }) to the field's raster, by brightness.
export async function picture_raster(picture, max_px = kFieldPx) {
    const blob = await (await fetch(`data:${picture.mime_type};base64,${picture.data}`)).blob();
    const img = await decode_image(blob, max_px);
    return raster(grey_of(img.rgba), img.w, img.h);
}
