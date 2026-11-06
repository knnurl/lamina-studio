// Units shared by the worker and the UI thread. Geometry is integer micrometres (SPEC 6.1);
// the design JSON and the UI use millimetres.

export const kUmPerMm = 1000;

export function mm_to_um(value_mm) {
    return Math.round(value_mm * kUmPerMm);
}
