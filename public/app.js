const REFRESH_MS = 60 * 1000; // cek update tiap 1 menit (backend sendiri refresh tiap beberapa menit)

const panel = document.getElementById('signalPanel');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function directionLabel(dir) {
  if (dir === 'BULLISH') return 'BUY / BULLISH';
  if (dir === 'BEARISH') return 'SELL / BEARISH';
  return 'NEUTRAL / SIDEWAYS';
}

function render(data) {
  if (data.direction === 'NEUTRAL') {
    panel.innerHTML = `
      <span class="direction-badge neutral">${directionLabel(data.direction)}</span>
      <div class="price-row">
        <div class="label">Harga XAUUSD Saat Ini</div>
        <div class="value">$${fmt(data.lastPrice)}</div>
      </div>
      <div class="neutral-msg">${data.message}</div>
      <div class="breakdown">
        <h3>Rincian Trend</h3>
        <div class="breakdown-row"><span>Trend M5</span><span>${data.breakdown.m5Trend}</span></div>
        <div class="breakdown-row"><span>Trend M15</span><span>${data.breakdown.m15Trend}</span></div>
        <div class="breakdown-row"><span>Trend M30</span><span>${data.breakdown.m30Trend}</span></div>
        <div class="breakdown-row"><span>Trend H1 (utama)</span><span>${data.breakdown.h1Trend}</span></div>
        <div class="breakdown-row"><span>RSI (M15)</span><span>${data.breakdown.rsiM15 ?? '—'}</span></div>
      </div>
    `;
    return;
  }

  const dirClass = data.direction === 'BULLISH' ? 'bullish' : 'bearish';
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

  panel.innerHTML = `
    <span class="direction-badge ${dirClass}">${directionLabel(data.direction)}</span>
    <div class="price-row">
      <div class="label">Harga XAUUSD Saat Ini</div>
      <div class="value">$${fmt(data.lastPrice)}</div>
    </div>

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

    <div class="breakdown">
      <h3>Rincian Analisis</h3>
      <div class="breakdown-row"><span>Trend M5</span><span>${data.breakdown.m5Trend}</span></div>
      <div class="breakdown-row"><span>Trend M15</span><span>${data.breakdown.m15Trend}</span></div>
      <div class="breakdown-row"><span>Trend M30</span><span>${data.breakdown.m30Trend}</span></div>
      <div class="breakdown-row"><span>Trend H1 (utama)</span><span>${data.breakdown.h1Trend}</span></div>
      <div class="breakdown-row"><span>RSI (M15)</span><span>${data.breakdown.rsiM15 ?? '—'}</span></div>
      <div class="breakdown-row"><span>RSI (M5)</span><span>${data.breakdown.rsiM5 ?? '—'}</span></div>
      <div class="breakdown-row"><span>MACD Histogram (H1)</span><span>${data.breakdown.macdHistogramH1 ?? '—'}</span></div>
      <div class="breakdown-row"><span>Zona Support/Resistance</span><span>${data.breakdown.srConfluence ? 'Terkonfirmasi' : 'Tidak ada'}</span></div>
      <div class="breakdown-row"><span>Zona Supply/Demand</span><span>${data.breakdown.sdConfluence ? 'Terkonfirmasi' : 'Tidak ada'}</span></div>
      <div class="breakdown-row"><span>Zona Entry Terdekat</span><span>${data.breakdown.nearestZone ? `${data.breakdown.nearestZone.type} @ $${fmt(data.breakdown.nearestZone.price)}` : '—'}</span></div>
    </div>
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