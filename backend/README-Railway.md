# Deploying MangaBuff Cache Server to Railway

This service is a simple Express server that syncs cache entries to Supabase.

## Prerequisites
- Node.js 18+
- Supabase project with table `cache_entries`
- Railway account and CLI (`npm i -g railway`)

## Supabase table + RLS
```
create table if not exists public.cache_entries (
  key text primary key,
  count integer not null,
  timestamp bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.cache_entries enable row level security;

create policy anon_select on public.cache_entries
  for select using (true);

create policy anon_insert on public.cache_entries
  for insert with check (true);

create policy anon_update on public.cache_entries
  for update using (true) with check (true);
```

## Environment variables
Set these in Railway service settings:
- `SUPABASE_URL` → your Supabase project URL
- `SUPABASE_KEY` → anon key of the project
- `PORT` → optional; Railway injects automatically

## Deploy steps
```
railway login
railway init  # select or create a project
railway up    # deploy current folder (backend)
```

After deploy, your service will be available at `https://<name>.up.railway.app`.

Update the extension endpoint:
- In `config.js`, set `SYNC_SERVER_URL` to the Railway URL, e.g. `https://your-app.up.railway.app`.
- Rebuild and reload the unpacked extension.

## CORS
The server allows origins:
- Chrome extension (`chrome-extension://*`)
- Localhost (3000/5173)
- Railway domains (`https://*.railway.app`)

## Endpoints
- `POST /sync/push`
- `POST /sync/pull`
- `GET /cache/stats`
- `GET /health`
- `GET /debug/entries`
