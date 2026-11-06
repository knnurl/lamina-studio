// The scope-hoisting bundler: every supported form works at runtime, every unsupported form is a
// build error with a useful message, never a silent miscompile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bundle } from '../tools/build.js';

function project(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-bundler-'));
    for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
    }
    return dir;
}

// Values from a vm context have that realm's prototypes, which strict deep equality rejects.
const plain = value => JSON.parse(JSON.stringify(value));

function run(code) {
    const ctx = vm.createContext({ out: {} });
    vm.runInContext(code, ctx);
    return ctx.out;
}

test('supported import and export forms work at runtime', () => {
    const dir = project({
        'entry.js': [
            "import { a, b as bee } from './lib/named.js';",
            "import * as ns from './lib/named.js';",
            "import def, { c } from './lib/default.js';",
            "import './lib/side.js';",
            "import { star_a, star_b, re_x, Inner } from './lib/reexport.js';",
            "import { mini, mini_two } from './lib/mini.js';",
            'out.values = [a, bee, ns.a, def(), c, star_a, star_b, re_x, Inner.k, mini, mini_two];',
            'out.side = globalThis.side_ran;',
        ].join('\n'),
        'lib/named.js': [
            'export const a = 1;',
            'export function b() { return 2; }',
            'const hidden = 99;',
        ].join('\n'),
        'lib/default.js': ['export default function () { return 3; }', 'export class c {}'].join('\n'),
        'lib/side.js': 'globalThis.side_ran = true;',
        'lib/reexport.js': [
            "export * from './star.js';",
            "export { x as re_x } from './plain.js';",
            "export * as Inner from './plain.js';",
        ].join('\n'),
        'lib/star.js': [
            'const star_a = 5;',
            'let star_b = 6;',
            'export {',
            '    star_a,',
            '    star_b,',
            '};',
        ].join('\n'),
        'lib/plain.js': 'export const x = 7;\nexport const k = 8;',
        'lib/mini.js': 'var q=11,w=12;function f(){return`;export{` }export{q as mini,w as mini_two};',
    });
    const { code, modules } = bundle(path.join(dir, 'entry.js'));
    assert.equal(modules.at(-1).endsWith('entry.js'), true);
    const out = run(code);
    assert.equal(out.values[0], 1);
    assert.equal(out.values[1](), 2);
    assert.equal(out.values[2], 1);
    assert.equal(out.values[3], 3);
    assert.equal(typeof out.values[4], 'function');
    assert.deepEqual(plain(out.values.slice(5)), [5, 6, 7, 8, 11, 12]);
    assert.equal(out.side, true);
});

test('identifiers that start with import or export are not statements', () => {
    const dir = project({
        'entry.js': [
            "import { importer } from './a.js';",
            'const handlers = {',
            '    import_svg: 1,',
            '    importer,',
            '    export_zip: 2,',
            '};',
            'out.keys = Object.keys(handlers).join(",");',
        ].join('\n'),
        'a.js': 'export const importer = 3;',
    });
    assert.equal(run(bundle(path.join(dir, 'entry.js')).code).keys, 'import_svg,importer,export_zip');
});

test('module scopes stay separate', () => {
    const dir = project({
        'entry.js': "import { one } from './a.js';\nimport { two } from './b.js';\nout.v = [one(), two()];",
        'a.js': 'const name = "a";\nexport function one() { return name; }',
        'b.js': 'const name = "b";\nexport function two() { return name; }',
    });
    assert.deepEqual(plain(run(bundle(path.join(dir, 'entry.js')).code).v), ['a', 'b']);
});

const rejects = (files, pattern) => {
    const dir = project(files);
    assert.throws(() => bundle(path.join(dir, 'entry.js')), pattern);
};

test('circular imports are rejected', () => {
    rejects(
        { 'entry.js': "import { a } from './a.js';", 'a.js': "import { e } from './entry.js';\nexport const a = 1;" },
        /circular import/,
    );
});

test('bare specifiers are rejected', () => {
    rejects({ 'entry.js': "import { Vector3 } from 'three';" }, /bare specifier "three"/);
});

test('importing a name the module does not export is rejected', () => {
    rejects(
        { 'entry.js': "import { missing } from './a.js';", 'a.js': 'export const present = 1;' },
        /"missing" is not exported by/,
    );
});

test('import.meta is rejected', () => {
    rejects({ 'entry.js': 'out.u = import.meta.url;' }, /import\.meta is not supported/);
});

test('a missing file is rejected', () => {
    rejects({ 'entry.js': "import { a } from './nope.js';" }, /cannot resolve/);
});
