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

async function getDailyCandles(limit = 300) {
  const raw = await tdGet('time_series', {
    symbol: SYMBOL,
    interval: '1day',
    outputsize: limit,
  });
  return normalize(raw);
}

async function getHourlyCandles(limit = 500) {
  const raw = await tdGet('time_series', {
    symbol: SYMBOL,
    interval: '1h',
    outputsize: limit,
  });
  return normalize(raw);
}

// Twelve Data support interval 4h langsung, tidak perlu agregasi manual dari H1
async function get4HourCandles(limit = 300) {
  const raw = await tdGet('time_series', {
    symbol: SYMBOL,
    interval: '4h',
    outputsize: limit,
  });
  return normalize(raw);
}

async function getCandles(timeframe, limit = 300) {
  if (timeframe === 'daily') return getDailyCandles(limit);
  if (timeframe === '1hour') return getHourlyCandles(limit);
  if (timeframe === '4hour') return get4HourCandles(limit);
  throw new Error(`Timeframe tidak didukung: ${timeframe}`);
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
