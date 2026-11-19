const MAX_CACHED_ORDERS = 50;
const MAX_CACHED_MESSAGES = 100;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked (private browsing); caching then simply stays off.
  }
}

function ordersKey(uid) {
  return `meathub-orders-${uid}`;
}

function messagesKey(uid, orderId) {
  return `meathub-order-chat-${uid}-${orderId}`;
}

export function cacheOrders(uid, orders) {
  if (!uid || !Array.isArray(orders)) return;
  write(ordersKey(uid), orders.slice(0, MAX_CACHED_ORDERS));
}

export function readCachedOrders(uid) {
  if (!uid) return null;
  const orders = read(ordersKey(uid));
  return Array.isArray(orders) ? orders : null;
}

export function cacheOrderMessages(uid, orderId, messages) {
  if (!uid || !orderId || !Array.isArray(messages)) return;
  write(messagesKey(uid, orderId), messages.slice(-MAX_CACHED_MESSAGES));
}

export function readCachedOrderMessages(uid, orderId) {
  if (!uid || !orderId) return null;
  const messages = read(messagesKey(uid, orderId));
  return Array.isArray(messages) ? messages : null;
}
