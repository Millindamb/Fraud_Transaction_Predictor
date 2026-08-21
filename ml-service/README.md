# FraudGuard — ML Service (Part 3 of 4)

FastAPI service that scores POS transactions and explains why. Sits in
`ml-service/`, beside `backend/` and `frontend/`.

## Setup

```bash
cd ml-service
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env

python training/generate_dataset.py    # 60k rows, 0.4% fraud
python training/train.py               # ~2 min, writes models/
uvicorn app.main:app --reload --port 8000
```

Check it: `http://localhost:8000/health` and interactive docs at `/docs`.

Then point the Node backend at it — in `backend/.env`:

```
ML_ENABLED=true
ML_SERVICE_URL=http://localhost:8000
```

Restart the backend. `GET /api/health` should now report
`"scoring": { "mode": "service" }`. Nothing else changes; the fallback scorer
stays in place as the timeout path.

You now run four processes: Mongo (Atlas), backend, frontend, ML service.

## Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | model name, version, trained-at, stored metrics |
| `POST` | `/predict` | `{ features }` → score, probability, explanation |
| `POST` | `/predict/batch` | up to 500 at once, for backfills |
| `POST` | `/reload` | reload artefacts after a retrain, no restart |

## Two models, on purpose

**GradientBoosting** is the supervised model — it learns the fraud patterns
present in the labelled data.

**IsolationForest** is trained on legitimate traffic only, so "unlike anything
normal" means something precise. It exists to catch attack patterns that have
never been labelled, which is exactly where a purely supervised model is blind.

They are blended 0.75 / 0.25 inside the service, tunable in `.env`. The Node
backend then blends *that* result with the rule score — two fusion layers, and
both are configurable rather than hard-coded.

## Class imbalance

Fraud is 0.4% of the synthetic set, close to reality. Consequences baked into
the code:

- **Accuracy is not reported.** A model that approves everything scores 99.6%
  and catches zero fraud. `train.py` reports PR AUC and recall at fixed alert
  budgets instead.
- **`compute_sample_weight("balanced")`** rather than SMOTE. Oversampling
  transaction data tends to synthesise cardholders who never existed.
- **Stratified splits**, or a random test set can end up with almost no fraud.

The alert-budget table is the part to read. It answers the operational question
directly: *if my team can review 1% of traffic, what share of fraud do we
catch?* A team of six cannot review 5% of a million transactions, so a model
that only looks good at a 5% budget is not deployable.

## Three fraud archetypes

`generate_dataset.py` generates three distinct patterns, not one:

- **Card-not-present** — large amount, odd hour, distant city, keyed-in PAN
- **Testing** — tiny probing charges in rapid succession before the real hit
- **Travel burst** — mid-value, high velocity, plausible-looking geography

This matters because a single archetype teaches the model that "large amount =
fraud", and it will then miss every testing attack. The testing archetype is
deliberately *low* value so amount alone cannot separate the classes.

Legitimate traffic includes real travel (18% out-of-home-city). Without it the
model learns "different city = fraud" — the exact useless rule your simulator
run exposed, where a ₹366 transaction scored 46 because the location rule fires
on nearly everything.

## Explanations

SHAP `TreeExplainer` on the supervised model. `hour_sin` and `hour_cos` are one
concept to an analyst, so display duplicates are merged before ranking, and the
top 6 signed contributions are returned. They render directly in the SHAP tape
on the transaction detail screen.

If SHAP fails to load, scoring continues without explanations. An explanation is
a nice-to-have; a scoring decision is not.

## The feedback loop

```bash
python training/retrain_from_labels.py
python training/train.py --data data/labelled_set.csv --version v2
python training/evaluate.py --model models/fraud_model_v2.joblib
```

Then set `MODEL_VERSION=v2` and `POST /reload`.

**Read the selection-bias warning that script prints.** You only learn outcomes
for transactions the system flagged. Fraud that scored low was never reviewed,
so the model literally cannot learn from its own misses — and each retrain makes
it more confident about the patterns it already knows. The fix is to route a
small random sample of *approved* transactions into the review queue. Unglamorous,
and the single most important thing for keeping the model honest over time.

## Latency

Prediction is roughly 5–15 ms; SHAP adds 20–60 ms. POS authorisation typically
needs a decision inside 100–300 ms end to end. If the budget tightens, set
`EXPLAIN_ENABLED=false` and compute explanations asynchronously after the
decision — the score is what the terminal is waiting on.
