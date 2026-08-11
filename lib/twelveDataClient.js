const axios = require('axios');

const BASE_URL = 'https://api.twelvedata.com';
const SYMBOL = 'XAU/USD'; // format simbol forex di Twelve Data pakai slash

function getApiKey() {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key || key === 'masukkan_api_key_twelvedata_disini') {
    throw new Error(
      'TWELVE_DATA_API_KEY belum diset. Buat API key gratis di twelvedata.com lalu isi di file .env'
    );
  }
  return key;
}

async function tdGet(endpoint, params = {}) {
  const apiKey = getApiKey();
  const url = `${BASE_URL}/${endpoint}`;
  const { data } = await axios.get(url, {
    params: { ...params, apikey: apiKey },
    timeout: 15000,
  });
  // Twelve Data selalu balas status 200 walau error, error-nya ada di body
  if (data && data.status === 'error') {
    throw new Error(`Twelve Data error: ${data.message || 'unknown error'} (code ${data.code})`);
  }
  return data;
}

function normalize(raw) {
  const values = Array.isArray(raw.values) ? raw.values : [];
  // Twelve Data mengembalikan data terbaru di index 0 -> urutkan kronologis (lama -> baru)
  const sorted = [...values].reverse();
  return sorted.map((c) => ({
    date: c.datetime,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume || 0),
  }));
}

// Mapping nama timeframe internal -> interval string Twelve Data
const INTERVAL_MAP = {
  '5min': '5min',
  '15min': '15min',
  '30min': '30min',
  '1hour': '1h',
  '4hour': '4h',
  daily: '1day',
};

async function getCandlesByInterval(intervalKey, limit = 300) {
  const interval = INTERVAL_MAP[intervalKey];
  if (!interval) throw new Error(`Timeframe tidak didukung: ${intervalKey}`);
  const raw = await tdGet('time_series', {
    symbol: SYMBOL,
    interval,
    outputsize: limit,
  });
  return normalize(raw);
}

async function getCandles(timeframe, limit = 300) {
  return getCandlesByInterval(timeframe, limit);
}

async function getLastPrice() {
  const data = await tdGet('price', { symbol: SYMBOL });
  const price = Number(data.price);
  if (!price || Number.isNaN(price)) {
    throw new Error('Gagal mengambil harga terakhir XAUUSD dari Twelve Data');
  }
  return price;
}

module.exports = { getCandles, getLastPrice, SYMBOL };