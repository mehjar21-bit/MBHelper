# Настройка Supabase для MangaBuff Cache Server

## 1️⃣ Создание проекта на Supabase

1. Перейдите на [app.supabase.com](https://app.supabase.com)
2. Нажмите **"New Project"** или **"Create New Project"**
3. Заполните:
   - **Name**: `mangabuff-cache` (или другое имя)
   - **Database Password**: Придумайте надёжный пароль
   - **Region**: Выберите ближайший регион (например, EU-West)
4. Нажмите **"Create new project"**

⏳ Ждите ~2 минут, пока проект создастся

## 2️⃣ Получение Database URL

После создания проекта:

1. Откройте **Settings → Database**
2. Скопируйте **Connection string → URI** (выглядит так):
   ```
   postgresql://postgres.xxxxxxxxxxxxx:PASSWORD@db.xxxxxxxxxxxxx.supabase.co:5432/postgres?sslmode=require
   ```

3. **Замените `PASSWORD`** на пароль, который вводили при создании

## 3️⃣ Настройка Backend

### Локально (для разработки)

1. В папке `backend/` создайте файл `.env`:
   ```bash
   cp .env.example .env
   ```

2. Отредактируйте `.env`:
   ```env
   PORT=3000
   NODE_ENV=development
   DATABASE_URL=postgresql://postgres.xxxxxxxxxxxxx:YOUR_PASSWORD@db.xxxxxxxxxxxxx.supabase.co:5432/postgres?sslmode=require
   ```

3. Сохраните файл и перезапустите сервер:
   ```bash
   npm run dev
   ```

4. Проверьте в логе:
   ```
   ✅ Database connected: 2025-01-01T10:00:00.000Z
   ✅ Database tables initialized
   ```

## 4️⃣ Тестирование API

### Тест подключения
```bash
curl http://localhost:3000/health
```

Ответ:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": 1766779000000
}
```

### Тест push
```bash
curl -X POST http://localhost:3000/sync/push \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      {"key": "owners_123", "count": 100, "timestamp": 1766779000000},
      {"key": "wishlist_123", "count": 50, "timestamp": 1766779000000}
    ]
  }'
```

### Тест pull
```bash
curl -X POST http://localhost:3000/sync/pull \
  -H "Content-Type: application/json" \
  -d '{"cardIds": [123, 124, 125]}'
```

## 5️⃣ Развёртывание на Railway (Рекомендуется)

### Вариант A: Via GitHub (Автоматический)

1. Создайте новый репозиторий GitHub (если ещё нет)
2. Выложите проект:
   ```bash
   git add .
   git commit -m "Add MangaBuff Cache Server with Supabase"
   git push origin main
   ```

3. На [railway.app](https://railway.app):
   - Нажмите **"New Project"**
   - Выберите **"Deploy from GitHub"**
   - Подключите свой репозиторий
   - Выберите ветку `main`

4. Railway автоматически обнаружит `package.json` и настроит:
   - Переменные окружения
   - npm start

5. Добавьте переменную окружения:
   - **Переменные → Add Variable**
   - Имя: `DATABASE_URL`
   - Значение: Ваша Supabase CONNECTION STRING
   - Нажмите **Add**

6. Railway автоматически перезагрузится с новыми переменными

7. Получите URL вашего API в логах или в **Settings → Deployment**

### Вариант B: Via Railway CLI

```bash
# Установите Railway CLI
npm install -g @railway/cli

# Аутентификация
railway login

# Инициализируйте проект
cd backend
railway init

# Добавьте переменную
railway variables set DATABASE_URL="postgresql://..."

# Развёртывание
railway up
```

## 6️⃣ Обновление Extension

После получения URL API:

1. Откройте `config.js` в расширении
2. Обновите:
   ```javascript
   export const SYNC_SERVER_URL = 'https://your-project.railway.app';
   ```

3. Пересоберите расширение:
   ```bash
   npm run build
   ```

4. Перезагрузите расширение в Chrome

## 7️⃣ Мониторинг

### Логи на Railway
```
Railway Dashboard → Logs
```

### Статистика кэша
```bash
curl https://your-project.railway.app/cache/stats
```

## 🔒 Безопасность

⚠️ **Важно:**
- ❌ НЕ коммитьте `.env` в Git
- ✅ Используйте `.gitignore` (уже добавлен)
- ✅ Railway автоматически скрывает переменные окружения
- ✅ Используйте только HTTPS в production

## 🆘 Troubleshooting

### Ошибка: "Database connection failed"
- Проверьте DATABASE_URL в `.env`
- Убедитесь, что пароль правильный
- Проверьте регион в Supabase

### Ошибка: "Connection refused"
- Убедитесь, что Supabase проект активен
- Попробуйте переключить регион

### Railway не развёртывается
- Проверьте, что `package.json` находится в корне backend/
- Убедитесь, что `start` скрипт определён

## 📊 Полезные команды

```bash
# Просмотр логов локально
npm run dev

# Подключение к БД Supabase напрямую
psql postgresql://postgres.xxxxx:password@db.xxxxx.supabase.co:5432/postgres

# Просмотр размера БД
SELECT pg_size_pretty(pg_database_size('postgres'));
```

---

**Готово!** Теперь ваш backend подключен к Supabase и готов к использованию. 🎉
