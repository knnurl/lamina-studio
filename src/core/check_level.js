// Summarises check results for the status light (SPEC 7). Kept free of geometry imports so the
// UI bundle does not pull in Clipper2.

// 'bad' if an un-overridden fatal result exists, 'warn' for warnings or overrides, else 'ok'.
export function check_level(results) {
    if (results.some(r => r.severity === 'fatal' && !r.overridden)) return 'bad';
    if (results.some(r => r.severity === 'warn' || r.overridden)) return 'warn';
    return 'ok';
}
