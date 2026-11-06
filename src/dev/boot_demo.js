// M0 boot self-test: a small round stack with rotating diamond windows, built with Clipper2 in
// the worker, so the shell proves the vendored geometry core and the 3D preview end to end.
// Not the layer pipeline: M1 replaces it. Front layer (index 0) is the most open, the back solid.
import { circle_path, regular_polygon_path, subtract, union_all, area_mm2 } from '../geom/clip.js';
import { mm_to_um } from '../core/units.js';

export function boot_demo({ layers = 6, radius_mm = 150 } = {}) {
    const out = [];
    for (let k = 0; k < layers; k++) {
        const outer = [circle_path(0, 0, mm_to_um(radius_mm))];
        const depth = k / (layers - 1);
        const windows = [];
        if (k < layers - 1) {
            windows.push(circle_path(0, 0, mm_to_um(radius_mm * (0.3 - 0.22 * depth))));
            const rings = [0.5, 0.72];
            rings.forEach((ring, j) => {
                const n = (k + j) % 2 ? 16 : 8;
                const r_mm = radius_mm * ring;
                const size_mm = radius_mm * (0.12 - 0.07 * depth) * (j ? 0.8 : 1);
                for (let i = 0; i < n; i++) {
                    const a = (2 * Math.PI * (i + 0.5 * (k % 2))) / n;
                    const cx = mm_to_um(r_mm * Math.cos(a));
                    const cy = mm_to_um(r_mm * Math.sin(a));
                    windows.push(regular_polygon_path(cx, cy, mm_to_um(size_mm), 4, a));
                }
            });
        }
        const paths = windows.length ? subtract(outer, union_all(windows)) : outer;
        out.push({ index: k, paths, area_mm2: area_mm2(paths) });
    }
    return { layers: out };
}
