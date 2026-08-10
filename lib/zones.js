// Deteksi swing high/low pakai metode fractal sederhana:
// candle[i] jadi swing high kalau high-nya lebih tinggi dari `lookback` candle
// sebelum & sesudahnya (begitu juga swing low).
function findSwingPoints(candles, lookback = 3) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const current = candles[i];

    const isSwingHigh = window.every((c) => c.high <= current.high);
    const isSwingLow = window.every((c) => c.low >= current.low);

    if (isSwingHigh) highs.push({ price: current.high, date: current.date, index: i });
    if (isSwingLow) lows.push({ price: current.low, date: current.date, index: i });
  }

  return { highs, lows };
}

// Kelompokkan titik-titik swing yang berdekatan (dalam toleransi tertentu) jadi satu "zona"
function clusterIntoZones(points, tolerancePercent = 0.15) {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const zones = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevAvg = current.reduce((s, p) => s + p.price, 0) / current.length;
    const diffPercent = (Math.abs(sorted[i].price - prevAvg) / prevAvg) * 100;
    if (diffPercent <= tolerancePercent) {
      current.push(sorted[i]);
    } else {
      zones.push(current);
      current = [sorted[i]];
    }
  }
  zones.push(current);

  return zones
    .map((group) => ({
      price: group.reduce((s, p) => s + p.price, 0) / group.length,
      high: Math.max(...group.map((p) => p.price)),
      low: Math.min(...group.map((p) => p.price)),
      touches: group.length,
      lastTouchDate: group[group.length - 1].date,
    }))
    .sort((a, b) => b.touches - a.touches);
}

// Bangun zona resistance (dari swing high -> juga bertindak sbg zona supply)
// dan zona support (dari swing low -> juga bertindak sbg zona demand)
function buildZones(candles, lookback = 3, tolerancePercent = 0.15) {
  const { highs, lows } = findSwingPoints(candles, lookback);
  const resistanceZones = clusterIntoZones(highs, tolerancePercent); // = supply zones
  const supportZones = clusterIntoZones(lows, tolerancePercent); // = demand zones
  return { resistanceZones, supportZones };
}

// Cek apakah suatu zona di timeframe kecil "didukung" oleh zona di timeframe besar
// (dalam toleransi harga tertentu) -> konfirmasi multi-timeframe
function hasConfluence(zonePrice, higherTimeframeZones, tolerancePercent = 0.3) {
  return higherTimeframeZones.some(
    (z) => (Math.abs(z.price - zonePrice) / zonePrice) * 100 <= tolerancePercent
  );
}

module.exports = { findSwingPoints, clusterIntoZones, buildZones, hasConfluence };
