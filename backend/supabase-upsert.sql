-- Функция для upsert записей с проверкой timestamp
-- Обновляет только если новый timestamp больше существующего

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
    -- Используем ON CONFLICT с условием WHERE для проверки timestamp
    INSERT INTO cache_entries (key, count, timestamp, updated_at)
    VALUES (
      entry->>'key',
      (entry->>'count')::integer,
      (entry->>'timestamp')::bigint,
      NOW()
    )
    ON CONFLICT (key) 
    DO UPDATE SET
      count = EXCLUDED.count,
      timestamp = EXCLUDED.timestamp,
      updated_at = NOW()
    WHERE cache_entries.timestamp < EXCLUDED.timestamp;
    
    -- Проверяем, была ли строка обновлена/вставлена
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

-- Создаём индекс для быстрой фильтрации по timestamp
CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON cache_entries(timestamp DESC);
