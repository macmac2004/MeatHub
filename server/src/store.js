import './env.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canAdvanceDeliveryStatus, isPhilippinesLocation } from './delivery.js';

const photo = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1000`;

const sampleProducts = [
  {
    id: 'farmstead-beef',
    name: 'Grass-fed beef ribeye',
    farm: 'Green Pastures Farm',
    category: 'Beef',
    price: 520,
    unit: '500g',
    stock: 18,
    image: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=1000&q=85',
    location: 'Silang, Cavite',
    description: 'Rich, well-marbled ribeye from pasture-raised cattle. Freshly cut and vacuum sealed.',
    featured: true,
    archived: false
  },
  {
    id: 'dry-aged-sirloin',
    name: 'Dry-aged sirloin steaks',
    farm: 'Green Pastures Farm',
    category: 'Beef',
    price: 465,
    unit: '500g',
    stock: 14,
    image: photo(8477074),
    location: 'Silang, Cavite',
    description: 'Hand-cut sirloin with a firm grain and deep beefy flavor. Two steaks per pack.',
    featured: false,
    archived: false
  },
  {
    id: 'beef-short-ribs',
    name: 'Marbled beef short ribs',
    farm: 'Batangas Cattle Co.',
    category: 'Beef',
    price: 580,
    unit: '1kg',
    stock: 9,
    image: photo(12884544),
    location: 'San Jose, Batangas',
    description: 'Thick-cut bone-in short ribs with generous marbling. Ideal for slow braising or the grill.',
    featured: false,
    archived: false
  },
  {
    id: 'ground-beef',
    name: 'Lean ground beef',
    farm: 'Batangas Cattle Co.',
    category: 'Beef',
    price: 320,
    unit: '500g',
    stock: 20,
    image: photo(128401),
    location: 'San Jose, Batangas',
    description: 'Freshly minced lean beef, ground the same morning it is delivered. Great for burgers and giniling.',
    featured: false,
    archived: false
  },
  {
    id: 'heritage-pork',
    name: 'Heritage pork belly',
    farm: 'Bukid Lokal',
    category: 'Pork',
    price: 285,
    unit: '500g',
    stock: 24,
    image: photo(39594956),
    location: 'Lipa, Batangas',
    description: 'Tender, flavorful pork belly raised on a small family farm. Even layers of fat and lean.',
    featured: true,
    archived: false
  },
  {
    id: 'pork-loin-chops',
    name: 'Pork loin chops',
    farm: 'Bukid Lokal',
    category: 'Pork',
    price: 310,
    unit: '500g',
    stock: 16,
    image: photo(7333264),
    location: 'Lipa, Batangas',
    description: 'Bone-in loin chops trimmed by hand, with a mild sweetness that grills beautifully.',
    featured: false,
    archived: false
  },
  {
    id: 'pork-spare-ribs',
    name: 'Fresh pork spare ribs',
    farm: 'Umagang Farm',
    category: 'Pork',
    price: 340,
    unit: '1kg',
    stock: 11,
    image: photo(7163989),
    location: 'Indang, Cavite',
    description: 'A full rack of spare ribs from pasture-raised pigs, cut fresh the day of pickup.',
    featured: false,
    archived: false
  },
  {
    id: 'free-range-chicken',
    name: 'Free-range whole chicken',
    farm: 'Umagang Farm',
    category: 'Chicken',
    price: 390,
    unit: '1.2kg',
    stock: 12,
    image: photo(10842246),
    location: 'Indang, Cavite',
    description: 'Naturally raised, firm-textured chicken with a deep, savory flavor.',
    featured: false,
    archived: false
  },
  {
    id: 'chicken-breast',
    name: 'Skinless chicken breast fillets',
    farm: 'Umagang Farm',
    category: 'Chicken',
    price: 295,
    unit: '500g',
    stock: 22,
    image: photo(6107733),
    location: 'Indang, Cavite',
    description: 'Trimmed, boneless breast fillets — lean, quick to cook, and packed fresh.',
    featured: false,
    archived: false
  },
  {
    id: 'chicken-drumsticks',
    name: 'Chicken drumsticks',
    farm: 'Mabini Poultry',
    category: 'Chicken',
    price: 250,
    unit: '700g',
    stock: 19,
    image: photo(7140316),
    location: 'Mabini, Batangas',
    description: 'Juicy skin-on drumsticks from slow-grown birds. Sold in a family pack of eight.',
    featured: false,
    archived: false
  },
  {
    id: 'lamb-chops',
    name: 'Pasture-raised lamb chops',
    farm: 'Highland Harvest',
    category: 'Lamb',
    price: 640,
    unit: '400g',
    stock: 8,
    image: photo(6281509),
    location: 'Tagaytay, Cavite',
    description: 'A small-batch cut with delicate flavor, ready for the grill.',
    featured: true,
    archived: false
 },
  {
    id: 'beef-stew-cubes',
    name: 'Fresh beef stew cubes',
    farm: 'Batangas Cattle Co.',
    category: 'Beef',
    price: 345,
    unit: '500g',
    stock: 15,
    image: photo(36319690),
    location: 'San Jose, Batangas',
    description: 'Fresh-cut beef portions for nilaga, caldereta, or slow-braised stews.',
    featured: false,
    archived: false
  },
  {
    id: 'fresh-pork-chops',
    name: 'Fresh-cut pork chops',
    farm: 'Bukid Lokal',
    category: 'Pork',
    price: 325,
    unit: '500g',
    stock: 13,
    image: photo(10647859),
    location: 'Lipa, Batangas',
    description: 'Thick-cut raw pork chops, ready for marinating, pan-searing, or grilling.',
    featured: false,
    archived: false
  },
  {
    id: 'raw-chicken-breast',
    name: 'Fresh chicken breast fillets',
    farm: 'Umagang Farm',
    category: 'Chicken',
    price: 305,
    unit: '500g',
    stock: 18,
    image: photo(5769376),
    location: 'Indang, Cavite',
    description: 'Boneless raw chicken breast fillets, trimmed and packed fresh.',
    featured: false,
    archived: false
  },
  {
    id: 'fresh-lamb-chops',
    name: 'Fresh lamb chops',
    farm: 'Highland Harvest',
    category: 'Lamb',
    price: 675,
    unit: '400g',
    stock: 7,
    image: photo(31732110),
    location: 'Tagaytay, Cavite',
    description: 'Raw lamb chops with visible marbling, portioned for the grill or skillet.',
    featured: false,
    archived: false
  }
];

const commissionRate = Number(process.env.PLATFORM_COMMISSION_RATE || 0.1);
if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 1) {
  throw new Error('PLATFORM_COMMISSION_RATE must be a number from 0 up to (but not including) 1.');
}

function commissionFields(total) {
  const commissionAmount = Math.round(total * commissionRate * 100) / 100;
  return {
    commissionRate,
    commissionAmount,
    sellerNet: Math.round((total - commissionAmount) * 100) / 100
  };
}

function sellerEarningsFields(lines) {
  const totals = new Map();
  for (const line of lines) {
    if (typeof line.sellerUid !== 'string' || !line.sellerUid) {
      throw new Error(`Product ${line.productId} is not linked to a seller.`);
    }
    const total = totals.get(line.sellerUid) || 0;
    totals.set(line.sellerUid, total + line.unitPrice * line.quantity);
  }
  const sellerEarnings = [...totals].map(([sellerUid, grossAmount]) => ({
    sellerUid,
    grossAmount: Math.round(grossAmount * 100) / 100,
    ...commissionFields(grossAmount),
    payoutStatus: 'unpaid'
  })).map(({ commissionRate: _commissionRate, ...earnings }) => earnings);
  return {
    sellerUids: sellerEarnings.map(({ sellerUid }) => sellerUid),
    sellerEarnings
  };
}

const isDemo = process.env.DATA_MODE === 'demo' ||
  (!process.env.DATA_MODE && process.env.NODE_ENV !== 'production');
const demoStorePath = resolve(process.env.MEATHUB_DEMO_STORE_PATH ||
  fileURLToPath(new URL('../data/demo-store.json', import.meta.url)));
const initialDemoProducts = sampleProducts.map((product) => ({ ...product, ownerUid: 'demo-seller' }));

function loadDemoStore() {
  let saved;
  try {
    saved = JSON.parse(readFileSync(demoStorePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { products: initialDemoProducts, orders: [], subscriptions: [] };
    }
    throw new Error(`Could not load the demo store at ${demoStorePath}: ${error.message}`, { cause: error });
  }
  if (!saved || !Array.isArray(saved.products) || !Array.isArray(saved.orders)) {
    throw new Error(`The demo store at ${demoStorePath} has an invalid format.`);
  }
  return { products: saved.products, orders: saved.orders, subscriptions: [] };
}

const memory = isDemo
  ? loadDemoStore()
  : { products: initialDemoProducts, orders: [], subscriptions: [] };

function persistDemoStore() {
  const temporaryPath = `${demoStorePath}.${process.pid}.tmp`;
  mkdirSync(dirname(demoStorePath), { recursive: true });
  writeFileSync(temporaryPath, JSON.stringify({
    products: memory.products,
    orders: memory.orders
  }), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, demoStorePath);
}

if (isDemo) {
  console.warn(`MeatHub is using its local demo store at ${demoStorePath}.`);
}

function resolveFirebaseProjectId() {
  const configured = process.env.FIREBASE_PROJECT_ID?.trim();
  if (configured) return configured;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath) {
    try {
      const projectId = JSON.parse(readFileSync(credentialsPath, 'utf8')).project_id;
      if (projectId) return projectId;
    } catch (error) {
      throw new Error(`Could not read GOOGLE_APPLICATION_CREDENTIALS at ${credentialsPath}: ${error.message}`);
    }
  }
  throw new Error('Firestore mode needs credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file (its project_id is used automatically), or run `gcloud auth application-default login` and set FIREBASE_PROJECT_ID. Set DATA_MODE=demo to keep using the local store.');
}

let db;
if (!isDemo) {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credentialsPath && !existsSync(credentialsPath)) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points to ${credentialsPath}, but that file does not exist.`);
  }
  const projectId = resolveFirebaseProjectId();
  try {
    const app = getApps()[0] || initializeApp({
      credential: applicationDefault(),
      projectId
    });
    db = getFirestore(app);
  } catch (error) {
    throw new Error(`Could not start Firestore for project ${projectId}: ${error.message}. Check that Firestore is enabled in the Firebase console and that the credentials can access it. Set DATA_MODE=demo to use the local store instead.`);
  }
  console.log(`MeatHub is using Firestore project ${projectId}.`);
}

