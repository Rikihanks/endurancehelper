// Local session storage (IndexedDB). Sessions stay on the device: no backend,
// no cloud. Works in the PWA and inside the Capacitor webview.
//
// A stored session is { id, meta, records } where `records` is an array of
// decoded RaceBoxRecord objects. Meta is small and is what the list view reads.

const DB_NAME = 'inlap-racebox';
const DB_VERSION = 1;
const STORE = 'sessions';

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
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'meta.createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB.'));
  });
  return dbPromise;
}

/** Run one request in a transaction and resolve with its result. */
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

export function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export const SessionStore = {
  /** Persist a session and return its id. */
  async save(session) {
    const record = {
      id: session.id || newSessionId(),
      meta: {
        name: session.meta?.name || 'Sesión RaceBox',
        deviceName: session.meta?.deviceName || null,
        deviceId: session.meta?.deviceId || null,
        source: session.meta?.source || 'device',
        startedAt: session.meta?.startedAt || null,
        durationS: session.meta?.durationS ?? null,
        distanceM: session.meta?.distanceM ?? null,
        recordCount: session.records.length,
        maxSpeed: session.meta?.maxSpeed ?? null,
        maxG: session.meta?.maxG ?? null,
        lapCount: session.meta?.lapCount ?? null,
        bestLapS: session.meta?.bestLapS ?? null,
        createdAt: Date.now(),
      },
      records: session.records,
    };
    await runTx('readwrite', (store) => store.put(record));
    return record.id;
  },

  /** @returns {Promise<object[]>} session metas (with their id), newest first */
  async list() {
    const records = await runTx('readonly', (store) => store.getAll());
    return (records || [])
      .map((r) => ({ id: r.id, ...(r.meta || {}) }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  /** @returns {Promise<{id:string, meta:object, records:any[]}|null>} */
  async get(id) {
    return (await runTx('readonly', (store) => store.get(id))) || null;
  },

  async remove(id) {
    await runTx('readwrite', (store) => store.delete(id));
  },

  async clear() {
    await runTx('readwrite', (store) => store.clear());
  },
};
