// Browser slider latency on the dense Lattice orb (docs/PERF.md, M2). Not a module: evaluated in
// the page by
//   node tools/shot.js out.png --timeout=120000 --eval-file=tools/lattice_latency.page.js
// Opens the Lattice orb from the start screen, then nudges the first opening slider 7 times, 3.5 s apart so the
// slow checks finish between samples. Each sample runs from the input event to the next status
// update; the main thread's long tasks during it are listed too. Returns the samples and median.
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const q = s => document.querySelector(s);
  const status = q('#status-text');
  await wait(1500);
  [...document.querySelectorAll('.preset')].find(b => b.textContent.includes('Lattice orb')).click();
  await wait(4000);
  q('.tour-offer .btn.ghost')?.click();
  await wait(300);
  const long = [];
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) long.push(Math.round(e.duration));
  }).observe({ type: 'longtask' });
  const samples = [];
  const long_tasks = [];
  for (let i = 0; i < 7; i++) {
    const slider = document.querySelector('.motif input[type=range]');
    const next = new Promise(resolve => {
      const mo = new MutationObserver(() => { mo.disconnect(); resolve(performance.now()); });
      mo.observe(status, { childList: true, characterData: true, subtree: true });
    });
    long.length = 0;
    const t0 = performance.now();
    slider.value = Number(slider.value) + 1;
    slider.dispatchEvent(new Event('input'));
    samples.push((await next) - t0);
    await wait(50);
    long_tasks.push([...long]);
    await wait(3500);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples_ms: sorted.map(Math.round), median_ms: Math.round(sorted[3]), long_tasks_ms: long_tasks, ua: navigator.userAgent.match(/Edg\/[\d.]+/)?.[0] };
})()
