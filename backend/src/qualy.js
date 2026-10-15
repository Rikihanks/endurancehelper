import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUALY_FILE = path.join(__dirname, '..', 'data', 'qualy.json');

// Qualifying snapshot store. Instantiate one per race session so two races
// never share qualifying data (Fase 0 multi-tenancy rule).
export class QualyStore {
  constructor(filePath = DEFAULT_QUALY_FILE) {
    this.filePath = filePath;
    this.data = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (_) {}
    return null;
  }

  persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.log('[qualy] persist error:', e.message);
    }
  }

  save(snapshot) {
    this.data = snapshot;
    this.persist();
    return this.data;
  }

  clear() {
    this.data = null;
    try { fs.unlinkSync(this.filePath); } catch (_) {}
    return this.data;
  }

  get() {
    return this.data;
  }
}
