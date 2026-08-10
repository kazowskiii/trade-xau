const { getCandles, getLastPrice } = require('./twelveDataClient');
const { ema, rsi, macd, lastValue } = require('./indicators');
const { buildZones, hasConfluence } = require('./zones');

function closes(candles) {
  return candles.map((c) => c.close);
}

function trendDirection(candlesArr, fastPeriod, slowPeriod) {
  const c = closes(candlesArr);
  const fast = lastValue(ema(c, fastPeriod));
  const slow = lastValue(ema(c, slowPeriod));
  if (fast === null || slow === null) return { direction: 'NEUTRAL', fast, slow };
  if (fast > slow) return { direction: 'BULLISH', fast, slow };
  if (fast < slow) return { direction: 'BEARISH', fast, slow };
  return { direction: 'NEUTRAL', fast, slow };
}

function buildTargets(direction, entry, riskDistance, zones, maxTargets) {
  const targets = [];
  const relevantZones =
    direction === 'BULLISH'
      ? zones.resistanceZones.filter((z) => z.price > entry).sort((a, b) => a.price - b.price)
      : zones.supportZones.filter((z) => z.price < entry).sort((a, b) => b.price - a.price);

  for (let i = 0; i < maxTargets; i++) {
    if (relevantZones[i]) {
      targets.push(Number(relevantZones[i].price.toFixed(2)));
    } else {
      const multiplier = i + 1;
      const fallback =
        direction === 'BULLISH'
          ? entry + riskDistance * multiplier
          : entry - riskDistance * multiplier;
      targets.push(Number(fallback.toFixed(2)));
    }
  }
  return targets;
}

