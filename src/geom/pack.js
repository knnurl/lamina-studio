// Packs paths into typed arrays for postMessage: transferring two buffers is far cheaper than
// structured-cloning thousands of {x, y} objects. Coordinates are micrometres in Int32 (+-2.1 km).

export function pack_paths(paths) {
    let n = 0;
    for (const p of paths) n += p.length;
    const xy = new Int32Array(n * 2);
    const starts = new Uint32Array(paths.length + 1);
    let at = 0;
    paths.forEach((path, i) => {
        starts[i] = at;
        for (const p of path) {
            xy[2 * at] = p.x;
            xy[2 * at + 1] = p.y;
            at++;
        }
    });
    starts[paths.length] = at;
    return { xy, starts };
}

export function unpack_paths({ xy, starts }) {
    const paths = [];
    for (let i = 0; i + 1 < starts.length; i++) {
        const path = [];
        for (let k = starts[i]; k < starts[i + 1]; k++) path.push({ x: xy[2 * k], y: xy[2 * k + 1] });
        paths.push(path);
    }
    return paths;
}
