# FraudGuard

Real-time POS fraud detection combining a configurable rule engine with machine
learning, and explaining every decision before it is made.

Built as a MERN stack application with a separate Python inference service.

---

## The problem

Fraud is roughly 1.5% of card transactions. That imbalance breaks the obvious
approach: a model that labels every transaction *legitimate* scores **98.5%
accuracy** and catches nothing at all. Accuracy is the wrong target.

Threshold rules fail differently. "Block anything above ₹50,000" flags the
customer buying a laptop and misses the attacker probing a stolen card with ₹12
charges. In our dataset, **transaction amount ranks near the bottom of feature
importance at 0.029** — the signal is in hour, device trust, and location
context, not in the number.

FraudGuard runs both approaches in parallel, fuses their scores, and shows the
analyst which signals moved the decision.

---

## Architecture

```
                       POS TRANSACTION
                             │
                    ┌────────▼────────┐
                    │  FEATURE LAYER  │  amount, hour, category, device
                    └────────┬────────┘  trust, velocity, location
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐          ┌─────────▼─────────┐
     │   RULE ENGINE   │          │     ML MODEL      │
     │  6 rules with   │          │ GradientBoosting  │
     │ editable weights│          │ + IsolationForest │
     │  → Rule Score   │          │   → ML Score      │
     └────────┬────────┘          └─────────┬─────────┘
              └──────────────┬──────────────┘
                             │
                   ┌─────────▼─────────┐
                   │ RISK SCORE ENGINE │  weighted fusion
                   │  0.4 rule/0.6 ML  │  + hard-rule guardrail
                   └─────────┬─────────┘
                             │
                   ┌─────────▼─────────┐
                   │  EXPLAINABILITY   │  SHAP contributions,
                   │                   │  named in plain language
                   └─────────┬─────────┘
                             │
                   ┌─────────▼─────────┐
                   │     DECISION      │  0–30   Approve
                   │                   │  31–60  Monitor
                   │                   │  61–80  Alert
                   └─────────┬─────────┘  81–100 Block
                             │
                   ┌─────────▼─────────┐
                   │   ALERT QUEUE     │
                   └─────────┬─────────┘
                             │ analyst verdict
                             ▼
                   becomes the training label
```

Rules and model run concurrently, so the model costs no extra wall-clock time.
Explainability sits **before** the decision gate, not bolted on after — which is
what makes a decision auditable when a chargeback dispute arrives.

The loop closes: confirming or dismissing an alert writes a ground-truth label
that the next retrain consumes.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, Tailwind CSS, TanStack Query, Recharts, socket.io-client |
| Backend | Node.js, Express, Mongoose, JWT, socket.io, Zod |
| Database | MongoDB Atlas |
| ML service | Python 3.13, FastAPI, scikit-learn, SHAP, pandas |

---

## Models

### GradientBoostingClassifier — the primary scorer

Sequential ensemble of shallow trees, each correcting its predecessor's errors.
Chosen after benchmarking against two alternatives on cross-validated PR AUC.

```
n_estimators=250, learning_rate=0.07, max_depth=3,
subsample=0.85, min_samples_leaf=15
```

Depth 3 is deliberate. Fraud detection on 8 raw features does not need deep
interactions, and shallow trees under an imbalanced label are far less prone to
memorising individual training rows.

### IsolationForest — the novelty detector

Trained on **legitimate transactions only**, so "unlike anything normal" carries
a precise meaning. It exists to flag attack patterns that have never appeared in
the labelled data — exactly where a purely supervised model is blind.

```
n_estimators=250, contamination=0.015
```

Its PR AUC of 0.23 is the expected result, not a failure: it never sees a label.
It contributes a novelty signal, not a verdict.

### Score fusion

Two layers, both configurable rather than hard-coded:

```
ML service:  0.75 × supervised + 0.25 × anomaly
Backend:     0.40 × rule score  + 0.60 × ML score
```

One guardrail is hard-coded in `backend/src/services/riskEngine.js`: **if the
rule score is 90 or above, the final score cannot fall below the alert band.** A
weighted blend will otherwise let a quiet model average away a confident rule
hit, which is the specific failure mode blending introduces.

### Benchmarked alternatives

| Model | CV PR AUC | Test PR AUC | Recall | Precision | FP |
| --- | --- | --- | --- | --- | --- |
| LogisticRegression | 0.694 ± 0.070 | 0.659 | 60.0% | 50.0% | 18 |
| RandomForest | 0.826 ± 0.055 | 0.901 | 76.7% | 92.0% | 2 |
| **GradientBoosting** | **0.988 ± 0.010** | **0.999** | **100%** | **81.1%** | **7** |
| IsolationForest | — | 0.231 | — | — | — |

