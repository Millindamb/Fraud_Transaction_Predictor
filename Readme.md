# FraudGuard

Real-time POS fraud detection: a configurable 33-rule engine and a trained ML model
scoring every transaction in parallel, fused into one decision, with a plain-language
explanation of what drove it.

MERN stack plus a Python inference service, packaged with Docker Compose. Three apps,
one pipeline.

---

## How this answers the brief

| Requirement | Where it lives |
| --- | --- |
| Identify fraud from predefined anomaly rules | 33-rule engine with editable thresholds, weights and severity scaling — `/rules` |
| Value above a defined threshold | `AMOUNT_ANOMALY`, graduated 1.0×–3.6× by how far past the threshold, plus `AMOUNT_VS_HISTORY`, `AMOUNT_ZSCORE` and `THRESHOLD_PROBING` |
| Odd days or hours | `TIME_ANOMALY`, with a 1.5× multiplier for 01:00–04:00, plus `NIGHT_HIGH_VALUE` |
| Unusual location | `LOCATION_ANOMALY` (geo-distance), `IMPOSSIBLE_TRAVEL` (implied speed), `MULTI_CITY_24H`, `FOREIGN_TRANSACTION` |
| Unusual order or purchase pattern | `PATTERN_ANOMALY`, `VELOCITY`, `CARD_TESTING`, `TEST_THEN_DRAIN`, `CATEGORY_HOPPING` and the other behavioural rules |
| A lightweight ML layer producing a risk score | GradientBoosting + IsolationForest, served over FastAPI |
| Explain *why* a transaction was flagged | Rules fired with plain-language detail, plus SHAP contributions — both before the decision gate |
| Produce a risk score | Fused 0–100 score with visible arithmetic and escalation floors |
| Generate an alert | Alert queue, with analyst verdicts feeding the next retrain |

Two things go beyond the brief and are worth pointing at: a **verification layer**
that resolves anomalous-but-genuine transactions instead of declining them, and a
**divergence chart** showing where the two engines disagree — the evidence that
the hybrid is not redundant.

### On the dataset

The brief recommends the ULB Credit Card Fraud dataset. We built support for it
(`ml-service/training/train_ulb.py`, `/ulb/predict`) and then chose a
business-feature dataset for the live system instead. The reason is the
explainability requirement: ULB's features are **V1–V28, anonymised PCA
components**, so SHAP can only report "V17 contributed +0.42" — which is not an
explanation a fraud analyst or a disputing customer can use. A dataset with real
attributes lets the same pipeline say "device trust score, +5.43". The ULB path
remains in the repo for benchmarking.

---

## The problem

Fraud is roughly 1.5% of card transactions. That imbalance breaks the obvious
approach — a model that labels every transaction *legitimate* scores **98.5%
accuracy** and catches nothing. Accuracy is the wrong target.

Threshold rules fail differently. "Block anything above ₹50,000" stops the
customer buying a laptop and waves through the attacker probing a stolen card
with ₹12 charges. In our data, **transaction amount ranks near the bottom of
feature importance at 0.029**. The signal lives in hour, device trust, location
context and velocity — not in the number.

So FraudGuard runs both, and shows its working.

---

## Architecture

