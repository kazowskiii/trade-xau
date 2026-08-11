const { getCandles, getLastPrice } = require('./twelveDataClient');
const { ema, rsi, macd, lastValue, atr } = require('./indicators');
const { buildZones, buildSupplyDemandZones, hasConfluence } = require('./zones');

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

// Ambil zona (SR atau SD) yang searah sinyal (demand/support utk BUY, supply/resistance utk SELL),
// urutkan dari yang paling dekat dengan harga sekarang.
function nearestZoneInDirection(direction, srZones, sdZones, lastPrice) {
  const srPool = direction === 'BULLISH' ? srZones.supportZones : srZones.resistanceZones;
  const sdPool = direction === 'BULLISH' ? sdZones.demandZones : sdZones.supplyZones;

  const candidates = [
    ...srPool.map((z) => ({ ...z, type: 'SR' })),
    ...sdPool.map((z) => ({ ...z, type: 'SD' })),
  ].filter((z) =>
    direction === 'BULLISH' ? z.price <= lastPrice * 1.002 : z.price >= lastPrice * 0.998
  );

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Math.abs(a.price - lastPrice) - Math.abs(b.price - lastPrice))[0];
}

function buildTargets(direction, entry, riskDistance, srZones, maxTargets) {
  const targets = [];
  const relevantZones =
    direction === 'BULLISH'
      ? srZones.resistanceZones.filter((z) => z.price > entry).sort((a, b) => a.price - b.price)
      : srZones.supportZones.filter((z) => z.price < entry).sort((a, b) => b.price - a.price);

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
  // --- Ambil data 4 timeframe yang diminta: M5, M15, M30, H1 ---
  const [m5, m15, m30, h1, lastPrice] = await Promise.all([
    getCandles('5min', 300),
    getCandles('15min', 300),
    getCandles('30min', 300),
    getCandles('1hour', 300),
    getLastPrice(),
  ]);

  // EMA periode disesuaikan per timeframe: TF kecil pakai periode lebih cepat
  // supaya tetap responsif tanpa terlalu berisik.
  const m5Trend = trendDirection(m5, 9, 21);
  const m15Trend = trendDirection(m15, 9, 21);
  const m30Trend = trendDirection(m30, 20, 50);
  const h1Trend = trendDirection(h1, 20, 50);

  const m5Rsi = rsi(closes(m5), 14);
  const m15Rsi = rsi(closes(m15), 14);
  const h1Macd = macd(closes(h1), 12, 26, 9);

  // --- Arah trend utama: H1 (trend besar) HARUS sejalan dengan M30 (konfirmasi) ---
  // M15 & M5 dipakai untuk timing entry & momentum, BUKAN untuk menentukan arah utama.
  // Ini yang mencegah sinyal "melawan trend": kalau H1 & M30 tidak sepakat, hasilnya NEUTRAL,
  // bukan dipaksakan BULLISH.
  let overallDirection = 'NEUTRAL';
  if (h1Trend.direction !== 'NEUTRAL' && h1Trend.direction === m30Trend.direction) {
    overallDirection = h1Trend.direction;
  }

  const atrM15 = atr(m15, 14);
  const srM15 = buildZones(m15, 3, 0.12);
  const srM30 = buildZones(m30, 3, 0.15);
  const srH1 = buildZones(h1, 3, 0.2);
  const sdM15 = buildSupplyDemandZones(m15, atrM15, { impulseMultiplier: 1.8 });

  if (overallDirection === 'NEUTRAL') {
    return {
      timestamp: new Date().toISOString(),
      symbol: 'XAUUSD',
      lastPrice,
      direction: 'NEUTRAL',
      message:
        h1Trend.direction !== m30Trend.direction
          ? `Trend H1 (${h1Trend.direction}) dan M30 (${m30Trend.direction}) belum sejalan (choppy/sideways). Tidak ada entry yang direkomendasikan — sinyal tidak boleh melawan trend utama.`
          : 'Trend belum jelas arahnya di timeframe utama (H1/M30). Tidak ada sinyal entry yang direkomendasikan saat ini.',
      confluenceScore: 0,
      maxScore: 7,
      breakdown: {
        m5Trend: m5Trend.direction,
        m15Trend: m15Trend.direction,
        m30Trend: m30Trend.direction,
        h1Trend: h1Trend.direction,
        rsiM15: m15Rsi !== null ? Number(m15Rsi.toFixed(1)) : null,
        rsiM5: m5Rsi !== null ? Number(m5Rsi.toFixed(1)) : null,
        macdHistogramH1: h1Macd.histogram !== null ? Number(h1Macd.histogram.toFixed(3)) : null,
      },
    };
  }

  // --- Hitung confluence score (0-7) ---
  let score = 0;

  // Konfirmasi TF lebih kecil searah trend utama
  if (m15Trend.direction === overallDirection) score += 1;
  if (m5Trend.direction === overallDirection) score += 1;

  const macdAligned =
    h1Macd.histogram !== null &&
    ((overallDirection === 'BULLISH' && h1Macd.histogram > 0) ||
      (overallDirection === 'BEARISH' && h1Macd.histogram < 0));
  if (macdAligned) score += 1;

  const rsiM15Aligned =
    m15Rsi !== null &&
    ((overallDirection === 'BULLISH' && m15Rsi > 50 && m15Rsi < 75) ||
      (overallDirection === 'BEARISH' && m15Rsi < 50 && m15Rsi > 25));
  if (rsiM15Aligned) score += 1;

  const rsiM5Aligned =
    m5Rsi !== null &&
    ((overallDirection === 'BULLISH' && m5Rsi > 50) ||
      (overallDirection === 'BEARISH' && m5Rsi < 50));
  if (rsiM5Aligned) score += 1;

  // Cari zona entry (SD dulu, fallback SR) di M15, searah trend saja
  const nearestZone = nearestZoneInDirection(overallDirection, srM15, sdM15, lastPrice);

  const higherSrZones = overallDirection === 'BULLISH' ? srH1.supportZones : srH1.resistanceZones;
  const higherSrZonesM30 = overallDirection === 'BULLISH' ? srM30.supportZones : srM30.resistanceZones;

  let srConfluence = false;
  let sdConfluence = false;
  if (nearestZone) {
    const confirmedByH1 = hasConfluence(nearestZone.price, higherSrZones, 0.35);
    const confirmedByM30 = hasConfluence(nearestZone.price, higherSrZonesM30, 0.3);
    if (nearestZone.type === 'SR' && (confirmedByH1 || confirmedByM30)) {
      srConfluence = true;
      score += 1;
    }
    if (nearestZone.type === 'SD' && (confirmedByH1 || confirmedByM30)) {
      sdConfluence = true;
      score += 1;
    }
  }

  // --- Tentukan entry & stop loss ---
  const buffer = atrM15 ? atrM15 * 0.3 : lastPrice * 0.0015;
  let entry;
  let stopLoss;

  if (nearestZone && Math.abs(nearestZone.price - lastPrice) / lastPrice < 0.006) {
    // Harga sedang dekat zona (dalam ~0.6%) -> pakai zona sebagai entry
    entry = Number(nearestZone.price.toFixed(2));
    stopLoss =
      overallDirection === 'BULLISH'
        ? Number((nearestZone.low - buffer).toFixed(2))
        : Number((nearestZone.high + buffer).toFixed(2));
  } else {
    // Tidak ada zona dekat -> pakai harga market saat ini, SL berbasis ATR M15
    entry = Number(lastPrice.toFixed(2));
    const slDistance = atrM15 ? atrM15 * 1.5 : lastPrice * 0.004;
    stopLoss =
      overallDirection === 'BULLISH'
        ? Number((lastPrice - slDistance).toFixed(2))
        : Number((lastPrice + slDistance).toFixed(2));
  }

  const riskDistance = Math.abs(entry - stopLoss);

  // Jumlah TP tergantung skor confluence (skor maksimal sekarang 7)
  let numTargets = 3;
  if (score >= 6) numTargets = 5;
  else if (score >= 4) numTargets = 4;

  // Target pakai zona S/R di H1 (timeframe lebih besar -> target lebih realistis)
  const targets = buildTargets(overallDirection, entry, riskDistance, srH1, numTargets);

  const qualityLabel =
    score >= 6 ? 'SANGAT KUAT' : score >= 4 ? 'KUAT' : score >= 3 ? 'CUKUP' : 'LEMAH';

  return {
    timestamp: new Date().toISOString(),
    symbol: 'XAUUSD',
    lastPrice: Number(lastPrice.toFixed(2)),
    direction: overallDirection,
    quality: qualityLabel,
    confluenceScore: score,
    maxScore: 7,
    entry,
    stopLoss,
    riskDistance: Number(riskDistance.toFixed(2)),
    takeProfits: targets.map((price, i) => ({ label: `TP${i + 1}`, price })),
    breakdown: {
      m5Trend: m5Trend.direction,
      m15Trend: m15Trend.direction,
      m30Trend: m30Trend.direction,
      h1Trend: h1Trend.direction,
      rsiM15: m15Rsi !== null ? Number(m15Rsi.toFixed(1)) : null,
      rsiM5: m5Rsi !== null ? Number(m5Rsi.toFixed(1)) : null,
      macdHistogramH1: h1Macd.histogram !== null ? Number(h1Macd.histogram.toFixed(3)) : null,
      srConfluence,
      sdConfluence,
      nearestZone: nearestZone
        ? {
            type: nearestZone.type,
            price: Number(nearestZone.price.toFixed(2)),
            touches: nearestZone.touches,
          }
        : null,
    },
    disclaimer:
      'Ini adalah hasil analisis teknikal otomatis (bukan saran keuangan/investasi). Entry hanya dibuat searah trend utama (H1 & M30) — tidak ada sinyal melawan trend. Selalu gunakan money management dan konfirmasi manual sebelum entry.',
  };
}

module.exports = { generateSignal };