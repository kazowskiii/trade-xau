// api/mcp.js — MCP server (Streamable HTTP, stateless) untuk XAUUSD Signal Terminal.
// Tanpa dependency tambahan: JSON-RPC 2.0 ditangani manual.
//
// URL setelah deploy:  https://trade-xau.vercel.app/api/mcp
// Opsional proteksi:   set env MCP_SECRET di Vercel, lalu pakai  /api/mcp?key=<MCP_SECRET>

const crypto = require('crypto');
const { generateSignal } = require('../lib/signalEngine');

const SERVER_INFO = { name: 'xauusd-signal-terminal', version: '1.0.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Cache sederhana (bertahan selama function "hangat"), sama pola dengan api/signal.js
let cachedSignal = null;
let lastFetchTime = 0;
const CACHE_MS = 60 * 1000;

async function getSignal(forceRefresh) {
  const now = Date.now();
  if (forceRefresh || !cachedSignal || now - lastFetchTime > CACHE_MS) {
    cachedSignal = await generateSignal();
    lastFetchTime = now;
  }
  return cachedSignal;
}

const TOOLS = [
  {
    name: 'get_xauusd_signal',
    description:
      'Ambil sinyal teknikal XAUUSD (emas) terbaru dari engine rule-based: trend besar (H1/M30), ' +
      'status entry (READY atau WAITING_FOR_ZONE), arah BUY/SELL, harga entry, stop loss, TP1-TPn, ' +
      'skor confluence, zona supply/demand & support/resistance terdekat, serta RSI/MACD. ' +
      'Ini analisis otomatis berbasis aturan, bukan prediksi pasti dan bukan saran keuangan.',
    inputSchema: {
      type: 'object',
      properties: {
        force_refresh: {
          type: 'boolean',
          description: 'true = abaikan cache 1 menit dan hitung ulang dari data terbaru.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleMessage(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  // Notifikasi (mis. notifications/initialized) tidak butuh balasan
  if (isNotification) return null;

  switch (method) {
    case 'initialize': {
      const requested = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Gunakan get_xauusd_signal untuk membaca kondisi & sinyal entry XAUUSD terbaru. ' +
          'Selalu sebutkan bahwa hasilnya analisis teknikal otomatis, bukan jaminan arah harga.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      if (name !== 'get_xauusd_signal') {
        return rpcError(id, -32602, `Tool tidak dikenal: ${name}`);
      }
      try {
        const args = (params && params.arguments) || {};
        const signal = await getSignal(Boolean(args.force_refresh));
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(signal, null, 2) }],
          isError: false,
        });
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: 'text', text: `Gagal mengambil sinyal: ${err.message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method tidak didukung: ${method}`);
  }
}

function keyIsValid(provided) {
  const secret = process.env.MCP_SECRET;
  if (!secret) return true; // proteksi opsional
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!keyIsValid(req.query && req.query.key)) {
    res.status(401).json(rpcError(null, -32001, 'Unauthorized'));
    return;
  }

  // Server stateless: tidak menyediakan stream SSE via GET
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json(rpcError(null, -32000, 'Gunakan POST'));
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json(rpcError(null, -32700, 'JSON tidak valid'));
      return;
    }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json(rpcError(null, -32600, 'Request tidak valid'));
    return;
  }

  try {
    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map(handleMessage))).filter((r) => r !== null);
      if (results.length === 0) {
        res.status(202).end();
        return;
      }
      res.status(200).json(results);
      return;
    }

    const result = await handleMessage(body);
    if (result === null) {
      res.status(202).end();
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json(rpcError(body && body.id, -32603, `Internal error: ${err.message}`));
  }
};
