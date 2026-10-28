import { CONFIG } from '../config.js';

const reducedMotionQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointerQuery = () => window.matchMedia('(hover: hover) and (pointer: fine)');

/** Plays the physical open gesture before the explorer navigates into a folder. */
export function animateFolderOpen(tile) {
  if (!tile || reducedMotionQuery().matches) return Promise.resolve();

  tile.classList.remove('is-open', 'is-opening');
  void tile.offsetWidth;
  tile.classList.add('is-opening');
  requestAnimationFrame(() => {
    if (tile.isConnected) tile.classList.add('is-open');
  });

  const sheetStagger = Math.max(0, Number(CONFIG.folder3d.staggerMs) || 0);
  const duration = Math.max(300, Number(CONFIG.folder3d.openDuration) || 520);
  const animationTime = Math.max(440, duration + (sheetStagger * 2));
  return new Promise(resolve => window.setTimeout(resolve, animationTime));
}

/**
 * Enables desktop-only visual shelf rearranging. It changes the in-page order
 * for this session only; it never writes a sort order or metadata to Drive.
 */
export function initFolderShelfDrag({ stage, onOrderChange } = {}) {
  if (!stage || !finePointerQuery().matches) return () => {};

  let candidate = null;
  let suppressedClickButton = null;
  let clearSuppressedTimer = 0;
  const dragThreshold = Math.max(4, Math.min(14, Number(CONFIG.folder3d.dragThreshold) || 7));

  const onPointerDown = event => {
    if (candidate || event.button !== 0 || !finePointerQuery().matches) return;
    const button = event.target.closest?.('.folder-tile__open[data-open-folder]');
    const tile = button?.closest('.folder-tile[data-folder-tile]');
    if (!button || !tile) return;
    if (event.target.closest('a, input, select, textarea')) return;

    candidate = {
      pointerId: event.pointerId,
      button,
      tile,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false
    };
  };

  const onPointerMove = event => {
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    candidate.lastX = event.clientX;
    candidate.lastY = event.clientY;
    const dx = event.clientX - candidate.startX;
    const dy = event.clientY - candidate.startY;

    if (!candidate.dragging && Math.hypot(dx, dy) < dragThreshold) return;
    if (!candidate.dragging) {
      candidate.dragging = true;
      candidate.tile.classList.add('is-dragging');
      stage.classList.add('is-reordered', 'is-shelf-dragging');
      stage.dataset.dragging = 'true';
    }

    event.preventDefault();
    candidate.tile.style.setProperty('--drag-x', `${dx}px`);
    candidate.tile.style.setProperty('--drag-y', `${dy}px`);
  };

  const getDropTarget = (event, draggedTile) => {
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (const element of stack) {
      const tile = element.closest?.('.folder-tile[data-folder-tile]');
      if (tile && tile !== draggedTile && stage.contains(tile)) return tile;
    }
    return null;
  };

  const refreshSerials = () => {
    const tiles = [...stage.querySelectorAll('.folder-tile[data-folder-tile]')];
    tiles.forEach((tile, index) => {
      tile.style.setProperty('--tile-index', String(index));
      tile.style.setProperty('--tile-delay', `${Math.min(index, 6) * CONFIG.folder3d.staggerMs}ms`);
      const serial = tile.querySelector('.folder-tile__serial');
      if (serial) serial.textContent = `${String(index + 1).padStart(2, '0')} / FOLDER`;
    });
    onOrderChange?.(tiles.map(tile => tile.dataset.folderTile));
  };

  const clearDragStyles = tile => {
    tile.classList.remove('is-dragging');
    tile.style.removeProperty('--drag-x');
    tile.style.removeProperty('--drag-y');
    tile.style.removeProperty('z-index');
  };

  const onPointerUp = event => {
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    const current = candidate;
    candidate = null;

    if (!current.dragging) return;

    const dropTarget = getDropTarget(event, current.tile);
    if (dropTarget) {
      const rect = dropTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const before = event.clientY < midY || (Math.abs(event.clientY - midY) < 12 && event.clientX < rect.left + rect.width / 2);
      stage.insertBefore(current.tile, before ? dropTarget : dropTarget.nextElementSibling);
    }

    clearDragStyles(current.tile);
    stage.classList.remove('is-shelf-dragging');
    delete stage.dataset.dragging;
    refreshSerials();

    // The pointer sequence also generates a click. Suppress only that click so
    // a drag never accidentally opens the folder under the pointer.
    suppressedClickButton = current.button;
    window.clearTimeout(clearSuppressedTimer);
    clearSuppressedTimer = window.setTimeout(() => { suppressedClickButton = null; }, 700);
  };

  const onPointerCancel = event => {
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    const tile = candidate.tile;
    const wasDragging = candidate.dragging;
    candidate = null;
    clearDragStyles(tile);
    stage.classList.remove('is-shelf-dragging');
    delete stage.dataset.dragging;
    if (wasDragging) refreshSerials();
  };

  const onClickCapture = event => {
    if (!suppressedClickButton) return;
    if (event.target.closest?.('.folder-tile__open') !== suppressedClickButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressedClickButton = null;
    window.clearTimeout(clearSuppressedTimer);
  };

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('click', onClickCapture, true);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  return () => {
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('click', onClickCapture, true);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.clearTimeout(clearSuppressedTimer);
    if (candidate) clearDragStyles(candidate.tile);
  };
}
