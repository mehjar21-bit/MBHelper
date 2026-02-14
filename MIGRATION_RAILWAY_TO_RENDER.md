# Migration Guide: Railway → Render.com

Инструкция по переносу бэкенда с Railway на Render.com

## Зачем переходить?

- ✅ **Render.com** предоставляет 750 бесплатных часов в месяц (достаточно для 24/7 работы 1 сервиса)
- ✅ Автоматический деплой из GitHub
- ✅ Бесплатный SSL (HTTPS)
- ✅ Простая настройка без кредитной карты
- ⚠️ Free tier имеет холодные старты после 15 минут неактивности (30-60 секунд на первый запрос)

## Шаг 1: Подготовка

### 1.1 Сохраните текущие переменные окружения из Railway

Зайдите в Railway Dashboard → Ваш сервис → Variables и сохраните:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `DATABASE_URL` (если используется)

## Шаг 2: Создание сервиса на Render.com

### 2.1 Регистрация на Render

1. Перейдите на [render.com](https://render.com)
2. Войдите через GitHub аккаунт
3. Подтвердите доступ к репозиториям

### 2.2 Создание Web Service

1. Кликните **"New +"** → **"Web Service"**
2. Выберите ваш GitHub репозиторий (например, `MBProject`)
3. Настройте параметры:
   ```
   Name: mangabuff-cache-server
   Region: Frankfurt (EU Central) или ближайший к вам
   Branch: main
   Root Directory: backend
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   ```

### 2.3 Добавление Environment Variables

Нажмите **"Advanced"** → **"Add Environment Variable"** и добавьте:

```env
SUPABASE_URL=https://qwrgjwbitlcdapmpmrhv.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
NODE_ENV=production
```

**Важно**: `PORT` добавлять не нужно — Render устанавливает автоматически.

### 2.4 Деплой

1. Нажмите **"Create Web Service"**
2. Подождите пока завершится первый деплой (2-5 минут)
3. Скопируйте URL вашего сервиса (например, `https://mangabuff-cache-server.onrender.com`)

## Шаг 3: Обновление Extension

### 3.1 Обновите URL в config.js

Откройте файл `config.js` в корне проекта:

```javascript
// Было:
export const SYNC_SERVER_URL = 'https://mbhelperv31-production.up.railway.app';

// Стало:
export const SYNC_SERVER_URL = 'https://mangabuff-cache-server.onrender.com';
```

### 3.2 Пересоберите extension

```bash
npm run build
```

### 3.3 Обновите extension в Chrome

1. Откройте `chrome://extensions/`
2. Нажмите на иконку обновления ↻ для вашего расширения
3. Или удалите и загрузите заново папку `dist/`

## Шаг 4: Проверка работоспособности

### 4.1 Проверьте health endpoint

Откройте в браузере:
```
https://your-service-name.onrender.com/health
```

Должны увидеть:
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "uptime": 123
}
```

### 4.2 Проверьте синхронизацию в extension

1. Откройте любую страницу MangaBuff.ru
2. Откройте popup расширения
3. Нажмите "Sync кэш с сервером"
4. Проверьте консоль браузера (F12) на наличие ошибок

## Шаг 5: Отключение Railway (опционально)

Если всё работает на Render:

1. Зайдите в Railway Dashboard
2. Выберите ваш старый сервис
3. Settings → Danger Zone → Delete Service

## Различия между Railway и Render

| Функция | Railway | Render.com |
|---------|---------|------------|
| Free tier | 500 часов ($5 credit) | 750 часов |
| Холодные старты | Нет | Да (15 мин неактивности) |
| Auto-deploy | Да | Да |
| SSL/HTTPS | Да | Да |
| Custom domains | Да | Да |
| Требует карту | Нет | Нет |
| Скорость деплоя | ~1-2 мин | ~2-5 мин |

## Решение проблем

### Сервис не запускается

**Проблема**: Логи показывают ошибку подключения к БД

**Решение**:
1. Проверьте `SUPABASE_URL` и `SUPABASE_KEY` в Environment Variables
2. Убедитесь что используете Supabase connection string (не database URL напрямую)
3. Проверьте что в Supabase включены RLS policies

### CORS ошибки в extension

**Проблема**: Extension показывает CORS ошибки при синхронизации

**Решение**:
1. Убедитесь что `SYNC_SERVER_URL` в `config.js` соответствует URL на Render
2. Пересоберите extension: `npm run build`
3. Полностью перезагрузите extension в Chrome

### Медленный первый запрос

**Проблема**: Первый запрос после долгого простоя занимает 30-60 секунд

**Решение**:
- Это нормально для Free tier Render (холодный старт)
- Для always-hot сервиса нужен платный план ($7/месяц)
- Или настройте external упtime monitoring (UptimeRobot) для пинга каждые 10 минут

### Render пингер для избежания холодных стартов (Free Hack)

Создайте бесплатный мониторинг на [UptimeRobot](https://uptimerobot.com):
1. Добавьте новый монитор
2. URL: `https://your-service.onrender.com/health`
3. Интервал: 5 минут
4. Это будет пинговать ваш сервис и держать его активным

**Важно**: Это может нарушать ToS Render.com, используйте на свой риск.

## Checklist миграции

- [ ] Скопированы environment variables из Railway
- [ ] Создан Web Service на Render.com
- [ ] Добавлены environment variables в Render
- [ ] Деплой успешно завершен
- [ ] Проверен `/health` endpoint
- [ ] Обновлен `SYNC_SERVER_URL` в `config.js`
- [ ] Extension пересобран (`npm run build`)
- [ ] Extension обновлен в Chrome
- [ ] Синхронизация работает
- [ ] Railway сервис отключен (опционально)

## Контакты и поддержка

Если что-то не работает:
1. Проверьте логи в Render Dashboard → Logs
2. Проверьте консоль браузера в Chrome DevTools
3. Убедитесь что Supabase доступен и RLS policies настроены

---

**Примерное время миграции**: 15-30 минут

**Downtime**: 0-5 минут (пока обновляете extension)