```
                       POS TRANSACTION
                             │
                    ┌────────▼────────┐
                    │  FEATURE LAYER  │  amount, hour, category, device
                    └────────┬────────┘  trust, velocity, location, foreign
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐          ┌─────────▼─────────┐
     │   RULE ENGINE   │          │     ML MODEL      │
     │  33 rules with  │          │ GradientBoosting  │
     │ editable weights│          │ + IsolationForest │
     │  + severity     │          │   (FastAPI)       │
     │  → Rule Score   │          │   → ML Score      │
     └────────┬────────┘          └─────────┬─────────┘
              └──────────────┬──────────────┘
                             │
                   ┌─────────▼─────────┐
                   │ RISK SCORE ENGINE │  0.4 rule / 0.6 ML
                   │                   │  + escalation floors
                   └─────────┬─────────┘
                             │
                   ┌─────────▼─────────┐
                   │  EXPLAINABILITY   │  SHAP contributions
                   └─────────┬─────────┘
                             │
                   ┌─────────▼─────────┐
                   │   VERIFICATION    │  biometric push, device/IP
                   │                   │  match, blocklist override
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

Rules and model run concurrently in `Promise.all`, so the model call costs no
extra wall-clock time. Explainability sits **before** the decision gate, not
bolted on afterwards — that is what makes a decision auditable when a chargeback
dispute arrives weeks later.

The loop closes: confirming or dismissing an alert writes a ground-truth label
that `GET /api/alerts/labels` exports for the next retrain.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite, Tailwind, TanStack Query, Recharts, socket.io-client |
| Backend | Node.js, Express, Mongoose, JWT, socket.io, Zod |
| Database | MongoDB (Atlas, or the bundled container under Docker) |
| ML service | Python 3.12 / 3.13, FastAPI, scikit-learn, SHAP, pandas |
| Packaging | Docker, Docker Compose, nginx (serves the built frontend and proxies `/api` and `/socket.io`) |

---

## Models

### GradientBoostingClassifier — the primary scorer

Sequential ensemble of shallow trees, each correcting its predecessor's errors.
Chosen after benchmarking two alternatives on cross-validated PR AUC.

```
n_estimators=250, learning_rate=0.07, max_depth=3,
subsample=0.85, min_samples_leaf=15
```

Depth 3 is deliberate: fraud detection on 8 raw features does not need deep
interactions, and shallow trees under an imbalanced label are far less prone to
memorising individual training rows.

### IsolationForest — the novelty detector

Trained on **legitimate transactions only**, so "unlike anything normal" carries
a precise meaning. It exists to flag attack patterns that never appeared in the
labelled data — exactly where a supervised model is blind.

```
n_estimators=250, contamination=0.015
```

Its PR AUC of 0.23 is the expected result, not a failure. It never sees a label.
It contributes a novelty signal, not a verdict.

### Benchmarked alternatives

| Model | CV PR AUC | Test PR AUC | Recall | Precision | FP |
| --- | --- | --- | --- | --- | --- |
| LogisticRegression | 0.694 ± 0.070 | 0.659 | 60.0% | 50.0% | 18 |
| RandomForest | 0.826 ± 0.055 | 0.901 | 76.7% | 92.0% | 2 |
| **GradientBoosting** | **0.988 ± 0.010** | **0.999** | **100%** | **81.1%** | **7** |
| IsolationForest | — | 0.231 | — | — | — |

Selected on **cross-validated** PR AUC, not the single test split. With 151 fraud
cases, a 20% test set holds ~30 examples and one lucky split can swing recall by
ten points. LogisticRegression's ±0.070 spread shows that uncertainty rather than
hiding it.

### Score fusion — two layers

```
ML service:  0.75 × supervised + 0.25 × anomaly
Backend:     0.40 × rule score  + 0.60 × ML score
```

Both configurable in `.env`, not hard-coded.

**Escalation floors** sit on top, in `backend/src/services/riskEngine.js`:

| Condition | Floor |
| --- | --- |
| Rule score ≥ 85 | 81 (Block) |
| Rule score ≥ 65 | 61 (Alert) |
| Model score ≥ 85 | 81 (Block) |
| Three or more rules fired | 61 (Alert) |

A weighted blend will otherwise let a quiet engine average away a confident one —
the specific failure mode blending introduces. When a floor applies, the UI shows
the blend arithmetic *and* the reason it was overridden, rather than presenting an
unexplained number.

### Verification — the layer after the score

A risk score answers *is this unusual?* It cannot answer *is this really the
cardholder?* Those are different questions, and conflating them is why naive
systems decline a customer's first large purchase.

So the score stands, and identity evidence adjusts the decision on top of it
(`backend/src/services/verification.js`):

| Check | Effect |
| --- | --- |
| Card or device on the blocklist | **Override → 100, Block** |
| Cardholder declined the push notification | **Override → 100, Block** |
| Approved by fingerprint on the registered phone | −45 |
| Same device fingerprint and IP as usual | −10 |
| Unrecognised device and network | +15 |

Overrides are not weighted signals. A known-compromised credential is not
evidence to be argued with by a fingerprint.

The UI shows **both** numbers — the score the pipeline produced and the score the
customer experienced — with the evidence between them. Hiding the original would
be dishonest: the transaction *was* anomalous, and an auditor needs to see it was
noticed and then explained.

This is what makes a ₹1,20,000 laptop on a card that normally spends ₹3,000
clearable rather than declined.

### Explainability

SHAP `TreeExplainer`, signed per-feature contributions on every prediction.
Display names are merged before ranking — `hour_sin` and `hour_cos` are one
concept to an analyst, as are the two device-trust terms — so the panel reads as
business language:

```
Transaction velocity    +5.60
Foreign transaction     +5.45
Device trust score      +5.43
Location mismatch       +5.42
Transaction hour        +4.61
```

The explainer is warmed at service startup, because SHAP builds it lazily on
first use and that first call would otherwise trip the caller's timeout and
silently degrade to the fallback scorer.

If SHAP fails entirely, scoring continues without explanations. An explanation is
a nice-to-have; a scoring decision is not.

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
high on any dataset that is 98.5% one class.

Precision of 81% is a deliberate trade. A missed fraud costs the transaction
amount; a false alarm costs a few minutes of analyst time. The threshold (0.169,
selected on cross-validated *training* predictions, never on test) favours recall
accordingly.

Regenerate any of this with `python training/metrics_report.py`.

These metrics describe the **ML model**. The rule engine is scored separately by
the fusion layer and has not been benchmarked against labelled data — see
[Known limitations](#known-limitations).

### Feature importance

```
Device trust (2 terms)     0.274  ████████████████
Transaction hour           0.197  ███████████
Foreign transaction        0.155  █████████
Location mismatch          0.127  ███████
Transaction velocity       0.118  ███████
Night-time authorisation   0.088  █████
Transaction amount         0.029  █
Cardholder age             0.001
```

Spread across seven features — no single-feature leak. Amount near the bottom is
the finding that justifies the whole approach.

### Alert budgets

| Review capacity | Reviews | Caught | Recall | Precision |
| --- | --- | --- | --- | --- |
| 0.5% | 10 | 10 | 33.3% | 100% |
| **1.0%** | **20** | **20** | **66.7%** | **100%** |
| 2.0% | 40 | 30 | 100% | 75% |
| 5.0% | 100 | 30 | 100% | 30% |

Answers the operational question directly: *given the review capacity we have,
what share of fraud do we catch?* A model that only performs at a 5% budget is
not deployable by a team of six.

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

`transaction_id` and `user_id` are identifiers — a tree will memorise "user 436
commits fraud", which generalises to nothing.

`Trashold Amount` correlates **0.008** with the label. It reads like a rule
threshold but behaves like noise: amount exceeds it in 4% of legitimate rows and
8% of fraud. Not enough signal to justify the variance it adds.

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

Amount barely separates the classes. That single row is why threshold rules alone
fail.

### Feature engineering

16 model features from 8 raw columns:

- `amount_log` — amounts are heavy-tailed; the log makes the scale usable
- `hour_sin`, `hour_cos` — **cyclical encoding**, because 23:00 and 00:00 are
  adjacent, not 23 units apart. Fraud clusters at 03:00 and a linear encoding
  would split that cluster across the midnight wrap-around
- `is_night` — explicit flag for before 06:00 or after 22:00
- `device_distrust` — `100 − trust`, giving trees a direct split on distrust
- `amount_per_velocity` — a large amount on an already-busy card is a different
  risk from the same amount on a quiet one
- `cat_*` — one-hot merchant categories

Training and serving import the **same** feature module (`app/csv_features.py`).
Training/serving skew — the two paths deriving features slightly differently — is
the most common reason a model that scores well offline fails in production.

### Methodology

**Stratified split with 5-fold cross-validation.** No time column exists, so a
temporal split is neither possible nor required. But 151 fraud cases makes a
single split an anecdote rather than a measurement, so every headline number is a
cross-validated mean with its standard deviation.

**No SMOTE.** Synthetic oversampling interpolates between fraud cases,
manufacturing cardholders who never existed — and applied before the split, as it
commonly is in tutorials, it leaks test information into training.
`class_weight="balanced"` rebalances without fabricating data.

**Threshold selected on cross-validated training predictions**, never on test.
Choosing an operating point on the test set is a quiet form of fitting to it.

---

## Setup

Two ways to run FraudGuard. **Docker is the recommended route** — one command, same
result on any machine. The manual route is for development.

### Option A — Docker (recommended)

#### Prerequisites

| Tool | Version |
| --- | --- |
| Docker Desktop (or Docker Engine + Compose v2) | any recent release |

No Node, Python or MongoDB install is needed — everything runs in containers.

#### What gets started

| Container | Image / build | Port | Purpose |
| --- | --- | --- | --- |
| `mongo` | `mongo:7` | internal | Database, persisted in the `mongo_data` volume |
| `ml-service` | `./ml-service` (Python 3.12) | 8000 | FastAPI model service |
| `backend` | `./backend` (Node 20) | 5000 | Express API and socket.io |
| `frontend` | `./frontend` → nginx | 5173 | React console; proxies `/api` and `/socket.io` to the backend |

Start-up order is enforced with health checks: the backend waits until MongoDB and
the ML model are healthy, so seeding never falls back to the heuristic scorer.

#### Files

```
fraudguard/
├── docker-compose.yml
├── .env.example                 (optional overrides, copy to .env)
├── backend/      Dockerfile, .dockerignore
├── ml-service/   Dockerfile, .dockerignore
└── frontend/     Dockerfile, .dockerignore, nginx.conf
```

#### Before the first build

The ML image copies the trained model artefacts into the container, so train the
model once on the host first:

```bash
cd ml-service
pip install -r requirements.txt
# dataset at ml-service/data/csv/transactions.csv
python training/train_csv.py        # ~60 seconds
cd ..
```

Confirm `ml-service/requirements.txt`, `backend/package-lock.json` and
`frontend/package-lock.json` exist — the images install from them.

#### Run

```bash
docker compose up --build
```

First build takes a few minutes (mostly Python packages). When the logs show the
ML service answering `/health` with 200 and the backend listening, load the data
from a **second terminal**:

```bash
docker compose run --rm backend npm run seed
```

Then open:

| URL | What |
| --- | --- |
| http://localhost:5173 | The console |
| http://localhost:5000/api/health | Should report `mode: service` |
| http://localhost:8000/docs | ML service interactive docs |

Sign in with the seeded accounts below.

Optional live traffic, from another terminal:

```bash
docker compose run --rm backend npm run simulate
```

#### Stop and restart

```bash
docker compose down            # stop and remove containers; data is kept
docker compose up              # start again (add --build only after code changes)
docker compose down -v         # also wipe the database
```

#### Configuration

Defaults work for a local demo. To override, copy `.env.example` to `.env` next to
`docker-compose.yml`:

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Signing secret — set a long random value for anything shared |
| `MONGO_URI` | Use Atlas instead of the bundled MongoDB container |
| `CLIENT_ORIGIN` | Comma-separated browser origins, e.g. when opening the console from another machine |
| `VITE_SOCKET_URL` | Only if the live feed does not connect through the nginx proxy; set to `http://localhost:5000` and rebuild |