export const demoMode = isDemo;

export async function getAccountRole(uid) {
  const reference = db.collection('users').doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) {
      const role = snapshot.data().role;
      if (role === 'buyer' || role === 'seller' || role === 'rider') return role;
      if (role) throw new Error(`Account ${uid} has an invalid role.`);
    }
    transaction.set(reference, { role: 'buyer', createdAt: new Date().toISOString() }, { merge: true });
    return 'buyer';
  });
}

export async function registerAccountRole(uid, role) {
  if (!['buyer', 'seller', 'rider'].includes(role)) {
    throw new Error('Choose buyer, seller, or rider as your account type.');
  }
  const reference = db.collection('users').doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists && snapshot.data().role) {
      if (snapshot.data().role !== role) {
        throw new Error('Account role cannot be changed after registration.');
      }
      return role;
    }
    transaction.set(reference, { role, createdAt: new Date().toISOString() }, { merge: true });
    return role;
  });
}

export async function listProducts(ownerUid = null) {
  if (isDemo) {
    return memory.products.filter((product) =>
      !product.archived && (!ownerUid || product.ownerUid === ownerUid));
  }
  let query = db.collection('products').where('archived', '==', false);
  if (ownerUid) query = db.collection('products')
    .where('ownerUid', '==', ownerUid)
    .where('archived', '==', false);
  const snapshot = await query.get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export async function createProduct(product, ownerUid) {
  const data = { ...product, ownerUid, featured: false, archived: false, createdAt: new Date().toISOString() };
  if (isDemo) {
    const saved = { id: randomUUID(), ...data };
    memory.products.unshift(saved);
    persistDemoStore();
    return saved;
  }
  const document = db.collection('products').doc();
  await document.set(data);
  return { id: document.id, ...data };
}

export async function updateProduct(id, updates, ownerUid) {
  if (isDemo) {
    const product = memory.products.find((item) => item.id === id);
    if (!product || product.archived) return null;
    if (product.ownerUid !== ownerUid) throw new Error('You can only edit your own listings.');
    Object.assign(product, updates, { updatedAt: new Date().toISOString() });
    persistDemoStore();
    return product;
  }
  const document = db.collection('products').doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().archived) return null;
    if (snapshot.data().ownerUid !== ownerUid) throw new Error('You can only edit your own listings.');
    transaction.update(document, { ...updates, updatedAt: new Date().toISOString() });
    return { id, ...snapshot.data(), ...updates, updatedAt: new Date().toISOString() };
  });
}

