# FraudGuard — Hackathon Handbook

POS fraud detection: hybrid rule engine + machine learning, with explainability
before the decision gate.

Everything you need in one place — how to start it, what the data looks like,
what to say, and what to do when something breaks.

---

# 1. What this is

A four-part system that scores card transactions in real time and explains why.

```
POS TRANSACTION
      |
   FEATURES  ── amount, hour, category, device trust, velocity, location
      |
      +──────────────+
      |              |
 RULE ENGINE     ML MODEL          (run in parallel)
 6 configurable   GradientBoosting
 rules, weighted  + IsolationForest
      |              |
      +──────+───────+
             |
      RISK SCORE ENGINE            weighted fusion, 0.4 rule / 0.6 ML
             |
      EXPLAINABILITY               SHAP — which signals moved the score
             |
        DECISION                   0-30 Approve · 31-60 Monitor
             |                     61-80 Alert  · 81-100 Block
        FRAUD ALERT                analyst confirms → training label
```

The loop closes: an analyst's verdict on an alert becomes the label the model
retrains on.

---

# 2. Repository layout

```
fraudguard-frontend/
├── frontend/          React 18 + Vite + Tailwind      port 5173
├── backend/           Express + MongoDB Atlas          port 5000
└── ml-service/        FastAPI + scikit-learn           port 8000
```

Three independent apps. Each has its own dependencies and its own `.env`.

---

# 3. Starting everything

Four terminals. Order matters only in that the backend should be up before the
simulator.

### Terminal 1 — Backend
```powershell
cd C:\coding_webdevanddsa\fraudguard-frontend\backend
npm run dev
```
Expect: `MongoDB connected: fraudguard` and `FraudGuard API listening on http://localhost:5000`

### Terminal 2 — Frontend
```powershell
cd C:\coding_webdevanddsa\fraudguard-frontend\frontend
npm run dev
```
Opens `http://localhost:5173`

### Terminal 3 — ML service
```powershell
cd C:\coding_webdevanddsa\fraudguard-frontend\ml-service
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```
Expect: `CSV model loaded: CSV-GradientBoosting`

The activate line is required in every new terminal for this folder. Messages
about missing POS/ULB models are expected and harmless.

### Terminal 4 — Traffic simulator
```powershell
cd C:\coding_webdevanddsa\fraudguard-frontend\backend
npm run simulate
```
Pushes a synthetic authorisation every 4 seconds so the live feed has content.

### Login
`analyst@bank.in` / `Analyst@123`

Other seeded accounts: `supervisor@bank.in` / `Supervisor@123`,
`engineer@bank.in` / `Engineer@123` (the latter two can edit rules and export
training labels).

---

# 4. The dataset

`ml-service/data/csv/transactions.csv` — 10,000 rows, 151 fraud (1.51%).

| Column | Type | Range | Used? |
| --- | --- | --- | --- |
| `transaction_id` | int | 1–10000 | **No** — identifier |
| `user_id` | int | 100–999 | **No** — identifier |
| `amount` | float | 5–3000 | Yes |
| `transaction_hour` | int | 0–23 | Yes |
| `merchant_category` | string | Electronics, Travel, Grocery, Food, Clothing | Yes |
| `foreign_transaction` | 0/1 | binary | Yes |
| `location_mismatch` | 0/1 | binary | Yes |
| `device_trust_score` | int | 0–100 | Yes |
| `velocity_last_24h` | int | 0–15 | Yes |
| `cardholder_age` | int | 18–80 | Yes |
| `Trashold Amount` | float | ~300–800 | **No** — noise |
| `is_fraud` | 0/1 | target | label |

### Three columns excluded, deliberately

**`transaction_id`, `user_id`** — identifiers. A tree will memorise "user 436
commits fraud", which generalises to nothing and inflates offline scores.

**`Trashold Amount`** — correlates **0.008** with the label. It looks like a rule
threshold but behaves like noise: amount exceeds it in 4% of legitimate rows and
8% of fraud. Not enough signal to justify the variance it adds. Still available
to the rule engine, just not as a model feature.

### Class separation in the raw data

| Feature | Legitimate | Fraud |
| --- | --- | --- |
| transaction_hour | 11.7 | **3.8** |
| device_trust_score | 62.2 | **37.9** |
| foreign_transaction | 9.1% | **54.3%** |
| location_mismatch | 8.0% | **47.7%** |
| velocity_last_24h | 2.0 | **3.2** |
| amount | 175 | 216 |
| cardholder_age | 43.5 | 43.4 (no signal) |

