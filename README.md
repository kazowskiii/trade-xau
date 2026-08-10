# XAUUSD Signal Terminal

Web app yang menampilkan chart live XAUUSD (via TradingView widget) dan menghasilkan
sinyal entry (arah, entry price, stop loss, TP1–TP5) secara otomatis berdasarkan
analisis teknikal multi-timeframe.

## Cara kerja analisis (ringkas)

1. **Trend multi-timeframe** — EMA50/200 di Daily, EMA20/50 di H4 dan H1. Arah dianggap
   valid kalau minimal 2 dari 3 timeframe searah.
2. **Momentum** — MACD histogram & RSI (H1) untuk konfirmasi tambahan.
3. **Zona Supply/Demand & Support/Resistance** — dideteksi otomatis dari swing high/low
   (metode fractal) lalu dikelompokkan jadi zona. Entry diambil dari zona terdekat kalau
   harga sedang berada di sekitarnya; kalau tidak, entry = harga market saat ini.
4. **Confluence score (0–6)** — dihitung dari: trend Daily selaras, trend H4 selaras,
   trend H1 selaras, MACD selaras, RSI selaras, dan zona dikonfirmasi lintas timeframe.
   - Score 0–3 → tampil TP1–TP3
   - Score 4–5 → tampil TP1–TP4
   - Score 6 (kondisi market sangat bagus) → tampil TP1–TP5
5. Stop loss diambil dari luar batas zona (dengan buffer), lalu TP1–TP5 diambil dari
   zona resistance/support berikutnya (fallback ke kelipatan risk/reward kalau zona
   tidak cukup).

**Penting:** ini adalah alat bantu analisis teknikal otomatis berbasis rule, bukan AI
yang "memahami" market, dan bukan jaminan profit. Tetap gunakan money management dan
konfirmasi manual.

## Setup lokal

```bash
npm install
cp .env.example .env
```

Buka `.env`, isi `FMP_API_KEY` dengan API key dari
[financialmodelingprep.com](https://site.financialmodelingprep.com/) (paket gratis
sudah cukup untuk data commodity EOD/intraday XAUUSD; kalau butuh update lebih sering
dan tanpa limit ketat, pertimbangkan paket berbayar mereka).

```bash
npm start
```

Buka `http://localhost:3000`.

## Deploy ke Railway (sama seperti alur SIMONEV)

1. Push folder ini ke repo GitHub baru.
2. Di Railway: New Project → Deploy from GitHub repo.
3. Set environment variable `FMP_API_KEY` (dan opsional `REFRESH_INTERVAL_MINUTES`)
   di tab Variables.
4. Railway otomatis mendeteksi `npm start` dan meng-assign `PORT` — tidak perlu
   diubah, `server.js` sudah membaca `process.env.PORT`.
5. Setiap push ke branch utama akan auto-redeploy.

## Struktur proyek

```
xauusd-signal-app/
├── server.js              # Express server + cache + auto-refresh
├── lib/
│   ├── fmpClient.js        # Ambil candle & harga dari FMP API
│   ├── indicators.js       # EMA, RSI, MACD
│   ├── zones.js             # Deteksi swing point & clustering zona S/D-S/R
│   └── signalEngine.js      # Gabungkan semua jadi satu sinyal entry/SL/TP
└── public/
    ├── index.html           # Chart TradingView + panel sinyal
    ├── style.css
    └── app.js                # Polling /api/signal & render UI
```

## Yang bisa dikembangkan lebih lanjut

- Simpan histori sinyal ke file JSON/DB (seperti pola SIMONEV) supaya bisa dilihat
  win-rate berdasarkan sinyal yang lewat.
- Tambah notifikasi Telegram/WhatsApp saat sinyal baru dengan score tinggi muncul.
- Tambah news filter (misal hindari sinyal baru saat mendekati rilis NFP/CPI) —
  cocok dengan pengalaman Ki soal analisis PPI/news-based trading.
- Tuning parameter (lookback swing, toleransi zona, periode EMA) berdasarkan
  backtest, bukan asumsi default di kode ini.
