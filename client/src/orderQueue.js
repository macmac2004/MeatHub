const DB_NAME = 'meathub';
const DB_VERSION = 1;
const STORE_NAME = 'orderQueue';
const LEGACY_QUEUE_KEY = 'meathub-order-queue';
const CLAIM_TTL_MS = 60 * 1000;

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function openQueueDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store offline orders.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the offline order queue.'));
  });
}

export async function enqueueOrder({ order, apiUrl = '', token = null, demoIdentity = null }) {
  const db = await openQueueDb();
  const record = {
    id: newId(),
    order,
    apiUrl,
    token,
    demoIdentity,
    queuedAt: new Date().toISOString()
  };
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
  return record;
}

export async function listQueuedOrders() {
  const db = await openQueueDb();
  try {
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    return records.sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
  } finally {
    db.close();
  }
}

export async function claimQueuedOrder(id, ttlMs = CLAIM_TTL_MS) {
  const db = await openQueueDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        const record = request.result;
        if (!record || (record.claimedAt && Date.now() - record.claimedAt < ttlMs)) {
          resolve(false);
          return;
        }
        record.claimedAt = Date.now();
        store.put(record);
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function removeQueuedOrder(id) {
  const db = await openQueueDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function migrateLegacyQueue(apiUrl = '', demoIdentity = null) {
  let legacy = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) || '[]');
  } catch {
    legacy = [];
  }
  if (!Array.isArray(legacy)) legacy = [];
  for (const order of legacy) {
    if (!order || typeof order !== 'object') continue;
    await enqueueOrder({ order, apiUrl, demoIdentity });
  }
  localStorage.removeItem(LEGACY_QUEUE_KEY);
}