Amount barely separates the classes. That is the single most useful fact about
this dataset, and it is why threshold rules alone fail.

---

# 5. Feature engineering

16 model features from 8 raw columns (`app/csv_features.py`):

| Feature | Derivation | Why |
| --- | --- | --- |
| `amount_log` | log1p(amount) | amounts are heavy-tailed |
| `hour_sin`, `hour_cos` | cyclical encoding | 23:00 and 00:00 are adjacent, not 23 apart — fraud clusters at 03:00 and a linear encoding splits that cluster across the wrap-around |
| `is_night` | hour < 6 or ≥ 22 | explicit night flag |
| `foreign_transaction` | passthrough | |
| `location_mismatch` | passthrough | |
| `device_trust_score` | passthrough | |
| `device_distrust` | 100 − trust | gives trees a direct split on distrust |
| `velocity_last_24h` | passthrough | |
| `amount_per_velocity` | amount / (velocity+1) | a big amount on an already-busy card is a different risk |
| `cardholder_age` | passthrough | |
| `cat_*` × 5 | one-hot | |

One module is imported by both training and serving. **Training/serving skew** —
the two paths deriving features slightly differently — is the most common reason
a model looks great offline and fails in production.

---

# 6. Model architecture

Two models, different jobs:

**GradientBoostingClassifier** (supervised) — learns the fraud patterns present
in the labelled data. Champion model.

**IsolationForest** (unsupervised) — trained on **legitimate rows only**, so
"unlike anything normal" means something precise. Catches attack patterns nobody
has labelled yet, which is exactly where a supervised model is blind.

Blended inside the service **0.75 supervised / 0.25 anomaly** (tunable in
`.env`). The Node backend then blends *that* against the rule score at 0.6/0.4 —
two fusion layers, both configurable rather than hard-coded.

### One hard-coded guardrail

In `backend/src/services/riskEngine.js`: if the rule score is ≥ 90, the final
score cannot fall below the alert band. A confident rule hit must never be
averaged away into an approval by a quiet model. That is the failure mode a
weighted blend introduces, and it is worth naming.

---

# 7. Results

```
model                        CV PR AUC  test PR   recall    prec    FP
LogisticRegression       0.6941 ±0.070   0.6589   60.00%  50.00%    18
RandomForest             0.8262 ±0.055   0.9014   76.67%  92.00%     2
GradientBoosting         0.9878 ±0.009   0.9989  100.00%  81.08%     7
IsolationForest              —           0.2307      —       —       —
```

**Champion: GradientBoosting**, selected on cross-validated PR AUC.

### Confusion matrix (2,000 held-out rows, 30 fraud)

```
                    predicted
                legit      fraud
  actual legit   1,963          7
  actual fraud       0         30
```

| Metric | Value |
| --- | --- |
| Accuracy | 99.65% |
| Precision (fraud) | 81.08% |
| Recall (fraud) | 100% |
| F1 (fraud) | 89.55% |
| Specificity | 99.64% |
| MCC | 0.8988 |
| PR AUC | 0.9989 |
| ROC AUC | 1.0000 |

### Feature importance

```
Transaction hour              0.197  ###########
Foreign transaction           0.155  #########
Device trust (2 terms)        0.274  ################
Location mismatch             0.127  #######
Transaction velocity          0.118  #######
Night-time authorisation      0.088  #####
Transaction amount            0.029  #
Cardholder age                0.001
```

Spread across seven features — no single-feature leak.

### Alert budgets

| Review budget | Reviews | Caught | Recall | Precision |
| --- | --- | --- | --- | --- |
| 0.5% | 10 | 10 | 33.3% | 100% |
| **1.0%** | **20** | **20** | **66.7%** | **100%** |
| 2.0% | 40 | 30 | 100% | 75% |
| 5.0% | 100 | 30 | 100% | 30% |

This table is the operational answer: *given the review capacity we have, what
share of fraud do we catch?* Most projects do not have it.

---

# 8. Commands

### ML service
```powershell
.\.venv\Scripts\Activate.ps1                  # required in every new terminal
python training/train_csv.py                  # retrain, ~60s
python training/metrics_report.py             # confusion matrix + all metrics
uvicorn app.main:app --reload --port 8000     # serve
Invoke-RestMethod -Method Post http://localhost:8000/reload   # reload artefact
```

