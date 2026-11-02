/* Motion effects for the customer landing page only. No dependencies, no data access. */
(() => {
  "use strict";
  const host = document.querySelector('.hns-cinematic');
  const stage = document.querySelector('#cinematic-stage');
  if (!host || !stage) return;

  const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const stageWrap = stage.closest('.stage-wrap');
  if (motionOK && finePointer && stageWrap) {
    let queued = false;
    let targetX = 0;
    let targetY = 0;
    stageWrap.addEventListener('pointermove', (e) => {
      const r = stageWrap.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      targetY = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        stageWrap.style.setProperty('--tilt-x', `${(-targetY * 2.2).toFixed(2)}deg`);
        stageWrap.style.setProperty('--tilt-y', `${(targetX * 4.5).toFixed(2)}deg`);
        stageWrap.style.setProperty('--layer-x', `${(-targetX * 12).toFixed(1)}px`);
        stageWrap.style.setProperty('--layer-y', `${(-targetY * 9).toFixed(1)}px`);
        queued = false;
      });
    }, { passive: true });
    stageWrap.addEventListener('pointerleave', () => {
      stageWrap.style.setProperty('--tilt-x', '0deg');
      stageWrap.style.setProperty('--tilt-y', '0deg');
      stageWrap.style.setProperty('--layer-x', '0px');
      stageWrap.style.setProperty('--layer-y', '0px');
    });
  }

  const revealElements = [...document.querySelectorAll('[data-reveal]')];
  if (!motionOK || !('IntersectionObserver' in window)) {
    revealElements.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.08 });
  revealElements.forEach(el => observer.observe(el));
})();
