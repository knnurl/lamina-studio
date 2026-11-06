// Builds index.html from src/. Two ES-module graphs, the app (src/main.js) and the geometry worker
// (src/worker/geometry_worker.js), are bundled into classic scripts and inlined with the CSS, so
// index.html runs from file:// with no server, no network and no npm install.
//
// Usage: node tools/build.js           write index.html
//        node tools/build.js --check   exit 1 if index.html is stale (CI)
//
// The bundler scope-hoists each module into its own function and returns its exports as an
// object. Supported syntax (anything else is a build error, never a silent miscompile):
//   import { a, b as c } from './x.js'    import * as ns from './x.js'    import d from './x.js'
//   import './x.js'
//   export function | async function | function* | class | const | let | var <name> ...
//   export default <declaration or expression>
//   export { a, b as c } [from './x.js']   export * [as ns] from './x.js'
//   a trailing minified `;export{...};` or `}export{...}` list (as in clipper2.min.mjs)
// Not supported: circular imports, import.meta, bare specifiers, top-level await,
// multi-declarator `export const a = 1, b = 2`, and re-assigned exported `let` (no live bindings).
// Every imported name is checked against the exporting module at build time.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const kRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kSrc = path.join(kRoot, 'src');
const kOut = path.join(kRoot, 'index.html');

