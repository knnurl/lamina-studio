// Calibration (SPEC 9.4): the test card's ladders, and the formulas that turn its measurements
// into physical material limits. The card is cut without kerf compensation, so:
//   kerf             = (H - P) / 2       P: the 20 mm square piece, H: the hole it leaves
//   scale            = (H + P) / 2       must be 20.00 +/- 0.05, or the import scale is wrong
//   min web          = nominal - kerf    a web loses half a kerf each side
//   min bridge       = nominal - kerf
//   min hole         = nominal + kerf    a hole gains half a kerf each side
//   dowel clearance  = nominal + kerf - 3     (hole minus the 3 mm dowel)
//   fit clearance    = nominal + 2 x kerf     (notch grows, key shrinks)
// Lamina's exports are kerf-compensated, so these physical values are what the checks use.
// Kept free of geometry imports: the UI bundle uses it, and the test card imports its ladders.

export const kLadders = {
    kerf_square_mm: 20,
    webs_mm: [0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5],
    bridges_mm: [0.6, 0.8, 1.0, 1.2, 1.5, 2.0],
    holes_mm: [0.5, 0.8, 1.0, 1.5, 2.0, 3.0],
    dowel_mm: 3,
    dowel_holes_mm: [2.9, 2.95, 3.0, 3.05, 3.1, 3.15, 3.2],
    clearances_mm: [0, 0.05, 0.1, 0.15, 0.2, 0.25],
    ramp_count: 5,
};

const kScaleTolMm = 0.05;
const r3 = v => Math.round(v * 1000) / 1000;

// m: { p_mm, h_mm, web_mm, bridge_mm, hole_mm, dowel_hole_mm, notch_mm, score_line }, the ladder
// values read off the card. Returns the physical limits, plus problems that should stop a save.
export function calibrate(m) {
    const problems = [];
    const p = Number(m.p_mm);
    const h = Number(m.h_mm);
    if (!(p > 0 && h > 0)) problems.push('Enter both caliper readings, P and H.');
    else if (h <= p) problems.push('H (the hole) must be larger than P (the piece).');
    const kerf = r3((h - p) / 2);
    const scale = r3((h + p) / 2);
    const scale_ok = Math.abs(scale - kLadders.kerf_square_mm) <= kScaleTolMm;
    if (p > 0 && h > p && !scale_ok) {
        problems.push(`Scale check failed: (H + P) / 2 is ${scale.toFixed(2)} mm, not 20.00. The file was imported at the wrong size; fix the import before trusting anything else.`);
    }
    if (p > 0 && h > p && (kerf <= 0 || kerf > 0.6)) problems.push(`A kerf of ${kerf} mm is implausible for a CO2 laser; measure again.`);
    return {
        ok: problems.length === 0,
        problems,
        kerf_mm: kerf,
        scale_mm: scale,
        min_web_mm: r3(Number(m.web_mm) - kerf),
        min_bridge_mm: r3(Number(m.bridge_mm) - kerf),
        min_hole_mm: r3(Number(m.hole_mm) + kerf),
        dowel_clearance_mm: r3(Number(m.dowel_hole_mm) + kerf - kLadders.dowel_mm),
        fit_clearance_mm: r3(Number(m.notch_mm) + 2 * kerf),
        score_line: Number(m.score_line),
    };
}

// A material preset with measured limits, built on a base preset.
export function measured_material(base, result, measurements) {
    return {
        ...base,
        label: base.label.replace(/ \(measured\)$/, '') + ' (measured)',
        kerf_mm: result.kerf_mm,
        min_web_mm: result.min_web_mm,
        min_bridge_mm: result.min_bridge_mm,
        min_hole_mm: result.min_hole_mm,
        dowel_clearance_mm: result.dowel_clearance_mm,
        fit_clearance_mm: result.fit_clearance_mm,
        score_line: result.score_line,
        measured: true,
        measurements: { ...measurements },
    };
}
