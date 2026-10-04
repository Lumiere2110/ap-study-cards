'use strict';

/**
 * IndexedDB ラッパー。
 *  decks   : { id, name, category, createdAt }
 *  cards   : { id, deckId, front, back, note, frontImages[], backImages[], tags[], flagged, createdAt, updatedAt, srs }
 *  images  : { id, blob }
 *  reviews : { id, cardId, deckId, ts, rating, prevState }
 */
const DB = (() => {
  const NAME = 'ap-study-cards';
  const VERSION = 1;
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('decks', { keyPath: 'id' });
          db.createObjectStore('cards', { keyPath: 'id' }).createIndex('deckId', 'deckId');
          db.createObjectStore('images', { keyPath: 'id' });
          const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
          reviews.createIndex('ts', 'ts');
          reviews.createIndex('cardId', 'cardId');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const request = req => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  const done = t => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });

  async function getAll(store) {
    const db = await open();
    return request(db.transaction(store).objectStore(store).getAll());
  }

  async function get(store, id) {
    const db = await open();
    return request(db.transaction(store).objectStore(store).get(id));
  }

  async function getByIndex(store, index, key) {
    const db = await open();
    return request(db.transaction(store).objectStore(store).index(index).getAll(key));
  }

  async function getRange(store, index, lower, upper) {
    const db = await open();
    const range = IDBKeyRange.bound(lower, upper);
    return request(db.transaction(store).objectStore(store).index(index).getAll(range));
  }

  async function putMany(store, values) {
    const db = await open();
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const v of values) os.put(v);
    return done(t);
  }

  async function deleteMany(store, ids) {
    if (!ids.length) return;
    const db = await open();
    const t = db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    for (const id of ids) os.delete(id);
    return done(t);
  }

  /** カードと、そのカードの画像・学習履歴をまとめて削除 */
  async function deleteCards(cards) {
    if (!cards.length) return;
    const db = await open();
    const ids = new Set(cards.map(c => c.id));
    const t = db.transaction(['cards', 'images', 'reviews'], 'readwrite');
    for (const c of cards) {
      t.objectStore('cards').delete(c.id);
      for (const img of [...(c.frontImages || []), ...(c.backImages || [])]) t.objectStore('images').delete(img);
    }
    t.objectStore('reviews').openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (!cur) return;
      if (ids.has(cur.value.cardId)) cur.delete();
      cur.continue();
    };
    await done(t);
    cards.forEach(c => [...(c.frontImages || []), ...(c.backImages || [])].forEach(Images.forget));
  }

  async function clearAll() {
    const db = await open();
    const stores = ['decks', 'cards', 'images', 'reviews'];
    const t = db.transaction(stores, 'readwrite');
    stores.forEach(s => t.objectStore(s).clear());
    return done(t);
  }

  return {
    getAll, get, getByIndex, getRange, putMany, deleteMany, deleteCards, clearAll,
    put: (store, v) => putMany(store, [v]),
    delete: (store, id) => deleteMany(store, [id]),
  };
})();

/** 画像 Blob の保存と表示用 URL のキャッシュ */
const Images = (() => {
  const urls = new Map();
  return {
    async save(blob) {
      const id = uid();
      await DB.put('images', { id, blob });
      return id;
    },
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const rec = await DB.get('images', id);
      if (!rec) return null;
      const u = URL.createObjectURL(rec.blob);
      urls.set(id, u);
      return u;
    },
    forget(id) {
      const u = urls.get(id);
      if (u) URL.revokeObjectURL(u);
      urls.delete(id);
    },
  };
})();