export async function archiveProduct(id, ownerUid) {
  if (isDemo) {
    const product = memory.products.find((item) => item.id === id);
    if (!product) return false;
    if (product.ownerUid !== ownerUid) throw new Error('You can only archive your own listings.');
    product.archived = true;
    persistDemoStore();
    return true;
  }
  const document = db.collection('products').doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return false;
    if (snapshot.data().ownerUid !== ownerUid) throw new Error('You can only archive your own listings.');
    transaction.update(document, { archived: true, archivedAt: new Date().toISOString() });
    return true;
  });
}

function customerOrder(order) {
  const { courierToken, sellerEarnings: _sellerEarnings, sellerUids: _sellerUids, sellerConfirmations: _sellerConfirmations, ...details } = order;
  return {
    ...details,
    items: details.items.map(({ sellerUid: _sellerUid, ...item }) => item)
  };
}

function sellerOrder(order, sellerUid) {
  const earnings = order.sellerEarnings?.find((item) => item.sellerUid === sellerUid);
  if (!earnings) return null;
  return {
    id: order.id,
    createdAt: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryDate: order.deliveryDate,
    deliveryAddress: order.deliveryAddress,
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    sellerConfirmation: order.sellerConfirmations?.[sellerUid] || 'confirmed',
    items: order.items
      .filter((item) => item.sellerUid === sellerUid)
      .map(({ name, quantity, unitPrice }) => ({ name, quantity, unitPrice })),
    grossAmount: earnings.grossAmount,
    commissionAmount: earnings.commissionAmount,
    sellerNet: earnings.sellerNet,
    payoutStatus: earnings.payoutStatus || 'unpaid',
    payoutAt: earnings.payoutAt || null,
    payoutReference: earnings.payoutReference || null
  };
}