Selection was made on **cross-validated** PR AUC, not the single test split. With
151 fraud cases in the dataset, a single 20% test set holds around 30 examples
and one lucky split can swing recall by ten points. LogisticRegression's ±0.070
spread shows that uncertainty rather than hiding it.

### Explainability

SHAP `TreeExplainer` returns signed per-feature contributions on every
prediction. Display names are merged before ranking — `hour_sin` and `hour_cos`
are one concept to an analyst, as are the two device-trust terms — so the panel
reads as business language:

```
Transaction velocity    +5.60
Foreign transaction     +5.45
Device trust score      +5.43
Location mismatch       +5.42
Transaction hour        +4.61
```

If SHAP fails to initialise, scoring continues without explanations. An
explanation is a nice-to-have; a scoring decision is not.

---

## Results

Held-out test set: 2,000 transactions, 30 fraud.

```
                    predicted
                legit      fraud
  actual legit   1,963          7
  actual fraud       0         30
```

| Metric | Value |
| --- | --- |
| Accuracy | 99.65% |
| **Precision (fraud)** | **81.08%** |
| **Recall (fraud)** | **100%** |
| F1 (fraud) | 89.55% |
| Specificity | 99.64% |
| MCC | 0.8988 |
| **PR AUC** | **0.9989** |
| ROC AUC | 1.0000 |

**PR AUC is the headline.** ROC AUC reads 1.0000 and means very little — it runs
high on any dataset that is 98.5% a single class.

Precision of 81% is a deliberate trade, not a shortfall. A missed fraud costs the
transaction amount; a false alarm costs a few minutes of analyst time. The
decision threshold (0.169, selected on cross-validated *training* predictions,
never on test) favours recall accordingly.

### Feature importance

```
Transaction hour           0.197  ███████████
Device trust (2 terms)     0.274  ████████████████
Foreign transaction        0.155  █████████
Location mismatch          0.127  ███████
Transaction velocity       0.118  ███████
Night-time authorisation   0.088  █████
Transaction amount         0.029  █
Cardholder age             0.001
```

Importance spread across seven features rules out a single-feature leak. Amount
sitting near the bottom is the finding that justifies the whole approach.

### Alert budgets

| Review capacity | Reviews | Caught | Recall | Precision |
| --- | --- | --- | --- | --- |
| 0.5% | 10 | 10 | 33.3% | 100% |
| **1.0%** | **20** | **20** | **66.7%** | **100%** |
| 2.0% | 40 | 30 | 100% | 75% |
| 5.0% | 100 | 30 | 100% | 30% |

This answers the operational question directly: *given the review capacity we
actually have, what share of fraud do we catch?* A model that only performs at a
5% budget is not deployable by a team of six.

---

## Dataset

10,000 transactions, 151 fraudulent (1.51%).

| Column | Type | Used |
| --- | --- | --- |
| `transaction_id` | int | No — identifier |
| `user_id` | int | No — identifier |
| `amount` | float | Yes |
| `transaction_hour` | int 0–23 | Yes |
| `merchant_category` | Electronics, Travel, Grocery, Food, Clothing | Yes |
| `foreign_transaction` | 0/1 | Yes |
| `location_mismatch` | 0/1 | Yes |
| `device_trust_score` | int 0–100 | Yes |
| `velocity_last_24h` | int | Yes |
| `cardholder_age` | int | Yes |
| `Trashold Amount` | float | No — noise |
| `is_fraud` | 0/1 | target |

### Three columns excluded, deliberately

`transaction_id` and `user_id` are identifiers — a tree will happily memorise
"user 436 commits fraud", which generalises to nothing.

`Trashold Amount` correlates **0.008** with the label. It reads like a rule
threshold but behaves like noise: amount exceeds it in 4% of legitimate rows and
8% of fraud. Not enough signal to justify the variance.

### Class separation

| Feature | Legitimate | Fraud |
| --- | --- | --- |
| transaction_hour | 11.7 | **3.8** |
| device_trust_score | 62.2 | **37.9** |
| foreign_transaction | 9.1% | **54.3%** |
| location_mismatch | 8.0% | **47.7%** |
| velocity_last_24h | 2.0 | **3.2** |
| amount | 175 | 216 |
| cardholder_age | 43.5 | 43.4 |