Code is baked into the images at build time, so after changing any source file run
`docker compose up --build` again.

### Option B — Manual

#### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 18 or 20 LTS |
| Python | 3.12 or 3.13 |
| MongoDB | Atlas free tier |

#### Repository layout

```
fraudguard/
├── frontend/      React console        → port 5173
├── backend/       Express API          → port 5000
└── ml-service/    FastAPI inference    → port 8000
```

#### 1. Database

Free M0 cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas). Add a
database user; under Network Access allow `0.0.0.0/0` for development.

**Insert the database name before the `?`** — without it Mongoose silently
connects to a database called `test`:

```
mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/fraudguard?retryWrites=true&w=majority
```

#### 2. ML service — do this first

The backend calls it during seeding, so it needs to be up.

```bash
cd ml-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env
```

Place the dataset at `ml-service/data/csv/transactions.csv`, then:

```bash
python training/train_csv.py        # ~60 seconds
```

Add to `.env`:

```env
CSV_MODEL_VERSION=csv_v1
```

```bash
uvicorn app.main:app --reload --port 8000
```

Confirm both lines appear:

```
CSV model loaded: CSV-GradientBoosting
CSV model warmed — SHAP explainer ready
```

Interactive docs at `http://localhost:8000/docs`.

The virtual environment must be activated in **every new terminal** for this
folder.

