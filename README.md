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

Set `DATA_MODE=firebase` and `FIREBASE_PROJECT_ID` in `.env`, then configure Firebase Admin Application Default Credentials. Do not commit service-account credentials. Create a Firestore database and enable Google sign-in in Firebase Authentication. Set the client-side Firebase values in `client/.env.local` using the `VITE_FIREBASE_*` names from `client/.env.example`.

In Firebase mode, API write requests require a Firebase ID token. Product and order data are stored in Firestore. Users can create listings and delivery orders after signing in.

For production builds, set `VITE_API_URL` in the client environment to the API's base URL (or serve the API behind the same-origin `/api` and `/ws` reverse-proxy routes). Configure `CLIENT_ORIGIN` on the API to match the browser origin.

## Included MVP behavior

- Browse, search, and filter active listings; featured items are highlighted.
- Place cash-on-delivery orders with a delivery address, date, and map-selected destination in the Philippines.
- Track order stages and the destination on a shareable tracking page.
- Share a per-order courier link to update delivery stages and stream device GPS while the courier page is open. Courier links are revocable by creating a replacement; share them only with the assigned courier.
- Sellers can add a listing; listings can be archived rather than deleted.
- Orders are created through the API and stock is checked/decremented.
- Reservations record an estimated platform commission (10% by default, configurable with `PLATFORM_COMMISSION_RATE`); the demo does not collect or transfer payment.
- A WebSocket chat room works while the API is running.
- The PWA caches the app shell and catalog response for offline browsing; queued delivery orders retry when connectivity returns.
- Browser notifications can be enabled locally. Web Push delivery requires VAPID keys and HTTPS (or localhost).
- Maps use OpenStreetMap tiles. Courier GPS requires location permission and a secure browser context (HTTPS or localhost); sharing stops when the courier page closes.

COD is recorded as paid only when a courier marks a delivery complete and confirms cash collection. The demo does not process electronic payments or commission transfers. Tracking and courier links are bearer links that grant access to delivery details; keep them private. Do not use demo mode for real customer data or transactions.
