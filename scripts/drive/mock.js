const FOLDER_MIME = 'application/x-archive-folder';
const rootId = 'mock-root';
const now = () => new Date().toISOString();
const previews = {
  'brief.svg': '/assets/previews/product-brief.svg',
  'interface-map.svg': '/assets/previews/component-map.svg',
  'motion-study.svg': '/assets/previews/motion-study.svg',
  'type-specimen.svg': '/assets/previews/type-specimen.svg',
  'navigation.svg': '/assets/previews/navigation-system.svg',
  'accessibility.svg': '/assets/previews/accessibility-notes.svg',
  'content-model.svg': '/assets/previews/content-model.svg',
  'workflows.svg': '/assets/previews/work-flows.svg',
  'spacing.svg': '/assets/previews/spacing-scale.svg',
  'audit.svg': '/assets/previews/interface-audit.svg',
  'pointer.svg': '/assets/previews/pointer-field.svg',
  'scroll-sequence.svg': '/assets/previews/scroll-sequence.svg'
};

const folders = [
  ['mock-projects', 'Projects'],
  ['mock-design', 'Design'],
  ['mock-development', 'Development'],
  ['mock-systems', 'Systems'],
  ['mock-research', 'Research'],
  ['mock-assets', 'Assets'],
  ['mock-documents', 'Documents']
].map(([id, name]) => ({
  id, name, mimeType: FOLDER_MIME, parents: [rootId], modifiedTime: now(),
  webViewLink: '', thumbnailLink: '', iconLink: ''
}));

const seedRows = [
  ['mock-projects', [['brief.svg', 'Project brief'], ['interface-map.svg', 'Interface map']]],
  ['mock-design', [['type-specimen.svg', 'Type specimen'], ['spacing.svg', 'Spacing scale']]],
  ['mock-development', [['workflows.svg', 'Build workflows'], ['content-model.svg', 'Content model']]],
  ['mock-systems', [['navigation.svg', 'Navigation system'], ['accessibility.svg', 'Accessibility notes']]],
  ['mock-research', [['audit.svg', 'Interface audit']]],
  ['mock-assets', [['motion-study.svg', 'Motion study'], ['pointer.svg', 'Pointer field']]],
  ['mock-documents', [['scroll-sequence.svg', 'Scroll sequence']]]
];

const items = new Map();
const previewUrls = new Map();
function ensure(parentId) { if (!items.has(parentId)) items.set(parentId, []); return items.get(parentId); }
function addSeed(parentId, fileName) {
  const id = `mock-file-${Math.random().toString(36).slice(2, 10)}`;
  const previewUrl = previews[fileName] || '';
  ensure(parentId).push({
    id, name: fileName, mimeType: 'image/svg+xml', parents: [parentId],
    modifiedTime: now(), size: '0', webViewLink: previewUrl, thumbnailLink: previewUrl, iconLink: ''
  });
  if (previewUrl) previewUrls.set(id, previewUrl);
}

function sorted(list) {
  return [...list].filter(item => !item.trashed).sort((a, b) => {
    const af = a.mimeType === FOLDER_MIME ? 0 : 1;
    const bf = b.mimeType === FOLDER_MIME ? 0 : 1;
    return af - bf || a.name.localeCompare(b.name);
  });
}

folders.forEach(folder => ensure(rootId).push(folder));
seedRows.forEach(([parent, rows]) => rows.forEach(([file]) => addSeed(parent, file)));

export const mockDrive = {
  rootId,
  getPreviewUrl(item) { return previewUrls.get(item.id) || item.webViewLink || item.thumbnailLink || ''; },
  async listFiles(parentId, pageToken = null, pageSize = 100) {
    const all = sorted(ensure(parentId));
    const start = pageToken ? Number(pageToken) : 0;
    const files = all.slice(start, start + pageSize);
    const nextPageToken = start + pageSize < all.length ? String(start + pageSize) : undefined;
    return { files: structuredClone(files), nextPageToken };
  }
};

export { FOLDER_MIME };
