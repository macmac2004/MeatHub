import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const demoStorePath = join(tmpdir(), `meathub-roles-${randomUUID()}.json`);
const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
let serverProcess;
let apiUrl;

async function findAvailablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error('The role test API exited before becoming ready.');
    try {
      const response = await fetch(`${apiUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('The role test API did not become ready.');
}

function demoHeaders(uid, role) {
  return {
    'Content-Type': 'application/json',
    'X-Demo-User-Id': uid,
    'X-Demo-User-Role': role
  };
}

before(async () => {
  const port = await findAvailablePort();
  apiUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDirectory,
    env: {
      ...process.env,
      DATA_MODE: 'demo',
      NODE_ENV: 'test',
      PORT: String(port),
      MEATHUB_ADMIN_UIDS: 'admin-1',
      MEATHUB_DEMO_STORE_PATH: demoStorePath
    },
    stdio: 'ignore'
  });
  await waitForApi();
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await once(serverProcess, 'exit');
  }
  rmSync(demoStorePath, { force: true });
});

test('seller and buyer accounts are limited to their respective API actions', async () => {
  const missingIdentity = await fetch(`${apiUrl}/api/profile`);
  assert.equal(missingIdentity.status, 401);

  const buyerProfile = await fetch(`${apiUrl}/api/profile`, {
    headers: demoHeaders('buyer-1', 'buyer')
  });
  assert.deepEqual(await buyerProfile.json(), { role: 'buyer', isAdmin: false });

  const adminProfile = await fetch(`${apiUrl}/api/profile`, {
    headers: demoHeaders('admin-1', 'buyer')
  });
  assert.deepEqual(await adminProfile.json(), { role: 'buyer', isAdmin: true });

  const buyerListings = await fetch(`${apiUrl}/api/products/mine`, {
    headers: demoHeaders('buyer-1', 'buyer')
  });
  assert.equal(buyerListings.status, 403);

  const blockedListing = await fetch(`${apiUrl}/api/products`, {
    method: 'POST',
    headers: demoHeaders('buyer-1', 'buyer'),
    body: JSON.stringify({ name: 'Buyer listing' })
  });
  assert.equal(blockedListing.status, 403);

  const productResponse = await fetch(`${apiUrl}/api/products`, {
    method: 'POST',
    headers: demoHeaders('seller-1', 'seller'),
    body: JSON.stringify({
      name: 'Local beef',
      farm: 'Test farm',
      category: 'Beef',
      price: 250,
      unit: '500g',
      stock: 3,
      location: 'Silang, Cavite',
      description: 'Small-batch beef',
      image: ''
    })
  });
  assert.equal(productResponse.status, 201);
  const product = await productResponse.json();

  const sellerListings = await fetch(`${apiUrl}/api/products/mine`, {
    headers: demoHeaders('seller-1', 'seller')
  });
  const listings = await sellerListings.json();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].ownerUid, 'seller-1');

  const otherSellerListings = await fetch(`${apiUrl}/api/products/mine`, {
    headers: demoHeaders('seller-2', 'seller')
  });
  assert.deepEqual(await otherSellerListings.json(), []);

  const secondProductResponse = await fetch(`${apiUrl}/api/products`, {
    method: 'POST',
    headers: demoHeaders('seller-2', 'seller'),
    body: JSON.stringify({
      name: 'Local pork',
      farm: 'Second test farm',
      category: 'Pork',
      price: 100,
      unit: '500g',
      stock: 3,
      location: 'Silang, Cavite',
      description: 'Small-batch pork',
      image: ''
    })
  });
  assert.equal(secondProductResponse.status, 201);
  const secondProduct = await secondProductResponse.json();

  const sellerOrders = await fetch(`${apiUrl}/api/orders`, {
    headers: demoHeaders('seller-1', 'seller')
  });
  assert.equal(sellerOrders.status, 403);

  const buyerEarnings = await fetch(`${apiUrl}/api/seller/earnings`, {
    headers: demoHeaders('buyer-1', 'buyer')
  });
  assert.equal(buyerEarnings.status, 403);

  const sellerPayouts = await fetch(`${apiUrl}/api/admin/payouts`, {
    headers: demoHeaders('seller-1', 'seller')
  });
  assert.equal(sellerPayouts.status, 403);

  const emptyAdminPayouts = await fetch(`${apiUrl}/api/admin/payouts`, {
    headers: demoHeaders('admin-1', 'buyer')
  });
  assert.deepEqual(await emptyAdminPayouts.json(), []);

  const now = new Date();
  const deliveryDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  const orderResponse = await fetch(`${apiUrl}/api/orders`, {
    method: 'POST',
    headers: demoHeaders('buyer-1', 'buyer'),
    body: JSON.stringify({
      items: [
        { productId: product.id, quantity: 1 },
        { productId: secondProduct.id, quantity: 2 }
      ],
      deliveryDate,
      deliveryAddress: '123 Test Street, Quezon City',
      deliveryLocation: { lat: 14.5995, lng: 120.9842 },
      customerName: 'Test Buyer',
      customerPhone: '09171234567',
      paymentMethod: 'cod'
    })
  });
  assert.equal(orderResponse.status, 201);
  const order = await orderResponse.json();
  assert.ok(order.courierToken);
  assert.equal(order.sellerEarnings, undefined);
  assert.equal(order.status, 'pending_seller');

  const sellerEarningsResponse = await fetch(`${apiUrl}/api/seller/earnings`, {
    headers: demoHeaders('seller-1', 'seller')
  });
  const sellerEarnings = await sellerEarningsResponse.json();
  assert.equal(sellerEarnings.length, 1);
  assert.equal(sellerEarnings[0].grossAmount, 250);
  assert.equal(sellerEarnings[0].commissionAmount, 25);
  assert.equal(sellerEarnings[0].sellerNet, 225);
  assert.equal(sellerEarnings[0].paymentStatus, 'pending');
  assert.equal(sellerEarnings[0].status, 'pending_seller');
  assert.equal(sellerEarnings[0].sellerConfirmation, 'pending');
  assert.equal(sellerEarnings[0].customerPhone, '09171234567');
  const secondSellerEarnings = await fetch(`${apiUrl}/api/seller/earnings`, {
    headers: demoHeaders('seller-2', 'seller')
  });
  const secondSellerOrders = await secondSellerEarnings.json();
  assert.equal(secondSellerOrders.length, 1);
  assert.equal(secondSellerOrders[0].grossAmount, 200);
  assert.equal(secondSellerOrders[0].sellerNet, 180);

  const riderProfile = await fetch(`${apiUrl}/api/profile`, {
    headers: demoHeaders('rider-1', 'rider')
  });
  assert.deepEqual(await riderProfile.json(), { role: 'rider', isAdmin: false });

  const buyerConfirmAttempt = await fetch(`${apiUrl}/api/seller/orders/${order.id}/confirm`, {
    method: 'POST',
    headers: demoHeaders('buyer-1', 'buyer')
  });
  assert.equal(buyerConfirmAttempt.status, 403);

  for (const sellerUid of ['seller-1', 'seller-2']) {
    const confirmation = await fetch(`${apiUrl}/api/seller/orders/${order.id}/confirm`, {
      method: 'POST',
      headers: demoHeaders(sellerUid, 'seller')
    });
    assert.equal(confirmation.status, 200);
  }

  const confirmedEarnings = await (await fetch(`${apiUrl}/api/seller/earnings`, {
    headers: demoHeaders('seller-1', 'seller')
  })).json();
  assert.equal(confirmedEarnings[0].status, 'confirmed');
  assert.equal(confirmedEarnings[0].sellerConfirmation, 'confirmed');

  const riderBoard = await (await fetch(`${apiUrl}/api/rider/orders`, {
    headers: demoHeaders('rider-1', 'rider')
  })).json();
  assert.equal(riderBoard.available.length, 1);
  const claimedDelivery = await fetch(`${apiUrl}/api/rider/orders/${order.id}/claim`, {
    method: 'POST',
    headers: demoHeaders('rider-1', 'rider')
  });
  assert.equal(claimedDelivery.status, 200);
  assert.equal((await claimedDelivery.json()).courierToken, order.courierToken);
  const secondClaim = await fetch(`${apiUrl}/api/rider/orders/${order.id}/claim`, {
    method: 'POST',
    headers: demoHeaders('rider-2', 'rider')
  });
  assert.equal(secondClaim.status, 409);
  const assignedBoard = await (await fetch(`${apiUrl}/api/rider/orders`, {
    headers: demoHeaders('rider-1', 'rider')
  })).json();
  assert.equal(assignedBoard.available.length, 0);
  assert.equal(assignedBoard.assigned.length, 1);

  const prematurePayout = await fetch(`${apiUrl}/api/admin/payouts/${order.id}`, {
    method: 'POST',
    headers: demoHeaders('admin-1', 'buyer'),
    body: JSON.stringify({ sellerUid: 'seller-1', reference: 'BANK-001' })
  });
  assert.equal(prematurePayout.status, 409);

  for (const status of ['preparing', 'out_for_delivery', 'delivered']) {
    const response = await fetch(`${apiUrl}/api/courier/${order.courierToken}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, cashCollected: status === 'delivered' })
    });
    assert.equal(response.status, 200);
  }

  const readyPayouts = await fetch(`${apiUrl}/api/admin/payouts`, {
    headers: demoHeaders('admin-1', 'buyer')
  });
  const readyPayoutList = await readyPayouts.json();
  assert.equal(readyPayoutList.length, 2);
  assert.ok(readyPayoutList.every((payout) => payout.payoutStatus === 'unpaid'));

  const recordedPayoutResponse = await fetch(`${apiUrl}/api/admin/payouts/${order.id}`, {
    method: 'POST',
    headers: demoHeaders('admin-1', 'buyer'),
    body: JSON.stringify({ sellerUid: 'seller-1', reference: 'BANK-001' })
  });
  assert.equal(recordedPayoutResponse.status, 200);
  assert.equal((await recordedPayoutResponse.json()).payoutStatus, 'paid');

  const secondRecordedPayout = await fetch(`${apiUrl}/api/admin/payouts/${order.id}`, {
    method: 'POST',
    headers: demoHeaders('admin-1', 'buyer'),
    body: JSON.stringify({ sellerUid: 'seller-2', reference: 'EWALLET-002' })
  });
  assert.equal(secondRecordedPayout.status, 200);

  const duplicatePayout = await fetch(`${apiUrl}/api/admin/payouts/${order.id}`, {
    method: 'POST',
    headers: demoHeaders('admin-1', 'buyer'),
    body: JSON.stringify({ sellerUid: 'seller-1', reference: 'BANK-001' })
  });
  assert.equal(duplicatePayout.status, 409);

  const updatedSellerEarnings = await fetch(`${apiUrl}/api/seller/earnings`, {
    headers: demoHeaders('seller-1', 'seller')
  });
  const updatedEarnings = await updatedSellerEarnings.json();
  assert.equal(updatedEarnings[0].paymentStatus, 'paid');
  assert.equal(updatedEarnings[0].payoutStatus, 'paid');
  assert.equal(updatedEarnings[0].payoutReference, 'BANK-001');

  const updatedSecondSellerEarnings = await fetch(`${apiUrl}/api/seller/earnings`, {
    headers: demoHeaders('seller-2', 'seller')
  });
  const finalSecondSellerEarnings = await updatedSecondSellerEarnings.json();
  assert.equal(finalSecondSellerEarnings[0].payoutStatus, 'paid');
  assert.equal(finalSecondSellerEarnings[0].payoutReference, 'EWALLET-002');

  const stockBeforeDecline = (await (await fetch(`${apiUrl}/api/products`)).json())
    .find((item) => item.id === product.id).stock;
  const declinedOrderResponse = await fetch(`${apiUrl}/api/orders`, {
    method: 'POST',
    headers: demoHeaders('buyer-1', 'buyer'),
    body: JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
      deliveryDate,
      deliveryAddress: '456 Test Street, Quezon City',
      deliveryLocation: { lat: 14.5995, lng: 120.9842 },
      customerName: 'Test Buyer',
      customerPhone: '09171234567',
      paymentMethod: 'cod'
    })
  });
  assert.equal(declinedOrderResponse.status, 201);
  const declinedOrder = await declinedOrderResponse.json();
  const declineResponse = await fetch(`${apiUrl}/api/seller/orders/${declinedOrder.id}/decline`, {
    method: 'POST',
    headers: demoHeaders('seller-1', 'seller')
  });
  assert.equal(declineResponse.status, 200);
  assert.equal((await declineResponse.json()).status, 'cancelled');
  const stockAfterDecline = (await (await fetch(`${apiUrl}/api/products`)).json())
    .find((item) => item.id === product.id).stock;
  assert.equal(stockAfterDecline, stockBeforeDecline);

  const missingContact = await fetch(`${apiUrl}/api/orders`, {
    method: 'POST',
    headers: demoHeaders('buyer-1', 'buyer'),
    body: JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
      deliveryDate,
      deliveryAddress: '456 Test Street, Quezon City',
      deliveryLocation: { lat: 14.5995, lng: 120.9842 },
      paymentMethod: 'cod'
    })
  });
  assert.equal(missingContact.status, 400);
});
