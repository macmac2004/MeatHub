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
  assert.deepEqual(await buyerProfile.json(), { role: 'buyer' });

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

  const product = await fetch(`${apiUrl}/api/products`, {
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
  assert.equal(product.status, 201);

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

  const sellerOrders = await fetch(`${apiUrl}/api/orders`, {
    headers: demoHeaders('seller-1', 'seller')
  });
  assert.equal(sellerOrders.status, 403);
});
