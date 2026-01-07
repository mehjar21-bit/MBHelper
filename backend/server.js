require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();

// Включаем gzip сжатие для экономии трафика
app.use(compression());

// Rate limiting: максимум 200 запросов в час с одного IP
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 200, // макс запросов
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/sync/', limiter);

const PORT = process.env.PORT || 3000;

// CORS конфиг
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'X-Extension-Version']
}));

app.use(express.json({ limit: '1mb' }));

// PostgreSQL подключение
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost/mangabuff_cache',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
 * POST /sync/push - Получить и сохранить данные от расширений
 */
app.post('/sync/push', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected. Configure DATABASE_URL in .env',
      demo: true 
    });
  }

  // Проверка версии расширения
  const clientVersion = req.headers['x-extension-version'];
  const minVersion = '3.0.6'; // Минимальная поддерживаемая версия
  
  if (clientVersion && clientVersion < minVersion) {
    return res.status(426).json({ 
      error: 'Extension version too old. Please update to v' + minVersion + ' or later.',
      minVersion,
      currentVersion: clientVersion
    });
  }

  try {
    const { entries } = req.body;

    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'Invalid entries format' });
    }

    let updated = 0;
    let inserted = 0;

    for (const entry of entries) {
      const { key, count, timestamp } = entry;

      if (!key || count === undefined || !timestamp) {
        console.warn('Skipping invalid entry:', entry);
        continue;
      }

      try {
        // Пытаемся обновить
        const updateResult = await pool.query(
          `UPDATE cache_entries 
           SET count = $1, timestamp = $2, updated_at = CURRENT_TIMESTAMP
           WHERE key = $3 AND timestamp < $2
           RETURNING id;`,
          [count, timestamp, key]
        );

        if (updateResult.rows.length > 0) {
          updated++;
        } else {
          // Если не обновилось, пытаемся вставить
          const insertResult = await pool.query(
            `INSERT INTO cache_entries (key, count, timestamp)
             VALUES ($1, $2, $3)
             ON CONFLICT (key) DO NOTHING
             RETURNING id;`,
            [key, count, timestamp]
          );

          if (insertResult.rows.length > 0) {
            inserted++;
          }
        }
      } catch (err) {
        console.error(`Error processing entry ${key}:`, err);
      }
    }

    res.json({ 
      success: true, 
      updated, 
      inserted,
      message: `Processed ${entries.length} entries`
    });
  } catch (error) {
    console.error('Error in /sync/push:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /sync/pull - Получить свежие данные для карт
 */
app.post('/sync/pull', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected',
      entries: []
    });
  }

  // Проверка версии расширения
  const clientVersion = req.headers['x-extension-version'];
  const minVersion = '3.0.6';
  
  if (!clientVersion || clientVersion < minVersion) {
    return res.status(426).json({ 
      error: 'Extension version too old. Please update to v' + minVersion + ' or later.',
      minVersion,
      currentVersion: clientVersion
    });
  }

  try {
    const { cardIds } = req.body;

    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      return res.status(400).json({ error: 'Invalid cardIds format' });
    }

    // Формируем список ключей для поиска
    const keys = [];
    cardIds.forEach(id => {
      keys.push(`owners_${id}`);
      keys.push(`wishlist_${id}`);
    });

    const result = await pool.query(
      `SELECT key, count, timestamp 
       FROM cache_entries 
       WHERE key = ANY($1)
       ORDER BY updated_at DESC;`,
      [keys]
    );

    res.json({
      success: true,
      entries: result.rows
    });
  } catch (error) {
    console.error('Error in /sync/pull:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cache/stats - Получить статистику кэша
 */
app.get('/cache/stats', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ 
      error: 'Database not connected',
      stats: null
    });
  }

  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_entries,
        AVG(count) as avg_count,
        MAX(timestamp) as latest_timestamp,
        COUNT(DISTINCT SUBSTRING(key FROM 1 FOR POSITION('_' IN key) - 1)) as unique_types
      FROM cache_entries;
    `);

    res.json({
      success: true,
      stats: result.rows[0]
    });
  } catch (error) {
    console.error('Error in /cache/stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /sync/all - DEPRECATED - Используйте /sync/pull
 */
app.get('/sync/all', (req, res) => {
  return res.status(410).json({ 
    error: 'This endpoint is deprecated. Please update your extension to v3.0.6 or later.',
    message: 'Use POST /sync/pull instead'
  });
});

/**
 * POST /cache/cleanup - Очистка старых записей
 */
app.post('/cache/cleanup', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database not connected' });
  }

  try {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const result = await pool.query('DELETE FROM cache_entries WHERE timestamp < $1 RETURNING id', [thirtyDaysAgo]);
    
    res.json({ 
      success: true,
      deleted: result.rowCount
    });
  } catch (error) {
    console.error('Error in /cache/cleanup:', error);
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

// Запуск сервера
const startServer = async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n🚀 Cache server running on http://localhost:${PORT}`);
        console.log(`Database: ${dbConnected ? '✅ Connected' : '⚠️  Demo mode (no database)'}\n`);
        console.log('Available endpoints:');
        console.log('  POST /sync/push  - Send cache data');
        console.log('  POST /sync/pull  - Get cache data');
        console.log('  GET  /cache/stats - Get statistics');
        console.log('  GET  /health     - Health check\n');
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