function adminPayouts(order) {
  return (order.sellerEarnings || []).map((earnings) => ({
    orderId: order.id,
    createdAt: order.createdAt,
    sellerUid: earnings.sellerUid,
    items: order.items
      .filter((item) => item.sellerUid === earnings.sellerUid)
      .map(({ name, quantity }) => ({ name, quantity })),
    grossAmount: earnings.grossAmount,
    commissionAmount: earnings.commissionAmount,
    sellerNet: earnings.sellerNet,
    payoutStatus: earnings.payoutStatus || 'unpaid',
    payoutAt: earnings.payoutAt || null,
    payoutReference: earnings.payoutReference || null
  }));
}

function trackedOrder(order) {
  return {
    id: order.id,
    items: order.items.map(({ name, quantity }) => ({ name, quantity })),
    total: order.total,
    status: order.status,
    statusHistory: order.statusHistory,
    deliveryDate: order.deliveryDate,
    deliveryAddress: order.deliveryAddress,
    deliveryLocation: order.deliveryLocation,
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    courierLocation: order.courierLocation,
    trackingUpdatedAt: order.trackingUpdatedAt,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus
  };
}

function deliveryStatusUpdate(order, status, cashCollected) {
  if (!canAdvanceDeliveryStatus(order.status, status)) {
    throw new Error('Invalid delivery status transition.');
  }
  if (status === 'delivered' && order.paymentMethod === 'cod' && cashCollected !== true) {
    throw new Error('Collect the cash payment before marking this COD order delivered.');
  }
  const updatedAt = new Date().toISOString();
  return {
    status,
    paymentStatus: status === 'delivered' ? 'paid' : order.paymentStatus,
    statusHistory: [...(order.statusHistory || []), { status, updatedAt }],
    trackingUpdatedAt: updatedAt,
    updatedAt
  };
}

