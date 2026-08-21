import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },

    amount: Number,
    finalScore: Number,
    band: String,
    merchant: { id: String, name: String, category: String },
    location: { city: String, country: String },
    flags: [{ code: String, detail: String, weight: Number, _id: false }],

    status: {
      type: String,
      enum: ['open', 'confirmed', 'dismissed'],
      default: 'open',
      index: true,
    },
    // These two fields are the training labels the model retrains on
    outcome: { type: String, enum: ['fraud', 'legitimate', null], default: null },
    note: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
  { timestamps: true }
);

alertSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Alert', alertSchema);
