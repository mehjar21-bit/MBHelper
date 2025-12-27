require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase конфиг
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mgusmnddeiutqjpmdqfk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndXNtbmRkZWl1dHFqcG1kcWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDY1MjQsImV4cCI6MjA4MjM4MjUyNH0.kVqc7_aV0g4s9Begc2hq1_sQyINuSvUJEK3VCg1S5KA';

// CORS конфиг (разрешаем расширение и локальные хосты)
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без Origin (например, curl/Postman)
    if (!origin) return callback(null, true);
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    // Разрешаем Railway домены
    if (/^https:\/\/.*\.railway\.app$/i.test(origin)) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Явно отвечаем на preflight
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// Простое логирование запросов
app.use((req, res, next) => {
  const origin = req.headers.origin || 'n/a';
  console.log(`[REQ] ${req.method} ${req.url} origin=${origin}`);
  next();
});

let dbConnected = false;

// Инициализация БД (проверяем доступность REST и таблицы)
const initializeDatabase = async () => {
  try {
    console.log('Attempting to connect to Supabase...');
    
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?select=key&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        validateStatus: () => true,
        timeout: 5000
      }
    );

    if (response.status === 404) {
      console.warn('⚠️  Table cache_entries not found. Create it in Supabase SQL:');
      console.warn('See backend/README.md (Supabase setup)');
      dbConnected = false;
      return;
    }

    if (response.status >= 200 && response.status < 300) {
      console.log('✅ Supabase REST API connected');
      dbConnected = true;
      return;
    }

    console.warn(`⚠️  Supabase responded with status ${response.status}`);
    dbConnected = false;
  } catch (err) {
    console.warn('⚠️  Supabase connection failed.');
    console.warn('Make sure SUPABASE_URL and SUPABASE_KEY are set correctly in .env');
    console.error('Error:', err.message);
    dbConnected = false;
  }
};

// Endpoints

/**
 * POST /sync/push - Отправить данные на сервер
 */
app.post('/sync/push', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected',
      demo: true 
    });
  }

  try {
    const { entries } = req.body;

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'Invalid entries format' });
    }

    let processed = 0;

    // Отправляем батчом через upsert (resolution=merge-duplicates)
    const payload = entries
      .filter(e => e.key && e.count !== undefined && e.timestamp)
      .map(e => ({
        key: e.key,
        count: e.count,
        timestamp: e.timestamp,
        updated_at: new Date().toISOString()
      }));

    if (payload.length === 0) {
      return res.status(400).json({ error: 'No valid entries to process' });
    }

    try {
      // Сначала пробуем RPC функцию (быстрее - 1 запрос вместо 2)
      try {
        console.log(`[SUPA] Attempting RPC upsert with ${payload.length} entries...`);
        console.log(`[SUPA] Sample entry:`, JSON.stringify(payload[0]));
        
        const rpcResp = await axios.post(
          `${SUPABASE_URL}/rest/v1/rpc/upsert_cache_entries`,
          { entries: payload },
          {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json'
            },
            validateStatus: () => true,
            timeout: 30000
          }
        );

        console.log(`[SUPA] RPC response status: ${rpcResp.status}`);
        console.log(`[SUPA] RPC response data:`, JSON.stringify(rpcResp.data));

        if (rpcResp.status >= 200 && rpcResp.status < 300) {
          const result = rpcResp.data;
          const updated = result?.updated || 0;
          const skipped = result?.skipped || 0;
          
          console.log(`[SUPA] RPC upsert: updated=${updated}, skipped=${skipped}`);
          return res.json({ 
            success: true, 
            processed: updated,
            skipped: skipped,
            total: payload.length,
            message: `Updated ${updated}, skipped ${skipped} (older) of ${payload.length} entries`
          });
        }
        
        // RPC не существует или ошибка - переходим на fallback
        console.warn(`[SUPA] RPC failed (${rpcResp.status}), using fallback method`);
      } catch (rpcErr) {
        console.warn(`[SUPA] RPC error: ${rpcErr.message}, using fallback`);
      }

      // Fallback: двухэтапный процесс (GET + POST)
      console.log(`[SUPA] Fallback: checking ${payload.length} entries...`);
      
      // Шаг 1: Получаем существующие timestamp'ы
      const keys = payload.map(e => e.key);
      const keysFilter = keys.map(k => `"${k}"`).join(',');
      
      let existingEntries = {};
      try {
        const checkResp = await axios.get(
          `${SUPABASE_URL}/rest/v1/cache_entries?key=in.(${keysFilter})&select=key,timestamp`,
          {
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`
            },
            timeout: 10000
          }
        );

        if (Array.isArray(checkResp.data)) {
          checkResp.data.forEach(entry => {
            existingEntries[entry.key] = entry.timestamp;
          });
          console.log(`[SUPA] Found ${Object.keys(existingEntries).length} existing entries`);
        }
      } catch (checkErr) {
        console.warn(`[SUPA] Failed to check existing: ${checkErr.message}`);
      }

      // Шаг 2: Фильтруем по timestamp
      const toUpsert = payload.filter(entry => {
        const existingTs = existingEntries[entry.key];
        return !existingTs || existingTs < entry.timestamp;
      });

      const skipped = payload.length - toUpsert.length;
      
      if (toUpsert.length === 0) {
        console.log(`[SUPA] All ${payload.length} entries are older, skipped`);
        return res.json({ 
          success: true, 
          processed: 0,
          skipped: skipped,
          total: payload.length,
          message: `All entries skipped (server data fresher)`
        });
      }

      console.log(`[SUPA] Upserting ${toUpsert.length} entries (${skipped} skipped)`);

      // Шаг 3: Batch upsert
      const supaResp = await axios.post(
        `${SUPABASE_URL}/rest/v1/cache_entries`,
        toUpsert,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          timeout: 30000
        }
      );

      if (supaResp.status >= 200 && supaResp.status < 300) {
        console.log(`[SUPA] Fallback upsert OK: ${toUpsert.length} entries`);
        return res.json({ 
          success: true, 
          processed: toUpsert.length,
          skipped: skipped,
          total: payload.length,
          message: `Updated ${toUpsert.length}, skipped ${skipped} (older) of ${payload.length}`
        });
      }

      throw new Error(`Upsert failed: ${supaResp.status}`);
    } catch (err) {
      console.error('Error in push:', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  } catch (error) {
    console.error('Error in /sync/push:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /sync/pull - Получить данные для карт
 */
app.post('/sync/pull', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected',
      entries: []
    });
  }

  try {
    const { cardIds } = req.body;

    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      return res.status(400).json({ error: 'Invalid cardIds format' });
    }

    // Формируем список ключей
    const keys = [];
    cardIds.forEach(id => {
      keys.push(`owners_${id}`);
      keys.push(`wishlist_${id}`);
    });

    console.log(`[PULL] Fetching ${keys.length} keys for ${cardIds.length} cards`);

    // Запрашиваем данные через Supabase REST API с использованием .in() фильтра
    const keysStr = keys.join(',');
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?key=in.(${keysStr})&select=key,count,timestamp`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        timeout: 15000
      }
    );

    console.log(`[PULL] Found ${response.data?.length || 0} entries`);

    res.json({
      success: true,
      entries: response.data || []
    });
  } catch (error) {
    console.error('Error in /sync/pull:', error.message);
    res.status(500).json({ error: 'Internal server error', entries: [] });
  }
});

