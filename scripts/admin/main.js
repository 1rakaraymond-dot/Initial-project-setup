import { h, formatSize, formatDate } from './dom.js';
import { api, ApiError, session } from './api.js';
import { askText, askConfirm, pickFolder } from './dialogs.js';
import { createUploader, entriesFromDrop, entriesFromInput } from './uploads.js';

const FOLDER = 'application/x-archive-folder';
const $ = id => document.getElementById(id);
const el = {
  login: $('login-view'), dash: $('dash-view'), form: $('login-form'), loginError: $('login-error'), loginSubmit: $('login-submit'),
  user: $('admin-user'), logout: $('logout'), crumbs: $('crumbs'), back: $('back'), list: $('list'), more: $('more'), status: $('status'),
  bulk: $('bulk'), bulkCount: $('bulk-count'), selectAll: $('select-all'), drop: $('drop')
};
const state = { path: [{ id: 'root', name: 'Arsip' }], items: [], next: null, selected: new Set(), maxUpload: 0, loadToken: 0 };
const here = () => state.path[state.path.length - 1];

const say = (message, isError = false) => { el.status.textContent = message; el.status.dataset.error = isError ? '1' : ''; };
const fail = error => say(error instanceof ApiError ? error.message : 'Terjadi kesalahan.', true);

// ---- Sesi ---------------------------------------------------------------------------------------
function showLogin(message = '') {
  session.csrf = '';
  el.dash.hidden = true; el.login.hidden = false; el.user.hidden = true; el.logout.hidden = true;
  el.loginError.textContent = message;
  el.form.password.value = '';
  (el.form.username.value ? el.form.password : el.form.username).focus();
}

function showDashboard(info) {
  session.csrf = info.csrf;
  session.uploadMode = info.uploadMode;
  state.maxUpload = info.maxUploadBytes;
  el.login.hidden = true; el.dash.hidden = false;
  el.user.textContent = info.username; el.user.hidden = false; el.logout.hidden = false;
  state.path = [{ id: 'root', name: 'Arsip' }];
  void load();
}

session.onUnauthorized = () => showLogin('Sesi berakhir. Silakan masuk lagi.');

el.form.addEventListener('submit', async event => {
  event.preventDefault();
  el.loginSubmit.disabled = true; el.loginError.textContent = '';
  try {
    showDashboard(await api('POST', '/api/admin/login', { json: { username: el.form.username.value.trim(), password: el.form.password.value } }));
  } catch (error) {
    el.loginError.textContent = error.message;
  } finally {
    el.loginSubmit.disabled = false;
  }
});

el.logout.addEventListener('click', async () => {
  try { await api('POST', '/api/admin/logout'); } catch { /* sesi mungkin sudah habis */ }
  showLogin();
});

// ---- Daftar ---------------------------------------------------------------------------------------
async function load({ append = false } = {}) {
  const token = ++state.loadToken;
  if (!append) { state.items = []; state.selected.clear(); el.list.replaceChildren(h('p', { class: 'admin-row__meta' }, 'Memuat…')); }
  try {
    const params = new URLSearchParams({ parent: here().id });
    if (append && state.next) params.set('pageToken', state.next);
    const data = await api('GET', `/api/list?${params}`);
    if (token !== state.loadToken) return;
    state.items = append ? state.items.concat(data.files) : data.files;
    state.next = data.nextPageToken || null;
    render();
    say(`${state.items.length} item${state.next ? '+' : ''}`);
  } catch (error) {
    if (token === state.loadToken) { el.list.replaceChildren(); fail(error); }
  }
}

function render() {
  el.back.hidden = state.path.length < 2;
  el.crumbs.replaceChildren(...state.path.flatMap((entry, index) => {
    const last = index === state.path.length - 1;
    return [index ? h('span', { class: 'breadcrumbs__sep', 'aria-hidden': 'true' }, '/') : null,
      h('button', { class: 'breadcrumbs__item', type: 'button', 'aria-current': last ? 'page' : null, onclick: () => goTo(index) }, entry.name)];
  }).filter(Boolean));

  if (!state.items.length) el.list.replaceChildren(h('p', { class: 'empty-state' }, 'Folder ini kosong. Tarik file ke sini atau gunakan tombol upload.'));
  else el.list.replaceChildren(...state.items.map(row));
  el.more.hidden = !state.next;
  syncSelection();
}

