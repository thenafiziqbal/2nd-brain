// idb-storage.js — tiny IndexedDB wrapper for keeping large user-owned
// blobs (note images, syllabus PDFs/images, OCR cache) on the device.
// Nothing here is uploaded — only an opaque key is stored in Firestore so
// other devices know which files exist locally.
//
// Stores:
//   - note-images : { id, blob, type, name, createdAt }
//   - syllabus-files : { id, blob, type, name, ocr, createdAt }
const DB_NAME = 'sb-local-store';
const DB_VERSION = 1;
const STORES = ['note-images','syllabus-files'];

let dbPromise = null;
function open(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach(name => {
        if(!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath:'id' });
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode='readonly'){
  return open().then(db => db.transaction(store, mode).objectStore(store));
}

export async function idbPut(store, record){
  const s = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = s.put(record);
    r.onsuccess = () => resolve(record);
    r.onerror = () => reject(r.error);
  });
}

export async function idbGet(store, id){
  const s = await tx(store);
  return new Promise((resolve, reject) => {
    const r = s.get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

export async function idbDelete(store, id){
  const s = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const r = s.delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function idbGetAll(store){
  const s = await tx(store);
  return new Promise((resolve, reject) => {
    const r = s.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

// Convert a Blob to a data URL we can use in <img src=...>. Cached on the
// Blob via a WeakMap so the same blob reuses one object URL.
const urlCache = new WeakMap();
export function blobToObjectUrl(blob){
  if(!blob) return '';
  if(urlCache.has(blob)) return urlCache.get(blob);
  const u = URL.createObjectURL(blob);
  urlCache.set(blob, u);
  return u;
}

export function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