export async function createOrder(items, delivery, customerUid) {
  const now = new Date().toISOString();
  const trackingToken = randomBytes(32).toString('base64url');
  const courierToken = randomBytes(32).toString('base64url');
  const orderFields = {
    deliveryDate: delivery.deliveryDate,
    deliveryAddress: delivery.deliveryAddress,
    deliveryLocation: delivery.deliveryLocation,
    customerName: delivery.customerName,
    customerPhone: delivery.customerPhone,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    status: 'pending_seller',
    statusHistory: [{ status: 'pending_seller', updatedAt: now }],
    courierLocation: null,
    trackingUpdatedAt: now,
    trackingToken,
    courierToken,
    customerUid,
    createdAt: now,
    archived: false
  };
  if (isDemo) {
    const lines = items.map(({ productId, quantity }) => {
      const product = memory.products.find((item) => item.id === productId && !item.archived);
      if (!product) throw new Error(`Product ${productId} is no longer available.`);
      if (product.stock < quantity) throw new Error(`${product.name} does not have enough stock.`);
      return { productId, sellerUid: product.ownerUid, quantity, name: product.name, unitPrice: product.price };
    });
    lines.forEach((line) => {
      memory.products.find((product) => product.id === line.productId).stock -= line.quantity;
    });
    const order = {
      id: randomUUID(),
      items: lines,
      total: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
      ...sellerEarningsFields(lines),
      sellerConfirmations: Object.fromEntries(
        [...new Set(lines.map((line) => line.sellerUid))].map((uid) => [uid, 'pending'])
      ),
      ...orderFields
    };
    Object.assign(order, commissionFields(order.total));
    memory.orders.unshift(order);
    persistDemoStore();
    return order;
  }

  const orderRef = db.collection('orders').doc();
  return db.runTransaction(async (transaction) => {
    const products = await Promise.all(items.map(({ productId }) =>
      transaction.get(db.collection('products').doc(productId))
    ));
    const lines = products.map((snapshot, index) => {
      const { quantity, productId } = items[index];
      if (!snapshot.exists || snapshot.data().archived) {
        throw new Error(`Product ${productId} is no longer available.`);
      }
      const product = snapshot.data();
      if (product.stock < quantity) throw new Error(`${product.name} does not have enough stock.`);
      return {
        productId,
        sellerUid: product.ownerUid,
        quantity,
        name: product.name,
        unitPrice: product.price,
        ref: snapshot.ref,
        stock: product.stock
      };
    });
    lines.forEach((line) => transaction.update(line.ref, { stock: line.stock - line.quantity }));
    const order = {
      items: lines.map(({ productId, sellerUid, quantity, name, unitPrice }) => ({
        productId, sellerUid, quantity, name, unitPrice
      })),
      total: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
      ...sellerEarningsFields(lines),
      sellerConfirmations: Object.fromEntries(
        [...new Set(lines.map((line) => line.sellerUid))].map((uid) => [uid, 'pending'])
      ),
      ...orderFields
    };
    Object.assign(order, commissionFields(order.total));
    transaction.set(orderRef, order);
    return { id: orderRef.id, ...order };
  });
}

export async function listOrders(customerUid) {
  if (isDemo) {
    return memory.orders
      .filter((order) => order.customerUid === customerUid && !order.archived)
      .map(customerOrder);
  }
  const snapshot = await db.collection('orders')
    .where('customerUid', '==', customerUid)
    .where('archived', '==', false)
    .get();
  return snapshot.docs.map((document) => customerOrder({ id: document.id, ...document.data() }));
}

export async function listSellerEarnings(sellerUid) {
  let orders;
  if (isDemo) {
    orders = memory.orders.filter((order) => !order.archived && order.sellerUids?.includes(sellerUid));
  } else {
    const snapshot = await db.collection('orders')
      .where('sellerUids', 'array-contains', sellerUid)
      .where('archived', '==', false)
      .get();
    orders = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }
  return orders.map((order) => sellerOrder(order, sellerUid)).filter(Boolean);
}

export async function confirmSellerOrder(orderId, sellerUid) {
  const now = new Date().toISOString();
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === orderId && !item.archived);
    if (!order || !order.sellerUids?.includes(sellerUid)) return null;
    if (order.status !== 'pending_seller') {
      throw new Error('This order is no longer waiting for seller confirmation.');
    }
    const confirmations = { ...(order.sellerConfirmations || {}) };
    if (confirmations[sellerUid] !== 'pending') {
      throw new Error('Your confirmation for this order was already recorded.');
    }
    confirmations[sellerUid] = 'confirmed';
    order.sellerConfirmations = confirmations;
    if (order.sellerUids.every((uid) => confirmations[uid] === 'confirmed')) {
      order.status = 'confirmed';
      order.statusHistory = [...(order.statusHistory || []), { status: 'confirmed', updatedAt: now }];
      order.updatedAt = now;
    }
    persistDemoStore();
    return sellerOrder(order, sellerUid);
  }
  const document = db.collection('orders').doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().archived) return null;
    const order = { id: document.id, ...snapshot.data() };
    if (!order.sellerUids?.includes(sellerUid)) return null;
    if (order.status !== 'pending_seller') {
      throw new Error('This order is no longer waiting for seller confirmation.');
    }
    const confirmations = { ...(order.sellerConfirmations || {}) };
    if (confirmations[sellerUid] !== 'pending') {
      throw new Error('Your confirmation for this order was already recorded.');
    }
    confirmations[sellerUid] = 'confirmed';
    const allConfirmed = order.sellerUids.every((uid) => confirmations[uid] === 'confirmed');
    const updates = { sellerConfirmations: confirmations };
    if (allConfirmed) {
      updates.status = 'confirmed';
      updates.statusHistory = [...(order.statusHistory || []), { status: 'confirmed', updatedAt: now }];
      updates.updatedAt = now;
    }
    transaction.update(document, updates);
    return sellerOrder({ ...order, ...updates }, sellerUid);
  });
}

