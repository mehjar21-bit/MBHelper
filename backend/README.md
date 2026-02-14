# MangaBuff Cache Server

Распределённый кэш-сервер для расширения MangaBuff

## Установка

```bash
npm install
```

## Конфигурация

Создайте файл `.env`:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost/mangabuff_cache
```

### Для Supabase:
```env
DATABASE_URL=postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=require
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<anon_public_key>
```

### Создать таблицу в Supabase (SQL Editor)
В консоли Supabase откройте **SQL** и выполните:
```sql
create table if not exists public.cache_entries (
  key text primary key,
  count integer not null,
  timestamp bigint not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cache_entries_updated_at on public.cache_entries;
create trigger trg_cache_entries_updated_at
before update on public.cache_entries
for each row execute procedure public.set_updated_at();

-- RLS policies for anon key
alter table public.cache_entries enable row level security;
drop policy if exists cache_entries_select on public.cache_entries;
drop policy if exists cache_entries_insert on public.cache_entries;
drop policy if exists cache_entries_update on public.cache_entries;

create policy cache_entries_select on public.cache_entries
for select using (true);

create policy cache_entries_insert on public.cache_entries
for insert with check (true);

create policy cache_entries_update on public.cache_entries
for update using (true) with check (true);
```


## Запуск

### Разработка
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### POST /sync/push
Отправить обновлённые данные на сервер

```json
{
  "entries": [
    {
      "key": "owners_123",
      "count": 100,
      "timestamp": 1766779000000
    },
    {
      "key": "wishlist_123",
      "count": 50,
      "timestamp": 1766779000000
    }
  ]
}
```

### POST /sync/pull
Получить свежие данные для карт

```json
{
  "cardIds": [123, 124, 125]
}
```

### GET /cache/stats
Получить статистику кэша

### GET /health
Health check

## Развёртывание

### Вариант 1: Railway.app (рекомендуется)
1. Создайте аккаунт на railway.app
2. Подключите GitHub репозиторий
3. Добавьте PostgreSQL плагин
4. Развёртывание произойдёт автоматически

### Вариант 2: Supabase (бесплатно)
1. Создайте проект на supabase.com
2. Получите DATABASE_URL из настроек
3. Используйте для своего хостинга

### Вариант 3: Heroku (платно)
```bash
heroku create mangabuff-cache-api
heroku addons:create heroku-postgresql:hobby-dev
git push heroku main
```

## Лицензия

ISC
