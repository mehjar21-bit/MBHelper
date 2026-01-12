# MangaBuff Scraper v2.0

Многопоточный скрейпер с поддержкой прокси и множества аккаунтов.
**Записывает данные напрямую в Supabase PostgreSQL** (без посредничества Railway).

## Установка

```bash
cd MBProject
npm install puppeteer jsdom pg
```

## Настройка

### 1. Получение URL базы данных Supabase

1. Откройте проект Supabase
2. Перейдите в **Settings** → **Database**
3. Скопируйте **Connection string (URI)** из раздела "Connection pooling"
4. Замените `[YOUR-PASSWORD]` на ваш пароль БД

Формат: `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

### 2. Настройка аккаунтов MangaBuff

Запустите setup для каждого аккаунта:

```bash
node scraper-v2.js --setup
```

- Введите имя аккаунта (например, `account1`)
- Укажите прокси если нужно
- Залогиньтесь в открывшемся браузере
- Нажмите Enter в терминале

Повторите для каждого аккаунта.

### 3. Конфигурация (scraper-config.json)

```json
{
  "database": {
    "url": "postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"
  },
  "scraping": {
    "maxCardId": 328320,
    "batchSize": 100,
    "delayMin": 100,
    "delayMax": 500,
    "saveProgressEvery": 10,
    "retryAttempts": 3,
    "timeout": 30000
  },
  "proxies": [
    { "url": "http://user:pass@host:port", "enabled": true },
    { "url": "http://user2:pass2@host2:port2", "enabled": true }
  ],
  "workers": {
    "count": 3
  }
}
```

## Использование

### Базовый запуск (1 воркер)
```bash
node scraper-v2.js
```

### Несколько воркеров
```bash
node scraper-v2.js --workers=3
```

### Конкретный диапазон карт
```bash
node scraper-v2.js --from=1000 --to=5000
```

### Комбинированный запуск
```bash
node scraper-v2.js --workers=3 --from=1 --to=100000
```

### Проверка статуса
```bash
node scraper-v2.js --status
```

## Файлы

| Файл | Описание |
|------|----------|
| `scraper-config.json` | Основная конфигурация |
| `scraper-accounts.json` | Сохранённые аккаунты (cookies) |
| `scraper_progress.json` | Прогресс скрейпинга |

## Рекомендации

1. **Прокси**: Используйте разные прокси для разных аккаунтов
2. **Воркеры**: Не больше чем аккаунтов (иначе будут использоваться повторно)
3. **Задержки**: Увеличьте `delayMin/delayMax` если получаете 429 ошибки
4. **Database URL**: Храните URL базы данных в секрете, он содержит пароль!

## Архитектура

```
┌─────────────────────────────────────────────────────┐
│                    Scraper v2                       │
├─────────────┬─────────────┬─────────────────────────┤
│  Worker 0   │  Worker 1   │  Worker 2   │    ...    │
│ (account1)  │ (account2)  │ (account3)  │           │
│ (proxy1)    │ (proxy2)    │ (proxy3)    │           │
│ cards 1-1k  │ cards 1k-2k │ cards 2k-3k │           │
└─────────────┴─────────────┴─────────────────────────┘
                      │
                      │  Direct PostgreSQL INSERT
                      ▼
              ┌──────────────┐
              │   Supabase   │◄───── Railway (читает)
              │   PostgreSQL │       для Extension
              └──────────────┘
```

## Безопасность

- `scraper-config.json` содержит URL с паролем — **не коммитьте в git!**
- Добавьте в `.gitignore`:
  ```
  scraper-config.json
  scraper-accounts.json
  ```
