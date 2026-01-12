require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { Pool } = require('pg');

const app = express();

// Trust proxy для Railway (rate limiter)
app.set('trust proxy', 1);

// In-memory кэш: 5 минут TTL, проверка каждые 60 секунд
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Включаем gzip сжатие для экономии трафика
app.use(compression());

// Rate limiting: максимум 50 запросов в час с одного IP (достаточно для ручной синхронизации)
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 50, // макс запросов
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/sync/', limiter);

const PORT = process.env.PORT || 3000;

// CORS конфиг - разрешаем все origin для chrome extensions
app.use(cors({
  origin: true, // Разрешить все origins (chrome-extension:// не поддерживает wildcard)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Extension-Version', 'X-Scraper-Token'],
  credentials: false
}));

app.use(express.json({ limit: '100kb' }));

// PostgreSQL подключение (принудительно IPv4)
const dbUrl = process.env.DATABASE_URL || 'postgresql://user:password@localhost/mangabuff_cache';
const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  // Принудительно IPv4 для совместимости с Railway
  family: 4,
  max: 2, // Минимальный pool для экономии памяти
  min: 0, // Не держать соединения когда нет запросов
  idleTimeoutMillis: 10000, // Закрывать через 10 секунд
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Инициализация БД
let dbConnected = false;

const initializeDatabase = async () => {
  try {
    // Тест подключения
    const result = await pool.query('SELECT NOW()');
    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ Database connected:', result.rows[0].now);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        count INTEGER NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_cache_key ON cache_entries(key);
      CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON cache_entries(timestamp);
    `);
    
    // Автоочистка старых записей (старше 30 дней)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    await pool.query('DELETE FROM cache_entries WHERE timestamp < $1', [thirtyDaysAgo]);
    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ Database tables initialized');
    }
    dbConnected = true;
  } catch (err) {
    console.warn('⚠️  Database connection failed. Running in demo mode.');
    console.warn('To use full features, configure DATABASE_URL in .env');
    console.error('Error details:', err.message);
    dbConnected = false;
  }
};

// Endpoints

/**
 * GET /sync/pull-all - Единственный endpoint для получения ВСЕХ данных
 * Кэшируется на 5 минут чтобы 100 пользователей получили один ответ
 */
app.get('/sync/pull-all', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected',
      entries: []
    });
  }

  try {
    // Проверяем кэш
    const cachedData = cache.get('all_entries');
    if (cachedData) {
      console.log('📦 Serving from cache');
      return res.json({
        success: true,
        entries: cachedData,
        cached: true,
        count: cachedData.length
      });
    }

    // Получаем все записи из БД (не старше 30 дней)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      `SELECT key, count, timestamp 
       FROM cache_entries 
       WHERE timestamp > $1
       ORDER BY timestamp DESC`,
      [thirtyDaysAgo]
    );

    const entries = result.rows;
    
    // Сохраняем в кэш на 5 минут
    cache.set('all_entries', entries);
    
    console.log(`📥 Fetched ${entries.length} entries from DB, cached for 5 min`);

    res.json({
      success: true,
      entries,
      cached: false,
      count: entries.length
    });
  } catch (error) {
    console.error('Error in /sync/pull-all:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /sync/push - ОТКЛЮЧЕНО (записи только через scraper)
 */
app.post('/sync/push', (req, res) => {
  return res.status(410).json({ 
    error: 'Push sync is disabled. Data is populated via scraper only.',
    message: 'Use the sync button to pull data from server.'
  });
});

/**
 * POST /sync/pull - ОТКЛЮЧЕНО (используйте /sync/pull-all)
 */
app.post('/sync/pull', (req, res) => {
  return res.status(410).json({ 
    error: 'This endpoint is deprecated. Use GET /sync/pull-all instead.',
    redirect: '/sync/pull-all'
  });
});

/**
 * GET /sync/all - ОТКЛЮЧЕНО (используйте /sync/pull-all)
 */
app.get('/sync/all', (req, res) => {
  return res.status(410).json({ 
    error: 'This endpoint is deprecated. Use GET /sync/pull-all instead.',
    redirect: '/sync/pull-all'
  });
});

/**
 * POST /scraper/push - DEPRECATED
 * Скрейпер теперь пишет напрямую в Supabase PostgreSQL
 */
app.post('/scraper/push', (req, res) => {
  res.status(410).json({ 
    error: 'Endpoint deprecated',
    message: 'Scraper now writes directly to Supabase. Update your scraper-config.json',
    documentation: 'See SCRAPER_README.md'
  });
});

/**
 * GET /cache/stats - Статистика кэша
 */
app.get('/cache/stats', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database not connected' });
  }

  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_entries,
        AVG(count) as avg_count,
        MAX(timestamp) as latest_timestamp
      FROM cache_entries;
    `);

    const cacheStats = cache.getStats();

    res.json({
      success: true,
      database: result.rows[0],
      memoryCache: {
        keys: cache.keys().length,
        hits: cacheStats.hits,
        misses: cacheStats.misses
      }
    });
  } catch (error) {
    console.error('Error in /cache/stats:', error);
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
    timestamp: Date.now()
  });
});

// Запуск сервера
const startServer = async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n🚀 Cache server running on http://localhost:${PORT}`);
        console.log(`Database: ${dbConnected ? '✅ Connected' : '⚠️  Demo mode'}\n`);
        console.log('Available endpoints:');
        console.log('  GET  /sync/pull-all  - Get all cache data (cached 5 min)');
        console.log('  GET  /cache/stats    - Get statistics');
        console.log('  GET  /health         - Health check\n');
        console.log('Note: Scraper writes directly to Supabase, /scraper/push is deprecated.');
      } else {
        console.log(`Server running on port ${PORT}`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Автоматическая очистка раз в сутки
setInterval(async () => {
  if (dbConnected) {
    try {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const result = await pool.query('DELETE FROM cache_entries WHERE timestamp < $1', [thirtyDaysAgo]);
      if (result.rowCount > 0) {
        console.log(`Auto-cleanup: deleted ${result.rowCount} old entries`);
      }
    } catch (error) {
      console.error('Auto-cleanup error:', error);
    }
  }
}, 24 * 60 * 60 * 1000); // Каждые 24 часа

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await pool.end();
  process.exit(0);
});

startServer();
