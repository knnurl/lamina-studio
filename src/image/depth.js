// Depth from a photo, in the page (SPEC M5): Depth Anything V2 through Transformers.js, loaded on
// first use from jsDelivr (pinned) and cached by the browser. WebGPU when the browser has a GPU
// adapter, otherwise WebAssembly. The photo never leaves the computer. The result is grey bytes at
// the photo's size, bright where near (the model's relative inverse depth, stretched to 0..255).
// Testing seam: globalThis.__lamina_depth_stand_in = async (canvas, model) => ({ grey, w, h }).

const kTransformersUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm';

// Download sizes in MB by backend: fp16 on WebGPU, 8-bit on WebAssembly (measured from the
// repositories' onnx folders, 2026-11-07).
export const kDepthModels = [
    { id: 'small', label: 'Small', repo: 'onnx-community/depth-anything-v2-small', licence: 'Apache-2.0', commercial: true, mb: { webgpu: 50, wasm: 27 } },
    { id: 'base', label: 'Base', repo: 'onnx-community/depth-anything-v2-base', licence: 'CC-BY-NC-4.0', commercial: false, mb: { webgpu: 195, wasm: 102 } },
    { id: 'large', label: 'Large', repo: 'onnx-community/depth-anything-v2-large', licence: 'CC-BY-NC-4.0', commercial: false, mb: { webgpu: 669, wasm: 347 } },
];

let backend_ = null;
let lib_ = null;
const pipes_ = new Map();

// 'webgpu' or 'wasm', decided once.
export async function depth_backend() {
    if (!backend_) {
        let gpu = false;
        try {
            gpu = !!(globalThis.navigator?.gpu && (await navigator.gpu.requestAdapter()));
        } catch {
            gpu = false;
        }
        backend_ = gpu ? 'webgpu' : 'wasm';
    }
    return backend_;
}

// on_progress({ phase: 'library' | 'download' | 'thinking', loaded_mb, total_mb })
export async function estimate_depth(canvas, model_id, on_progress = () => {}) {
    const model = kDepthModels.find(m => m.id === model_id) ?? kDepthModels[0];
    const stand_in = globalThis.__lamina_depth_stand_in;
    if (stand_in) return stand_in(canvas, model);
    const device = await depth_backend();
    if (!lib_) {
        on_progress({ phase: 'library' });
        lib_ = await import(kTransformersUrl);
    }
    const key = `${model.id}|${device}`;
    if (!pipes_.has(key)) {
        const made = lib_
            .pipeline('depth-estimation', model.repo, {
                device,
                dtype: device === 'webgpu' ? 'fp16' : 'q8',
                progress_callback: p => {
                    if (p.status === 'progress_total') on_progress({ phase: 'download', loaded_mb: p.loaded / 1e6, total_mb: p.total / 1e6 });
                },
            })
            .catch(err => {
                pipes_.delete(key);
                throw err;
            });
        pipes_.set(key, made);
    }
    const pipe = await pipes_.get(key);
    on_progress({ phase: 'thinking' });
    const { depth } = await pipe(canvas);
    // depth is a one-channel RawImage at the input's size.
    const grey = depth.channels === 1 ? Uint8Array.from(depth.data) : Uint8Array.from({ length: depth.width * depth.height }, (_, i) => depth.data[i * depth.channels]);
    return { grey, w: depth.width, h: depth.height };
}
