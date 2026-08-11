const { getCandles, getLastPrice } = require('./twelveDataClient');
const { ema, rsi, macd, lastValue, atr } = require('./indicators');
const { buildZones, buildSupplyDemandZones } = require('./zones');

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

// Gabungkan zona S/R + Supply/Demand dari beberapa timeframe jadi satu pool,
// dipisah "di atas harga" (resistance/supply -> relevan utk SELL & TP BUY)
// dan "di bawah harga" (support/demand -> relevan utk BUY & TP SELL).
function buildZonePools(lastPrice, zonesByTf) {
  const above = [];
  const below = [];

  zonesByTf.forEach(({ tf, sr, sd }) => {
    sr.resistanceZones.forEach((z) => above.push({ ...z, type: 'SR', tf }));
    sr.supportZones.forEach((z) => below.push({ ...z, type: 'SR', tf }));
    if (sd) {
      sd.supplyZones.forEach((z) => above.push({ ...z, type: 'SD', tf }));
      sd.demandZones.forEach((z) => below.push({ ...z, type: 'SD', tf }));
    }
  });

  return {
    above: above.filter((z) => z.price > lastPrice).sort((a, b) => a.price - b.price),
    below: below.filter((z) => z.price < lastPrice).sort((a, b) => b.price - a.price),
  };
}

// Ambil beberapa target TP berurutan dari pool zona (searah entry), fallback pakai
// kelipatan risk distance kalau zona di pool sudah habis.
function buildTargetsFromPool(direction, entry, riskDistance, pool, maxTargets) {
  const targets = [];
  for (let i = 0; i < maxTargets; i++) {
    if (pool[i]) {
      targets.push(Number(pool[i].price.toFixed(2)));
    } else {
      const multiplier = i + 1;
      const fallback = direction === 'BUY' ? entry + riskDistance * multiplier : entry - riskDistance * multiplier;
      targets.push(Number(fallback.toFixed(2)));
    }
  }
  return targets;
}