/**
 * GET /sync/all - Получить все записи (с лимитом)
 */
app.get('/sync/all', async (req, res) => {
  if (!dbConnected) {
    console.warn('[/sync/all] Database not connected, returning empty array');
    return res.status(200).json({
      success: false,
      error: 'Database not connected. Check SUPABASE_URL and SUPABASE_KEY',
      entries: []
    });
  }

  try {
    const limit = Number(req.query.limit) || 1000;
    const offset = Number(req.query.offset) || 0;

    console.log(`[/sync/all] Fetching entries: offset=${offset}, limit=${limit}`);

    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?select=key,count,timestamp&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'count=exact'
        },
        validateStatus: () => true
      }
    );

    if (response.status === 404) {
      return res.status(503).json({ error: 'Table cache_entries missing', entries: [] });
    }

    console.log(`[/sync/all] Returning ${response.data?.length || 0} entries (status: ${response.status})`);

    return res.status(response.status).json({
      success: response.status >= 200 && response.status < 300,
      entries: response.data || []
    });
  } catch (error) {
    console.error('Error in /sync/all:', error.message);
    return res.status(500).json({ error: 'Internal server error', entries: [] });
  }
});

/**
 * GET /cache/stats - Статистика кэша
 */
app.get('/cache/stats', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected',
      stats: null
    });
  }

  try {
    // Получаем все ключи с limit=0&count=exact для подсчёта
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?select=key&limit=0`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'count=exact'
        },
        validateStatus: () => true
      }
    );

    if (response.status === 404) {
      return res.status(503).json({ error: 'Table cache_entries missing', stats: null });
    }

    // Получаем count из заголовка Content-Range
    const contentRange = response.headers['content-range'];
    let total = 0;
    
    if (contentRange && typeof contentRange === 'string') {
      // Формат: "0-0/14" или просто число
      const match = contentRange.match(/\/(\d+)$/);
      if (match) {
        total = parseInt(match[1], 10);
      }
    }

    console.log(`[STATS] Content-Range: ${contentRange}, total: ${total}`);

    res.json({
      success: true,
      stats: {
        total_entries: Number.isNaN(total) ? 0 : total,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('Error in /cache/stats:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: dbConnected ? 'ok' : 'warning',
    database: dbConnected ? 'connected' : 'disconnected',
    timestamp: Date.now()
  });
});

/**
 * GET /debug/entries - Показать первые 20 записей из cache_entries
 */
app.get('/debug/entries', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database not connected', entries: [] });
  }
  try {
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?select=key,count,timestamp,updated_at&limit=20`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        validateStatus: () => true
      }
    );
    return res.status(response.status).json({ status: response.status, entries: response.data || [] });
  } catch (error) {
    console.error('Error in /debug/entries:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Запуск сервера
const startServer = async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 Cache server running on http://localhost:${PORT}`);
      console.log(`Database: ${dbConnected ? '✅ Connected' : '⚠️  Demo mode (no database)'}\n`);
      console.log('Available endpoints:');
      console.log('  POST /sync/push  - Send cache data');
      console.log('  POST /sync/pull  - Get cache data');
      console.log('  GET  /cache/stats - Get statistics');
      console.log('  GET  /health     - Health check\n');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing...');
  process.exit(0);
});

startServer();
