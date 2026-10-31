import { h, formatSize } from './dom.js';
import { api, uploadFile } from './api.js';

const CONCURRENCY = 3;

/** Antrean upload: membuat struktur folder lebih dulu, lalu mengunggah file (3 paralel) dengan progres. */
export function createUploader({ queueEl, listEl, titleEl, getMax, onItemDone, onFinished }) {
  const jobs = [];
  let running = 0;
  const folderCache = new Map();

  function refreshTitle() {
    const done = jobs.filter(j => j.status === 'done').length;
    const failed = jobs.filter(j => j.status === 'error').length;
    titleEl.textContent = `Upload: ${done}/${jobs.length} selesai${failed ? `, ${failed} gagal` : ''}`;
    queueEl.hidden = jobs.length === 0;
  }

  function setStatus(job, status, text) {
    job.status = status;
    job.stateEl.textContent = text;
    job.row.className = status === 'error' ? 'is-error' : status === 'done' ? 'is-done' : '';
    job.cancel.hidden = status !== 'queued' && status !== 'uploading';
    job.retry.hidden = status !== 'error';
    refreshTitle();
  }

  async function ensureFolder(parentId, segments) {
    if (!segments.length) return parentId;
    const key = `${parentId}/${segments.join('/')}`;
    if (!folderCache.has(key)) {
      folderCache.set(key, api('POST', '/api/admin/folders/ensure', { json: { parent: parentId, path: segments.join('/') } }).then(r => r.item.id));
      folderCache.get(key).catch(() => folderCache.delete(key));
    }
    return folderCache.get(key);
  }

  async function run(job) {
    running += 1;
    job.controller = new AbortController();
    try {
      if (job.file.size > getMax()) throw new Error(`Melebihi batas ${formatSize(getMax())}.`);
      setStatus(job, 'uploading', 'Menyiapkan…');
      const target = await ensureFolder(job.parent, job.segments);
      if (job.controller.signal.aborted) throw new Error('Dibatalkan.');
      job.bar.hidden = false;
      const result = await uploadFile({ file: job.file, parent: target, signal: job.controller.signal, onProgress: p => { job.bar.value = p; job.stateEl.textContent = `${Math.round(p * 100)}%`; } });
      job.bar.value = 1;
      setStatus(job, 'done', result.renamed ? `Selesai (nama: ${result.item.name})` : 'Selesai');
      onItemDone?.(job, result.item);
    } catch (error) {
      setStatus(job, 'error', error.message);
    } finally {
      running -= 1;
      pump();
    }
  }

  function pump() {
    while (running < CONCURRENCY) {
      const next = jobs.find(j => j.status === 'queued');
      if (!next) break;
      void run(next);
    }
    if (running === 0 && !jobs.some(j => j.status === 'queued')) onFinished?.(jobs.filter(j => j.status === 'done').length);
  }

  function add(entries, parent) {
    for (const { file, segments } of entries) {
      const bar = h('progress', { max: 1, value: 0, hidden: true });
      const stateEl = h('span', { class: 'admin-queue__state' }, 'Menunggu');
      const job = { file, segments, parent, status: 'queued', bar, stateEl };
      job.cancel = h('button', { class: 'file-action', type: 'button', onclick: () => { job.controller?.abort(); if (job.status === 'queued') setStatus(job, 'error', 'Dibatalkan.'); } }, 'Batal');
      job.retry = h('button', { class: 'file-action', type: 'button', hidden: true, onclick: () => { setStatus(job, 'queued', 'Menunggu'); bar.value = 0; pump(); } }, 'Ulangi');
      const label = [...segments, file.name].join('/');
      job.row = h('li', {}, h('span', { class: 'admin-queue__name', title: label }, label), h('div', {}, bar, stateEl), h('span', {}, job.cancel, job.retry));
      listEl.append(job.row);
      jobs.push(job);
    }
    refreshTitle();
    pump();
  }

  function clearFinished() {
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      if (jobs[i].status === 'done' || jobs[i].status === 'error') { jobs[i].row.remove(); jobs.splice(i, 1); }
    }
    refreshTitle();
  }

  return { add, clearFinished, get busy() { return jobs.some(j => j.status === 'queued' || j.status === 'uploading'); } };
}

/** Ubah hasil drop (file & folder) menjadi [{ file, segments }]. */
export async function entriesFromDrop(dataTransfer) {
  const out = [];
  const roots = [...(dataTransfer.items || [])].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) return [...dataTransfer.files].map(file => ({ file, segments: [] }));
  const readAll = reader => new Promise((resolve, reject) => {
    const all = [];
    const next = () => reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, reject);
    next();
  });
  async function walk(entry, segments) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, segments });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, [...segments, entry.name]);
    }
  }
  for (const entry of roots) await walk(entry, []);
  return out;
}

/** Hasil <input webkitdirectory>: webkitRelativePath = "folder/sub/a.txt". */
export function entriesFromInput(files) {
  return [...files].map(file => {
    const parts = (file.webkitRelativePath || '').split('/').filter(Boolean);
    return { file, segments: parts.length > 1 ? parts.slice(0, -1) : [] };
  });
}
