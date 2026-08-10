// Semua fungsi menerima array angka (close price), urut kronologis (lama -> baru)

function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  // Mulai dengan SMA sebagai seed
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function lastValue(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== undefined && !Number.isNaN(arr[i])) return arr[i];
  }
  return null;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (values.length < slowPeriod + signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null };
  }
  const fastEma = ema(values, fastPeriod);
  const slowEma = ema(values, slowPeriod);

  const macdSeries = [];
  for (let i = 0; i < values.length; i++) {
    if (fastEma[i] !== undefined && slowEma[i] !== undefined) {
      macdSeries[i] = fastEma[i] - slowEma[i];
    }
  }
  const macdValues = macdSeries.filter((v) => v !== undefined);
  const signalSeries = ema(macdValues, signalPeriod);

  const macdLine = lastValue(macdSeries);
  const signalLine = lastValue(signalSeries);
  const histogram = macdLine !== null && signalLine !== null ? macdLine - signalLine : null;

  return { macdLine, signalLine, histogram };
}

module.exports = { ema, rsi, macd, lastValue };
