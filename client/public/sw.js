const CACHE_NAME = 'meathub-shell-v2';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
const QUEUE_DB = 'meathub';
const QUEUE_STORE = 'orderQueue';
const QUEUE_SYNC_TAG = 'meathub-reservations';
const CLAIM_TTL_MS = 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const page = await fetch('/');
    if (!page.ok) throw new Error('Could not cache the MeatHub app shell.');
    const html = await page.clone().text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => `${url.pathname}${url.search}`))];
    await cache.put('/', page);
    await cache.addAll([...new Set([...APP_SHELL.slice(1), ...assets])]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  if (url.pathname === '/api/products') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  if (['script', 'style', 'font', 'manifest'].includes(request.destination)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'MeatHub', body: 'There is something fresh from your local market.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (error) {
    console.error('Could not parse push notification:', error);
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || 'meathub',
    data: { url: payload.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((windowClient) => windowClient.url.startsWith(self.location.origin));
    if (client) {
      await client.focus();
      try {
        await client.navigate(target);
      } catch (error) {
        console.warn('Could not navigate the open MeatHub tab:', error);
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag !== QUEUE_SYNC_TAG) return;
  event.waitUntil(syncQueuedOrders());
});

function openQueueDb() {
  return new Promise((resolve) => {
    if (!self.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(QUEUE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function readQueue(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(QUEUE_STORE).objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function claimQueueEntry(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (!record || (record.claimedAt && Date.now() - record.claimedAt < CLAIM_TTL_MS)) {
        resolve(false);
        return;
      }
      record.claimedAt = Date.now();
      store.put(record);
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

function deleteQueueEntry(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, 'readwrite');
    transaction.objectStore(QUEUE_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function isPermanentOrderFailure(status) {
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

function isMarketAppClient(client) {
  try {
    const path = new URL(client.url).pathname;
    return path === '/' || path === '/index.html';
  } catch {
    return false;
  }
}

async function syncQueuedOrders() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const appClients = windows.filter(isMarketAppClient);
  if (appClients.length) {
    appClients.forEach((client) => client.postMessage({ type: 'SYNC_MEATHUB_RESERVATIONS' }));
    return;
  }

  const db = await openQueueDb();
  if (!db) return;
  let records = [];
  try {
    records = await readQueue(db);
  } catch (error) {
    db.close();
    throw error;
  }

  let failure = null;
  for (const record of records) {
    if (!(await claimQueueEntry(db, record.id).catch((error) => { failure = error; return false; }))) {
      continue;
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (record.token) headers.Authorization = `Bearer ${record.token}`;
      if (record.demoIdentity) {
        headers['X-Demo-User-Id'] = record.demoIdentity.uid;
        headers['X-Demo-User-Role'] = record.demoIdentity.role;
      }
      const response = await fetch(`${record.apiUrl || ''}/api/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(record.order)
      });
      if (response.ok) {
        await deleteQueueEntry(db, record.id);
        continue;
      }
      if (isPermanentOrderFailure(response.status)) {
        const body = await response.json().catch(() => ({}));
        console.warn('Dropping an offline order the server rejected:', body.error || response.status);
        await deleteQueueEntry(db, record.id);
        continue;
      }
      failure = new Error(`Offline order sync failed (${response.status}).`);
    } catch (error) {
      failure = error;
    }
  }
  db.close();

  if (failure) throw failure;
}
