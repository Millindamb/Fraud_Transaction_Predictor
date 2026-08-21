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
