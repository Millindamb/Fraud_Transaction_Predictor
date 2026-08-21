# Business-Feature Fraud Model — Quick Start

Dataset: `credit_card_fraud_10k.csv` — 10,000 transactions, 151 fraud (1.51%).

Unlike the ULB dataset, every column here is a real business attribute, so the
model's explanations are readable by an analyst. This is the model to demo.

## Run it

```powershell
# 1. Place the CSV
#    ml-service/data/csv/transactions.csv

# 2. Train (about 60 seconds)
python training/train_csv.py

# 3. Add to .env, then restart uvicorn
#    CSV_MODEL_VERSION=csv_v1

# 4. Try it at http://localhost:8000/docs  ->  POST /csv/predict
```

Sample request body:

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

Returns score 90/100 with signed contributions — transaction velocity, foreign
flag, location mismatch, hour, device trust — each named in plain language.

`GET /csv/info` returns every model's metrics for your slides.

## Results

| Model | CV PR AUC | Test PR AUC | Recall | Precision |
| --- | --- | --- | --- | --- |
| LogisticRegression | 0.694 ± 0.070 | 0.659 | 60.0% | 50.0% |
| RandomForest | 0.825 ± 0.056 | 0.902 | 76.7% | 92.0% |
| **GradientBoosting** | **0.988 ± 0.010** | 0.999 | 100% | 81.1% |
| IsolationForest | — | 0.231 | — | — |

Feature importance: transaction hour 0.20, foreign transaction 0.16, device
trust 0.27 (two terms), location mismatch 0.13, velocity 0.12.

## Say this in the presentation

**The 0.99 is high because the dataset is synthetic.** Fraud here was generated
from clean rules, so it separates far more cleanly than real traffic ever does.
Importance is spread across seven features rather than concentrated in one,
which rules out a single-feature leak — but a real deployment on this
architecture should expect PR AUC in the 0.4–0.8 range. Claiming a 99% fraud
detector is the fastest way to lose a viva; explaining *why* the number is high
is the fastest way to win one.

**Accuracy is never reported.** Predicting "legitimate" for everything scores
98.5% here and catches nothing. PR AUC is the headline metric.

**Three columns were excluded, deliberately.** `transaction_id` and `user_id`
are identifiers — a tree will memorise "user 436 commits fraud", which
generalises to nothing. `Trashold Amount` correlates 0.008 with the label:
it looks like a rule threshold but behaves like noise.

**Cross-validation, not a single split.** With 151 fraud cases, a single 20%
test set holds ~30 examples and one lucky split can swing recall by ten points.
Every headline number is a 5-fold cross-validated mean with its standard
deviation. Note that LogisticRegression's ±0.070 spread is wide — that
uncertainty is real and worth showing.

**The alert-budget table is the operational answer.** At a 1% review budget the
model catches 66.7% of fraud with 100% precision; at 2% it catches everything at
75% precision. That is the number an operations manager needs, and most student
projects do not have it.
