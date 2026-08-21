# FraudGuard — Backend (Part 2 of 4)

Express + MongoDB API for the POS fraud detection pipeline. Sits in `backend/`,
beside `frontend/`.

## Setup

```bash
cd backend
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
npm run seed                # creates users, rules, 400 scored transactions
npm run dev                 # http://localhost:5000
```

Sign in with `analyst@bank.in` / `Analyst@123`.

Optional third terminal, for a live dashboard feed:

```bash
npm run simulate            # a synthetic authorisation every 4 seconds
```

## Endpoints

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/api/health` | public |
| `POST` | `/api/auth/login` | public, 10 attempts / 15 min |
| `GET` | `/api/auth/me` | any signed-in user |
| `GET` | `/api/transactions` | `?q&band&page&limit&from&to` |
| `GET` | `/api/transactions/stats` | `?range=24h\|7d` |
| `GET` | `/api/transactions/:id` | business ID, e.g. `TX1025` |
| `POST` | `/api/transactions/score` | scores; persists only when `persist: true` |
| `GET` | `/api/alerts` | `?status=open\|confirmed\|dismissed` |
| `PATCH` | `/api/alerts/:id` | `{ outcome, note }` |
| `GET` | `/api/alerts/labels` | engineer / supervisor — training set export |
| `GET` | `/api/rules` | any signed-in user |
| `PATCH` | `/api/rules/:id` | engineer / supervisor |

Socket.io emits `transaction:scored` and `alert:created` on the `feed` room.
The handshake requires the JWT — the client already sends it.

## How scoring works

`riskEngine.scoreTransaction()` runs four stages:

1. **`featureBuilder`** pulls 90 days of history for the card and derives
   aggregates: amount z-score, distance from the last authorisation, implied
   travel speed, 24-hour velocity, category familiarity, card tenure.
2. **`ruleEngine`** evaluates six configurable rules and sums the weights of
   those that fired. Rules are cached for 30 seconds and the cache is
   invalidated the moment one is edited.
3. **`mlClient`** calls the Python service — or the built-in fallback scorer.
4. **`fuse()`** blends the two, then maps the result to a band and a decision.

Rules and model run in `Promise.all`, so the model call costs no extra wall time.

### Fusion

Weighted blend by default: `0.4 × rule + 0.6 × ml`, set in `.env`.
Set `FUSION_STRATEGY=max` to switch to the more conservative `max()` rule.

One guardrail is hard-coded: if the rule score is 90 or above, the final score
cannot fall below the alert band. A confident rule hit should never be averaged
away into an approval by a quiet model — that is exactly the failure mode a
blend introduces.

### The fallback scorer

`ML_ENABLED=false` uses a logistic heuristic inside `mlClient.js`. It weighs
continuous signals rather than crossing thresholds, so it can genuinely disagree
with the rule engine — the point of running both. In Part 3, set
`ML_ENABLED=true` and `ML_SERVICE_URL`, and nothing else changes.

If the ML service times out, scoring degrades to the fallback and marks the
result `fallback-degraded` rather than failing the authorisation.

## Feedback loop

Confirming or dismissing an alert writes `outcome: fraud | legitimate`.
`GET /api/alerts/labels` exports those verdicts as the labelled training set for
the retrain job. This is the loop your original diagram was missing.

## Notes for production

- Historical aggregates run a query per authorisation. At real POS latency they
  belong in a precomputed feature store (Redis), not a collection scan.
- SHAP values are the slowest part of an explanation. If the budget tightens,
  return the decision synchronously and compute the explanation asynchronously.
- `BLOCK` currently auto-blocks. Add a manual override path before going live.
