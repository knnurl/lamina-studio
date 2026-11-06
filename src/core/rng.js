// Seeded randomness (SPEC 13.5). Every random choice in Lamina comes from here, so a design JSON
// and its seed always reproduce the same output.

// FNV-1a over a string, as an unsigned 32-bit seed.
export function hash_str(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// mulberry32: small, fast, good enough for design choices. Returns floats in [0, 1).
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// An independent stream per purpose: rng_for(seed, 'layer', 3) never shifts when another stream
// draws more numbers.
export function rng_for(seed, ...keys) {
    const rand = mulberry32(hash_str(`${seed >>> 0}:${keys.join(':')}`));
    return {
        next: rand,
        range: (lo, hi) => lo + (hi - lo) * rand(),
        int: (lo, hi) => lo + Math.floor((hi - lo + 1) * rand()),
        pick: items => items[Math.floor(items.length * rand())],
        chance: p => rand() < p,
    };
}
