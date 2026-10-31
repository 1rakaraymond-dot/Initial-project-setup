import { LocalStorage } from './local.js';
import { DriveStorage } from './drive.js';

export function createStorage(config) {
  if (config.storage.backend === 'drive') return new DriveStorage(config.storage.drive);
  return new LocalStorage(config.storage.local);
}
