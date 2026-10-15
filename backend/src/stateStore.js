import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_FILE = path.join(__dirname, '..', 'data', 'last-state.json');

// Last-known live snapshot store (offline/fallback display). Instantiate one
// per race session so sessions never read each other's saved state.
export class StateStore {
  constructor(filePath = DEFAULT_STATE_FILE) {
    this.filePath = filePath;
    this.data = this.load();
    this.lastSaved = 0;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (_) {}
    return null;
  }

  save(snapshot, throttleMs = 15000) {
    const now = Date.now();
    if (now - this.lastSaved < throttleMs) return false;
    this.lastSaved = now;
    this.data = { ...snapshot, savedAt: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.log('[state] persist error:', e.message);
    }
    return true;
  }

  get() {
    return this.data;
  }
}
