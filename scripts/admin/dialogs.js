import { h } from './dom.js';
import { api } from './api.js';

function open(dialog) {
  document.body.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue); }, { once: true });
    dialog.showModal();
  });
}

const buttons = (confirmLabel, { danger = false, disabled = false } = {}) => h('div', { class: 'admin-dialog__buttons' },
  h('button', { class: 'button button--quiet', type: 'button', value: 'cancel', onclick: event => event.target.closest('dialog').close('cancel') }, 'Batal'),
  h('button', { class: `button ${danger ? 'button--danger' : 'button--solid'}`, type: 'submit', value: 'ok', disabled }, confirmLabel));

export async function askText({ title, label, value = '', confirm = 'Simpan' }) {
  const input = h('input', { type: 'text', value, maxlength: 200, required: true, 'aria-label': label, autocomplete: 'off' });
  const dialog = h('dialog', { class: 'admin-dialog' }, h('form', { method: 'dialog' }, h('h2', {}, title), h('p', {}, label), input, buttons(confirm)));
  const done = open(dialog);
  input.focus();
  const dot = value.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : value.length);
  return (await done) === 'ok' ? input.value.trim() : null;
}

export async function askConfirm({ title, message, confirm = 'Hapus', danger = true }) {
  const dialog = h('dialog', { class: 'admin-dialog' }, h('form', { method: 'dialog' }, h('h2', {}, title), h('p', {}, message), buttons(confirm, { danger })));
  const done = open(dialog);
  dialog.querySelector('button[value="cancel"]').focus();
  return (await done) === 'ok';
}

/** Pemilih folder tujuan. exclude = Set id yang tidak boleh dipilih (item yang dipindahkan). */
export async function pickFolder({ title, start, exclude = new Set() }) {
  let trail = [{ id: 'root', name: 'Arsip' }];
  if (start?.length) trail = start.map(entry => ({ ...entry }));
  const crumb = h('p', {});
  const list = h('ul', { class: 'admin-picker' });
  const ok = h('button', { class: 'button button--solid', type: 'submit', value: 'ok' }, 'Pindahkan ke sini');
  const dialog = h('dialog', { class: 'admin-dialog' }, h('form', { method: 'dialog' }, h('h2', {}, title), crumb, list,
    h('div', { class: 'admin-dialog__buttons' }, h('button', { class: 'button button--quiet', type: 'button', onclick: () => dialog.close('cancel') }, 'Batal'), ok)));

  async function render() {
    const here = trail[trail.length - 1];
    crumb.textContent = `Tujuan: ${trail.map(t => t.name).join(' / ')}`;
    list.replaceChildren(h('li', { class: 'admin-picker__empty' }, 'Memuat…'));
    ok.disabled = true;
    try {
      const data = await api('GET', `/api/list?parent=${encodeURIComponent(here.id)}`);
      const folders = data.files.filter(f => f.mimeType === 'application/x-archive-folder');
      const rows = [];
      if (trail.length > 1) rows.push(h('li', {}, h('button', { type: 'button', onclick: () => { trail.pop(); void render(); } }, '← Naik satu level')));
      for (const folder of folders) {
        const blocked = exclude.has(folder.id);
        rows.push(h('li', {}, h('button', { type: 'button', disabled: blocked, onclick: () => { trail.push({ id: folder.id, name: folder.name }); void render(); } }, `▸ ${folder.name}`)));
      }
      if (!folders.length) rows.push(h('li', { class: 'admin-picker__empty' }, 'Tidak ada subfolder.'));
      list.replaceChildren(...rows);
      ok.disabled = exclude.has(here.id);
    } catch (error) {
      list.replaceChildren(h('li', { class: 'admin-picker__empty' }, error.message));
    }
  }
  const done = open(dialog);
  void render();
  return (await done) === 'ok' ? trail[trail.length - 1].id : null;
}