function row(item) {
  const folder = item.mimeType === FOLDER;
  const check = h('input', { type: 'checkbox', 'aria-label': `Pilih ${item.name}`, checked: state.selected.has(item.id), onchange: event => { event.target.checked ? state.selected.add(item.id) : state.selected.delete(item.id); syncSelection(); } });
  const name = folder
    ? h('button', { type: 'button', onclick: () => { state.path.push({ id: item.id, name: item.name }); void load(); } }, item.name)
    : h('button', { type: 'button', title: 'Unduh', onclick: () => download(item) }, item.name);
  const actions = [
    folder ? h('button', { class: 'file-action', type: 'button', onclick: () => { state.path.push({ id: item.id, name: item.name }); void load(); } }, 'Buka') : h('button', { class: 'file-action', type: 'button', onclick: () => download(item) }, 'Unduh'),
    h('button', { class: 'file-action', type: 'button', onclick: () => renameItem(item) }, 'Ubah nama'),
    h('button', { class: 'file-action', type: 'button', onclick: () => moveItems([item]) }, 'Pindahkan'),
    h('button', { class: 'file-action is-danger', type: 'button', onclick: () => deleteItems([item]) }, 'Hapus')
  ];
  return h('div', { class: `admin-row${state.selected.has(item.id) ? ' is-selected' : ''}`, dataset: { id: item.id } },
    h('label', { class: 'admin-check' }, check),
    h('div', { class: 'admin-row__name' }, h('span', { 'aria-hidden': 'true' }, folder ? '📁' : '📄'), name),
    h('span', { class: 'admin-row__meta' }, folder ? 'Folder' : formatSize(item.size)),
    h('span', { class: 'admin-row__meta' }, formatDate(item.modifiedTime)),
    h('div', { class: 'admin-row__actions' }, actions));
}

function syncSelection() {
  const n = state.selected.size;
  el.bulk.hidden = n === 0;
  el.bulkCount.textContent = `${n} dipilih`;
  el.selectAll.checked = n > 0 && n === state.items.length;
  el.selectAll.indeterminate = n > 0 && n < state.items.length;
  for (const r of el.list.querySelectorAll('.admin-row')) {
    const on = state.selected.has(r.dataset.id);
    r.classList.toggle('is-selected', on);
    r.querySelector('input').checked = on;
  }
}

function goTo(index) {
  if (index === state.path.length - 1) return;
  state.path = state.path.slice(0, index + 1);
  void load();
}

el.back.addEventListener('click', () => goTo(state.path.length - 2));
el.more.addEventListener('click', () => load({ append: true }));
$('refresh').addEventListener('click', () => load());
el.selectAll.addEventListener('change', () => {
  state.selected = el.selectAll.checked ? new Set(state.items.map(i => i.id)) : new Set();
  syncSelection();
});

// ---- Aksi ---------------------------------------------------------------------------------------
function download(item) {
  const a = h('a', { href: `/api/files/${encodeURIComponent(item.id)}/download`, download: item.name });
  document.body.append(a); a.click(); a.remove();
}

$('new-folder').addEventListener('click', async () => {
  const name = await askText({ title: 'Folder baru', label: 'Nama folder', confirm: 'Buat' });
  if (!name) return;
  try { await api('POST', '/api/admin/folders', { json: { parent: here().id, name } }); say(`Folder "${name}" dibuat.`); await load(); } catch (error) { fail(error); }
});

async function renameItem(item) {
  const name = await askText({ title: 'Ubah nama', label: `Nama baru untuk "${item.name}"`, value: item.name });
  if (!name || name === item.name) return;
  try { await api('PATCH', `/api/admin/items/${encodeURIComponent(item.id)}`, { json: { name } }); say('Nama diubah.'); await load(); } catch (error) { fail(error); }
}

