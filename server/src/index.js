import './env.js';
import cors from 'cors';
import express from 'express';
import webpush from 'web-push';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAuth } from 'firebase-admin/auth';
import { WebSocketServer } from 'ws';
import {
  archiveOrder,
  archiveProduct,
  createCourierLink,
  createOrder,
  createProduct,
  demoMode,
  getAccountRole,
  getCourierOrder,
  getTrackedOrder,
  listOrders,
  listProducts,
  listSubscriptions,
  registerAccountRole,
  saveSubscription,
  updateCourierLocation,
  updateCourierStatus,
  updateProduct
} from './store.js';
import { isPhilippinesLocation, isValidDeliveryDate } from './delivery.js';
import { isValidProductImage, MAX_PRODUCT_IMAGE_BYTES } from './productImage.js';
import { uploadProductImage } from './cloudinary.js';

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT || 4000);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const clientDistPath = fileURLToPath(new URL('../../client/dist', import.meta.url));
const hasPushKeys = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

app.set('trust proxy', 1);
app.disable('x-powered-by');

if (hasPushKeys) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

app.use(cors({ origin: clientOrigin }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  next();
});
app.use(express.json({ limit: '1mb' }));

const writeRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests. Please slow down and try again shortly.'
});
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return writeRateLimiter(req, res, next);
});

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) {
      if (entry.start < cutoff) hits.delete(key);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

async function authenticate(req, res, next) {
  if (demoMode) {
    const uid = req.get('x-demo-user-id')?.trim();
    const role = req.get('x-demo-user-role');
    if (!uid || uid.length > 120 || !['buyer', 'seller'].includes(role)) {
      return res.status(401).json({ error: 'Sign in is required.' });
    }
    req.user = { uid, role };
    return next();
  }
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in is required.' });
  try {
    req.user = await getAuth().verifyIdToken(token);
    next();
  } catch (error) {
    console.error('Firebase token verification failed:', error.message);
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

function requireRole(role) {
  return async (req, res, next) => {
    try {
      const accountRole = demoMode ? req.user.role : await getAccountRole(req.user.uid);
      if (accountRole !== role) {
        return res.status(403).json({ error: `A ${role} account is required for this action.` });
      }
      req.user.role = accountRole;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function validateProduct(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Please provide valid listing details.';
  const required = ['name', 'farm', 'category', 'location', 'description', 'unit'];
  if (required.some((key) => typeof body[key] !== 'string' || !body[key].trim())) return 'Please complete all listing details.';
  if (!['Beef', 'Pork', 'Chicken', 'Lamb'].includes(body.category)) return 'Choose a supported meat category.';
  if (required.some((key) => body[key].length > 500)) return 'Listing details must be 500 characters or fewer.';
  if (!Number.isFinite(body.price) || body.price <= 0) return 'Price must be greater than zero.';
  if (!Number.isInteger(body.stock) || body.stock < 1) return 'Stock must be a whole number greater than zero.';
  if (body.unit.length > 40) return 'Unit must be 40 characters or fewer.';
  if (body.image !== undefined && (typeof body.image !== 'string' || body.image.length > 2000)) return 'Photo URL is invalid.';
  return null;
}

function productFields(body) {
  return {
    name: body.name.trim(),
    farm: body.farm.trim(),
    category: body.category,
    price: body.price,
    unit: body.unit.trim(),
    stock: body.stock,
    location: body.location.trim(),
    description: body.description.trim(),
    image: body.image || ''
  };
}

function missingDeliveryLinkMessage(label) {
  const reason = demoMode
    ? 'It may belong to another API instance or to an order created before local persistence was enabled; place a new order for a fresh link.'
    : 'Check that you are using a link from the correct application environment.';
  return `${label} was not found. ${reason}`;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: demoMode ? 'demo' : 'firebase', pushEnabled: hasPushKeys });
});

app.get('/api/profile', authenticate, async (req, res, next) => {
  try {
    const role = demoMode ? req.user.role : await getAccountRole(req.user.uid);
    res.json({ role });
  } catch (error) {
    next(error);
  }
});

app.post('/api/profile/role', authenticate, async (req, res, next) => {
  const { role } = req.body || {};
  if (role !== 'buyer' && role !== 'seller') {
    return res.status(400).json({ error: 'Choose buyer or seller as your account type.' });
  }
  if (demoMode) {
    if (req.user.role !== role) {
      return res.status(409).json({ error: 'The selected account type does not match your demo account.' });
    }
    return res.json({ role });
  }
  try {
    res.json({ role: await registerAccountRole(req.user.uid, role) });
  } catch (error) {
    if (error.message.startsWith('Account role cannot be changed')) {
      return res.status(409).json({ error: error.message });
    }
    return next(error);
  }
});

app.get('/api/products', async (_req, res, next) => {
  try {
    res.json(await listProducts());
  } catch (error) {
    next(error);
  }
});

app.get('/api/products/mine', authenticate, requireRole('seller'), async (req, res, next) => {
  try {
    res.json(await listProducts(req.user.uid));
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/uploads/product-image',
  authenticate,
  requireRole('seller'),
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: MAX_PRODUCT_IMAGE_BYTES
  }),
  async (req, res, next) => {
    if (!process.env.CLOUDINARY_CLOUD_NAME?.trim() ||
        !process.env.CLOUDINARY_API_KEY?.trim() ||
        !process.env.CLOUDINARY_API_SECRET?.trim()) {
      return res.status(503).json({ error: 'Cloudinary image uploads are not configured on this server.' });
    }
    const contentType = req.get('content-type')?.split(';')[0].trim();
    if (!isValidProductImage(req.body, contentType)) {
      return res.status(400).json({ error: 'Choose a valid JPEG, PNG, or WebP image up to 5 MB.' });
    }
    try {
      res.status(201).json(await uploadProductImage(req.body, contentType, req.user.uid));
    } catch (error) {
      if (error.statusCode === 502) {
        console.error('Cloudinary product photo upload failed:', error.message);
        return res.status(502).json({ error: error.message });
      }
      next(error);
    }
  }
);

app.post('/api/products', authenticate, requireRole('seller'), async (req, res, next) => {
  const invalid = validateProduct(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    res.status(201).json(await createProduct(productFields(req.body), req.user.uid));
  } catch (error) {
    next(error);
  }
});

app.patch('/api/products/:id', authenticate, requireRole('seller'), async (req, res, next) => {
  const invalid = validateProduct(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const product = await updateProduct(req.params.id, productFields(req.body), req.user.uid);
    if (!product) return res.status(404).json({ error: 'Listing not found.' });
    res.json(product);
  } catch (error) {
    if (error.message.startsWith('You can only')) return res.status(403).json({ error: error.message });
    next(error);
  }
});

app.post('/api/products/:id/archive', authenticate, requireRole('seller'), async (req, res, next) => {
  try {
    const archived = await archiveProduct(req.params.id, req.user.uid);
    if (!archived) return res.status(404).json({ error: 'Listing not found.' });
    res.status(204).end();
  } catch (error) {
    if (error.message.startsWith('You can only')) return res.status(403).json({ error: error.message });
    next(error);
  }
});

app.get('/api/orders', authenticate, requireRole('buyer'), async (req, res, next) => {
  try {
    res.json(await listOrders(req.user.uid));
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', authenticate, requireRole('buyer'), async (req, res, next) => {
  const { items, deliveryDate, deliveryAddress, deliveryLocation, paymentMethod } = req.body || {};
  if (!Array.isArray(items) || items.length === 0 ||
      items.some((item) => !item || typeof item.productId !== 'string' || !item.productId.trim() || !Number.isInteger(item.quantity) || item.quantity < 1) ||
      new Set(items.map((item) => item.productId)).size !== items.length) {
    return res.status(400).json({ error: 'Add at least one valid item to your delivery order.' });
  }
  if (!isValidDeliveryDate(deliveryDate)) {
    return res.status(400).json({ error: 'Choose a valid delivery date that is today or later.' });
  }
  if (typeof deliveryAddress !== 'string' || !deliveryAddress.trim() || deliveryAddress.trim().length > 500) {
    return res.status(400).json({ error: 'Enter a delivery address (500 characters or fewer).' });
  }
  if (!isPhilippinesLocation(deliveryLocation)) {
    return res.status(400).json({ error: 'Choose a delivery pin within the Philippines map area.' });
  }
  if (paymentMethod !== 'cod') {
    return res.status(400).json({ error: 'Cash on delivery is the only supported payment method.' });
  }
  try {
    const order = await createOrder(items, {
      deliveryDate,
      deliveryAddress: deliveryAddress.trim(),
      deliveryLocation: { lat: deliveryLocation.lat, lng: deliveryLocation.lng }
    }, req.user.uid);
    sendPushToSubscribers({ title: 'MeatHub COD delivery', body: 'A new cash-on-delivery order was placed.' })
      .catch((error) => console.error('Could not send delivery notifications:', error));
    res.status(201).json(order);
  } catch (error) {
    if (error.message.includes('not available') || error.message.includes('enough stock')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

app.get('/api/tracking/:trackingToken', async (req, res, next) => {
  try {
    const order = await getTrackedOrder(req.params.trackingToken);
    if (!order) return res.status(404).json({ error: missingDeliveryLinkMessage('Delivery tracking link') });
    res.json(order);
  } catch (error) {
    next(error);
  }
});

app.get('/api/courier/:courierToken', async (req, res, next) => {
  try {
    const order = await getCourierOrder(req.params.courierToken);
    if (!order) return res.status(404).json({ error: missingDeliveryLinkMessage('Courier link') });
    res.json(order);
  } catch (error) {
    next(error);
  }
});

app.post('/api/courier/:courierToken/location', async (req, res, next) => {
  const { lat, lng } = req.body || {};
  const location = { lat, lng };
  if (!isPhilippinesLocation(location)) {
    return res.status(400).json({ error: 'Courier GPS must be within the Philippines map area.' });
  }
  try {
    const order = await updateCourierLocation(req.params.courierToken, location);
    if (!order) return res.status(404).json({ error: 'Courier link was not found.' });
    res.json(order);
  } catch (error) {
    if (error.message.startsWith('Live location sharing')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

app.patch('/api/courier/:courierToken/status', async (req, res, next) => {
  const { status, cashCollected = false } = req.body || {};
  if (!['preparing', 'out_for_delivery', 'delivered'].includes(status) || typeof cashCollected !== 'boolean') {
    return res.status(400).json({ error: 'Choose a valid delivery status.' });
  }
  try {
    const order = await updateCourierStatus(req.params.courierToken, status, cashCollected);
    if (!order) return res.status(404).json({ error: 'Courier link was not found.' });
    res.json(order);
  } catch (error) {
    if (error.message.startsWith('Invalid delivery status') || error.message.startsWith('Collect the cash')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

app.post('/api/orders/:id/courier-link', authenticate, requireRole('buyer'), async (req, res, next) => {
  try {
    const link = await createCourierLink(req.params.id, req.user.uid);
    if (!link) return res.status(404).json({ error: 'Active delivery order was not found.' });
    res.json(link);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/:id/archive', authenticate, requireRole('buyer'), async (req, res, next) => {
  try {
    const archived = await archiveOrder(req.params.id, req.user.uid);
    if (!archived) return res.status(404).json({ error: 'Delivery order was not found or can no longer be cancelled.' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/push/subscribe', authenticate, requireRole('buyer'), async (req, res, next) => {
  if (!hasPushKeys) return res.status(503).json({ error: 'Web Push is not configured on this server.' });
  if (!req.body?.endpoint || !req.body?.keys?.p256dh || !req.body?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription.' });
  }
  try {
    await saveSubscription(req.body, req.user.uid);
    res.status(201).json({ subscribed: true });
  } catch (error) {
    next(error);
  }
});

async function sendPushToSubscribers(payload) {
  if (!hasPushKeys) return;
  const subscriptions = await listSubscriptions();
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      if (error.statusCode !== 404 && error.statusCode !== 410) {
        console.error('Could not send push notification:', error.message);
      }
    }
  }));
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

if (existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath, {
    index: false,
    setHeaders: (response, filePath) => {
      response.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(filePath)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    }
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: clientDistPath }, (error) => (error ? next(error) : undefined));
  });
}

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Product photos must be 5 MB or smaller.' });
  }
  if (error.statusCode === 502) {
    return res.status(502).json({ error: error.message });
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const websocketServer = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

async function authorizeSocket(socket, request) {
  if (demoMode) {
    socket.user = { uid: 'demo-customer' };
    return true;
  }
  const token = new URL(request.url || '/ws', 'http://localhost').searchParams.get('token');
  if (!token) {
    socket.close(4401, 'Sign in is required.');
    return false;
  }
  try {
    socket.user = await getAuth().verifyIdToken(token);
    return true;
  } catch (error) {
    console.warn('Chat token verification failed:', error.message);
    socket.close(4401, 'Your session expired. Please sign in again.');
    return false;
  }
}

websocketServer.on('connection', async (socket, request) => {
  if (!(await authorizeSocket(socket, request))) return;
  if (socket.readyState !== 1) return;

  socket.send(JSON.stringify({
    type: 'system',
    id: randomUUID(),
    text: 'You are connected to the MeatHub community chat.'
  }));

  const recentMessages = [];
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: 'error', text: 'Message must be valid JSON.' }));
      return;
    }
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 500) return;

    const now = Date.now();
    while (recentMessages.length && now - recentMessages[0] > 5000) recentMessages.shift();
    if (recentMessages.length >= 5) {
      socket.send(JSON.stringify({ type: 'error', text: 'You are sending messages too quickly. Please wait a moment.' }));
      return;
    }
    recentMessages.push(now);

    const senderName = typeof socket.user?.name === 'string' && socket.user.name.trim()
      ? socket.user.name
      : typeof message.name === 'string' ? message.name : 'MeatHub member';
    const event = JSON.stringify({
      type: 'message',
      id: randomUUID(),
      name: senderName.slice(0, 40),
      text: message.text.trim(),
      sentAt: new Date().toISOString()
    });
    for (const client of websocketServer.clients) {
      if (client.readyState === 1) client.send(event);
    }
  });
});

server.listen(port, () => {
  console.log(`MeatHub API listening at http://localhost:${port}`);
});
