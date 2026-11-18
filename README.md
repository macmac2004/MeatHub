# MeatHub

MeatHub is a React + Node.js marketplace MVP for local meat producers. It includes a product catalog, seller listings, cash-on-delivery orders, Philippines-bounded delivery maps, courier GPS tracking, a realtime chat room, installable PWA support, and a Firebase-ready API.

## Run locally

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
4. Run `npm run dev`, then open `http://localhost:5173`.
5. Run `npm test` to check the delivery validation and tracking lifecycle.

The default `DATA_MODE=demo` runs with sample products and a local JSON store at `server/data/demo-store.json`, so demo orders and listings survive API restarts. This file is ignored by Git and is not suitable for production; use Firebase mode for persistent deployment storage.

## Firebase

1. In the [Firebase Console](https://console.firebase.google.com/), create a project and add a **Web app**. Copy its web-app config into `client/.env.local` using the `VITE_FIREBASE_*` names from `client/.env.example`. `VITE_API_URL` should be `http://localhost:4000` for local development.
2. In **Authentication → Sign-in method**, enable **Google** and add `localhost` under **Authentication → Settings → Authorized domains** if it is not already listed.
3. In **Firestore Database**, create a database. The API uses the `products`, `orders`, and `pushSubscriptions` collections. Deploy the included indexes and deny-by-default client rules using the Firebase CLI: `npx firebase-tools login`, `npx firebase-tools use --add`, then `npx firebase-tools deploy --only firestore:rules,firestore:indexes`.
4. Copy `.env.example` to `.env`, set `DATA_MODE=firebase` and `CLIENT_ORIGIN=http://localhost:5173`. For local Admin SDK access, either configure Application Default Credentials (`gcloud auth application-default login`) and set `FIREBASE_PROJECT_ID`, or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON path **outside this repository** (its `project_id` is used automatically). If Firestore is misconfigured, the API stops with an explicit error instead of silently falling back to the demo store.
5. Restart `npm run dev`, reload the website, sign in with Google, then create a test listing. The Firebase catalog starts empty; demo products are only used in demo mode.

The backend verifies Firebase ID tokens and uses the Admin SDK, which bypasses Firestore Security Rules. The web client does not access Firestore directly, so the included rules deny all client SDK access. Never put Admin credentials in `client/.env.local`, commit a service-account key, or share that key. The web-app API key/config is intended for client identification; secure data access is enforced by backend authentication and Firestore rules.

In Firebase mode, API write requests require a Firebase ID token. Product, order, and account-role data are stored in Firestore. Users can create listings and delivery orders after signing in. The included composite indexes support each customer's non-archived orders and each seller's active listings.

New accounts choose either buyer or seller. Buyers get the marketplace and delivery features; sellers get a dashboard limited to their own listings. In Firebase mode, the API stores the account role in Firestore and enforces role-specific actions. Demo mode stores accounts locally and is not suitable for real users or production.

For production builds, set `VITE_API_URL` in the client environment to the API's base URL (or serve the API behind the same-origin `/api` and `/ws` reverse-proxy routes). Configure `CLIENT_ORIGIN` on the API to match the browser origin.

## Deploy

1. Build the client with production values: `npm run build`. Vite bakes `VITE_*` variables in at build time, so set `VITE_FIREBASE_*` and `VITE_VAPID_PUBLIC_KEY` (and `VITE_API_URL` only if the API is on a different origin) before this step.
2. Start the API with `NODE_ENV=production npm start`. When `client/dist` exists, Express serves it with SPA fallbacks for `/login`, `/signup`, `/track/...`, and `/courier/...`, and returns JSON 404s for unknown `/api` routes.
3. Configure the server environment: `PORT`, `CLIENT_ORIGIN=https://your-domain`, `DATA_MODE=firebase`, `FIREBASE_PROJECT_ID` (or `GOOGLE_APPLICATION_CREDENTIALS`), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Use fresh VAPID keys for production; the local pair is for localhost only.
4. Terminate TLS at the host or reverse proxy and forward both HTTP and WebSocket upgrades (`/ws`) to the API. Push, geolocation, and a secure chat connection require HTTPS/WSS. The API already trusts the first proxy hop for client IPs.
5. In Firebase, add the production domain under **Authentication → Settings → Authorized domains**, enable **Email/Password** (and Google if used), and deploy the Firestore rules and indexes. Firestore starts empty; seed real listings instead of relying on demo products.
6. Serve the PWA over HTTPS so the service worker can register. On iOS, users must add the app to the Home Screen before web push works.

Rate limits are in-memory per API instance, and the chat relay is in-memory: messages are lost on restart and are not shared across multiple instances. Run a single API instance for chat, or move chat and rate limiting to a shared store before scaling horizontally. Add external monitoring for production, since the app only logs to the console.

## Included MVP behavior

- Browse, search, and filter active listings; featured items are highlighted.
- Place cash-on-delivery orders with a delivery address, date, and map-selected destination in the Philippines.
- Track order stages and the destination on a shareable tracking page.
- Share a per-order courier link to update delivery stages and stream device GPS while the courier page is open. Courier links are revocable by creating a replacement; share them only with the assigned courier.
- Sellers have a dashboard for their active listings and stock, and can add, edit, or archive their products. Buyers see the marketplace and their deliveries instead.
- Orders are created through the API and stock is checked/decremented.
- Reservations record an estimated platform commission (10% by default, configurable with `PLATFORM_COMMISSION_RATE`); the demo does not collect or transfer payment.
- A WebSocket chat room works while the API is running.
- The PWA caches the app shell and catalog response for offline browsing. Offline delivery orders are kept in IndexedDB, and the service worker posts them when the device is back online, even if the app is closed; it skips records an open tab is already syncing.
- Browser notifications can be enabled locally. Web Push delivery requires `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` on the server, `VITE_VAPID_PUBLIC_KEY` in `client/.env.local`, a signed-in user, HTTPS (or localhost), and the browser's notification permission. Generate a key pair with `npx web-push generate-vapid-keys`.
- Maps use OpenStreetMap tiles. Courier GPS requires location permission and a secure browser context (HTTPS or localhost); sharing stops when the courier page closes.

COD is recorded as paid only when a courier marks a delivery complete and confirms cash collection. The demo does not process electronic payments or commission transfers. Tracking and courier links are bearer links that grant access to delivery details; keep them private. Do not use demo mode for real customer data or transactions.
