// Browser slider latency (docs/PERF.md). Not a module: evaluated in the page by
// node tools/shot.js out.png --eval-file=tools/slider_latency.page.js
// Sets 12 layers, then nudges the first opening slider 7 times and times each from the input event
// to the next status update. Returns the samples and the median in ms.
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const q = s => document.querySelector(s);
  const status = q('#status-text');
  // Twelve layers, like the bench case.
  const count = [...document.querySelectorAll('.step[data-step=piece] .ctl')].find(c => c.textContent.includes('Layers')).querySelector('.ctl-num');
  count.value = 12; count.dispatchEvent(new Event('change'));
  await wait(2500);
  q('.step[data-step=pattern]').open = true;
  await wait(300);
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const slider = document.querySelector('.motif input[type=range]');
    const next = new Promise(resolve => {
      const mo = new MutationObserver(() => { mo.disconnect(); resolve(performance.now()); });
      mo.observe(status, { childList: true, characterData: true, subtree: true });
    });
    const t0 = performance.now();
    slider.value = Number(slider.value) + 1;
    slider.dispatchEvent(new Event('input'));
    samples.push((await next) - t0);
    await wait(900);
  }
  samples.sort((a, b) => a - b);
  return { samples_ms: samples.map(Math.round), median_ms: Math.round(samples[3]), layers: document.querySelectorAll('.layer-chip').length, ua: navigator.userAgent.match(/Edg\/[\d.]+/)?.[0] };
})()