export async function declineSellerOrder(orderId, sellerUid) {
  const now = new Date().toISOString();
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === orderId && !item.archived);
    if (!order || !order.sellerUids?.includes(sellerUid)) return null;
    if (order.status !== 'pending_seller') {
      throw new Error('This order is no longer waiting for seller confirmation.');
    }
    const confirmations = { ...(order.sellerConfirmations || {}) };
    if (confirmations[sellerUid] !== 'pending') {
      throw new Error('Your confirmation for this order was already recorded.');
    }
    order.items.forEach((line) => {
      const product = memory.products.find((item) => item.id === line.productId);
      if (product) product.stock += line.quantity;
    });
    confirmations[sellerUid] = 'declined';
    Object.assign(order, {
      sellerConfirmations: confirmations,
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelledBy: sellerUid,
      cancellationReason: 'seller_declined',
      statusHistory: [...(order.statusHistory || []), { status: 'cancelled', updatedAt: now }],
      updatedAt: now
    });
    persistDemoStore();
    return sellerOrder(order, sellerUid);
  }
  const document = db.collection('orders').doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().archived) return null;
    const order = { id: document.id, ...snapshot.data() };
    if (!order.sellerUids?.includes(sellerUid)) return null;
    if (order.status !== 'pending_seller') {
      throw new Error('This order is no longer waiting for seller confirmation.');
    }
    const confirmations = { ...(order.sellerConfirmations || {}) };
    if (confirmations[sellerUid] !== 'pending') {
      throw new Error('Your confirmation for this order was already recorded.');
    }
    const products = await Promise.all(order.items.map((item) =>
      transaction.get(db.collection('products').doc(item.productId))
    ));
    products.forEach((product, index) => {
      if (product.exists) {
        transaction.update(product.ref, { stock: product.data().stock + order.items[index].quantity });
      }
    });
    confirmations[sellerUid] = 'declined';
    const updates = {
      sellerConfirmations: confirmations,
      status: 'cancelled',
      paymentStatus: 'cancelled',
      cancelledBy: sellerUid,
      cancellationReason: 'seller_declined',
      statusHistory: [...(order.statusHistory || []), { status: 'cancelled', updatedAt: now }],
      updatedAt: now
    };
    transaction.update(document, updates);
    return sellerOrder({ ...order, ...updates }, sellerUid);
  });
}

function riderOrder(order, includeCourierToken = false) {
  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: order.total,
    deliveryDate: order.deliveryDate,
    deliveryAddress: order.deliveryAddress,
    deliveryLocation: order.deliveryLocation,
    customerName: order.customerName || '',
    customerPhone: order.customerPhone || '',
    items: order.items.map(({ name, quantity }) => ({ name, quantity })),
    courierLocation: order.courierLocation || null,
    ...(includeCourierToken ? { courierToken: order.courierToken } : {})
  };
}

export async function listRiderOrders(riderUid) {
  let orders;
  if (isDemo) {
    orders = memory.orders.filter((order) => !order.archived &&
      ['confirmed', 'preparing', 'out_for_delivery'].includes(order.status));
  } else {
    const snapshot = await db.collection('orders').where('archived', '==', false).get();
    orders = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((order) => ['confirmed', 'preparing', 'out_for_delivery'].includes(order.status));
  }
  return {
    available: orders
      .filter((order) => !order.riderUid)
      .map((order) => riderOrder(order)),
    assigned: orders
      .filter((order) => order.riderUid === riderUid)
      .map((order) => riderOrder(order, true))
  };
}

