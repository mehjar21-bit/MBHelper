# Deploying MangaBuff Cache Server to Render.com

This service is a simple Express server that syncs cache entries to Supabase.

## Prerequisites
- Node.js 18+
- Supabase project with table `cache_entries`
- Render.com account (free tier available)

## Supabase table + RLS
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

## Deploy to Render.com

### Option 1: Deploy from GitHub (Recommended)

1. Push your backend code to GitHub repository
2. Go to [render.com](https://render.com) and sign in
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repository
5. Configure the service:
   - **Name**: `mangabuff-cache-server` (or your preferred name)
   - **Region**: Choose closest to your users
   - **Branch**: `main` (or your deployment branch)
   - **Root Directory**: `backend` (if backend is in subfolder)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (or paid if needed)

6. Add Environment Variables:
   - `SUPABASE_URL` → your Supabase project URL (e.g., `https://xxx.supabase.co`)
   - `SUPABASE_KEY` → anon/public key from Supabase
   - `NODE_ENV` → `production`
   - `PORT` is automatically set by Render

7. Click **"Create Web Service"**

### Option 2: Manual Deploy

```bash
# Install Render CLI (optional)
npm install -g render-cli

# Or use Render Dashboard to manually upload code
```

## After Deployment

After deployment, your service will be available at:
```
https://your-service-name.onrender.com
```

**Important**: Free tier services on Render spin down after 15 minutes of inactivity. First request after spin-down may take 30-60 seconds.

## Update Extension Configuration

Update the backend URL in your extension:

1. Open `config.js` in your extension project
2. Change `SYNC_SERVER_URL`:
   ```javascript
   export const SYNC_SERVER_URL = 'https://your-service-name.onrender.com';
   ```
3. Rebuild extension: `npm run build`
4. Reload extension in Chrome

## CORS Configuration

The server allows origins:
- Chrome extension (`chrome-extension://*`)
- Localhost (`:3000`, `:5173`)
- Render domains (`https://*.onrender.com`)

CORS is configured in `server.js`:
```javascript
const allowedOrigins = [
  /^chrome-extension:\/\//,
  /^https:\/\/.*\.onrender\.com$/,
  'http://localhost:3000',
  'http://localhost:5173'
];
```

## API Endpoints

### GET /sync/pull-all
Get all cache entries from Supabase

**Response:**
```json
{
  "entries": [
    { "key": "owners_123", "count": 100, "timestamp": 1766779000000 },
    { "key": "wishlist_456", "count": 50, "timestamp": 1766779000000 }
  ],
  "total": 2,
  "cached": false
}
```

### GET /health
Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "timestamp": 1766779000000,
  "uptime": 12345
}
```

### GET /cache/stats
Cache statistics

**Response:**
```json
{
  "totalEntries": 150000,
  "cacheHitRate": 0.85
}
```

## Monitoring

Render provides built-in monitoring:
1. Go to your service dashboard
2. Click **"Logs"** to view application logs
3. Click **"Metrics"** to see CPU, memory, and bandwidth usage

## Free Tier Limits

Render.com Free Tier includes:
- ✅ 750 hours/month runtime (enough for 1 service running 24/7)
- ✅ Auto-deploy from GitHub
- ✅ SSL certificates (HTTPS)
- ✅ Custom domains
- ⚠️ Spins down after 15 min inactivity (30-60s cold start)
- ⚠️ 100 GB bandwidth/month

## Troubleshooting

### Service won't start
- Check logs in Render dashboard
- Verify `PORT` environment variable (Render sets it automatically)
- Ensure `package.json` has correct `start` script

### CORS errors
- Verify `SYNC_SERVER_URL` in extension `config.js` matches Render URL
- Check allowed origins in `server.js`

### Slow response times
- Free tier spins down after inactivity
- Consider upgrading to paid tier for always-on service
- First request after spin-down takes 30-60 seconds

### Database connection errors
- Verify `SUPABASE_URL` and `SUPABASE_KEY` environment variables
- Check Supabase project is active and accessible
- Ensure RLS policies are configured correctly

## Cost Comparison

| Service | Free Tier | Paid Plans |
|---------|-----------|------------|
| Render.com | $0/mo (750h, with cold starts) | $7/mo (always-on) |
| Railway | $0/mo (500h, $5 credit) | Pay-as-you-go |
| Fly.io | $0/mo (3 VMs, with limits) | Pay-as-you-go |

**Recommendation**: Start with Render.com Free tier. Upgrade to $7/mo paid plan if you need always-on service without cold starts.