#### 3. Backend

```bash
cd backend
npm install
copy .env.example .env
```

```env
PORT=5000
MONGO_URI=mongodb+srv://.../fraudguard?retryWrites=true&w=majority
JWT_SECRET=a_long_random_string
CLIENT_ORIGIN=http://localhost:5173
ML_ENABLED=true
ML_SERVICE_URL=http://localhost:8000
ML_TIMEOUT_MS=4000
```

```bash
npm run seed     # users, 33 rules, 400 transactions scored by the real model
npm run dev
```

`npm run seed` **wipes and rebuilds** the database. To add newly introduced rules to
an existing database without touching users, transactions or alerts — and without
resetting thresholds or weights you have already tuned — run:

```bash
npm run seed:rules
```

The seed run should produce **no** "ML service unavailable" lines. If it does,
the ledger fills with fallback scores and will contradict the simulator — stop
and fix the connection first.

Startup should read `Scoring mode: ML service`.

#### 4. Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

Vite proxies `/api` and `/socket.io` to port 5000, so no CORS setup is needed.

#### 5. Optional — live traffic

```bash
cd backend
npm run simulate     # one authorisation every 4 seconds
```

Populates the dashboard's live feed.

#### Running order

Four terminals: **ML service → backend → frontend → simulator**.

### Seeded accounts

