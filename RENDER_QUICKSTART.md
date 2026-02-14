# 🚀 Render.com Quick Start

Быстрый деплой бэкенда на Render.com за 5 минут.

## Шаг 1: Подключение GitHub (1 минута)

1. Зайдите на [render.com](https://render.com)
2. **Sign Up** через GitHub
3. Разрешите доступ к вашему репозиторию

## Шаг 2: Создание Web Service (2 минуты)

1. Нажмите **"New +"** → **"Web Service"**
2. Выберите репозиторий с проектом
3. Настройки:
   ```
   Name: mangabuff-cache
   Region: Frankfurt (EU)
   Branch: main
   Root Directory: backend
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   ```

## Шаг 3: Environment Variables (1 минута)

Нажмите **Advanced** и добавьте:

```env
SUPABASE_URL=https://qwrgjwbitlcdapmpmrhv.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
NODE_ENV=production
```

**Где взять значения?**
- `SUPABASE_URL`: Supabase Dashboard → Settings → API → URL
- `SUPABASE_KEY`: Supabase Dashboard → Settings → API → anon/public key

## Шаг 4: Deploy (1 минута)

1. Нажмите **"Create Web Service"**
2. Дождитесь завершения деплоя (~2-3 минуты)
3. Скопируйте URL: `https://your-service.onrender.com`

## Шаг 5: Обновление Extension (30 секунд)

Откройте `config.js`:

```javascript
// Замените URL:
export const SYNC_SERVER_URL = 'https://your-service.onrender.com';
```

Пересоберите:
```bash
npm run build
```

Перезагрузите extension в Chrome (chrome://extensions/ → ↻)

## ✅ Готово!

Проверьте работоспособность:
```
https://your-service.onrender.com/health
```

Должны увидеть:
```json
{"status":"ok","timestamp":1234567890,"uptime":123}
```

---

## 📋 Checklist

- [ ] Создан Web Service на Render
- [ ] Добавлены SUPABASE_URL и SUPABASE_KEY
- [ ] Деплой успешно завершен
- [ ] `/health` возвращает `{"status":"ok"}`
- [ ] Обновлен `SYNC_SERVER_URL` в config.js
- [ ] Extension пересобран и перезагружен
- [ ] Синхронизация работает

## ⚡ Важные замечания

**Free Tier особенности:**
- ⏱️ **Холодный старт**: сервис засыпает после 15 минут неактивности
- 🐌 **Первый запрос**: может занять 30-60 секунд после сна
- 📊 **750 часов/месяц**: достаточно для 24/7 работы одного сервиса
- 🔄 **Auto-deploy**: при push в main автоматически обновляется

**Как избежать холодных стартов (опционально):**
1. Зарегистрируйтесь на [UptimeRobot](https://uptimerobot.com) (бесплатно)
2. Добавьте мониторинг: `https://your-service.onrender.com/health`
3. Интервал: 5-10 минут
4. Это будет пинговать сервис и держать его активным

⚠️ **Внимание**: частые пинги могут нарушать ToS Render — используйте на свой риск.

---

## 🔧 Troubleshooting

### Сервис не стартует
→ Проверьте логи в Render Dashboard

### CORS errors
→ Убедитесь что URL в config.js совпадает с Render URL

### База данных не подключается
→ Проверьте SUPABASE_URL и SUPABASE_KEY

---

**Полная инструкция**: [MIGRATION_RAILWAY_TO_RENDER.md](MIGRATION_RAILWAY_TO_RENDER.md)

**Документация Render**: [backend/README-Render.md](backend/README-Render.md)
