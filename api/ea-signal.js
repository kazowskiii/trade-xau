// Endpoint khusus untuk Expert Advisor (EA) MT5.
// Mengembalikan sinyal dalam format teks "key=value" (lebih mudah diparse MQL5 daripada JSON).
// WAJIB set environment variable EA_TOKEN di Vercel. Request harus membawa header: X-EA-Token: <token>
const crypto = require('crypto');
const { generateSignal } = require('../lib/signalEngine');

let cached = null;
let lastFetch = 0;
const CACHE_MS = 30 * 1000;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const expected = process.env.EA_TOKEN;
  if (!expected || expected.length < 16) {
    res.status(500).send('error=EA_TOKEN belum diset (min 16 karakter)');
    return;
  }
  if (!safeEqual(req.headers['x-ea-token'], expected)) {
    res.status(401).send('error=unauthorized');
    return;
  }

  const now = Date.now();
  if (!cached || now - lastFetch > CACHE_MS) {
    try {
      cached = await generateSignal();
      lastFetch = now;
    } catch (err) {
      if (!cached) {
        res.status(502).send('error=' + String(err.message).replace(/[\r\n]/g, ' '));
        return;
      }
    }
  }

  const s = cached;
  const serverTs = Math.floor(Date.now() / 1000);
  const age = Math.floor((Date.now() - new Date(s.timestamp).getTime()) / 1000);
  const lines = [`server_ts=${serverTs}`, `age=${age}`];

  if (s.entryStatus !== 'READY') {
    lines.push('status=WAIT');
  } else {
    lines.push('status=READY');
    lines.push(`id=${s.entrySignal}_${s.entry}_${s.activeZone.tf}`);
    lines.push(`symbol=${s.symbol}`);
    lines.push(`side=${s.entrySignal}`);
    lines.push(`entry=${s.entry}`);
    lines.push(`sl=${s.stopLoss}`);
    lines.push(`score=${s.confluenceScore}`);
    lines.push(`counter=${s.isCounterTrend ? 1 : 0}`);
    lines.push(`tp_count=${s.takeProfits.length}`);
    s.takeProfits.forEach((tp, i) => lines.push(`tp${i + 1}=${tp.price}`));
  }
  res.status(200).send(lines.join('\n'));
};