`--reload` means saving any `.py` file restarts the server automatically. Editing
`.env` requires a manual Ctrl+C and restart, since env is read once at startup.

### Backend
```powershell
npm run dev          # start API
npm run seed         # reset DB: users, rules, 400 transactions
npm run simulate     # synthetic traffic every 4s
```

### Frontend
```powershell
npm run dev
```

---

# 9. API reference

### ML service (port 8000)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | model status and stored metrics |
| POST | `/csv/predict` | score one transaction |
| GET | `/csv/info` | every model's metrics, for slides |
| POST | `/reload` | reload artefacts without restarting |

Interactive docs: `http://localhost:8000/docs`

**Request**
```json
{
  "record": {
    "amount": 820,
    "transaction_hour": 3,
    "merchant_category": "Electronics",
    "foreign_transaction": 1,
    "location_mismatch": 1,
    "device_trust_score": 22,
    "velocity_last_24h": 6,
    "cardholder_age": 41
  }
}
```

**Response**
```json
{
  "score": 90,
  "probability": 0.9,
  "supervisedScore": 100,
  "anomalyScore": 60,
  "model": { "name": "CSV-GradientBoosting", "version": "csv_v1", "confidence": 0.9 },
  "explanation": {
    "baseValue": -9.9104,
    "contributions": [
      { "feature": "Transaction velocity", "value": 5.5971 },
      { "feature": "Foreign transaction",  "value": 5.4554 },
      { "feature": "Device trust score",   "value": 5.4269 },
      { "feature": "Location mismatch",    "value": 5.4164 }
    ]
  },
  "latencyMs": 37
}
```

