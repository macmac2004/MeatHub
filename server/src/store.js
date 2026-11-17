import { randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const memory = {
  products: sampleProducts.map((product) => ({ ...product, ownerUid: 'demo-seller' })),
  orders: [],
  subscriptions: []
};

const isDemo = process.env.DATA_MODE === 'demo' ||
  (!process.env.DATA_MODE && process.env.NODE_ENV !== 'production');

if (isDemo) {
  console.warn('MeatHub is using its in-memory demo store. Data is not persistent.');
}

let db;
if (!isDemo) {
  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is required when DATA_MODE=firebase.');
  }
  const app = getApps()[0] || initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  db = getFirestore(app);
}

export const demoMode = isDemo;

export async function listProducts() {
  if (isDemo) return memory.products.filter((product) => !product.archived);
  const snapshot = await db.collection('products').where('archived', '==', false).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export async function createProduct(product, ownerUid) {
  const data = { ...product, ownerUid, featured: false, archived: false, createdAt: new Date().toISOString() };
  if (isDemo) {
    const saved = { id: randomUUID(), ...data };
    memory.products.unshift(saved);
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

export async function createOrder(items, pickupDate, customerUid) {
  if (isDemo) {
    const lines = items.map(({ productId, quantity }) => {
      const product = memory.products.find((item) => item.id === productId && !item.archived);
      if (!product) throw new Error(`Product ${productId} is no longer available.`);
      if (product.stock < quantity) throw new Error(`${product.name} does not have enough stock.`);
      return { productId, quantity, name: product.name, unitPrice: product.price };
    });
    lines.forEach((line) => {
      memory.products.find((product) => product.id === line.productId).stock -= line.quantity;
    });
    const order = {
      id: randomUUID(),
      items: lines,
      pickupDate,
      customerUid,
      total: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
      status: 'reserved',
      createdAt: new Date().toISOString(),
      archived: false
    };
    Object.assign(order, commissionFields(order.total));
    memory.orders.unshift(order);
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
      return { productId, quantity, name: product.name, unitPrice: product.price, ref: snapshot.ref, stock: product.stock };
    });
    lines.forEach((line) => transaction.update(line.ref, { stock: line.stock - line.quantity }));
    const order = {
      items: lines.map(({ productId, quantity, name, unitPrice }) => ({ productId, quantity, name, unitPrice })),
      pickupDate,
      customerUid,
      total: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
      status: 'reserved',
      createdAt: new Date().toISOString(),
      archived: false
    };
    Object.assign(order, commissionFields(order.total));
    transaction.set(orderRef, order);
    return { id: orderRef.id, ...order };
  });
}

export async function listOrders(customerUid) {
  if (isDemo) return memory.orders.filter((order) => order.customerUid === customerUid && !order.archived);
  const snapshot = await db.collection('orders')
    .where('customerUid', '==', customerUid)
    .where('archived', '==', false)
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export async function archiveOrder(id, customerUid) {
  if (isDemo) {
    const order = memory.orders.find((item) => item.id === id && item.customerUid === customerUid);
    if (!order || order.archived || order.status !== 'reserved') return false;
    order.items.forEach((line) => {
      const product = memory.products.find((item) => item.id === line.productId);
      if (product) product.stock += line.quantity;
    });
    order.archived = true;
    order.status = 'cancelled';
    return true;
  }
  const document = db.collection('orders').doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists || snapshot.data().customerUid !== customerUid ||
        snapshot.data().archived || snapshot.data().status !== 'reserved') return false;
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

export async function listSubscriptions() {
  if (isDemo) return memory.subscriptions;
  const snapshot = await db.collectionGroup('subscriptions').get();
  return snapshot.docs.map((document) => document.data());
}
