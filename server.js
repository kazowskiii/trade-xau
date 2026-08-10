require('dotenv').config();
const express = require('express');
const path = require('path');
const { generateSignal } = require('./lib/signalEngine');

const app = express();
const PORT = process.env.PORT || 3000;
const REFRESH_MINUTES = Number(process.env.REFRESH_INTERVAL_MINUTES || 5);

let cachedSignal = null;
let lastError = null;
let isRefreshing = false;

async function refreshSignal() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const signal = await generateSignal();
    cachedSignal = signal;
    lastError = null;
    console.log(`[${new Date().toISOString()}] Signal diperbarui: ${signal.direction} (score ${signal.confluenceScore}/${signal.maxScore})`);
  } catch (err) {
    lastError = err.message;
    console.error(`[${new Date().toISOString()}] Gagal refresh signal:`, err.message);
  } finally {
    isRefreshing = false;
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/signal', async (req, res) => {
  if (!cachedSignal && !lastError) {
    // Belum ada cache sama sekali -> tunggu hasil pertama
    await refreshSignal();
  }
  if (lastError && !cachedSignal) {
    return res.status(502).json({ error: lastError });
  }
  res.json({ ...cachedSignal, cacheError: lastError });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, lastRefresh: cachedSignal ? cachedSignal.timestamp : null });
});

app.listen(PORT, () => {
  console.log(`XAUUSD Signal App jalan di port ${PORT}`);
  refreshSignal();
  setInterval(refreshSignal, REFRESH_MINUTES * 60 * 1000);
});