### Backend (port 5000)

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/health` | public |
| POST | `/api/auth/login` | public, 10 attempts/15min |
| GET | `/api/transactions` | `?q&band&page&limit` |
| GET | `/api/transactions/:id` | e.g. `TX1025` |
| POST | `/api/transactions/score` | persists only if `persist: true` |
| GET | `/api/transactions/stats` | `?range=24h\|7d` |
| GET | `/api/alerts` | `?status=open\|confirmed\|dismissed` |
| PATCH | `/api/alerts/:id` | `{ outcome, note }` |
| GET | `/api/alerts/labels` | engineer/supervisor — training set export |
| GET | `/api/rules` | any signed-in user |
| PATCH | `/api/rules/:id` | engineer/supervisor |

Socket.io emits `transaction:scored` and `alert:created`; the handshake requires
the JWT.

---

# 10. MongoDB schemas

### transactions
```js
{
  transactionId: "TX1025",        // unique, indexed
  timestamp: Date,                // indexed
  amount: Number,
  currency: "INR",
  card:       { masked, cardId, network },
  cardholder: { id, name, homeCity },
  merchant:   { id, name, category },
  location:   { city, country, lat, lng },
  device:     { terminalId, entryMode },   // CHIP|SWIPE|CONTACTLESS|MANUAL
  ruleScore:  Number,             // 0-100
  mlScore:    Number,             // 0-100
  finalScore: Number,             // 0-100, indexed
  fusion:     { strategy, weights: { rule, ml } },
  band:       "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  decision:   "APPROVE"|"MONITOR"|"ALERT"|"BLOCK",
  flags:      [{ code, detail, weight }],
  model:      { name, version, confidence, source },
  explanation:{ baseValue, contributions: [{ feature, value }] },
  latencyMs:  Number
}
```
Indexes: `{timestamp:-1, band:1}` (the ledger is read newest-first, filtered by
band) and a text index on transactionId, merchant name, and masked card.

### alerts
```js
{
  transactionId, transaction: ObjectId,
  amount, finalScore, band, merchant, location, flags,
  status:  "open"|"confirmed"|"dismissed",   // indexed
  outcome: "fraud"|"legitimate"|null,        // ← the training label
  note, reviewedBy: ObjectId, reviewedAt: Date
}
```

### rules
```js
{
  code: "AMOUNT_ANOMALY"|"TIME_ANOMALY"|"LOCATION_ANOMALY"
       |"PATTERN_ANOMALY"|"VELOCITY"|"DEVICE_ANOMALY",
  name, description,
  threshold: Number,    // editable in the UI
  weight:    Number,    // 0-100, editable
  enabled:   Boolean,
  updatedBy: ObjectId
}
```
Cached 30s in the rule engine; the cache is invalidated the instant a rule is
edited.

### users
```js
{
  name, email (unique, lowercase),
  password,                                  // bcrypt, cost 12, select:false
  role: "analyst"|"supervisor"|"engineer",
  lastLoginAt
}
```

### Rule defaults

| Code | Threshold | Weight |
| --- | --- | --- |
| AMOUNT_ANOMALY | ₹50,000 | 25 |
| TIME_ANOMALY | 07:00 | 20 |
| LOCATION_ANOMALY | 300 km | 30 |
| PATTERN_ANOMALY | 1 | 15 |
| VELOCITY | 8 / 24h | 20 |
| DEVICE_ANOMALY | 1 | 15 |

---

# 11. Demo test cases

All six verified against the trained model.

### 1 — Clean baseline → **8/100 LOW**
```json
{"record":{"amount":45,"transaction_hour":13,"merchant_category":"Grocery","foreign_transaction":0,"location_mismatch":0,"device_trust_score":88,"velocity_last_24h":1,"cardholder_age":34}}
```
All contributions negative. Normal traffic passes without friction.

### 2 — Textbook fraud → **90/100 CRITICAL**
```json
{"record":{"amount":820,"transaction_hour":3,"merchant_category":"Electronics","foreign_transaction":1,"location_mismatch":1,"device_trust_score":22,"velocity_last_24h":6,"cardholder_age":41}}
```
Velocity +5.60, foreign +5.45, device trust +5.43, location +5.42.

### 3 — Large amount ONLY → **12/100 LOW** ⭐
```json
{"record":{"amount":2400,"transaction_hour":14,"merchant_category":"Electronics","foreign_transaction":0,"location_mismatch":0,"device_trust_score":85,"velocity_last_24h":1,"cardholder_age":52}}
```
Amount contributes +4.83 but context outweighs it. **A naive threshold rule
would block this customer.** ₹2,400 at 2pm on a trusted device is a laptop, not
fraud.

### 4 — Card testing → **90/100 CRITICAL** ⭐
```json
{"record":{"amount":12,"transaction_hour":4,"merchant_category":"Food","foreign_transaction":1,"location_mismatch":1,"device_trust_score":18,"velocity_last_24h":9,"cardholder_age":29}}
```
A ₹12 transaction scoring identically to the ₹820 one. Attackers probe stolen
cards with tiny charges first; amount-based rules miss this entirely.

### 5 — Legitimate travel → **15/100 LOW** ⭐
```json
{"record":{"amount":650,"transaction_hour":11,"merchant_category":"Travel","foreign_transaction":1,"location_mismatch":1,"device_trust_score":91,"velocity_last_24h":2,"cardholder_age":45}}
```
Foreign +3.39 and location mismatch +3.85 both push up, but high device trust
and a normal hour outweigh them. The false-positive story.

### 6 — Borderline → **9/100 LOW**
```json
{"record":{"amount":300,"transaction_hour":2,"merchant_category":"Electronics","foreign_transaction":0,"location_mismatch":0,"device_trust_score":50,"velocity_last_24h":3,"cardholder_age":38}}
```
Hour alone (+2.52) is not enough. One suspicious factor does not trigger a block.

**If you demo only three: 2 → 3 → 4.** Big fraud blocked, bigger legitimate
approved, tiny fraud blocked. Forty seconds, complete argument.

---

# 12. Talking points

### Why accuracy is not the headline
Your model: **99.65%**. A model that predicts "legitimate" for every transaction:
**98.50%** — and catches zero fraud. Accuracy buys 1.15 points over doing
nothing. Precision and recall on the fraud class are what separate a useful model
from a useless one.

### Why PR AUC over ROC AUC
ROC AUC is 1.0000, which is meaningless here — it runs high on any set that is
98.5% one class. PR AUC focuses on the minority class and is the honest headline.

### Why cross-validation
151 fraud cases means a single 20% test set holds ~30 examples, and one lucky
split can swing recall by ten points. Every number is a 5-fold CV mean with its
standard deviation. Note LogisticRegression's ±0.070 spread — that uncertainty
is real and shown rather than hidden.

### Why no SMOTE
Synthetic oversampling interpolates between fraud cases, manufacturing
cardholders who never existed — and applied before the split, as it usually is
in tutorials, it leaks test data into training. `class_weight="balanced"`
rebalances without fabricating anything.

### Why two models
The supervised model learns labelled patterns. IsolationForest, trained on
legitimate rows only, flags transactions unlike anything in training at all —
which is exactly where a purely supervised model is blind. Its PR AUC of 0.23 is
the expected result: it never sees a label.

### The feedback loop
Confirming or dismissing an alert writes `outcome: fraud|legitimate`, and
`GET /api/alerts/labels` exports those verdicts as the training set. The system
learns from its analysts.

### Precision 81% is a choice, not a shortcoming
A missed fraud costs the transaction amount; a false alarm costs a few minutes
of analyst time. The threshold (0.1691, chosen on cross-validated training
predictions, never on test) deliberately favours recall.

---

# 13. Known limitations — say these before you are asked

**PR AUC 0.9878 is high because the dataset is synthetic.** Fraud was generated
from clean rules, so it separates far more cleanly than real traffic. Importance
spread across seven features rules out a single-feature leak, but a real
deployment should expect **0.4–0.8**. Claiming a 99% fraud detector loses a viva;
explaining why the number is inflated wins one.

**The rule engine and the ML model consume different feature sets today.** The
rule engine runs on the Node side with geography and card history; the model runs
on the CSV schema. Unifying them is the next step, and `ML_ENABLED=false` keeps
the backend on its built-in fallback scorer in the meantime — the system works
end to end either way.

**Historical aggregates run a query per authorisation.** Fine at 10,000 rows,
fatal at POS latency. They belong in Redis as a precomputed feature store.

**Selection bias in retraining.** You only learn outcomes for transactions the
system flagged. Fraud that scored low was never reviewed, so the model cannot
learn from its own misses, and each retrain makes it more confident about
patterns it already knows. The fix is routing a random sample of *approved*
transactions into the review queue.

**Auto-block at 81+ has real customer cost.** A manual override path is needed
before this goes live.

---

# 14. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ModuleNotFoundError: numpy` | venv not active | `.\.venv\Scripts\Activate.ps1` |
| `.venv could not be loaded` | folder deleted by re-extraction | `py -m venv .venv` then activate |
| `Building wheel for scikit-learn` | pinned versions with no 3.13 wheels | use the loosened `requirements.txt` |
| `curl -X : parameter not found` | PowerShell aliases curl | `Invoke-RestMethod -Method Post` |
| `MongoDB connected: test` | database name missing from URI | add `/fraudguard` before the `?` |
| Backend 401 everywhere | frontend still has the auth bypass | remove `return children` from `ProtectedRoute.jsx` |
| Live feed empty | simulator not running | `npm run simulate` |
| `No CSV model artefact found` | not trained, or `.env` line missing | `python training/train_csv.py`, add `CSV_MODEL_VERSION=csv_v1` |
| Nested `ml-service/ml-service` | zip extracted one level too deep | `Remove-Item -Recurse -Force .\ml-service` |

