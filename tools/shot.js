// Headless check of the built index.html in Edge or Chrome over the DevTools protocol: loads the
// page from file://, waits until the status light leaves "busy", reports the status text and any
// console errors or exceptions, and saves a screenshot. Exit code 1 on a "bad" status or errors.
// With --click it then clicks an element, waits for the status to change, and reports any file the
// page downloaded (saved to a downloads/ folder next to the screenshot).
// No dependencies: Node 22+ has fetch and WebSocket built in.
//
// Usage: node tools/shot.js [out.png] [--light] [--size=1400x860] [--timeout=20000]
//                           [--click=<css selector>]
// Set LAMINA_BROWSER to a browser executable to override the search.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const kRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kCandidates = [
    process.env.LAMINA_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const out_png = path.resolve(args.find(a => !a.startsWith('--')) || 'shot.png');
const [width, height] = flag('size', '1400x860').split('x').map(Number);
const timeout_ms = Number(flag('timeout', '20000'));
const light = args.includes('--light');
const click = flag('click', null);
const download_dir = path.join(path.dirname(out_png), 'downloads');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function launch() {
    const exe = kCandidates.find(p => fs.existsSync(p));
    if (!exe) throw new Error('no Edge or Chrome found; set LAMINA_BROWSER');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-shot-'));
    const proc = spawn(exe, [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-first-run',
        'about:blank',
    ]);
    const ws_url = new Promise((resolve, reject) => {
        let text = '';
        proc.stderr.on('data', chunk => {
            text += chunk;
            const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
            if (m) resolve(m[1]);
        });
        proc.on('exit', code => reject(new Error(`browser exited (${code}) before DevTools started`)));
    });
    return { proc, profile, ws_url };
}

function connect(url) {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = [];
    let next_id = 1;
    ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        } else if (msg.method) {
            for (const fn of listeners) fn(msg);
        }
    };
    const opened = new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
    });
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = next_id++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    return { opened, send, on: fn => listeners.push(fn), close: () => ws.close() };
}

async function main() {
    const page_url = pathToFileURL(path.join(kRoot, 'index.html')).href;
    const { proc, profile, ws_url } = launch();
    const problems = [];
    try {
        const port = new URL(await ws_url).port;
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = targets.find(t => t.type === 'page');
        const cdp = connect(page.webSocketDebuggerUrl);
        await cdp.opened;
        cdp.on(msg => {
            if (msg.method === 'Runtime.exceptionThrown') {
                const d = msg.params.exceptionDetails;
                problems.push(`exception: ${d.exception?.description || d.text}`);
            } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                problems.push(`console.error: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
            }
        });
        await cdp.send('Runtime.enable');
        await cdp.send('Page.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
        });
        if (light) {
            await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
                source: "try { localStorage.setItem('lamina-theme', 'light'); } catch {}",
            });
        }
        if (click) {
            fs.rmSync(download_dir, { recursive: true, force: true });
            fs.mkdirSync(download_dir, { recursive: true });
            await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: download_dir });
        }
        await cdp.send('Page.navigate', { url: page_url });

        const read = async expr =>
            (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
        const read_level = () => read("document.getElementById('status-light')?.dataset.level ?? null");
        const read_text = () => read("document.getElementById('status-text')?.textContent ?? ''");
        const t0 = Date.now();
        let level = null;
        while (Date.now() - t0 < timeout_ms) {
            level = await read_level();
            if (level && level !== 'busy') break;
            await sleep(100);
        }

        if (click) {
            const before = await read_text();
            const clicked = await read(
                `(() => { const el = document.querySelector(${JSON.stringify(click)});` +
                    ' if (!el) return false; el.click(); return true; })()',
            );
            if (!clicked) problems.push(`no element matches ${click}`);
            const t1 = Date.now();
            while (clicked && Date.now() - t1 < timeout_ms) {
                level = await read_level();
                if (level !== 'busy' && (await read_text()) !== before) break;
                await sleep(100);
            }
            const done = () => fs.readdirSync(download_dir).filter(f => !f.endsWith('.crdownload'));
            const t2 = Date.now();
            while (Date.now() - t2 < 5000 && !done().length) await sleep(100);
            for (const f of done()) {
                console.log(`download: ${path.join(download_dir, f)} (${fs.statSync(path.join(download_dir, f)).size} bytes)`);
            }
        }
        const text = await read_text();
        await sleep(200); // let the last frame present
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(out_png, Buffer.from(shot.data, 'base64'));
        cdp.close();

        console.log(`status: ${level} | ${text}`);
        console.log(`screenshot: ${out_png}`);
        for (const p of problems) console.log(p);
        if (level !== 'ok' && level !== 'warn') problems.push(`status level is ${level}`);
        return problems.length ? 1 : 0;
    } finally {
        proc.kill();
        await sleep(300);
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

main().then(
    code => process.exit(code),
    err => {
        console.error(err.message);
        process.exit(1);
    },
);
