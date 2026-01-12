# MangaBuff Distributed Cache System v3.1

Система синхронизации данных о картах MangaBuff.

## Архитектура v3.1 (Pull-only)

```
┌─────────────────────────────────────────────────────────────┐
│                    SCRAPER (ваш сервер)                     │
│                    scraper-v2.js                            │
│   - Множество воркеров                                      │
│   - Разные прокси и аккаунты                                │
│   - Записывает напрямую в PostgreSQL                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Direct PostgreSQL INSERT
                              ▼
                     ┌─────────────────┐
                     │    Supabase     │
                     │   PostgreSQL    │
                     │  (cache_entries)│
                     └─────────────────┘
                              ▲
                              │ SELECT (read-only)
                              │
┌─────────────────────────────────────────────────────────────┐
│               RAILWAY BACKEND (server.js)                   │
│   - GET /sync/pull-all только                               │
│   - node-cache (5 мин TTL)                                  │
│   - GZIP сжатие                                             │
│   - Rate limit 50 req/hour                                  │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP GET (при клике кнопки)
                              │
┌─────────────────────────────────────────────────────────────┐
│              Chrome Extension v3.1.0                        │
│   - Нет авто-синхронизации                                  │
│   - Только ручной pull через кнопку                         │
│   - Локальное хранилище в chrome.storage                    │
└─────────────────────────────────────────────────────────────┘
```

## Компоненты

### 🔄 Scraper (`scraper-v2.js`)
- Многопоточный парсинг карт с MangaBuff
- Поддержка множества аккаунтов и прокси
- **Прямая запись в Supabase PostgreSQL** (без Railway)
- Сохранение прогресса для продолжения

### 🖥️ Backend (`/backend/server.js`)
- Единственный эндпоинт: `GET /sync/pull-all`
- node-cache с TTL 5 минут (дедупликация запросов)
- GZIP сжатие ответов
- Rate limiting: 50 запросов/час на IP

### 📦 Extension (`sync.js`)
- `syncPullAll()` — получить все данные с сервера
- Вызывается только по клику на кнопку
- Нет автоматической синхронизации

## Потоки данных

### Scraper → Supabase (прямая запись)
```javascript
// scraper-v2.js использует pg напрямую:
const { Pool } = require('pg');
pool.query(`
  INSERT INTO cache_entries (key, count, timestamp)
  VALUES ($1, $2, $3)
  ON CONFLICT (key) DO UPDATE ...
`)
```

### Extension → Railway → Supabase (только чтение)
```javascript
// GET /sync/pull-all
// Ответ (кэшируется 5 минут):
{
  "entries": [
    { "key": "owners_123", "count": 100, "timestamp": 1766779000000 },
    { "key": "wishlist_123", "count": 50, "timestamp": 1766778000000 }
  ],
  "total": 2,
  "cached": true  // если из node-cache
}
```

## Преимущества архитектуры v3.1

✅ **Минимальный трафик Railway** — только чтение, кэш 5 мин  
✅ **Скрейпер не нагружает Railway** — пишет напрямую в Supabase  
✅ **Нет автоматических запросов** — пользователь решает когда синхронизировать  
✅ **Приватно** — extension не отправляет никаких данных  
✅ **Экономно** — Railway Free Tier достаточно  

## Quick Start

### Запуск скрейпера
```bash
# Установка
npm install puppeteer jsdom pg

# Настройка аккаунта
node scraper-v2.js --setup

# Запуск (1 воркер)
node scraper-v2.js

# Запуск (3 воркера, карты 1-50000)
node scraper-v2.js --workers=3 --from=1 --to=50000
```

### Деплой бэкенда
```bash
cd backend
# Railway auto-deploys from GitHub
# Требуется: DATABASE_URL в переменных окружения
```

### Сборка расширения
```bash
npm run build
# Загрузите dist/ в Chrome как unpacked extension
```

## Файлы конфигурации

| Файл | Описание | В Git? |
|------|----------|--------|
| `scraper-config.json` | URL БД, параметры скрейпинга | ❌ (содержит пароль) |
| `scraper-accounts.json` | Cookies аккаунтов MangaBuff | ❌ |
| `scraper_progress.json` | Прогресс скрейпинга | ❌ |

## Переменные окружения

### Railway Backend
```
DATABASE_URL=postgresql://...  # Supabase connection string
PORT=3000                      # Порт сервера (Railway задаёт автоматически)
```

### Scraper (scraper-config.json)
```json
{
  "database": {
    "url": "postgresql://postgres:PASSWORD@db.xxx.supabase.co:5432/postgres"
  }
}
```

## Стоимость

| Сервис | Tier | Стоимость |
|--------|------|-----------|
| Supabase PostgreSQL | Free | $0/мес (500MB) |
| Railway Backend | Free | ~$0-5/мес |
| Scraper | Ваш сервер | — |

**Total: ~$0-5/месяц** при умеренном использовании
