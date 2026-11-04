# MeatHub

MeatHub is a React + Node.js marketplace MVP for local meat producers. It includes a product catalog, seller listings, pickup reservations, a realtime chat room, installable PWA support, and a Firebase-ready API.

## Run locally

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
4. Run `npm run dev`, then open `http://localhost:5173`.

The default `DATA_MODE=demo` runs with sample products and an in-memory database. Demo data resets when the API restarts. It is not suitable for deployment.

## Firebase

Set `DATA_MODE=firebase` and `FIREBASE_PROJECT_ID` in `.env`, then configure Firebase Admin Application Default Credentials. Do not commit service-account credentials. Create a Firestore database and enable Google sign-in in Firebase Authentication. Set the client-side Firebase values in `client/.env.local` using the `VITE_FIREBASE_*` names from `client/.env.example`.

In Firebase mode, API write requests require a Firebase ID token. Product and order data are stored in Firestore. Users can create listings and reservations after signing in.

For production builds, set `VITE_API_URL` in the client environment to the API's base URL (or serve the API behind the same-origin `/api` and `/ws` reverse-proxy routes). Configure `CLIENT_ORIGIN` on the API to match the browser origin.

## Included MVP behavior

- Browse, search, and filter active listings; featured items are highlighted.
- Add products to a cart and reserve a pickup date.
- Sellers can add a listing; listings can be archived rather than deleted.
- Orders are created through the API and stock is checked/decremented.
- Reservations record an estimated platform commission (10% by default, configurable with `PLATFORM_COMMISSION_RATE`); the demo does not collect or transfer payment.
- A WebSocket chat room works while the API is running.
- The PWA caches the app shell and catalog response for offline browsing; queued reservations retry when connectivity returns.
- Browser notifications can be enabled locally. Web Push delivery requires VAPID keys and HTTPS (or localhost).

Payments and commission transfers are intentionally not processed in this MVP. Do not use demo mode for real customer data or transactions.