// "import" must be followed by whitespace, a brace, a star or a quote, never by an identifier
// character: a line such as "    import_svg," in an object literal is not an import.
const kImportRe =
    /^[ \t]*import(?=[\s{*'"])\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*|\*\s*as\s+([\w$]+)\s*)?(?:from\s*)?(['"])([^'"\n]+)\4[ \t]*;?/gm;
const kExportListRe = /^[ \t]*export\s*\{([^}]*)\}\s*(?:from\s*(['"])([^'"\n]+)\2)?[ \t]*;?/gm;
const kExportStarRe = /^[ \t]*export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*(['"])([^'"\n]+)\2[ \t]*;?/gm;
const kExportDeclRe =
    /^([ \t]*)export\s+(default\s+)?((?:async\s+)?function\s*\*?\s*([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+))/gm;
const kExportDefaultRe = /^([ \t]*)export\s+default\s+/gm;
const kTrailingExportRe = /(^|[;}\s])export\s*\{([^}]*)\}\s*;?\s*$/;
const kLeftoverRe = /^[ \t]*(?:import(?:\s*[{*'"]|\s+[\w$]+\s*(?:,|from\b))|export\b)/m;

const rel = abs => path.relative(kRoot, abs).split(path.sep).join('/');

function fail(file, message) {
    throw new Error(`build: ${file ? rel(file) + ': ' : ''}${message}`);
}

export function read_text(file) {
    return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function module_var(abs) {
    return '__m_' + rel(abs).replace(/^src\//, '').replace(/[^\w$]/g, '_');
}

function resolve_spec(file, spec) {
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
        fail(file, `bare specifier "${spec}" (only relative paths are supported)`);
    }
    const abs = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(abs)) fail(file, `cannot resolve "${spec}"`);
    return abs;
}

function parse_list(list, file) {
    return list
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
            const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
            if (!m) fail(file, `cannot parse specifier "${s}"`);
            return { from: m[1], to: m[2] || m[1] };
        });
}

const binding = ({ from, to }) => (from === to ? from : `${from}: ${to}`);

// Turns one ES module's source into a hoistable function body plus its dependency and export info.
export function transform_module(file, source) {
    if (/\bimport\.meta\b/.test(source)) fail(file, 'import.meta is not supported');
    let body = source.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
    const deps = [];
    const imports = []; // { dep, names: [{from, to}] | null (namespace) }
    const header = [];
    const exports = []; // { key, expr }
    const stars = []; // dep paths spread into the export object
    const add_dep = spec => {
        const abs = resolve_spec(file, spec);
        if (!deps.includes(abs)) deps.push(abs);
        return abs;
    };

    body = body.replace(kImportRe, (_m, def, named, ns, _q, spec) => {
        const dep = add_dep(spec);
        const names = [];
        if (def) names.push({ from: 'default', to: def });
        if (named !== undefined) names.push(...parse_list(named, file));
        if (ns) {
            header.push(`const ${ns} = ${module_var(dep)};`);
            imports.push({ dep, names: null });
        }
        if (names.length) {
            header.push(`const { ${names.map(binding).join(', ')} } = ${module_var(dep)};`);
            imports.push({ dep, names });
        }
        return '';
    });

    body = body.replace(kExportStarRe, (_m, ns, _q, spec) => {
        const dep = add_dep(spec);
        if (ns) exports.push({ key: ns, expr: module_var(dep) });
        else stars.push(dep);
        return '';
    });

    body = body.replace(kExportListRe, (_m, list, _q, spec) => {
        const items = parse_list(list, file);
        if (spec) {
            const dep = add_dep(spec);
            imports.push({ dep, names: items.map(i => ({ from: i.from, to: i.from })) });
            for (const i of items) exports.push({ key: i.to, expr: `${module_var(dep)}.${i.from}` });
        } else {
            for (const i of items) exports.push({ key: i.to, expr: i.from });
        }
        return '';
    });

    body = body.replace(kExportDeclRe, (_m, indent, def, decl, fn_name, class_name, var_name) => {
        const name = fn_name || class_name || var_name;
        exports.push({ key: def ? 'default' : name, expr: name });
        return indent + decl;
    });

    body = body.replace(kExportDefaultRe, (_m, indent) => {
        exports.push({ key: 'default', expr: '__default' });
        return `${indent}const __default = `;
    });

    const trailing = kTrailingExportRe.exec(body);
    if (trailing) {
        for (const i of parse_list(trailing[2], file)) exports.push({ key: i.to, expr: i.from });
        body = body.slice(0, trailing.index + trailing[1].length) + ';';
    }

    const left = kLeftoverRe.exec(body);
    if (left) {
        const line = body.slice(0, left.index).split('\n').length;
        fail(file, `unsupported import/export syntax near transformed line ${line}: "${left[0].trim()}"`);
    }
    const keys = exports.map(e => e.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) fail(file, `duplicate export "${dup}"`);

    return { file, deps, imports, header, exports, stars, body };
}

function exported_names(mod, mods) {
    const names = new Set(mod.exports.map(e => e.key));
    for (const dep of mod.stars) {
        for (const n of exported_names(mods.get(dep), mods)) if (n !== 'default') names.add(n);
    }
    return names;
}

function wrap(mod) {
    const entries = [
        ...mod.stars.map(dep => `...${module_var(dep)}`),
        ...mod.exports.map(e => (e.key === e.expr ? e.key : `${e.key}: ${e.expr}`)),
    ];
    return [
        `// ${rel(mod.file)}`,
        `const ${module_var(mod.file)} = (function () {`,
        ...mod.header,
        mod.body.trim(),
        `return { ${entries.join(', ')} };`,
        '})();',
    ].join('\n');
}

// Bundles the module graph rooted at entry_abs into one classic script.
export function bundle(entry_abs) {
    const mods = new Map();
    const state = new Map();
    const order = [];
    const visit = (abs, stack) => {
        if (state.get(abs) === 'done') return;
        if (state.get(abs) === 'visiting') {
            fail(abs, `circular import: ${[...stack, abs].map(rel).join(' -> ')}`);
        }
        state.set(abs, 'visiting');
        const mod = transform_module(abs, read_text(abs));
        mods.set(abs, mod);
        for (const dep of mod.deps) visit(dep, [...stack, abs]);
        state.set(abs, 'done');
        order.push(abs);
    };
    visit(entry_abs, []);

    const vars = new Map();
    for (const abs of order) {
        const v = module_var(abs);
        if (vars.has(v)) fail(abs, `module name collides with ${rel(vars.get(v))}`);
        vars.set(v, abs);
    }
    for (const mod of mods.values()) {
        for (const imp of mod.imports) {
            if (!imp.names) continue;
            const have = exported_names(mods.get(imp.dep), mods);
            for (const n of imp.names) {
                if (!have.has(n.from)) fail(mod.file, `"${n.from}" is not exported by ${rel(imp.dep)}`);
            }
        }
    }

    const code = [
        `// Lamina Studio bundle: ${rel(entry_abs)} and ${order.length - 1} modules.`,
        '// Built by tools/build.js from src/. Do not edit.',
        '(function () {',
        '"use strict";',
        ...order.map(abs => wrap(mods.get(abs))),
        '})();',
        '',
    ].join('\n');
    try {
        new vm.Script(code, { filename: rel(entry_abs) + ' (bundle)' });
    } catch (err) {
        fail(entry_abs, `bundle does not parse: ${err.message}`);
    }
    return { code, modules: order.map(rel) };
}

// Makes code safe to inline inside a <script> element.
function script_safe(code, what) {
    if (code.includes('<!--')) fail(null, `${what} contains "<!--", which breaks inline scripts`);
    return code.replace(/<\/(script)/gi, '<\\/$1');
}

function fill(html, token, text) {
    const parts = html.split(token);
    if (parts.length !== 2) fail(null, `template must contain ${token} exactly once`);
    return parts[0] + text + parts[1];
}

export function build_html() {
    const app = bundle(path.join(kSrc, 'main.js'));
    const worker = bundle(path.join(kSrc, 'worker', 'geometry_worker.js'));
    let html = read_text(path.join(kSrc, 'template.html'));
    html = fill(html, '/*CSS*/', read_text(path.join(kSrc, 'ui', 'theme.css')).trim());
    html = fill(html, '/*WORKER*/', script_safe(worker.code, 'worker bundle'));
    html = fill(html, '/*APP*/', script_safe(app.code, 'app bundle'));
    return { html, app, worker };
}

function main() {
    const { html, app, worker } = build_html();
    const kb = s => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(kOut) ? fs.readFileSync(kOut, 'utf8') : '';
        if (current !== html) {
            console.error('index.html is stale. Run node tools/build.js and commit it.');
            process.exit(1);
        }
        console.log(`index.html is current (${kb(html)})`);
        return;
    }
    fs.writeFileSync(kOut, html);
    console.log(
        `index.html: ${kb(html)} (app ${app.modules.length} modules ${kb(app.code)}, ` +
            `worker ${worker.modules.length} modules ${kb(worker.code)})`,
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
