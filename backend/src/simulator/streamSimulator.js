/**
 * Pushes synthetic authorisations at the running API so the live feed on the
 * dashboard has something to show during development. Run it in a third
 * terminal alongside the server and the client.
 */
import axios from 'axios';
import env from '../config/env.js';

const API = `http://localhost:${env.PORT}/api`;
const INTERVAL_MS = Number(process.argv[2]) || 4000;

const CITIES = ['Pune', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad'];
const CATEGORIES = ['GROCERY', 'FUEL', 'RESTAURANT', 'ELECTRONICS', 'TRAVEL', 'JEWELLERY'];
const CARDS = ['CARD-4400', 'CARD-4411', 'CARD-4422', 'CARD-4433'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  const { data } = await axios.post(`${API}/auth/login`, {
    email: env.SEED_ADMIN_EMAIL,
    password: env.SEED_ADMIN_PASSWORD,
  });
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };
  console.log(`Streaming a transaction every ${INTERVAL_MS} ms. Ctrl+C to stop.`);

  setInterval(async () => {
    const suspicious = Math.random() < 0.15;
    const payload = {
      amount: suspicious ? rand(55000, 180000) : rand(200, 8000),
      hour: suspicious ? rand(0, 5) : rand(8, 22),
      merchantCategory: pick(CATEGORIES),
      city: pick(CITIES),
      homeCity: 'Pune',
      entryMode: suspicious && Math.random() < 0.5 ? 'MANUAL' : 'CHIP',
      cardId: pick(CARDS),
      persist: true,
    };

    try {
      const res = await axios.post(`${API}/transactions/score`, payload, auth);
      console.log(`${res.data.transactionId}  ₹${payload.amount}  score ${res.data.finalScore}  ${res.data.decision}`);
    } catch (err) {
      console.error('Stream error:', err.response?.data?.message || err.message);
    }
  }, INTERVAL_MS);
}

main().catch((err) => {
  console.error('Could not start simulator:', err.response?.data?.message || err.message);
  process.exit(1);
});
