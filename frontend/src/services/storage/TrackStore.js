// Local track store (IndexedDB). Tracks are { id, name, startFinish, splits }
// where each trap has { lat, lon, heading, width, bidirectional, type }.
// Kept in its own database so it never conflicts with the session store.

const DB_NAME = 'inlap-racebox-tracks';
const DB_VERSION = 1;
const STORE = 'tracks';

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB no está disponible en este entorno.'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB.'));
  });
  return dbPromise;
}

function runTx(mode, executor) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        let value;
        let hasValue = false;
        try {
          const request = executor(store);
          if (request) {
            request.onsuccess = () => {
              value = request.result;
              hasValue = true;
            };
            request.onerror = () => reject(request.error);
          }
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = () => resolve(hasValue ? value : undefined);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Transacción abortada.'));
      }),
  );
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const HIDDEN_KEY = 'inlap-hidden-builtins';

function hiddenBuiltins() {
  try {
    return JSON.parse(window.localStorage.getItem(HIDDEN_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

function hideBuiltin(id) {
  try {
    const list = hiddenBuiltins();
    if (!list.includes(id)) {
      list.push(id);
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
    }
  } catch (_) {
    /* ignore */
  }
}

function unhideBuiltin(id) {
  try {
    const list = hiddenBuiltins().filter((x) => x !== id);
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
  } catch (_) {
    /* ignore */
  }
}

export const TrackStore = {
  async save(track) {
    const record = {
      id: track.id || newId(),
      name: track.name || 'Circuito',
      createdAt: track.createdAt || Date.now(),
      startFinish: track.startFinish,
      splits: track.splits || [],
      builtin: !!track.builtin,
      centerline: track.centerline || null,
      source: track.source || null,
    };
    await runTx('readwrite', (store) => store.put(record));
    if (!record.builtin) unhideBuiltin(record.id);
    return record.id;
  },

  /** Insert the built-in tracks that are not stored yet and not hidden. */
  async ensureBuiltins(list) {
    const hidden = hiddenBuiltins();
    const existing = new Set((await this.list()).map((t) => t.id));
    let added = 0;
    for (const track of list) {
      if (existing.has(track.id) || hidden.includes(track.id)) continue;
      await runTx('readwrite', (store) =>
        store.put({
          id: track.id,
          name: track.name,
          createdAt: Date.now(),
          startFinish: track.startFinish,
          splits: track.splits || [],
          builtin: true,
          centerline: track.centerline || null,
          source: track.source || null,
        }),
      );
      added += 1;
    }
    return added;
  },

  async list() {
    const all = await runTx('readonly', (store) => store.getAll());
    return (all || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  async get(id) {
    return (await runTx('readonly', (store) => store.get(id))) || null;
  },

  async remove(id) {
    const track = await this.get(id);
    if (track && track.builtin) hideBuiltin(id);
    await runTx('readwrite', (store) => store.delete(id));
  },
};
