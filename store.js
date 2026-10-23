// ClipCreate — almacenamiento local v1.0: proyectos del editor y sus archivos en IndexedDB.
// Todo queda en este navegador: nada se sube a ningún servidor.
const DB = 'clipcreate-editor';
let dbp;
const open = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('projects', { keyPath: 'id' });
    r.result.createObjectStore('media', { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req.result);
    t.onerror = t.onabort = () => {
      const e = t.error || req.error;
      rej(e?.name === 'QuotaExceededError' ? new Error('No queda lugar en el navegador. Borrá proyectos viejos y probá de nuevo.') : e);
    };
  });
}

export const put = (store, value) => run(store, 'readwrite', s => s.put(value));
export const get = (store, id) => run(store, 'readonly', s => s.get(id));
export const all = store => run(store, 'readonly', s => s.getAll());
export const del = (store, id) => run(store, 'readwrite', s => s.delete(id));
export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);
