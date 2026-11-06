// Store-only (uncompressed) zip writer (SPEC 9.2). Every timestamp is the DOS epoch (1980-01-01)
// and entries keep their given order, so the same files always give byte-identical zips.
// Assumptions: fewer than 65535 entries and under 4 GB in total (no zip64); names are UTF-8.

const kCrcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = kCrcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

const kDosDate = 0x0021; // 1980-01-01
const kUtf8Flag = 0x0800;

// files: [{ name, data: string | Uint8Array }] -> Uint8Array
export function zip_store(files) {
    const encoder = new TextEncoder();
    const entries = files.map(f => {
        const data = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
        return { name: encoder.encode(f.name), data, crc: crc32(data) };
    });
    let size = 22;
    for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
    const buf = new Uint8Array(size);
    const view = new DataView(buf.buffer);
    let at = 0;
    const u16 = v => {
        view.setUint16(at, v, true);
        at += 2;
    };
    const u32 = v => {
        view.setUint32(at, v, true);
        at += 4;
    };
    const bytes = b => {
        buf.set(b, at);
        at += b.length;
    };
    const header_fields = e => {
        u16(20); // version needed: 2.0
        u16(kUtf8Flag);
        u16(0); // method: stored
        u16(0); // time
        u16(kDosDate);
        u32(e.crc);
        u32(e.data.length);
        u32(e.data.length);
        u16(e.name.length);
        u16(0); // extra length
    };

    for (const e of entries) {
        e.offset = at;
        u32(0x04034b50);
        header_fields(e);
        bytes(e.name);
        bytes(e.data);
    }
    const dir_start = at;
    for (const e of entries) {
        u32(0x02014b50);
        u16(20); // version made by
        header_fields(e);
        u16(0); // comment length
        u16(0); // disk number
        u16(0); // internal attributes
        u32(0); // external attributes
        u32(e.offset);
        bytes(e.name);
    }
    const dir_size = at - dir_start;
    u32(0x06054b50);
    u16(0);
    u16(0);
    u16(entries.length);
    u16(entries.length);
    u32(dir_size);
    u32(dir_start);
    u16(0);
    return buf;
}