| Email | Password | Role | Can edit rules |
| --- | --- | --- | --- |
| `analyst@bank.in` | `Analyst@123` | analyst | No |
| `supervisor@bank.in` | `Supervisor@123` | supervisor | Yes |
| `engineer@bank.in` | `Engineer@123` | engineer | Yes |

These are demo credentials. Change them, and set a real `JWT_SECRET`, before
exposing the system beyond a local machine.

---

## Verifying the model is actually connected

The most common silent failure is the backend falling back to its heuristic
scorer while everything still appears to work. Three ways to check, cheapest
first:

**In the UI** — the Model explanation panel names the scorer at the bottom:
`CSV-GradientBoosting — trained model`. If it says `FallbackLogistic`, the
connection is down.

**Contribution labels** — the trained model returns *Location mismatch*, *Device
trust score*, *Transaction velocity*. The fallback returns *Location distance*,
*Device trust*, *Transaction frequency*.

**API** — `Invoke-RestMethod http://localhost:5000/api/health` should report
`mode: service`.

---

## Screens

| Route | Purpose |
| --- | --- |
| `/` | Human-impact strip, 24-hour stats, engine-divergence scatter, decision split, rule-frequency panel |
| `/transactions` | Filterable ledger of every scored transaction |
| `/transactions/:id` | Full decision record — authorisation strip, fusion maths, rules fired, SHAP tape |
| `/alerts` | Review queue; each verdict becomes a training label |
| `/rules` | Threshold and weight editing for all 33 rules, weight-budget analysis |
| `/simulator` | Score a transaction through the live pipeline, with two scripted walkthroughs, optionally persisting it |

Every screen shares one pipeline. Editing a weight on `/rules` changes the next
score on `/simulator`; a persisted simulator run appears in `/transactions` and,
if it crosses the alert band, in `/alerts`.

The **authorisation strip** on the detail page is the signature component: one
0–100 scale carrying the rule tick, the model tick and the fused needle, with the
four decision bands beneath. It answers "did the rules or the model drive this?"
at a glance — the question that matters during a chargeback dispute.

---

## Rule engine

