// Browser slider latency (docs/PERF.md). Not a module: evaluated in the page by
// node tools/shot.js out.png --eval-file=tools/slider_latency.page.js
// Opens the Orb from the start screen (a fresh browser has no saved design), sets 12 layers in the
// Piece step, then nudges the first opening slider in the Pattern step 7 times and times each from
// the input event to the next status update. Returns the samples and the median in ms.
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const q = s => document.querySelector(s);
  const status = q('#status-text');
  await wait(1500);
  [...document.querySelectorAll('.preset')].find(b => b.textContent.includes('Orb') && !b.textContent.includes('Lattice')).click();
  await wait(2500);
  q('.tour-offer .btn.ghost')?.click();
  // Twelve layers, like the bench case.
  q('[data-step-go="piece"]').click();
  await wait(300);
  const count = [...document.querySelectorAll('#panel-body .ctl')].find(c => c.textContent.includes('Layers')).querySelector('.ctl-num');
  count.value = 12; count.dispatchEvent(new Event('change'));
  await wait(2500);
  q('[data-step-go="pattern"]').click();
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
  return { samples_ms: samples.map(Math.round), median_ms: Math.round(samples[3]), layers: document.querySelectorAll('.strip-item').length, ua: navigator.userAgent.match(/Edg\/[\d.]+/)?.[0] };
})()
