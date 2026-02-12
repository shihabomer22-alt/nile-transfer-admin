# Nile Transfer Admin (Internal System MVP)

A professional starter web app for internal money-transfer operations.

## What this system includes

- Client management with required fields:
  - Full name
  - **Full address**
  - Address
  - Email
  - Phone number
- Automatic client reference code generation (`NTC-0001`, ...)
- Transfer order workflow:
  - Select existing client to recover their data
  - Send/receive country for: USA, Egypt, Sudan, Canada, Gulf
  - Currency mapping: USD, EGP, SDG, CAD, AED
  - **Manual exchange rate entry per transfer**
  - Payment methods: Zelle, Cash App, Cash
  - **Receiver details**: name + choose phone number **or** bank account
  - **Proof of payment image upload**
  - Internal note field
  - Transfer amount and auto conversion preview
  - Payment methods: Zelle, Cash App, Cash
  - Proof of payment field
  - Internal note field
- Admin-managed exchange rates by direction (e.g. USD→EGP)
- Transaction status updates (Pending, Processing, Completed, Cancelled)
- Full transaction history inside each client profile
- Dashboard counters for quick operations view

## How to run

Because this is a static app, run it with a simple local server:
Because this is a static app, you can run it with any simple local server:

```bash
python3 -m http.server 4173
```

Then open: `http://localhost:4173`

## Usage flow (step by step)

1. Go to **Clients** and add a new client.
2. Go to **New Transfer** and:
   - pick the client
   - choose send/receive countries
   - enter send amount and **manual exchange rate**
   - add receiver details (name + choose phone or bank account)
   - upload proof-of-payment image
   - enter payment method + note
   - submit transfer
3. Go to **Dashboard** to update transaction status.
4. Go to **Clients → Profile** to review full history of that client.

## Launch from any device (internet)

You can publish this static app on Netlify/Vercel/GitHub Pages quickly.

### Quick option: Netlify Drop
1. Open https://app.netlify.com/drop
2. Drag the whole project folder contents (`index.html`, `styles.css`, `app.js`, `assets/`)
3. Netlify gives you a public link to open from any device.

> Important: this MVP stores data in each browser's localStorage, so data is **not shared** between devices yet.

If you need shared data for your whole team from all devices, Phase 2 should add:
- backend API + database
- authentication and user roles
- secure file storage for uploaded proof images
1. Go to **Exchange Rates** and add rates for required directions.
2. Go to **Clients** and add a new client.
3. Go to **New Transfer** and:
   - pick the client
   - choose send/receive countries
   - enter amount and payment details
   - submit transfer
4. Go to **Dashboard** to update transaction status.
5. Go to **Clients → Profile** to review full history of that client.

## Current storage

Data is saved in browser `localStorage` for quick internal demo and MVP usage.

If you want, next step we can build **Phase 2** with:
- secure login
- SQL database
- multi-user roles (admin / operator)
- file uploads for payment proof
- printable receipts and reports
- backup/export to CSV/PDF
