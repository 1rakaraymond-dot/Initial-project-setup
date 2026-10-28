import { CONFIG } from '../config.js';

export function initParallax(stage = document.getElementById('folder-stage')) {
  if (!stage || !CONFIG.parallax.enabled) return () => {};
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (reducedMotion.matches || !finePointer.matches) return () => {};

  let frame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let scrollY = window.scrollY;

  const apply = () => {
    frame = 0;
    const tiles = stage.querySelectorAll('.folder-tile');
    tiles.forEach((tile, index) => {
      const strength = CONFIG.parallax.baseStrength + ((index % 3) * CONFIG.parallax.strengthStep);
      tile.style.setProperty('--pointer-rotate-x', `${-pointerY * CONFIG.parallax.tiltDegrees * 0.85 * strength}deg`);
      tile.style.setProperty('--pointer-rotate-y', `${pointerX * CONFIG.parallax.tiltDegrees * strength}deg`);
      tile.style.setProperty('--pointer-shift-x', `${pointerX * CONFIG.parallax.shiftPixels * strength}px`);
      tile.style.setProperty('--pointer-shift-y', `${pointerY * CONFIG.parallax.shiftPixels * 0.75 * strength}px`);
    });
    const scrollProgress = Math.min(1, Math.max(0, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)));
    stage.style.setProperty('--ambient-shift', `${(scrollProgress - 0.5) * CONFIG.parallax.scrollShiftPixels}px`);
    stage.style.setProperty('--ambient-opacity', `${0.08 + scrollProgress * 0.1}`);
    stage.classList.toggle('is-parallax-active', Math.abs(pointerX) + Math.abs(pointerY) > 0.01);
  };

  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  const onMove = event => {
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointerX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
    pointerY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
    schedule();
  };
  const onLeave = () => { pointerX = 0; pointerY = 0; schedule(); };
  const onScroll = () => { scrollY = window.scrollY; schedule(); };
  const onMotionChange = () => { if (reducedMotion.matches) { onLeave(); stage.style.setProperty('--ambient-shift', '0px'); stage.style.setProperty('--ambient-opacity', '.08'); } };

  stage.addEventListener('pointermove', onMove, { passive: true });
  stage.addEventListener('pointerleave', onLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  reducedMotion.addEventListener?.('change', onMotionChange);
  schedule();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('scroll', onScroll);
    reducedMotion.removeEventListener?.('change', onMotionChange);
    stage.classList.remove('is-parallax-active');
    stage.querySelectorAll('.folder-tile').forEach(tile => {
      ['--pointer-rotate-x', '--pointer-rotate-y', '--pointer-shift-x', '--pointer-shift-y'].forEach(name => tile.style.removeProperty(name));
    });
  };
}
