require('dotenv').config();

// Принудительно IPv4 для совместимости с Render.com
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const NodeCache = require('node-cache');
const axios = require('axios');

const app = express();

// Trust proxy для Render.com
app.set('trust proxy', 1);

// In-memory кэш: 5 минут TTL, проверка каждые 60 секунд
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Включаем gzip сжатие для экономии трафика
app.use(compression());

const PORT = process.env.PORT || 3000;

// Supabase конфиг - ОБЯЗАТЕЛЬНО установите через .env файл!
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ ERROR: SUPABASE_URL and SUPABASE_KEY must be set in .env file!');
  console.error('Create backend/.env with:');
  console.error('SUPABASE_URL=your_supabase_project_url');
  console.error('SUPABASE_KEY=your_supabase_anon_key');
  process.exit(1);
}

// CORS конфиг - разрешаем все origin для chrome extensions
app.use(cors({
  origin: true, // Разрешить все origins (chrome-extension:// не поддерживает wildcard)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Extension-Version', 'X-Scraper-Token'],
  credentials: false
}));

app.use(express.json({ limit: '100kb' }));

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
            'Prefer': 'return=minimal, resolution=merge-duplicates'
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
 * GET /sync/all и /sync/pull-all - Получить все записи (с лимитом)
 */
const handleSyncAll = async (req, res) => {
  if (!dbConnected) {
    console.warn('[/sync/all] Database not connected, returning empty array');
    return res.status(200).json({
      success: false,
      error: 'Database not connected. Check SUPABASE_URL and SUPABASE_KEY',
      entries: []
    });
  }

  try {
    const limit = Math.min(Number(req.query.limit) || 10000, 10000); // Supabase REST API лимит 10000
    const offset = Number(req.query.offset) || 0;

    // Проверяем in-memory кэш ТОЛЬКО для первой страницы (offset=0)
    const cacheKey = `all_entries_${offset}_${limit}`;
    if (offset === 0) {
      const cached = cache.get(cacheKey);
      if (cached) {
        console.log(`[/sync/all] Returning ${cached.length} entries from cache (offset=0)`);
        return res.json({
          success: true,
          entries: cached,
          total: cached.length,
          cached: true
        });
      }
    }

    console.log(`[/sync/all] Fetching entries: offset=${offset}, limit=${limit}`);

    // Только записи не старше 60 дней
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);

    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?select=key,count,timestamp&timestamp=gt.${sixtyDaysAgo}&limit=${limit}&offset=${offset}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'count=exact'
        },
        validateStatus: () => true
      }
    );

    // Special-case: Supabase may return 416 for out-of-range offsets in some setups (Render)
    if (response.status === 416) {
      console.warn(`[/sync/all] Upstream returned 416 — treating as end of data (returning empty set)`);
      return res.json({ success: true, entries: [], total: 0, cached: false, warning: 'Upstream returned 416; treated as empty result' });
    }

    if (response.status === 404) {
      return res.status(503).json({ error: 'Table cache_entries missing', entries: [] });
    }

    // Normalize non-2xx upstream responses into structured JSON so clients always get an `error` field
    if (!(response.status >= 200 && response.status < 300)) {
      console.warn(`[/sync/all] Upstream responded with status ${response.status}`, response.data);
      const upstreamMessage = response.data && (response.data.error || response.data.message) ? (response.data.error || response.data.message) : response.data;
      return res.status(response.status).json({ success: false, error: upstreamMessage || `Upstream status ${response.status}`, entries: [], total: 0, cached: false });
    }

    const entries = response.data || [];
    console.log(`[/sync/all] Returning ${entries.length} entries (status: ${response.status})`);

    // Сохраняем в кэш на 5 минут ТОЛЬКО первую страницу
    if (offset === 0 && entries.length > 0) {
      cache.set(cacheKey, entries);
    }

    return res.status(200).json({ success: true, entries: entries, total: entries.length, cached: false });
  } catch (error) {
    console.error('Error in /sync/all:', error.message);
    return res.status(500).json({ error: 'Internal server error', entries: [] });
  }
};

app.get('/sync/all', handleSyncAll);
app.get('/sync/pull-all', handleSyncAll);

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
    cacheKeys: cache.keys().length,
    timestamp: Date.now(),
    uptime: process.uptime()
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