**Extracting future zips:** extract to `C:\temp` first, then copy the *inner*
contents across. Windows' "Extract All" overwrites whole folders, which is what
kept deleting `.venv`.

---

# 15. Five-minute demo script

**0:00 — The problem.** Fraud is 1.5% of transactions. A model that approves
everything is 98.5% accurate and useless. Show the accuracy-vs-baseline line.

**0:45 — Architecture.** Rules and model run in parallel, fuse into one score,
explanation before the decision gate. Show the diagram.

**1:30 — Live demo.** `localhost:5173` → Transactions → filter Critical → open
one → the authorisation strip, rules fired, SHAP tape.

**2:30 — The model.** `localhost:8000/docs` → run test 2 (fraud, 90) → test 3
(bigger amount, legitimate, 12) → test 4 (tiny amount, fraud, 90). *"Amount is
0.03 importance. The model learned context."*

**3:30 — Metrics.** Confusion matrix, precision/recall, alert-budget table.
*"At a 1% review budget we catch two-thirds of fraud with zero false alarms."*

**4:15 — Honesty.** Synthetic dataset, expect 0.4–0.8 in production, selection
bias in retraining, feature store needed for real latency.

**4:45 — The loop.** Analysts confirm alerts; those verdicts are the next
training set.

---

# 16. Screenshots to take now

1. `python training/metrics_report.py` — confusion matrix and metrics
2. `python training/train_csv.py` — model comparison, alert budgets, importances
3. Transaction detail page — the authorisation strip
4. `/docs` — test 2 and test 3 responses side by side
5. Alerts queue with open alerts
6. Overview dashboard with the live feed running

Take them before the presentation. Live demos fail; screenshots do not.
