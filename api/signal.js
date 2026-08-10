const { generateSignal } = require('../lib/signalEngine');

// Cache sederhana di memory (bertahan selama serverless function "hangat")
let cachedSignal = null;
let lastFetchTime = 0;
let lastError = null;
const CACHE_MS = 60 * 1000; // 1 menit

module.exports = async (req, res) => {
  const now = Date.now();
  const isStale = !cachedSignal || now - lastFetchTime > CACHE_MS;

  if (isStale) {
    try {
      const signal = await generateSignal();
      cachedSignal = signal;
      lastError = null;
      lastFetchTime = now;
    } catch (err) {
      lastError = err.message;
      if (!cachedSignal) {
        res.status(502).json({ error: lastError });
        return;
      }
    }
  }

  res.status(200).json({ ...cachedSignal, cacheError: lastError });
};