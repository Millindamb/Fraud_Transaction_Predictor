import mongoose from 'mongoose';

const ruleSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      enum: [
        'AMOUNT_ANOMALY',
        'TIME_ANOMALY',
        'LOCATION_ANOMALY',
        'PATTERN_ANOMALY',
        'VELOCITY',
        'DEVICE_ANOMALY',
        // Round 2 additions
        'FOREIGN_TRANSACTION',
        'IMPOSSIBLE_TRAVEL',
        'AMOUNT_VS_HISTORY',
        'HIGH_RISK_CATEGORY',
        'MANUAL_HIGH_VALUE',
        'NIGHT_HIGH_VALUE',
        'THRESHOLD_PROBING',
        'CUMULATIVE_SPEND_24H',
        // Round 2 — behavioural / sequence rules
        'CARD_TESTING',
        'TEST_THEN_DRAIN',
        'DORMANT_CARD_REACTIVATION',
        'MULTI_CITY_24H',
        'CATEGORY_HOPPING',
        'DUPLICATE_AMOUNT',
        'FOREIGN_MANUAL',
        'SWIPE_FALLBACK_HIGH_VALUE',
        'AMOUNT_ZSCORE',
        'NEW_CARD_HIGH_VALUE',
        'ROUND_AMOUNT',
        // Round 2 — entry-mode and category sequence rules
        'CHIP_FALLBACK_SEQUENCE',
        'CONTACTLESS_NEAR_LIMIT_BURST',
        'HIGH_RISK_MCC_SPIKE',
        'CASH_EQUIVALENT_FIRST_USE',
        'NEW_CARD_CONTACTLESS_CLUSTER',
        'LATE_NIGHT_NEW_CATEGORY_CONTACTLESS',
        'MANUAL_AFTER_CHIP_HISTORY',
        'HIGH_RISK_MCC_CONCENTRATION',
      ],
    },
    name: { type: String, required: true },
    description: String,
    threshold: { type: Number, required: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
    enabled: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default mongoose.model('Rule', ruleSchema);