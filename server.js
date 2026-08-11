const { generateSignal } = require('./lib/signalEngine');
const { notifyNewSignal } = require('./lib/notifier');

const app = express();
const PORT = process.env.PORT || 3000;
const REFRESH_MINUTES = Number(process.env.REFRESH_INTERVAL_MINUTES || 5);

let cachedSignal = null;
let lastError = null;
let isRefreshing = false;
let lastNotifiedKey = null; // supaya notifikasi tidak dikirim berulang utk sinyal yang sama

// Kunci unik per "kemunculan sinyal": arah + harga entry + zona aktif.
// Kalau salah satu berubah dari notifikasi terakhir, dianggap sinyal baru.
function signalKey(signal) {
  if (signal.entryStatus !== 'READY') return null;
  return `${signal.entrySignal}|${signal.entry}|${signal.activeZone?.tf}|${signal.activeZone?.price}`;
}

async function refreshSignal() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    const signal = await generateSignal();
    cachedSignal = signal;
    lastError = null;
    console.log(`[${new Date().toISOString()}] Signal diperbarui: ${signal.entryStatus} (score ${signal.confluenceScore ?? '-'} / ${signal.maxScore ?? '-'})`);

    const key = signalKey(signal);
    if (key && key !== lastNotifiedKey) {
      lastNotifiedKey = key;
      notifyNewSignal(signal).catch((err) =>
        console.error(`[${new Date().toISOString()}] Gagal kirim notifikasi:`, err.message)
      );
    }
    if (!key) {
      lastNotifiedKey = null; // reset supaya sinyal berikutnya (walau sama persis) tetap dianggap baru
    }
  } catch (err) {
    lastError = err.message;
    console.error(`[${new Date().toISOString()}] Gagal refresh signal:`, err.message);
  } finally {
    isRefreshing = false;
  }
}