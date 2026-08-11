// Kirim notifikasi WhatsApp tiap kali ada sinyal entry BARU (READY).
// Pilih salah satu provider (atau isi dua-duanya kalau mau backup):
// kalau env var-nya kosong, otomatis di-skip tanpa error.

const axios = require('axios');

// ---------- WHATSAPP via Fonnte (https://fonnte.com) ----------
// Daftar akun -> hubungkan device WA (scan QR) -> ambil token di dashboard.
async function sendWhatsAppFonnte(message) {
  if (!process.env.FONNTE_TOKEN || !process.env.WA_TARGET) return;
  try {
    await axios.post(
      'https://api.fonnte.com/send',
      { target: process.env.WA_TARGET, message },
      { headers: { Authorization: process.env.FONNTE_TOKEN } }
    );
    console.log(`[${new Date().toISOString()}] Notifikasi WhatsApp (Fonnte) terkirim`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Gagal kirim WhatsApp (Fonnte):`, err.message);
  }
}

// ---------- WHATSAPP via CallMeBot (gratis, hanya ke nomor sendiri) ----------
// Setup: chat "I allow callmebot to send me messages" ke +34 644 84 71 63 lewat WA,
// nanti dibalas API key. Cocok untuk reminder pribadi (bukan broadcast).
async function sendWhatsAppCallMeBot(message) {
  if (!process.env.CALLMEBOT_PHONE || !process.env.CALLMEBOT_APIKEY) return;
  try {
    await axios.get('https://api.callmebot.com/whatsapp.php', {
      params: {
        phone: process.env.CALLMEBOT_PHONE,
        text: message,
        apikey: process.env.CALLMEBOT_APIKEY,
      },
    });
    console.log(`[${new Date().toISOString()}] Notifikasi WhatsApp (CallMeBot) terkirim`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Gagal kirim WhatsApp (CallMeBot):`, err.message);
  }
}

function formatSignalMessage(signal) {
  const tpLines = signal.takeProfits.map((t) => `${t.label}: ${t.price}`).join('\n');
  const waktu = new Date(signal.timestamp).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  return [
    '🔔 SINYAL XAUUSD BARU',
    `Arah      : ${signal.entrySignal}`,
    `Entry     : ${signal.entry}`,
    `Stop Loss : ${signal.stopLoss}`,
    `Kualitas  : ${signal.quality} (${signal.confluenceScore}/${signal.maxScore})`,
    tpLines,
    signal.isCounterTrend ? '⚠️ Counter-trend (pullback), disiplin SL.' : '',
    `Waktu (WIB): ${waktu}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function notifyNewSignal(signal) {
  const message = formatSignalMessage(signal);
  await Promise.all([
    sendWhatsAppFonnte(message),
    sendWhatsAppCallMeBot(message),
  ]);
}

module.exports = { notifyNewSignal };