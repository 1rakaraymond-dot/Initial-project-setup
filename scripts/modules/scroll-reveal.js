import { CONFIG } from '../config.js';

export function initScrollReveal(root = document) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.style.setProperty('--reveal-duration', `${CONFIG.scrollReveal.duration}ms`);
  document.documentElement.style.setProperty('--reveal-distance', `${CONFIG.scrollReveal.distance}px`);
  const revealTargets = root.querySelectorAll('.archive-head, .folder-stage, .file-view, .drive-footer');
  revealTargets.forEach((element, index) => {
    if (!element.hasAttribute('data-reveal')) element.dataset.reveal = index === 0 ? 'intro' : 'section';
  });

  if (!CONFIG.scrollReveal.enabled || reducedMotion || !('IntersectionObserver' in window)) {
    root.querySelectorAll('[data-reveal]').forEach(element => element.dataset.revealVisible = 'true');
    return () => {};
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.dataset.revealVisible = 'true';
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: CONFIG.scrollReveal.rootMargin, threshold: CONFIG.scrollReveal.threshold });

  const observeTargets = node => {
    if (!(node instanceof Element)) return;
    if (node.matches('[data-reveal]') && node.dataset.revealVisible !== 'true') observer.observe(node);
    node.querySelectorAll?.('[data-reveal]').forEach(element => {
      if (element.dataset.revealVisible !== 'true') observer.observe(element);
    });
  };
  root.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));

  const mutationObserver = new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(observeTargets));
  });
  const dynamicRoots = [document.getElementById('folder-stage'), document.getElementById('file-list')].filter(Boolean);
  dynamicRoots.forEach(element => mutationObserver.observe(element, { childList: true, subtree: true }));

  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
  };
}
