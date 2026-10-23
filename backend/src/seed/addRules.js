/**
 * Non-destructive: adds any missing rules to an existing database without
 * touching users, transactions or alerts, and without resetting the thresholds
 * or weights an engineer has already tuned on the rules that exist.
 *
 *   npm run seed:rules
 */
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Rule from '../models/Rule.js';
import { RULES } from './rulesData.js';

async function run() {
  await connectDB();
  let added = 0;
  for (const rule of RULES) {
    const res = await Rule.updateOne({ code: rule.code }, { $setOnInsert: rule }, { upsert: true });
    if (res.upsertedCount) {
      added += 1;
      console.log(`+ ${rule.code}`);
    }
  }
  console.log(`${added} rule(s) added, ${RULES.length - added} already present. Total: ${await Rule.countDocuments()}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});