export async function claimDelivery(orderId, riderUid, riderName) {
  const assignedAt = new Date().toISOString();
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === orderId && !item.archived);
    if (!order || !['confirmed', 'preparing'].includes(order.status)) return null;
    if (order.riderUid && order.riderUid !== riderUid) return null;
    Object.assign(order, { riderUid, riderName, riderAssignedAt: assignedAt });
    persistDemoStore();
    return { courierToken: order.courierToken };
  }
  const document = db.collection('orders').doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().archived) return null;
    const order = snapshot.data();
    if (!['confirmed', 'preparing'].includes(order.status)) return null;
    if (order.riderUid && order.riderUid !== riderUid) return null;
    transaction.update(document, { riderUid, riderName, riderAssignedAt: assignedAt });
    return { courierToken: order.courierToken };
  });
}

export async function getOrderNotificationContext(orderId) {
  let order;
  if (isDemo) {
    order = memory.orders.find((item) => item.id === orderId);
  } else {
    const snapshot = await db.collection('orders').doc(orderId).get();
    order = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }
  if (!order) return null;
  return { customerUid: order.customerUid, trackingToken: order.trackingToken };
}

export async function listAdminPayouts() {
  let orders;
  if (isDemo) {
    orders = memory.orders.filter((order) =>
      !order.archived && order.status === 'delivered' && order.paymentStatus === 'paid');
  } else {
    const snapshot = await db.collection('orders')
      .where('paymentStatus', '==', 'paid')
      .where('archived', '==', false)
      .get();
    orders = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((order) => order.status === 'delivered');
  }
  return orders.flatMap(adminPayouts);
}

export async function recordSellerPayout(orderId, sellerUid, reference, adminUid) {
  const payoutAt = new Date().toISOString();
  const payoutReference = reference.trim();
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === orderId && !item.archived);
    if (!order) return null;
    if (order.status !== 'delivered' || order.paymentStatus !== 'paid') {
      throw new Error('Seller payout can only be recorded after COD payment is collected.');
    }
    const earnings = order.sellerEarnings?.find((item) => item.sellerUid === sellerUid);
    if (!earnings) return null;
    if (earnings.payoutStatus === 'paid') {
      throw new Error('Seller payout has already been recorded.');
    }
    Object.assign(earnings, {
      payoutStatus: 'paid',
      payoutAt,
      payoutReference,
      paidBy: adminUid
    });
    persistDemoStore();
    return adminPayouts(order).find((item) => item.sellerUid === sellerUid);
  }

  const document = db.collection('orders').doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().archived) return null;
    const order = { id: document.id, ...snapshot.data() };
    if (order.status !== 'delivered' || order.paymentStatus !== 'paid') {
      throw new Error('Seller payout can only be recorded after COD payment is collected.');
    }
    const earnings = order.sellerEarnings?.find((item) => item.sellerUid === sellerUid);
    if (!earnings) return null;
    if (earnings.payoutStatus === 'paid') {
      throw new Error('Seller payout has already been recorded.');
    }
    const updatedEarnings = order.sellerEarnings.map((item) => item.sellerUid === sellerUid
      ? { ...item, payoutStatus: 'paid', payoutAt, payoutReference, paidBy: adminUid }
      : item);
    transaction.update(document, { sellerEarnings: updatedEarnings });
    return adminPayouts({ ...order, sellerEarnings: updatedEarnings })
      .find((item) => item.sellerUid === sellerUid);
  });
}

export async function createCourierLink(orderId, customerUid) {
  const courierToken = randomBytes(32).toString('base64url');
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === orderId &&
      item.customerUid === customerUid && !item.archived &&
      !['delivered', 'cancelled'].includes(item.status));
    if (!order) return null;
    order.courierToken = courierToken;
    persistDemoStore();
    return { courierToken };
  }
  const document = db.collection('orders').doc(orderId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().customerUid !== customerUid ||
        snapshot.data().archived || ['delivered', 'cancelled'].includes(snapshot.data().status)) return null;
    transaction.update(document, { courierToken, courierLinkUpdatedAt: new Date().toISOString() });
    return { courierToken };
  });
}

async function findOrderByToken(field, token) {
  if (isDemo) {
    const order = memory.orders.find((item) => item[field] === token && !item.archived);
    return order ? { id: order.id, order } : null;
  }
  const snapshot = await db.collection('orders').where(field, '==', token).limit(1).get();
  if (snapshot.empty) return null;
  const document = snapshot.docs[0];
  return { id: document.id, ref: document.ref, order: { id: document.id, ...document.data() } };
}

export async function getTrackedOrder(trackingToken) {
  const found = await findOrderByToken('trackingToken', trackingToken);
  return found ? trackedOrder(found.order) : null;
}

