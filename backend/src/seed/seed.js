import mongoose from 'mongoose';
import env from '../config/env.js';
import connectDB from '../config/db.js';
import User from '../models/User.js';
import Rule from '../models/Rule.js';
import Transaction from '../models/Transaction.js';
import Alert from '../models/Alert.js';
import { scoreTransaction } from '../services/riskEngine.js';
import { cityCoords } from '../services/featureBuilder.js';
import { invalidateRuleCache } from '../services/ruleEngine.js';
import { RULES } from './rulesData.js';



const CITIES = ['Pune', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Jaipur', 'Kolkata'];
const CATEGORIES = ['GROCERY', 'FUEL', 'RESTAURANT', 'ELECTRONICS', 'TRAVEL', 'JEWELLERY'];
const MERCHANTS = {
  GROCERY: 'DMart Supercentre',
  FUEL: 'HP Petro Point',
  RESTAURANT: 'Barbeque Junction',
  ELECTRONICS: 'Vertex Electronics',
  TRAVEL: 'SkyRoute Travel',
  JEWELLERY: 'Sanchi Jewellers',
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function run() {
  await connectDB();

  console.log('Clearing collections…');
  await Promise.all([
    User.deleteMany({}),
    Rule.deleteMany({}),
    Transaction.deleteMany({}),
    Alert.deleteMany({}),
  ]);

  await User.create([
    { name: 'Risk Analyst', email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, role: 'analyst' },
    { name: 'Ops Supervisor', email: 'supervisor@bank.in', password: 'Supervisor@123', role: 'supervisor' },
    { name: 'Risk Engineer', email: 'engineer@bank.in', password: 'Engineer@123', role: 'engineer' },
  ]);
  console.log('Users created');

  await Rule.insertMany(RULES);
  invalidateRuleCache();
  console.log(`${RULES.length} rules created`);

  // 400 normal-ish transactions across 8 cards over 14 days
  const cards = Array.from({ length: 8 }, (_, i) => ({
    cardId: `CARD-${4400 + i * 11}`,
    homeCity: CITIES[i % CITIES.length],
    holder: ['R. Sharma', 'A. Iyer', 'M. Khan', 'P. Nair', 'S. Gupta', 'D. Bose', 'K. Reddy', 'N. Shah'][i],
  }));

  let created = 0;
  for (let i = 0; i < 400; i += 1) {
    const card = pick(cards);
    const daysAgo = Math.random() * 14;
    const when = new Date(Date.now() - daysAgo * 86400_000);

    // ~6% of traffic is deliberately anomalous, close to a realistic fraud base rate
    const suspicious = Math.random() < 0.06;
    when.setHours(suspicious ? rand(0, 5) : rand(8, 22), rand(0, 59), 0, 0);

    const category = suspicious ? pick(['ELECTRONICS', 'JEWELLERY', 'TRAVEL']) : pick(CATEGORIES);
    const city = suspicious ? pick(CITIES.filter((c) => c !== card.homeCity)) : card.homeCity;
    const amount = suspicious ? rand(60000, 190000) : rand(300, 9000);

    const input = {
      amount,
      timestamp: when.toISOString(),
      merchantCategory: category,
      city,
      homeCity: card.homeCity,
      entryMode: suspicious && Math.random() < 0.5 ? 'MANUAL' : pick(['CHIP', 'CONTACTLESS', 'SWIPE']),
      cardId: card.cardId,
    };

    const result = await scoreTransaction(input);
    const coords = cityCoords(city) || [];

    const tx = await Transaction.create({
      transactionId: `TX${1000 + i + 1}`,
      timestamp: when,
      amount,
      currency: 'INR',
      card: { cardId: card.cardId, masked: `**** **** **** ${card.cardId.slice(-4)}`, network: 'VISA' },
      cardholder: { id: `CH-${card.cardId.slice(-4)}`, name: card.holder, homeCity: card.homeCity },
      merchant: { id: `M-${rand(1000, 9999)}`, name: MERCHANTS[category], category },
      location: { city, country: 'IN', lat: coords[0], lng: coords[1] },
      device: { terminalId: `POS-${city.slice(0, 2).toUpperCase()}-${rand(1, 99).toString().padStart(4, '0')}`, entryMode: input.entryMode },
      ruleScore: result.ruleScore,
      mlScore: result.mlScore,
      finalScore: result.finalScore,
      fusion: result.fusion,
      band: result.band,
      decision: result.decision,
      flags: result.flags,
      model: result.model,
      explanation: result.explanation,
      latencyMs: result.latencyMs,
    });

    if (['ALERT', 'BLOCK'].includes(tx.decision)) {
      await Alert.create({
        transactionId: tx.transactionId,
        transaction: tx._id,
        amount: tx.amount,
        finalScore: tx.finalScore,
        band: tx.band,
        merchant: tx.merchant,
        location: tx.location,
        flags: tx.flags,
      });
    }
    created += 1;
  }

  const alertCount = await Alert.countDocuments();
  console.log(`${created} transactions created, ${alertCount} alerts raised`);
  console.log(`\nSign in with: ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});