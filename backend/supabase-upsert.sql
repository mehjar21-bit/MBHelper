-- Функция и вспомогательные объекты для корректного upsert в cache_entries
-- Обновляет строку только если входящий timestamp больше существующего
-- Устанавливает created_at по умолчанию и поддерживает updated_at триггером

-- 1) Устанавливаем DEFAULT для created_at
ALTER TABLE public.cache_entries
  ALTER COLUMN created_at SET DEFAULT now();

-- 2) Функция-триггер для обновления updated_at при UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cache_entries_updated_at ON public.cache_entries;
CREATE TRIGGER trg_cache_entries_updated_at
BEFORE UPDATE ON public.cache_entries
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- 3) Функция upsert: вставляет created_at/updated_at и обновляет только если EXCLUDED.timestamp > existing
CREATE OR REPLACE FUNCTION upsert_cache_entries(entries jsonb)
RETURNS TABLE (updated integer, skipped integer) AS $$
DECLARE
  entry jsonb;
  updated_count integer := 0;
  skipped_count integer := 0;
  rows_affected integer;
BEGIN
  FOR entry IN SELECT * FROM jsonb_array_elements(entries)
  LOOP
    INSERT INTO cache_entries (key, count, timestamp, created_at, updated_at)
    VALUES (
      entry->>'key',
      (entry->>'count')::integer,
      (entry->>'timestamp')::bigint,
      NOW(),
      NOW()
    )
    ON CONFLICT (key)
    DO UPDATE SET
      count = EXCLUDED.count,
      timestamp = EXCLUDED.timestamp,
      updated_at = NOW()
    WHERE cache_entries.timestamp < EXCLUDED.timestamp;

    GET DIAGNOSTICS rows_affected = ROW_COUNT;
    IF rows_affected > 0 THEN
      updated_count := updated_count + 1;
    ELSE
      skipped_count := skipped_count + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT updated_count, skipped_count;
END;
$$ LANGUAGE plpgsql;

-- 4) Индекс для быстрого поиска по timestamp
CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON cache_entries(timestamp DESC);

-- 5) (Опционально) Однократное заполнение существующих NULL created_at/updated_at на основе timestamp
-- Выполните вручную в SQL Editor, если хотите заполнить исторические записи:
-- UPDATE public.cache_entries
-- SET created_at = to_timestamp(timestamp / 1000.0)
-- WHERE created_at IS NULL;
--
-- UPDATE public.cache_entries
-- SET updated_at = to_timestamp(timestamp / 1000.0)
-- WHERE updated_at IS NULL;
