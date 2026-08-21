# FraudGuard — Frontend (Part 1 of 4)

React + Vite console for the POS fraud detection pipeline.

## Run it

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to `http://localhost:5000`, so the Express
backend (Part 2) can run alongside with no CORS setup.

## What each screen does

| Route | Purpose |
| --- | --- |
| `/login` | JWT sign-in; token stored in `localStorage`, attached by an axios interceptor |
| `/` | 24-hour stats, hourly score chart, live socket feed of scored authorisations |
| `/transactions` | Paginated, filterable ledger of every scored transaction |
| `/transactions/:id` | The full decision record — authorisation strip, fusion maths, rules fired, SHAP tape |
| `/alerts` | Review queue; confirming or dismissing an alert is the label the model retrains on |
| `/rules` | Live threshold and weight editing for the rule engine |
| `/simulator` | Push a synthetic transaction through the pipeline without writing to the ledger |

## API contract the backend must satisfy

```
POST   /api/auth/login          -> { token, user }
GET    /api/auth/me             -> user
GET    /api/transactions        ?q&band&page&limit  -> { items, page, pages, total }
GET    /api/transactions/:id    -> transaction (see src/mocks/sampleData.js)
POST   /api/transactions/score  -> scored result (same shape, not persisted)
GET    /api/transactions/stats  ?range -> { total, alerts, blockedValue, series[] }
GET    /api/alerts              ?status -> { items }
PATCH  /api/alerts/:id          { outcome, note } -> alert
GET    /api/rules               -> { items }
PATCH  /api/rules/:id           { threshold, weight, enabled } -> rule

socket.io event: "transaction:scored" -> transaction
```

`src/mocks/sampleData.js` is the canonical payload shape — build the Express
responses against it and the UI needs no changes.

## Design notes

- All numerics use IBM Plex Mono with tabular figures so score columns align.
- Rule engine is green, the model is violet, everywhere, without exception —
  the colour tells you which engine produced a number before you read the label.
- The **authorisation strip** is the signature component: one 0–100 scale
  carrying both engine scores and the fused needle, so a decision can be read
  in a glance rather than reconstructed from three separate charts.
