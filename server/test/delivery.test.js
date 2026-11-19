import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { canAdvanceDeliveryStatus, isPhilippinesLocation, isValidDeliveryDate } from '../src/delivery.js';

process.env.DATA_MODE = 'demo';
const demoStorePath = join(tmpdir(), `meathub-test-${randomUUID()}.json`);
process.env.MEATHUB_DEMO_STORE_PATH = demoStorePath;
const store = await import('../src/store.js');
after(() => rmSync(demoStorePath, { force: true }));

test('delivery inputs stay within the Philippines map and valid dates', () => {
  assert.equal(isPhilippinesLocation({ lat: 14.5995, lng: 120.9842 }), true);
  assert.equal(isPhilippinesLocation({ lat: 35.6762, lng: 139.6503 }), false);
  assert.equal(isPhilippinesLocation({ lat: '14.5', lng: 121 }), false);
  assert.equal(isValidDeliveryDate('2026-11-17', new Date(2026, 10, 17)), true);
  assert.equal(isValidDeliveryDate('2026-11-16', new Date(2026, 10, 17)), false);
  assert.equal(isValidDeliveryDate('2026-02-30', new Date(2026, 1, 1)), false);
});

test('COD delivery tracking requires ordered statuses and records collected payment', async () => {
  assert.equal(canAdvanceDeliveryStatus('confirmed', 'preparing'), true);
  assert.equal(canAdvanceDeliveryStatus('confirmed', 'delivered'), false);

  const deliveryDate = new Date();
  const date = [
    deliveryDate.getFullYear(),
    String(deliveryDate.getMonth() + 1).padStart(2, '0'),
    String(deliveryDate.getDate()).padStart(2, '0')
  ].join('-');
  const order = await store.createOrder([{ productId: 'farmstead-beef', quantity: 1 }], {
    deliveryDate: date,
    deliveryAddress: '123 Test Street, Quezon City',
    deliveryLocation: { lat: 14.5995, lng: 120.9842 },
    customerName: 'Test Buyer',
    customerPhone: '09171234567'
  }, 'delivery-test-customer');

  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.status, 'pending_seller');
  assert.deepEqual(order.sellerConfirmations, { 'demo-seller': 'pending' });
  assert.equal(order.customerPhone, '09171234567');
  assert.match(order.trackingToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(order.courierToken, /^[A-Za-z0-9_-]{43}$/);
  const restartedStore = await import(`../src/store.js?restart=${randomUUID()}`);
  assert.equal((await restartedStore.getTrackedOrder(order.trackingToken)).id, order.id);
  const originalCourierToken = order.courierToken;
  assert.equal((await store.listOrders('delivery-test-customer'))[0].courierToken, undefined);
  assert.equal((await store.getTrackedOrder(order.trackingToken)).deliveryAddress, order.deliveryAddress);
  assert.equal((await store.getTrackedOrder(order.trackingToken)).customerPhone, '09171234567');

  await assert.rejects(
    store.updateCourierStatus(order.courierToken, 'preparing', false),
    /Invalid delivery status/
  );
  const sellerOrder = await store.confirmSellerOrder(order.id, 'demo-seller');
  assert.equal(sellerOrder.sellerConfirmation, 'confirmed');
  assert.equal((await store.getTrackedOrder(order.trackingToken)).status, 'confirmed');

  const riderBoard = await store.listRiderOrders('rider-test');
  assert.equal(riderBoard.available.length, 1);
  const claim = await store.claimDelivery(order.id, 'rider-test', 'Test Rider');
  assert.equal(claim.courierToken, order.courierToken);
  const claimedBoard = await store.listRiderOrders('rider-test');
  assert.equal(claimedBoard.available.length, 0);
  assert.equal(claimedBoard.assigned.length, 1);

  const renewedLink = await store.createCourierLink(order.id, 'delivery-test-customer');
  assert.notEqual(renewedLink.courierToken, originalCourierToken);
  assert.equal(await store.getCourierOrder(originalCourierToken), null);

  await store.updateCourierStatus(renewedLink.courierToken, 'preparing', false);
  await store.updateCourierStatus(renewedLink.courierToken, 'out_for_delivery', false);
  await assert.rejects(
    store.updateCourierStatus(renewedLink.courierToken, 'delivered', false),
    /Collect the cash payment/
  );
  await assert.rejects(
    store.updateCourierLocation(renewedLink.courierToken, { lat: 35.6762, lng: 139.6503 }),
    /within the Philippines/
  );
  const updated = await store.updateCourierLocation(renewedLink.courierToken, {
    lat: 14.61,
    lng: 120.99
  });
  assert.equal(updated.courierLocation.lat, 14.61);
  assert.equal(updated.courierLocation.lng, 120.99);
  assert.ok(Date.parse(updated.courierLocation.updatedAt));
  const delivered = await store.updateCourierStatus(renewedLink.courierToken, 'delivered', true);
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.paymentStatus, 'paid');
  const reloadedStore = await import(`../src/store.js?reload=${randomUUID()}`);
  const reloadedOrder = await reloadedStore.getTrackedOrder(order.trackingToken);
  assert.equal(reloadedOrder.status, 'delivered');
  assert.equal(reloadedOrder.paymentStatus, 'paid');
  assert.equal(reloadedOrder.courierLocation.lng, 120.99);
});