### Feature engineering

16 model features from 8 raw columns:

- `amount_log` — amounts are heavy-tailed, the log makes the scale usable
- `hour_sin`, `hour_cos` — **cyclical encoding**, because 23:00 and 00:00 are
  adjacent rather than 23 units apart. Fraud clusters at 03:00, and a linear
  encoding splits that cluster across the midnight wrap-around
- `is_night` — explicit flag for hours before 06:00 or after 22:00
- `device_distrust` — `100 − trust`, giving trees a direct split on distrust
- `amount_per_velocity` — a large amount on an already-busy card is a different
  risk from the same amount on a quiet one
- `cat_*` — one-hot merchant categories

Training and serving import the **same** feature module. Training/serving skew —
the two paths deriving features slightly differently — is the most common reason
a model that scores well offline fails in production.

### Methodology

**Stratified split with 5-fold cross-validation.** No time column exists, so a
temporal split is neither possible nor required. But 151 fraud cases makes a
single split an anecdote rather than a measurement, so every headline number is a
cross-validated mean with its standard deviation.

**No SMOTE.** Synthetic oversampling interpolates between fraud cases,
manufacturing cardholders who never existed — and applied before the split, as it
commonly is, it leaks test information straight into training.
`class_weight="balanced"` rebalances without fabricating data.

**Threshold selected on cross-validated training predictions**, never on the test
set. Choosing an operating point on test is a quiet form of fitting to it.

---

## Setup

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 18 or 20 LTS |
| Python | 3.12 or 3.13 |
| MongoDB | Atlas free tier, or local 7.x |

### Repository layout

```
fraudguard/
├── frontend/      React console        → port 5173
├── backend/       Express API          → port 5000
└── ml-service/    FastAPI inference    → port 8000
```

Three independent applications, each with its own dependencies and `.env`.

### 1. Database

Create a free M0 cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
Add a database user, and under Network Access allow `0.0.0.0/0` for development.

Copy the connection string and **insert the database name** before the `?` —
without it, Mongoose silently connects to a database called `test`:

```
mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/fraudguard?retryWrites=true&w=majority
```

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

```env
PORT=5000
MONGO_URI=mongodb+srv://.../fraudguard?retryWrites=true&w=majority
JWT_SECRET=a_long_random_string
CLIENT_ORIGIN=http://localhost:5173
ML_ENABLED=false
ML_SERVICE_URL=http://localhost:8000
```

```bash
npm run seed     # users, 6 rules, 400 scored transactions
npm run dev      # http://localhost:5000
```

Seeded accounts:

| Email | Password | Role |
| --- | --- | --- |
| `analyst@bank.in` | `Analyst@123` | analyst |
| `supervisor@bank.in` | `Supervisor@123` | supervisor |
| `engineer@bank.in` | `Engineer@123` | engineer |

Supervisors and engineers can edit rules and export training labels.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev      # http://localhost:5173
```

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

Vite proxies `/api` and `/socket.io` to port 5000, so no CORS configuration is
needed in development.

### 4. ML service

```bash
cd ml-service
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env
```

Place the dataset at `ml-service/data/csv/transactions.csv`, then:

```bash
python training/train_csv.py       # ~60 seconds
```

Add to `.env`:

```env
CSV_MODEL_VERSION=csv_v1
```

```bash
uvicorn app.main:app --reload --port 8000
```

Confirm `CSV model loaded: CSV-GradientBoosting` in the startup output.
Interactive docs at `http://localhost:8000/docs`.

The virtual environment must be activated in **every new terminal** for this
folder.

### 5. Optional — synthetic traffic

```bash
cd backend
npm run simulate     # one authorisation every 4 seconds
```

Populates the dashboard's live feed during a demo.

### Running order

Four terminals: backend → frontend → ML service → simulator.

---

## Usage

### Score a transaction

```bash
POST http://localhost:8000/csv/predict
```

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

37 ms sits comfortably inside a POS authorisation budget of 100–300 ms.

### Worked examples

| Scenario | Amount | Hour | Foreign | Location | Trust | Velocity | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Everyday grocery | ₹45 | 13 | 0 | 0 | 88 | 1 | **8** LOW |
| Every signal fires | ₹820 | 3 | 1 | 1 | 22 | 6 | **90** CRITICAL |
| Large amount only | ₹2,400 | 14 | 0 | 0 | 85 | 1 | **12** LOW |
| Card testing | ₹12 | 4 | 1 | 1 | 18 | 9 | **90** CRITICAL |
| Business travel | ₹650 | 11 | 1 | 1 | 91 | 2 | **15** LOW |