async function generateSignal() {
  const [daily, h4, h1, lastPrice] = await Promise.all([
    getCandles('daily', 300),
    getCandles('4hour', 300),
    getCandles('1hour', 300),
    getLastPrice(),
  ]);

  const dailyTrend = trendDirection(daily, 50, 200);
  const h4Trend = trendDirection(h4, 20, 50);
  const h1Trend = trendDirection(h1, 20, 50);

  const h1Closes = closes(h1);
  const h1Rsi = rsi(h1Closes, 14);
  const h1Macd = macd(h1Closes, 12, 26, 9);

  const h4Zones = buildZones(h4, 3, 0.15);
  const h1Zones = buildZones(h1, 3, 0.15);

  const directions = [dailyTrend.direction, h4Trend.direction, h1Trend.direction];
  const bullCount = directions.filter((d) => d === 'BULLISH').length;
  const bearCount = directions.filter((d) => d === 'BEARISH').length;

  let overallDirection = 'NEUTRAL';
  if (bullCount >= 2) overallDirection = 'BULLISH';
  else if (bearCount >= 2) overallDirection = 'BEARISH';

  if (overallDirection === 'NEUTRAL') {
    return {
      timestamp: new Date().toISOString(),
      symbol: 'XAUUSD',
      lastPrice,
      direction: 'NEUTRAL',
      message:
        'Trend di timeframe D1/H4/H1 belum searah (choppy/sideways). Tidak ada sinyal entry yang direkomendasikan saat ini.',
      confluenceScore: 0,
      maxScore: 6,
      breakdown: { dailyTrend: dailyTrend.direction, h4Trend: h4Trend.direction, h1Trend: h1Trend.direction, rsi: h1Rsi, macdHistogram: h1Macd.histogram },
    };
  }

  // --- Hitung confluence score (0-6) ---
  let score = 0;
  if (dailyTrend.direction === overallDirection) score += 1;
  if (h4Trend.direction === overallDirection) score += 1;
  if (h1Trend.direction === overallDirection) score += 1;

  const macdAligned =
    h1Macd.histogram !== null &&
    ((overallDirection === 'BULLISH' && h1Macd.histogram > 0) ||
      (overallDirection === 'BEARISH' && h1Macd.histogram < 0));
  if (macdAligned) score += 1;

  const rsiAligned =
    h1Rsi !== null &&
    ((overallDirection === 'BULLISH' && h1Rsi > 50 && h1Rsi < 70) ||
      (overallDirection === 'BEARISH' && h1Rsi < 50 && h1Rsi > 30));
  if (rsiAligned) score += 1;

  // Zona entry: cari zona demand (bullish) / supply (bearish) terdekat dari harga sekarang di H1,
  // lalu cek apakah dikonfirmasi oleh zona di H4 (multi-timeframe confluence)
  const entryZones = overallDirection === 'BULLISH' ? h1Zones.supportZones : h1Zones.resistanceZones;
  const higherZones = overallDirection === 'BULLISH' ? h4Zones.supportZones : h4Zones.resistanceZones;

  const nearestZone = [...entryZones]
    .sort((a, b) => Math.abs(a.price - lastPrice) - Math.abs(b.price - lastPrice))[0] || null;

  let zoneConfluence = false;
  if (nearestZone) {
    zoneConfluence = hasConfluence(nearestZone.price, higherZones, 0.3);
    if (zoneConfluence) score += 1;
  }

  // --- Tentukan entry & stop loss ---
  const buffer = lastPrice * 0.0015; // buffer ~0.15%
  let entry;
  let stopLoss;

  if (nearestZone && Math.abs(nearestZone.price - lastPrice) / lastPrice < 0.01) {
    // Harga sedang berada dekat zona (dalam 1%) -> pakai zona sebagai entry
    entry = Number(nearestZone.price.toFixed(2));
    stopLoss =
      overallDirection === 'BULLISH'
        ? Number((nearestZone.low - buffer).toFixed(2))
        : Number((nearestZone.high + buffer).toFixed(2));
  } else {
    // Tidak ada zona dekat -> pakai harga market saat ini, SL berdasarkan buffer persentase
    entry = Number(lastPrice.toFixed(2));
    stopLoss =
      overallDirection === 'BULLISH'
        ? Number((lastPrice - lastPrice * 0.004).toFixed(2))
        : Number((lastPrice + lastPrice * 0.004).toFixed(2));
  }

  const riskDistance = Math.abs(entry - stopLoss);

  // Jumlah TP yang ditampilkan tergantung skor confluence:
  // score 0-3 -> TP1-3, score 4-5 -> TP1-4, score 6 (sempurna) -> TP1-5
  let numTargets = 3;
  if (score >= 6) numTargets = 5;
  else if (score >= 4) numTargets = 4;

  const relevantZonesForTP = overallDirection === 'BULLISH' ? h4Zones : h4Zones;
  const targets = buildTargets(overallDirection, entry, riskDistance, relevantZonesForTP, numTargets);

  const qualityLabel =
    score >= 6 ? 'SANGAT KUAT' : score >= 4 ? 'KUAT' : score >= 3 ? 'CUKUP' : 'LEMAH';

  return {
    timestamp: new Date().toISOString(),
    symbol: 'XAUUSD',
    lastPrice: Number(lastPrice.toFixed(2)),
    direction: overallDirection,
    quality: qualityLabel,
    confluenceScore: score,
    maxScore: 6,
    entry,
    stopLoss,
    riskDistance: Number(riskDistance.toFixed(2)),
    takeProfits: targets.map((price, i) => ({ label: `TP${i + 1}`, price })),
    breakdown: {
      dailyTrend: dailyTrend.direction,
      h4Trend: h4Trend.direction,
      h1Trend: h1Trend.direction,
      rsi: h1Rsi !== null ? Number(h1Rsi.toFixed(1)) : null,
      macdHistogram: h1Macd.histogram !== null ? Number(h1Macd.histogram.toFixed(3)) : null,
      zoneConfluence,
      nearestZone: nearestZone
        ? { price: Number(nearestZone.price.toFixed(2)), touches: nearestZone.touches }
        : null,
    },
    disclaimer:
      'Ini adalah hasil analisis teknikal otomatis (bukan saran keuangan/investasi). Selalu gunakan money management dan konfirmasi manual sebelum entry.',
  };
}

module.exports = { generateSignal };
