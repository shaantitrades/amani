/**
 * Petit magasin IndexedDB sans dependance.
 * Trois espaces : "outbox" (annonces preparees hors ligne, avec les Blobs),
 * "kv" (cache de listes d'annonces pour la consultation hors ligne) et
 * "calls" (historique local des appels lances).
 * Une version superieure cree simplement les magasins manquants : les donnees
 * deja presentes sont conservees.
 */

const DB_NAME = 'bodogui';
const DB_VERSION = 2;
const STORES = { outbox: { key: 'id' }, kv: { key: 'key' }, calls: { key: 'id' } };

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: cfg.key });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const idb = {
  async put(storeName, value) {
    return withStore(storeName, 'readwrite', (store) => store.put(value));
  },
  async get(storeName, key) {
    return withStore(storeName, 'readonly', (store) => store.get(key));
  },
  async all(storeName) {
    return withStore(storeName, 'readonly', (store) => store.getAll());
  },
  async remove(storeName, key) {
    return withStore(storeName, 'readwrite', (store) => store.delete(key));
  },
  async clear(storeName) {
    return withStore(storeName, 'readwrite', (store) => store.clear());
  },
  async count(storeName) {
    return withStore(storeName, 'readonly', (store) => store.count());
  },
};

/** Met en cache une reponse d'API pour la consultation hors ligne. */
export async function cacheSet(key, value) {
  try {
    await idb.put('kv', { key, value, at: Date.now() });
  } catch {
    /* le cache est un confort : on ignore les erreurs de quota */
  }
}

export async function cacheGet(key) {
  try {
    const row = await idb.get('kv', key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

export default idb;