33 rules, each with an editable threshold and weight. Round 1 shipped six
single-threshold rules; Round 2 grew the engine to 33 in three families:
single-transaction thresholds, compound/contextual rules (combinations of signals,
or a signal measured against the cardholder's own history), and behavioural/sequence
rules (card testing, impossible travel, dormant-card reactivation) drawn from
standard card-fraud typologies.

| # | Code | Default | Weight | Family | What it catches |
|---|---|---|---|---|---|
| 1 | `AMOUNT_ANOMALY` | ₹50,000 | 25 | Threshold | High-value transaction |
| 2 | `TIME_ANOMALY` | 07:00 | 20 | Threshold | Outside normal activity window |
| 3 | `LOCATION_ANOMALY` | 300 km | 30 | Threshold | Far from last known point |
| 4 | `PATTERN_ANOMALY` | 1 | 15 | Threshold | First purchase in a category |
| 5 | `VELOCITY` | 8 / 24h | 20 | Threshold | Too many authorisations |
| 6 | `DEVICE_ANOMALY` | 1 | 15 | Threshold | Manually keyed card |
| 7 | `FOREIGN_TRANSACTION` | 1 | 20 | Contextual | Spend originating outside India |
| 8 | `IMPOSSIBLE_TRAVEL` | 900 km/h | 35 | Behavioural | Distance/time between swipes is physically impossible |
| 9 | `AMOUNT_VS_HISTORY` | 5× median | 20 | Contextual | Amount far above the cardholder's own norm |
| 10 | `HIGH_RISK_CATEGORY` | ₹20,000 | 15 | Compound | Jewellery / electronics / travel at value |
| 11 | `MANUAL_HIGH_VALUE` | ₹10,000 | 20 | Compound | Keyed-in card + large amount |
| 12 | `NIGHT_HIGH_VALUE` | ₹25,000 | 20 | Compound | Large amount 00:00–05:59 |
| 13 | `THRESHOLD_PROBING` | ₹50,000 | 15 | Behavioural | Amount at 90–99% of the review limit |
| 14 | `CUMULATIVE_SPEND_24H` | ₹1,00,000 | 20 | Behavioural | Many purchases adding up within 24h |
| 15 | `CARD_TESTING` | 3 in 1h | 25 | Behavioural | Run of micro-payments (≤ ₹100) validating a card |
| 16 | `TEST_THEN_DRAIN` | ₹20,000 | 30 | Behavioural | Large charge after micro-payment probes |
| 17 | `DORMANT_CARD_REACTIVATION` | 30 days | 15 | Behavioural | Idle card suddenly spends heavily |
| 18 | `MULTI_CITY_24H` | 3 cities | 25 | Behavioural | Several cities within a day |
| 19 | `CATEGORY_HOPPING` | 4 categories | 10 | Behavioural | Sampling many merchant types quickly |
| 20 | `DUPLICATE_AMOUNT` | 2 repeats | 15 | Behavioural | Same exact amount charged repeatedly |
| 21 | `FOREIGN_MANUAL` | 1 | 25 | Compound | Cross-border + keyed-in card details |
| 22 | `SWIPE_FALLBACK_HIGH_VALUE` | ₹25,000 | 15 | Compound | Magstripe swipe instead of chip at value |
| 23 | `AMOUNT_ZSCORE` | 3σ | 15 | Statistical | Outlier against the card's own spread |
| 24 | `NEW_CARD_HIGH_VALUE` | ₹20,000 | 15 | Compound | Large spend on a card with almost no history |
| 25 | `ROUND_AMOUNT` | ₹10,000 | 10 | Statistical | Exact round-thousand amounts |
| 26 | `CHIP_FALLBACK_SEQUENCE` | 2× median | 20 | Behavioural | Swipe at a higher amount after recent chip use |
| 27 | `CONTACTLESS_NEAR_LIMIT_BURST` | 3 in 1h | 25 | Behavioural | Taps of ₹3,000–5,000 probing the PIN-free limit |
| 28 | `HIGH_RISK_MCC_SPIKE` | 5× category median | 20 | Contextual | Risky-category spend far above the card's norm for it |
| 29 | `CASH_EQUIVALENT_FIRST_USE` | ₹10,000 | 25 | Compound | First crypto/prepaid/money-transfer/gambling use |
| 30 | `NEW_CARD_CONTACTLESS_CLUSTER` | 3 taps | 15 | Behavioural | Contactless burst on a newly active card |
| 31 | `LATE_NIGHT_NEW_CATEGORY_CONTACTLESS` | ₹2,500 | 15 | Compound | Night-time tap in a category new to the card |
| 32 | `MANUAL_AFTER_CHIP_HISTORY` | ₹1,000 | 20 | Behavioural | Keyed-in payment on a card with chip history |
| 33 | `HIGH_RISK_MCC_CONCENTRATION` | 3 txns / ₹15,000 | 20 | Behavioural | Repeated purchases in one risky category in a day |

### Severity scaling

A binary rule is the wrong shape for money: ₹50,001 and ₹8,00,00,000 are not the
same event, but a flat weight scored them identically. Threshold rules multiply
their weight by how far past the threshold the value sits:

| Ratio to threshold | Multiplier |
| --- | --- |
| 1–2× | 1.0× |
| 2–5× | 1.5× |
| 5–20× | 2.2× |
| 20–100× | 3.0× |
| 100×+ | 3.6× |

Some rules use a simpler fixed escalation (for example 1.0× to 1.5×) where a ratio
is not meaningful.

**Any single rule is capped at 60 points**, so one signal alone can never reach
the block band. A decision always rests on more than one thing. The combined rule
score is capped at 100.

### Data the rules use

All 33 rules run on data the system already holds — the transaction itself and the
card's 90-day history (last 200 transactions): amount, time, city, merchant
category, entry mode, and per-card aggregates such as median, standard deviation,
24-hour spend, distinct cities and categories, and recent chip/contactless use.
`featureBuilder.js` computes these once per authorisation.

### Governance

Rules are cached for 30 seconds; the cache is invalidated the instant one is
edited, so changes take effect on the next authorisation. Editing requires the
engineer or supervisor role — analysts see the values but the inputs are
disabled, with the reason shown. `npm run seed:rules` adds any missing rules
without resetting tuned values.

Rule weights are hand-set by policy, not optimised — that is what a rule engine is.
The model is the learned half; the rules are the auditable half.

---

## API reference

### ML service — port 8000

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | service status |
| `POST` | `/csv/predict` | score one transaction |
| `GET` | `/csv/info` | all benchmarked model metrics |
| `POST` | `/reload` | reload artefacts without a restart |

```json
POST /csv/predict
{
  "record": {
    "amount": 820, "transaction_hour": 3, "merchant_category": "Electronics",
    "foreign_transaction": 1, "location_mismatch": 1,
    "device_trust_score": 22, "velocity_last_24h": 6, "cardholder_age": 41
  }
}
```

```json
{
  "score": 90, "probability": 0.9,
  "supervisedScore": 100, "anomalyScore": 60,
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

37 ms (measured on a local run) sits comfortably inside a POS authorisation budget
of 100–300 ms. The backend also records the end-to-end `latencyMs` (rules plus
model) on every scored transaction.

### Backend — port 5000

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/api/auth/login` | public, 10 attempts / 15 min |
| `GET` | `/api/auth/me` | signed-in |
| `GET` | `/api/health` | public, reports scoring mode |
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

## Demo

### Story one — "One card, one day"

Six moments on the same card, each a toggle in the Simulator's right rail. Switch
any on or off; the score recomputes.

| Time | Signal | Model score |
| --- | --- | --- |
| 09:14 | Groceries near home *(always on)* | ~9 |
| 14:02 | + different city | ~12 |
| 14:05 | + card number keyed in by hand | ~13 |
| **03:11** | **+ three in the morning** | **~83** |
| 03:12 | + terminal abroad | ~89 |
| 03:20 | + ninth attempt today | ~90 |

The first moment is always on because it is the **baseline**: the normal purchase
every later moment is compared against. Distance, impossible-travel and history
rules all need a prior transaction to measure from.

The jump between 14:05 and 03:11 is the argument. The model learned that fraud
needs several signals together — an odd location on a manual entry is unusual;
the same thing at 3am is fraud. No single threshold produces that.

Because they are toggles rather than a fixed sequence, a judge can **remove** the
3am and watch the score collapse with everything else still switched on. That
demonstrates dependency, which narration cannot.

### Story two — "When the customer is real"

The more important one. A system catching fraud is table stakes; a system not
catching a customer is what keeps a bank's revenue.

| Step | Effect |
| --- | --- |
| ₹1,20,000 laptop on a card that spends ₹1,000–5,000 *(always on)* | Scores into Alert |
| + same phone, same home network | −10 |
| + approved by fingerprint in nine seconds | −45 → **Approve** |
| + but the card is on the blocklist | **Override → Block** |

Here the always-on laptop is the **event being judged**, not a baseline; the
remaining steps are identity evidence that tries to clear it.

### Where the engines disagree

Two buttons, identical transactions apart from card usage today. The rule score
triples; the model does not move. The model learned velocity separates the
classes weakly (fraud 3.2/day against legitimate 2.0); the rule fires because a
bank has policy reasons to look at a card used twelve times in a day.

That divergence is the answer to *"why not just use the model?"*

### End-to-end, five clicks

Rule engine (as engineer) → Simulator with *Write to the ledger* on → run the
fraud case → **Open in ledger** → **View alert queue** → confirm fraud.

One continuous story: policy layer, learned model, fused decision, audit trail,
training label.

---

## Known limitations

**PR AUC of 0.988 is inflated because the dataset is synthetic.** Fraud here was
generated from clean rules and separates far more cleanly than real traffic.
Importance spread across seven features rules out a leak, but production on this
architecture should expect **0.4–0.8**.

**The 27 Round 2 rules are unit-tested, not validated on labelled fraud data.**
Each was checked against constructed transactions to confirm it fires when intended
and stays quiet on a normal one. None has measured precision or recall, because the
dataset has no card history, sequence or merchant detail to evaluate them against.
Defaults come from standard card-fraud typologies, not from tuning. In production
they should first run in **shadow mode** (scoring without affecting decisions),
then be tuned on analyst verdicts.

**The ML model does not use the new rules' signals.** The trained model sees the
eight raw dataset features; the Round 2 rules feed the rule score only. Combining
rule-derived features into the model is on the roadmap.

**More rules raise alert volume.** Several rules overlap by design (compound rules
fire alongside their component signals), and the "three or more rules fired"
escalation floor counts them. Check the Alert/Block share after changing the rule
set and raise the floor or lower weights if it is too aggressive.

**Some rule inputs are not available.** Rules that need merchant-level aggregates,
authorisation decline codes, refund transactions or a festival calendar are not
built, because the system does not capture that data.

**Amounts are rescaled between the two systems.** The model was trained on
amounts in a 5–3000 band; the console works in rupees. A power compression maps
one to the other (`mapAmount` in `backend/src/services/mlClient.js`). This
matters less than it looks — amount carries 0.029 importance — and severity on
amount is the rule engine's job, working in real rupees. It is still a real seam.

**Historical aggregates run a database query per authorisation.** Fine at 400
rows, fatal at real POS latency. They belong in Redis as a precomputed feature
store. The Round 2 rules add more per-card aggregates, which makes this more
important.

**Retraining carries selection bias.** Outcomes are only ever learned for
transactions the system flagged, so the model cannot learn from its own misses,
and each retrain grows more confident about patterns it already knows. The fix is
routing a random sample of *approved* transactions into the review queue.

**Auto-block at 81+ has real customer cost.** A manual override path is required
before production.

**The verification layer is simulated.** Biometric push, device fingerprinting
and blocklist lookup are modelled as inputs with fixed weights, not integrated
with a real 3-D Secure or device-intelligence provider. The architecture and the
override semantics are the contribution; the integrations are not built.

**Rule weights are hand-set, not optimised.** That is what a rule engine is —
banks set weights by policy, not by gradient descent. The model is the learned
half; the rules are the auditable half.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Explanation shows *Location distance* / *Device trust* | fallback scorer in use | check `ML_ENABLED=true`, restart backend fully |
| `ML service unavailable (timeout)` | SHAP cold start | `ML_TIMEOUT_MS=4000`; the model warms at startup |
| `ModuleNotFoundError: numpy` | venv not active | `.\.venv\Scripts\Activate.ps1` |
| `.venv could not be loaded` | folder deleted by re-extraction | `py -m venv .venv`, reinstall |
| `Building wheel for scikit-learn` | pinned versions without 3.13 wheels | use the loosened `requirements.txt` |
| `MongoDB connected: test` | database name missing from URI | add `/fraudguard` before the `?` |
| `PATCH /api/rules 403` | signed in as analyst | sign in as `engineer@bank.in` |
| Ledger scores contradict simulator | seeded before a fix | re-run `npm run seed` with the ML service up |
| `/rules` shows only 6 rules | rules added after the database was seeded | run `npm run seed:rules` (or `npm run seed` to rebuild) |
| `curl -X` fails in PowerShell | `curl` is aliased | `Invoke-RestMethod -Method Post` |
| Docker: `ml-service` stays unhealthy | model artefacts missing from the image, or wrong entry point | run `python training/train_csv.py` before building; check `docker compose logs ml-service` |
| Docker: backend never starts | waiting on an unhealthy dependency | `docker compose ps`, then `docker compose logs mongo ml-service` |
| Docker: live feed empty | socket URL not resolved through the proxy | set `VITE_SOCKET_URL=http://localhost:5000` in `.env`, then `docker compose up --build` |
| Docker: code change has no effect | image still holds the old code | `docker compose up --build` |
| Docker: console loads, API calls fail from another machine | origin not allowed | set `CLIENT_ORIGIN` in `.env` to that address |

Outside Docker, `.env` is read once at startup — nodemon's reload does not pick up
changes to it. A full Ctrl+C and restart is required. Under Docker, changes to
`.env` take effect on the next `docker compose up`.

---

## Roadmap

- Unify the rule engine and model feature sets behind one contract, removing the
  amount rescaling seam, and feed the Round 2 rule signals into the model
- Measure the fused system against each engine alone, to prove the hybrid earns
  its complexity
- Shadow-mode deployment for new rules, with a per-rule dashboard of alerts,
  precision, recall and incremental lift
- Merchant-level rules (merchant velocity, merchant-normal amount outliers) once
  merchant history is retained
- Capture authorisation response codes and refunds to enable test-attempt and
  refund-asymmetry rules
- Redis feature store for historical aggregates
- Random-sample review queue to correct retraining bias
- Async SHAP, keeping the decision path under 100 ms
- Manual override on auto-block
- Model versioning with shadow deployment before promotion