async function moveItems(items) {
  const target = await pickFolder({ title: items.length > 1 ? `Pindahkan ${items.length} item` : `Pindahkan "${items[0].name}"`, start: state.path, exclude: new Set(items.filter(i => i.mimeType === FOLDER).map(i => i.id)) });
  if (!target) return;
  const same = target === here().id || (target === 'root' && here().id === 'root');
  if (same) { say('Item sudah berada di folder tujuan.'); return; }
  let ok = 0; const errors = [];
  for (const item of items) {
    try { await api('PATCH', `/api/admin/items/${encodeURIComponent(item.id)}`, { json: { parent: target } }); ok += 1; } catch (error) { errors.push(`${item.name}: ${error.message}`); }
  }
  say(errors.length ? `${ok} dipindahkan, ${errors.length} gagal — ${errors[0]}` : `${ok} item dipindahkan.`, errors.length > 0);
  await load();
}

async function deleteItems(items) {
  const many = items.length > 1;
  const confirmed = await askConfirm({
    title: many ? `Hapus ${items.length} item?` : 'Hapus item?',
    message: many ? 'Semua item terpilih (beserta isi folder) akan dipindahkan ke tempat sampah.' : `"${items[0].name}"${items[0].mimeType === FOLDER ? ' beserta seluruh isinya' : ''} akan dipindahkan ke tempat sampah.`
  });
  if (!confirmed) return;
  let ok = 0; const errors = [];
  for (const item of items) {
    try { await api('DELETE', `/api/admin/items/${encodeURIComponent(item.id)}`); ok += 1; } catch (error) { errors.push(`${item.name}: ${error.message}`); }
  }
  say(errors.length ? `${ok} dihapus, ${errors.length} gagal — ${errors[0]}` : `${ok} item dihapus.`, errors.length > 0);
  await load();
}

const selectedItems = () => state.items.filter(i => state.selected.has(i.id));
$('bulk-delete').addEventListener('click', () => deleteItems(selectedItems()));
$('bulk-move').addEventListener('click', () => moveItems(selectedItems()));

// ---- Upload ---------------------------------------------------------------------------------------
const uploader = createUploader({
  queueEl: $('queue'), listEl: $('queue-list'), titleEl: $('queue-title'), getMax: () => state.maxUpload,
  onFinished: count => { if (count) { say(`${count} file terunggah.`); void load(); } }
});
$('queue-clear').addEventListener('click', () => uploader.clearFinished());

const fileInput = $('file-input'); const folderInput = $('folder-input');
$('pick-files').addEventListener('click', () => fileInput.click());
$('pick-folder').addEventListener('click', () => folderInput.click());
fileInput.addEventListener('change', () => { uploader.add(entriesFromInput(fileInput.files).map(e => ({ ...e, segments: [] })), here().id); fileInput.value = ''; });
folderInput.addEventListener('change', () => { uploader.add(entriesFromInput(folderInput.files), here().id); folderInput.value = ''; });

let dragDepth = 0;
const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
el.drop.addEventListener('dragenter', event => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth += 1; el.drop.classList.add('is-dragging'); });
el.drop.addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
el.drop.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.drop.classList.remove('is-dragging'); });
el.drop.addEventListener('drop', async event => {
  if (!hasFiles(event)) return;
  event.preventDefault(); dragDepth = 0; el.drop.classList.remove('is-dragging');
  try { const entries = await entriesFromDrop(event.dataTransfer); if (entries.length) uploader.add(entries, here().id); } catch { say('Gagal membaca item yang dilepas.', true); }
});
window.addEventListener('beforeunload', event => { if (uploader.busy) { event.preventDefault(); event.returnValue = ''; } });

// ---- Mulai ---------------------------------------------------------------------------------------
(async () => {
  try {
    const info = await api('GET', '/api/admin/session');
    if (info.authenticated) showDashboard(info);
    else {
      showLogin(info.adminEnabled ? '' : 'Login admin belum dikonfigurasi di server (isi ADMIN_PASSWORD_HASH).');
    }
  } catch (error) {
    showLogin(error.message);
  }
})();
