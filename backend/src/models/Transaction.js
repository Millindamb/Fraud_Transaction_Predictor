import mongoose from 'mongoose';

const flagSchema = new mongoose.Schema(
  { code: String, detail: String, weight: Number },
  { _id: false }
);

const contributionSchema = new mongoose.Schema(
  { feature: String, value: Number },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    timestamp: { type: Date, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    card: { masked: String, cardId: String, network: String },
    cardholder: { id: String, name: String, homeCity: String },
    merchant: { id: String, name: String, category: String },
    location: { city: String, country: String, lat: Number, lng: Number },
    device: { terminalId: String, entryMode: String },

    ruleScore: { type: Number, required: true, min: 0, max: 100 },
    mlScore: { type: Number, required: true, min: 0, max: 100 },
    finalScore: { type: Number, required: true, min: 0, max: 100, index: true },

    fusion: {
      strategy: String,
      weights: { rule: Number, ml: Number },
    },

    band: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], index: true },
    decision: { type: String, enum: ['APPROVE', 'MONITOR', 'ALERT', 'BLOCK'] },

    flags: [flagSchema],
    model: { name: String, version: String, confidence: Number, source: String },
    explanation: { baseValue: Number, contributions: [contributionSchema] },
    // How the model's inputs were obtained — direct, mapped or derived
    adapter: { type: mongoose.Schema.Types.Mixed, default: null },

    preVerificationScore: Number,
    verification: {
      applied: [{ code: String, label: String, detail: String, kind: String, _id: false }],
      overridden: Boolean,
    },

    latencyMs: Number,
  },
  { timestamps: true }
);

// The ledger is almost always read newest-first, filtered by band
transactionSchema.index({ timestamp: -1, band: 1 });
transactionSchema.index({ 'merchant.name': 'text', 'card.masked': 'text', transactionId: 'text' });

export default mongoose.model('Transaction', transactionSchema);