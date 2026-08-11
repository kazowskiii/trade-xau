const REFRESH_MS = 60 * 1000; // cek update tiap 1 menit (backend sendiri refresh tiap beberapa menit)

const panel = document.getElementById('signalPanel');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function trendLabel(bias) {
  if (bias === 'BULLISH') return 'TREND: BULLISH';
  if (bias === 'BEARISH') return 'TREND: BEARISH';
  return 'TREND: NEUTRAL / SIDEWAYS';
}

function trendClass(bias) {
  if (bias === 'BULLISH') return 'bullish';
  if (bias === 'BEARISH') return 'bearish';
  return 'neutral';
}

function zoneLabel(zone) {
  if (!zone) return '—';
  return `${zone.type} (${zone.tf}) @ $${fmt(zone.price)}`;
}

function renderBreakdown(breakdown) {
  return `
    <div class="breakdown">
      <h3>Rincian Analisis</h3>
      <div class="breakdown-row"><span>Trend M1</span><span>${breakdown.m1Trend}</span></div>
      <div class="breakdown-row"><span>Trend M5</span><span>${breakdown.m5Trend}</span></div>
      <div class="breakdown-row"><span>Trend M15</span><span>${breakdown.m15Trend}</span></div>
      <div class="breakdown-row"><span>Trend M30</span><span>${breakdown.m30Trend}</span></div>
      <div class="breakdown-row"><span>Trend H1 (trend besar)</span><span>${breakdown.h1Trend}</span></div>
      <div class="breakdown-row"><span>RSI (M1)</span><span>${breakdown.rsiM1 ?? '—'}</span></div>
      <div class="breakdown-row"><span>RSI (M5)</span><span>${breakdown.rsiM5 ?? '—'}</span></div>
      <div class="breakdown-row"><span>RSI (M15)</span><span>${breakdown.rsiM15 ?? '—'}</span></div>
      <div class="breakdown-row"><span>MACD Histogram (H1)</span><span>${breakdown.macdHistogramH1 ?? '—'}</span></div>
      <div class="breakdown-row"><span>Zona Resistance/Supply Terdekat</span><span>${zoneLabel(breakdown.nearestZoneAbove)}</span></div>
      <div class="breakdown-row"><span>Zona Support/Demand Terdekat</span><span>${zoneLabel(breakdown.nearestZoneBelow)}</span></div>
    </div>
  `;
}

function render(data) {
  const trendBadge = `<span class="direction-badge ${trendClass(data.trendBias)}">${trendLabel(data.trendBias)}</span>`;
  const priceRow = `
    <div class="price-row">
      <div class="label">Harga XAUUSD Saat Ini</div>
      <div class="value">$${fmt(data.lastPrice)}</div>
    </div>
  `;

  // Belum ada entry -> cuma tampilkan trend besar + alasan kenapa belum ada entry
  if (data.entryStatus === 'WAITING_FOR_ZONE') {
    panel.innerHTML = `
      ${trendBadge}
      ${priceRow}
      <div class="neutral-msg">⏳ Belum ada entry BUY/SELL yang direkomendasikan.<br/>${data.message}</div>
      ${renderBreakdown(data.breakdown)}
    `;
    return;
  }

  // Ada entry aktif -> tampilkan BUY/SELL terpisah dari badge trend besar
  const entryClass = data.entrySignal === 'BUY' ? 'bullish' : 'bearish';
  const ticksFilled = data.confluenceScore;
  const ticksTotal = data.maxScore;
  const ticks = Array.from({ length: ticksTotal })
    .map((_, i) => `<div class="gauge-tick ${i < ticksFilled ? 'filled' : ''}"></div>`)
    .join('');

  const tpRows = data.takeProfits
    .map(
      (tp) => `
      <div class="level-row">
        <span class="tag tp">${tp.label}</span>
        <span>$${fmt(tp.price)}</span>
      </div>`
    )
    .join('');

  const counterTrendNote = data.isCounterTrend
    ? `<div class="neutral-msg">⚠️ Entry ${data.entrySignal} ini melawan arah trend besar (${data.trendBias}) — ini koreksi/pullback jangka pendek, bukan perubahan trend. ${data.message}</div>`
    : `<div class="neutral-msg">✅ ${data.message}</div>`;

  panel.innerHTML = `
    ${trendBadge}
    ${priceRow}

    <span class="direction-badge ${entryClass}">ENTRY: ${data.entrySignal}</span>
    <div class="breakdown-row"><span>Zona Entry Aktif</span><span>${zoneLabel(data.activeZone)}</span></div>

    ${counterTrendNote}

    <div class="gauge-section">
      <div class="gauge-label">
        <span>Confluence Score</span>
        <span class="quality">${data.quality} (${data.confluenceScore}/${data.maxScore})</span>
      </div>
      <div class="gauge-ticks">${ticks}</div>
    </div>

    <div class="levels">
      <div class="level-row">
        <span class="tag entry">Entry</span>
        <span>$${fmt(data.entry)}</span>
      </div>
      <div class="level-row">
        <span class="tag sl">Stop Loss</span>
        <span>$${fmt(data.stopLoss)}</span>
      </div>
      ${tpRows}
    </div>

    ${renderBreakdown(data.breakdown)}
  `;
}

async function loadSignal() {
  try {
    const res = await fetch('/api/signal');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal memuat sinyal');

    render(data);
    statusDot.className = 'dot live';
    const t = new Date(data.timestamp);
    statusText.textContent = `Update terakhir: ${t.toLocaleTimeString('id-ID')}`;
  } catch (err) {
    statusDot.className = 'dot error';
    statusText.textContent = `Error: ${err.message}`;
  }
}

loadSignal();
setInterval(loadSignal, REFRESH_MS);