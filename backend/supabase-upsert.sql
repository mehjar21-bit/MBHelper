-- Функция для upsert записей с проверкой timestamp
-- Использует jsonb массив для batch операций

CREATE OR REPLACE FUNCTION upsert_cache_entries(entries jsonb)
RETURNS TABLE (updated integer, skipped integer) AS $$
DECLARE
  entry jsonb;
  updated_count integer := 0;
  skipped_count integer := 0;
  existing_ts bigint;
BEGIN
  FOR entry IN SELECT * FROM jsonb_array_elements(entries)
  LOOP
    -- Получаем существующий timestamp
    SELECT timestamp INTO existing_ts 
    FROM cache_entries 
    WHERE key = (entry->>'key');
    
    -- Если записи нет или новые данные свежее - обновляем
    IF existing_ts IS NULL OR existing_ts < (entry->>'timestamp')::bigint THEN
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
        updated_at = NOW();
      
      updated_count := updated_count + 1;
    ELSE
      skipped_count := skipped_count + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT updated_count, skipped_count;
END;
$$ LANGUAGE plpgsql;