Rows three and four are the point of the whole system. **₹2,400 approved, ₹12
blocked.** A threshold rule would get both backwards: it would block the customer
buying a laptop at 2pm on a trusted device, and wave through the attacker
verifying a stolen card. Row five is the false-positive story — foreign and
location mismatch both push the score up, but high device trust and a normal hour
outweigh them, so a genuine traveller is not stopped.

---

## API reference

### ML service — port 8000

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | model status and stored metrics |
| `POST` | `/csv/predict` | score one transaction |
| `GET` | `/csv/info` | all benchmarked model metrics |
| `POST` | `/reload` | reload artefacts without a restart |

### Backend — port 5000

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/api/auth/login` | public, 10 attempts / 15 min |
| `GET` | `/api/auth/me` | signed-in |
| `GET` | `/api/transactions` | `?q&band&page&limit` |
| `GET` | `/api/transactions/:id` | e.g. `TX1025` |
| `POST` | `/api/transactions/score` | persists only when `persist: true` |
| `GET` | `/api/transactions/stats` | `?range=24h\|7d` |
| `GET` | `/api/alerts` | `?status=open\|confirmed\|dismissed` |
| `PATCH` | `/api/alerts/:id` | `{ outcome, note }` |
| `GET` | `/api/alerts/labels` | engineer / supervisor |
| `GET` | `/api/rules` | signed-in |
| `PATCH` | `/api/rules/:id` | engineer / supervisor |

Socket.io emits `transaction:scored` and `alert:created`; the handshake requires
a valid JWT.

---

## Screens

| Route | Purpose |
| --- | --- |
| `/` | 24-hour stats, hourly score chart, live authorisation feed |
| `/transactions` | Filterable ledger of every scored transaction |
| `/transactions/:id` | Full decision record — authorisation strip, fusion maths, rules fired, SHAP tape |
| `/alerts` | Review queue; each verdict becomes a training label |
| `/rules` | Live threshold and weight editing |
| `/simulator` | Push a synthetic transaction through the pipeline |

The **authorisation strip** on the detail page is the signature component: one
0–100 scale carrying the rule tick, the model tick, and the fused needle, with
the four decision bands beneath. It answers "did the rules or the model drive
this?" at a glance — the question that matters during a chargeback dispute.

---

## Rule engine

Six rules, each with an editable threshold and weight:

| Code | Trigger | Threshold | Weight |
| --- | --- | --- | --- |
| `AMOUNT_ANOMALY` | Amount above cardholder threshold | ₹50,000 | 25 |
| `TIME_ANOMALY` | Outside normal activity window | 07:00 | 20 |
| `LOCATION_ANOMALY` | Distance from last authorisation | 300 km | 30 |
| `PATTERN_ANOMALY` | Merchant category never used | 1 | 15 |
| `VELOCITY` | Authorisations in 24 hours | 8 | 20 |
| `DEVICE_ANOMALY` | Card details keyed in manually | 1 | 15 |

Rules are cached for 30 seconds; the cache is invalidated the instant one is
edited in the UI, so changes take effect on the next authorisation.

---

## Known limitations

**PR AUC of 0.988 is inflated because the dataset is synthetic.** Fraud here was
generated from clean rules and separates far more cleanly than real traffic.
Importance spread across seven features rules out a single-feature leak, but a
production deployment on this architecture should expect **0.4–0.8**.

**The rule engine and ML model consume different feature sets.** The rule engine
runs on geography and card history in Node; the model runs on the CSV schema.
Unifying them is the next milestone. `ML_ENABLED=false` keeps the backend on its
built-in fallback scorer meanwhile, so the system works end to end either way.

**Historical aggregates run a database query per authorisation.** Acceptable at
10,000 rows, fatal at real POS latency. They belong in Redis as a precomputed
feature store.

**Retraining carries selection bias.** Outcomes are only ever learned for
transactions the system flagged, so the model cannot learn from its own misses,
and each retrain grows more confident about patterns it already knows. The fix is
routing a random sample of *approved* transactions into the review queue.

**Auto-block at 81+ has real customer cost.** A manual override path is required
before production.

---

## Roadmap

- Unify the rule engine and model feature sets behind one contract
- Redis feature store for historical aggregates
- Random-sample review queue to correct retraining bias
- Async SHAP computation, keeping the decision path under 100 ms
- Manual override on auto-block
- Model versioning with shadow deployment before promotion