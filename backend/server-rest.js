require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase конфиг
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mgusmnddeiutqjpmdqfk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndXNtbmRkZWl1dHFqcG1kcWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMxNTI1MjAsImV4cCI6MjA0ODcyODUyMH0.xXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'; // Заменить на реальный anon key

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
      const supaResp = await axios.post(
        `${SUPABASE_URL}/rest/v1/cache_entries`,
        payload,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          validateStatus: () => true
        }
      );

      if (supaResp.status >= 200 && supaResp.status < 300) {
        const returned = Array.isArray(supaResp.data) ? supaResp.data.length : 0;
        processed = returned || payload.length;
        console.log(`[SUPA] Upsert OK: status=${supaResp.status} returned=${returned}`);
        return res.json({ 
          success: true, 
          processed,
          returned,
          message: `Processed ${processed} entries`
        });
      }

      console.error('Supabase upsert failed:', supaResp.status, supaResp.data);
      return res.status(502).json({ 
        success: false, 
        processed: 0,
        error: 'Upsert rejected by Supabase',
        details: supaResp.data,
        status: supaResp.status
      });
    } catch (err) {
      console.error('Error upserting entries:', err.message);
      return res.status(500).json({ success: false, processed: 0, error: err.message });
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

    // Запрашиваем данные через Supabase REST API
    const keyFilter = keys.map(k => `key.eq.${k}`).join(',');
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?or=(${keyFilter})`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

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
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/cache_entries?select=key&limit=1&count=exact`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        validateStatus: () => true
      }
    );

    if (response.status === 404) {
      return res.status(503).json({ error: 'Table cache_entries missing', stats: null });
    }

    const total = response.headers['content-range']
      ? parseInt(response.headers['content-range'].split('/')[1] || '0', 10)
      : 0;

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