export async function getCourierOrder(courierToken) {
  const found = await findOrderByToken('courierToken', courierToken);
  return found ? trackedOrder(found.order) : null;
}

export async function getCourierOrderContext(courierToken) {
  const found = await findOrderByToken('courierToken', courierToken);
  if (!found) return null;
  return {
    orderId: found.order.id,
    customerUid: found.order.customerUid,
    trackingToken: found.order.trackingToken
  };
}

export async function updateCourierLocation(courierToken, location) {
  if (!isPhilippinesLocation(location)) throw new Error('Courier location must be within the Philippines map area.');
  const found = await findOrderByToken('courierToken', courierToken);
  if (!found) return null;
  const updatedAt = new Date().toISOString();
  const courierLocation = { ...location, updatedAt };
  if (isDemo) {
    if (found.order.status !== 'out_for_delivery') {
      throw new Error('Live location sharing is only available while the order is out for delivery.');
    }
    found.order.courierLocation = courierLocation;
    found.order.trackingUpdatedAt = updatedAt;
    persistDemoStore();
    return trackedOrder(found.order);
  }
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(found.ref);
    if (!snapshot.exists || snapshot.data().courierToken !== courierToken || snapshot.data().archived) return null;
    if (snapshot.data().status !== 'out_for_delivery') {
      throw new Error('Live location sharing is only available while the order is out for delivery.');
    }
    const updates = { courierLocation, trackingUpdatedAt: updatedAt };
    transaction.update(found.ref, updates);
    return trackedOrder({ id: found.id, ...snapshot.data(), ...updates });
  });
}

export async function updateCourierStatus(courierToken, status, cashCollected) {
  const found = await findOrderByToken('courierToken', courierToken);
  if (!found) return null;
  if (isDemo) {
    Object.assign(found.order, deliveryStatusUpdate(found.order, status, cashCollected));
    persistDemoStore();
    return trackedOrder(found.order);
  }
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(found.ref);
    if (!snapshot.exists || snapshot.data().courierToken !== courierToken || snapshot.data().archived) return null;
    const updates = deliveryStatusUpdate(snapshot.data(), status, cashCollected);
    transaction.update(found.ref, updates);
    return trackedOrder({ id: found.id, ...snapshot.data(), ...updates });
  });
}

export async function archiveOrder(id, customerUid) {
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === id && item.customerUid === customerUid);
    if (!order || order.archived || !['reserved', 'pending_seller', 'confirmed', 'preparing'].includes(order.status)) return false;
    order.items.forEach((line) => {
      const product = memory.products.find((item) => item.id === line.productId);
      if (product) product.stock += line.quantity;
    });
    order.archived = true;
    order.status = 'cancelled';
    order.paymentStatus = 'cancelled';
    persistDemoStore();
    return true;
  }
  const document = db.collection('orders').doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().customerUid !== customerUid ||
        snapshot.data().archived || !['reserved', 'pending_seller', 'confirmed', 'preparing'].includes(snapshot.data().status)) return false;
    const items = snapshot.data().items || [];
    const productSnapshots = await Promise.all(items.map((item) =>
      transaction.get(db.collection('products').doc(item.productId))
    ));
    productSnapshots.forEach((product, index) => {
      if (product.exists) transaction.update(product.ref, { stock: product.data().stock + items[index].quantity });
    });
    transaction.update(document, {
      archived: true,
      status: 'cancelled',
      paymentStatus: 'cancelled',
      archivedAt: new Date().toISOString()
    });
    return true;
  });
}

export async function saveSubscription(subscription, userUid) {
  if (isDemo) {
    memory.subscriptions = memory.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
    memory.subscriptions.push({ ...subscription, userUid });
    return;
  }
  await db.collection('pushSubscriptions').doc(userUid).collection('subscriptions')
    .doc(Buffer.from(subscription.endpoint).toString('base64url')).set(subscription);
}

export async function listSubscriptions(userUid = null) {
  if (isDemo) {
    return userUid
      ? memory.subscriptions.filter((item) => item.userUid === userUid)
      : memory.subscriptions;
  }
  if (userUid) {
    const snapshot = await db.collection('pushSubscriptions').doc(userUid).collection('subscriptions').get();
    return snapshot.docs.map((document) => document.data());
  }
  const snapshot = await db.collectionGroup('subscriptions').get();
  return snapshot.docs.map((document) => document.data());
}
