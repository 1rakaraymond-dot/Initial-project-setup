import { CONFIG } from '../config.js';

const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], .folder-tile__open';

export function initCustomCursor() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!CONFIG.cursor.enabled || reducedMotion || !finePointer) return () => {};

  const cursor = document.createElement('span');
  cursor.className = 'custom-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<span class="custom-cursor__ring"></span><span class="custom-cursor__dot"></span>';
  document.body.append(cursor);
  document.body.classList.add('has-custom-cursor');

  let frame = 0;
  let x = -100;
  let y = -100;
  let nextX = x;
  let nextY = y;

  const paint = () => {
    frame = 0;
    x += (nextX - x) * CONFIG.cursor.smoothing;
    y += (nextY - y) * CONFIG.cursor.smoothing;
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (Math.abs(nextX - x) > 0.2 || Math.abs(nextY - y) > 0.2) frame = requestAnimationFrame(paint);
  };

  const onMove = event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    nextX = event.clientX;
    nextY = event.clientY;
    cursor.classList.add('is-visible');
    if (!frame) frame = requestAnimationFrame(paint);
    const target = event.target instanceof Element ? event.target : null;
    cursor.classList.toggle('is-active', Boolean(target?.closest(INTERACTIVE)));
    cursor.classList.toggle('is-folder', Boolean(target?.closest('.folder-tile__open')));
  };
  const onLeave = () => cursor.classList.remove('is-visible', 'is-active', 'is-folder', 'is-pressed');
  const onDown = () => cursor.classList.add('is-pressed');
  const onUp = () => cursor.classList.remove('is-pressed');

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointerup', onUp);
  window.addEventListener('blur', onLeave);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerup', onUp);
    window.removeEventListener('blur', onLeave);
    cursor.remove();
    document.body.classList.remove('has-custom-cursor');
  };
}
