# ULB Credit Card Fraud — Implementation Notes

Dataset: [mlg-ulb/creditcardfraud](https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud)
Université Libre de Bruxelles, September 2013, 284,807 European card
transactions over two days, 492 of them fraudulent (0.172%).

## Setup

1. Download `creditcard.csv` from Kaggle (~144 MB, requires a free account)
2. Place it at `ml-service/data/ulb/creditcard.csv`
3. Train:

```powershell
python training/train_ulb.py
```

Roughly 5–12 minutes. Add `--quick` to skip RandomForest and halve that.

4. Serve — add to `.env`, then restart uvicorn:

```
ULB_MODEL_VERSION=ulb_v1
```

5. Verify against real held-out rows:

```powershell
python tools/replay_ulb.py --n 300
```

Endpoints: `POST /ulb/predict`, `POST /ulb/predict/batch`, `GET /ulb/info`.

## What this dataset can and cannot do

The features are **V1–V28: PCA components**, anonymised for confidentiality.
Only `Time` and `Amount` survive in original form. Two consequences:

**It cannot drive the live POS console.** A payment terminal emits an amount, a
merchant ID and a location — not 28 principal components. The ULB model is
therefore the benchmark deliverable, and the POS model (`training/train.py`)
remains what the rule engine fuses with. Both are served by the same FastAPI
process under separate routes.

**Explainability is structurally limited.** SHAP will report that V17 contributed
+0.42, which means nothing to a fraud analyst. This is a property of the
anonymised data, not a gap in the implementation, and the API says so explicitly
in the `note` field of every ULB explanation. Worth stating plainly in your
report rather than glossing over — it is the central trade-off of using this
dataset.

## Methodology, and why it differs from most published work

**Temporal split, not random.** The rows are ordered in time across a two-day
capture. `train_test_split` lets the model see transactions from *after* those
it is tested on, which is information it would never have at authorisation time.
Nearly every public notebook on this dataset does exactly that and reports an
inflated figure. Splitting on `Time` (60/20/20) costs a few points of measured
performance and is the number you can defend.

**No SMOTE.** Synthetic oversampling interpolates between fraud cases in PCA
space, manufacturing transactions that never occurred — and when applied before
the split, as it usually is, it leaks test information directly into training.
`class_weight="balanced"` achieves the same rebalancing without fabricating
data.

**Threshold selected on validation.** Choosing the operating point on the test
set is a quiet form of fitting to it. Hence the three-way split.

**Accuracy is never reported.** Predicting "legitimate" for everything scores
99.83% here and catches zero fraud. PR AUC is the headline; ROC AUC is printed
only to show how misleadingly high it runs under this imbalance.

## What to report

Four models are trained and compared: LogisticRegression, HistGradientBoosting,
RandomForest, and IsolationForest as an unsupervised baseline. The champion is
chosen on PR AUC and saved; every model's numbers land in
`models/metadata_ulb_v1.json` for your write-up.

Two tables matter more than the headline metric:

**Alert budgets** — recall and precision when only the riskiest 0.05%, 0.1%,
0.2%, 0.5%, 1% and 2% of traffic is reviewed. This answers the operational
question directly: *given the review capacity we have, what share of fraud do we
catch?* A model that only performs at a 5% budget is not deployable by a team of
six.

**Error economics** — a missed fraud costs the transaction amount; a false alarm
costs analyst time (₹150 per review by default, `--review-cost` to change). This
reframes threshold choice as the business decision it actually is, rather than
maximising F1 for its own sake. Expect the cost-optimal threshold to sit well
below the F1-optimal one, because a missed high-value fraud is far more
expensive than a wasted review.

## Expected results

On a temporal split, PR AUC in the **0.70–0.82** range is a good result for the
tree models; LogisticRegression usually lands somewhat lower but trains in
seconds and is trivially auditable — worth reporting for that reason alone.

If you see PR AUC above 0.95, something has leaked. Check that the split is
temporal and that no resampling ran before it.

IsolationForest will trail the supervised models substantially. That is the
expected and correct result — it never sees a label. It is included because it
flags transactions unlike anything in the training set at all, which is where a
purely supervised model is blind.