async function generateSignal() {
  // --- Ambil data 5 timeframe: M1 (buat momentum/rejection), M5, M15, M30, H1 (buat trend besar) ---
  const [m1, m5, m15, m30, h1, lastPrice] = await Promise.all([
    getCandles('1min', 300),
    getCandles('5min', 300),
    getCandles('15min', 300),
    getCandles('30min', 300),
    getCandles('1hour', 300),
    getLastPrice(),
  ]);

  const m1Trend = trendDirection(m1, 5, 13);
  const m5Trend = trendDirection(m5, 9, 21);
  const m15Trend = trendDirection(m15, 9, 21);
  const m30Trend = trendDirection(m30, 20, 50);
  const h1Trend = trendDirection(h1, 20, 50);

  const m1Rsi = rsi(closes(m1), 14);
  const m5Rsi = rsi(closes(m5), 14);
  const m15Rsi = rsi(closes(m15), 14);
  const h1Macd = macd(closes(h1), 12, 26, 9);

  // --- Trend besar (informational, ini yang tampil di badge kanan atas) ---
  // H1 harus sejalan dengan M30 supaya dianggap trend yang valid, bukan choppy.
  // Field ini TIDAK menentukan arah entry — cuma konteks "market lagi kemana".
  let trendBias = 'NEUTRAL';
  if (h1Trend.direction !== 'NEUTRAL' && h1Trend.direction === m30Trend.direction) {
    trendBias = h1Trend.direction;
  }

  // --- Bangun zona S/R & Supply/Demand di M5, M15, M30 ---
  const atrM1 = atr(m1, 14);
  const atrM5 = atr(m5, 14);
  const atrM15 = atr(m15, 14);

  const srM5 = buildZones(m5, 3, 0.1);
  const srM15 = buildZones(m15, 3, 0.12);
  const srM30 = buildZones(m30, 3, 0.15);
  const sdM5 = buildSupplyDemandZones(m5, atrM5, { impulseMultiplier: 1.8 });
  const sdM15 = buildSupplyDemandZones(m15, atrM15, { impulseMultiplier: 1.8 });

  const { above: abovePool, below: belowPool } = buildZonePools(lastPrice, [
    { tf: 'M5', sr: srM5, sd: sdM5 },
    { tf: 'M15', sr: srM15, sd: sdM15 },
    { tf: 'M30', sr: srM30, sd: null },
  ]);

  const nearestAbove = abovePool[0] || null;
  const nearestBelow = belowPool[0] || null;
  const distAbovePercent = nearestAbove ? ((nearestAbove.price - lastPrice) / lastPrice) * 100 : null;
  const distBelowPercent = nearestBelow ? ((lastPrice - nearestBelow.price) / lastPrice) * 100 : null;

  // --- Deteksi rejection/momentum di M1 & M5 (ini yang menentukan arah ENTRY) ---
  // Bearish rejection: M1 sudah berbalik turun & M5 mendukung (trend M5 turun ATAU RSI M5 di bawah 50)
  // Bullish rejection: M1 sudah berbalik naik & M5 mendukung (trend M5 naik ATAU RSI M5 di atas 50)
  const bearishRejection =
    m1Trend.direction === 'BEARISH' && (m5Trend.direction === 'BEARISH' || (m5Rsi !== null && m5Rsi < 50));
  const bullishRejection =
    m1Trend.direction === 'BULLISH' && (m5Trend.direction === 'BULLISH' || (m5Rsi !== null && m5Rsi > 50));

  // Seberapa dekat harga dianggap "lagi berinteraksi" dengan suatu zona
  const ZONE_INTERACTION_PERCENT = 0.35;

  let entrySignal = null; // 'BUY' | 'SELL'
  let activeZone = null;

  if (nearestAbove && distAbovePercent <= ZONE_INTERACTION_PERCENT && bearishRejection) {
    entrySignal = 'SELL';
    activeZone = nearestAbove;
  } else if (nearestBelow && distBelowPercent <= ZONE_INTERACTION_PERCENT && bullishRejection) {
    entrySignal = 'BUY';
    activeZone = nearestBelow;
  }

  const breakdown = {
    m1Trend: m1Trend.direction,
    m5Trend: m5Trend.direction,
    m15Trend: m15Trend.direction,
    m30Trend: m30Trend.direction,
    h1Trend: h1Trend.direction,
    rsiM15: m15Rsi !== null ? Number(m15Rsi.toFixed(1)) : null,
    rsiM5: m5Rsi !== null ? Number(m5Rsi.toFixed(1)) : null,
    rsiM1: m1Rsi !== null ? Number(m1Rsi.toFixed(1)) : null,
    macdHistogramH1: h1Macd.histogram !== null ? Number(h1Macd.histogram.toFixed(3)) : null,
    nearestZoneAbove: nearestAbove
      ? { type: nearestAbove.type, tf: nearestAbove.tf, price: Number(nearestAbove.price.toFixed(2)) }
      : null,
    nearestZoneBelow: nearestBelow
      ? { type: nearestBelow.type, tf: nearestBelow.tf, price: Number(nearestBelow.price.toFixed(2)) }
      : null,
  };

  if (!entrySignal) {
    return {
      timestamp: new Date().toISOString(),
      symbol: 'XAUUSD',
      lastPrice: Number(lastPrice.toFixed(2)),
      trendBias,
      entryStatus: 'WAITING_FOR_ZONE',
      message: `Trend besar (H1/M30) saat ini ${trendBias}, tapi harga belum berinteraksi dengan zona resistance/supply atau support/demand manapun di M5/M15/M30 dengan momentum M1/M5 yang jelas. Belum ada entry BUY atau SELL yang direkomendasikan — tunggu harga mendekati zona dulu.`,
      breakdown,
      disclaimer:
        'Ini adalah hasil analisis teknikal otomatis (bukan saran keuangan/investasi). Selalu gunakan money management dan konfirmasi manual sebelum entry.',
    };
  }

  // --- Confluence score (0-6): dipakai buat menentukan jumlah TP & label kualitas ---
  let score = 0;
  if (activeZone.tf === 'M15' || activeZone.tf === 'M30') score += 1; // zona di TF lebih besar = lebih kuat
  if (
    (entrySignal === 'SELL' && belowPool.some((z) => Math.abs(z.price - activeZone.price) / activeZone.price > 0)) ||
    (entrySignal === 'BUY' && abovePool.some((z) => Math.abs(z.price - activeZone.price) / activeZone.price > 0))
  )
    score += 1; // ada target TP yang jelas di arah berlawanan
  if (m1Trend.direction === (entrySignal === 'SELL' ? 'BEARISH' : 'BULLISH')) score += 1;
  if (m5Trend.direction === (entrySignal === 'SELL' ? 'BEARISH' : 'BULLISH')) score += 1;
  if (entrySignal === 'SELL' && m5Rsi !== null && m5Rsi < 50) score += 1;
  if (entrySignal === 'BUY' && m5Rsi !== null && m5Rsi > 50) score += 1;
  const macdAgainstEntry =
    h1Macd.histogram !== null &&
    ((entrySignal === 'SELL' && h1Macd.histogram > 0) || (entrySignal === 'BUY' && h1Macd.histogram < 0));
  if (!macdAgainstEntry) score += 1; // tidak "melawan" MACD H1

  const isCounterTrend =
    (entrySignal === 'SELL' && trendBias === 'BULLISH') || (entrySignal === 'BUY' && trendBias === 'BEARISH');

  // --- Entry & Stop Loss dari zona aktif ---
  const buffer = atrM5 ? atrM5 * 0.3 : lastPrice * 0.0015;
  const entry = Number(activeZone.price.toFixed(2));
  const stopLoss =
    entrySignal === 'SELL'
      ? Number((activeZone.high + buffer).toFixed(2))
      : Number((activeZone.low - buffer).toFixed(2));
  const riskDistance = Math.abs(entry - stopLoss);

  let numTargets = 2;
  if (score >= 5) numTargets = 4;
  else if (score >= 3) numTargets = 3;

  const tpPool = entrySignal === 'SELL' ? belowPool : abovePool;
  const targets = buildTargetsFromPool(entrySignal, entry, riskDistance, tpPool, numTargets);

  const qualityLabel = score >= 5 ? 'KUAT' : score >= 3 ? 'CUKUP' : 'LEMAH';

  const trendNote = isCounterTrend
    ? `Catatan: entry ${entrySignal} ini koreksi/pullback jangka pendek di dalam trend besar yang masih ${trendBias} — bukan perubahan trend utama. Gunakan target TP yang lebih dekat & disiplin dengan stop loss.`
    : `Entry ${entrySignal} ini searah dengan trend besar (${trendBias}).`;

  return {
    timestamp: new Date().toISOString(),
    symbol: 'XAUUSD',
    lastPrice: Number(lastPrice.toFixed(2)),
    trendBias,
    entryStatus: 'READY',
    entrySignal,
    isCounterTrend,
    quality: qualityLabel,
    confluenceScore: score,
    maxScore: 6,
    entry,
    stopLoss,
    riskDistance: Number(riskDistance.toFixed(2)),
    takeProfits: targets.map((price, i) => ({ label: `TP${i + 1}`, price })),
    activeZone: { type: activeZone.type, tf: activeZone.tf, price: entry },
    message: trendNote,
    breakdown,
    disclaimer:
      'Ini adalah hasil analisis teknikal otomatis (bukan saran keuangan/investasi). Entry hanya diberikan saat harga benar-benar berinteraksi dengan zona S/R atau Supply/Demand yang valid. Selalu gunakan money management dan konfirmasi manual sebelum entry.',
  };
}

module.exports = { generateSignal };