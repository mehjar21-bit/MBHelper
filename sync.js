import { log, logError, logWarn, isExtensionContextValid } from './utils.js';
import { SYNC_SERVER_URL, EXTENSION_VERSION } from './config.js';

const BATCH_SIZE = 10000; // Supabase REST API лимит настроен на 10000 записей

/**
 * Получает ВСЕ данные с сервера с пагинацией
 */
export const syncPullAll = async () => {
  if (!isExtensionContextValid()) {
    throw new Error('Extension context invalid');
  }

  try {
    log(`📥 Fetching all data from server ${SYNC_SERVER_URL}/sync/pull-all ...`);
    
    let allEntries = [];
    let offset = 0;
    let hasMore = true;
    
    // Загружаем все данные батчами
    while (hasMore) {
      const response = await fetch(`${SYNC_SERVER_URL}/sync/pull-all?limit=${BATCH_SIZE}&offset=${offset}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const { entries, count } = await response.json();
      
      if (!entries || entries.length === 0) {
        hasMore = false;
      } else {
        allEntries = allEntries.concat(entries);
        log(`📦 Batch ${Math.floor(offset / BATCH_SIZE) + 1}: received ${entries.length} entries`);
        
        if (entries.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      }
    }

    if (allEntries.length === 0) {
      log('No data from server');
      return { updated: 0, skipped: 0, total: 0 };
    }

    log(`📦 Total received: ${allEntries.length} entries`);

    // Получаем текущие локальные данные для сравнения
    const localData = await chrome.storage.local.get(null);
    
    const storageUpdate = {};
    let updated = 0;
    let skipped = 0;
    let tooOld = 0;
    
    const MAX_AGE = 60 * 24 * 60 * 60 * 1000; // Не принимаем данные старше 60 дней
    const now = Date.now();
    
    allEntries.forEach(entry => {
      const { key } = entry;

      // Приводим возвращённые сервером значения к корректным типам
      const rawCount = entry.count;
      let count = (typeof rawCount === 'number') ? rawCount : Number(rawCount);
      if (!Number.isFinite(count) || isNaN(count)) count = 0;

      const timestamp = Number(entry.timestamp) || 0;
      const localEntry = localData[key];
      
      // Проверяем возраст серверных данных
      const age = now - timestamp;
      if (age > MAX_AGE) {
        tooOld++;
        return;
      }

      // TTL: 30 дней по умолчанию, но для wishlist с 0 — 1 день (как в api.js)
      let ttl = 30 * 24 * 60 * 60 * 1000;
      if (key && key.startsWith('wishlist_') && count === 0) {
        ttl = 24 * 60 * 60 * 1000;
      }
      
      // Обновляем только если серверные данные свежее или локальных нет
      if (!localEntry || !localEntry.timestamp || localEntry.timestamp < timestamp) {
        storageUpdate[key] = { count, timestamp, ttl };
        updated++;
      } else {
        skipped++;
      }
    });

    if (Object.keys(storageUpdate).length > 0) {
      await chrome.storage.local.set(storageUpdate);
    }
    
    // Сохраняем время последней синхронизации
    await chrome.storage.local.set({ _lastSyncTime: now });
    
    if (tooOld > 0) {
      logWarn(`⚠️ Rejected ${tooOld} entries (older than 60 days)`);
    }
    
    log(`✅ Sync complete: ${updated} updated, ${skipped} skipped (local fresher)`);
    
    return { updated, skipped, total: allEntries.length };
  } catch (error) {
    logError('Error pulling data from server:', error);
    throw error;
  }
};

/**
 * Получает время последней синхронизации
 */
export const getLastSyncTime = async () => {
  if (!isExtensionContextValid()) return null;
  
  try {
    const data = await chrome.storage.local.get('_lastSyncTime');
    return data._lastSyncTime || null;
  } catch (error) {
    logError('Error getting last sync time:', error);
    return null;
  }
};

/**
 * Форматирует время последней синхронизации для отображения
 */
export const formatLastSyncTime = (timestamp) => {
  if (!timestamp) return 'Никогда';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return 'Только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;
  if (days === 1) return 'Вчера';
  if (days < 7) return `${days} дн. назад`;
  
  const date = new Date(timestamp);
  return date.toLocaleDateString('ru-RU');
};

export const normalizeLocalCache = async () => {
  if (!isExtensionContextValid()) return { fixed: 0 };
  try {
    const all = await chrome.storage.local.get(null);
    const updates = {};
    let fixed = 0;

    for (const [key, val] of Object.entries(all)) {
      if (!key.startsWith('owners_') && !key.startsWith('wishlist_')) continue;
      if (!val || typeof val !== 'object') continue;

      const rawCount = val.count;
      let count = (typeof rawCount === 'number') ? rawCount : Number(rawCount);
      if (!Number.isFinite(count) || isNaN(count)) count = 0;
      const timestamp = Number(val.timestamp) || Date.now();

      let ttl = val.ttl;
      if (ttl == null) {
        ttl = (key.startsWith('wishlist_') && count === 0) ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      }

      if (val.count !== count || val.timestamp !== timestamp || val.ttl !== ttl) {
        updates[key] = { count, timestamp, ttl };
        fixed++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }

    log(`normalizeLocalCache: fixed ${fixed} entries`);
    return { fixed };
  } catch (error) {
    logError('normalizeLocalCache error:', error);
    return { fixed: 0, error: error.message };
  }
};

// Debug helpers: dump/clear debug pages saved by api.js
export const getDebugDumps = async (keys = null) => {
  if (!isExtensionContextValid()) return {};
  try {
    const all = await chrome.storage.local.get(null);
    const debugKeys = Object.keys(all).filter(k => k.startsWith('debug_'));
    const result = {};
    if (Array.isArray(keys) && keys.length > 0) {
      for (const k of debugKeys) {
        if (keys.includes(k)) result[k] = all[k];
      }
    } else {
      for (const k of debugKeys) result[k] = all[k];
    }
    log(`getDebugDumps: returning ${Object.keys(result).length} dumps`);
    return result;
  } catch (error) {
    logError('getDebugDumps error:', error);
    return {};
  }
};

export const clearDebugDumps = async (keys = null) => {
  if (!isExtensionContextValid()) return { removed: 0 };
  try {
    const all = await chrome.storage.local.get(null);
    let debugKeys = Object.keys(all).filter(k => k.startsWith('debug_'));
    if (Array.isArray(keys) && keys.length > 0) {
      debugKeys = debugKeys.filter(k => keys.includes(k));
    }
    if (debugKeys.length === 0) return { removed: 0 };
    await chrome.storage.local.remove(debugKeys);
    log(`clearDebugDumps: removed ${debugKeys.length} dumps`);
    return { removed: debugKeys.length, keys: debugKeys };
  } catch (error) {
    logError('clearDebugDumps error:', error);
    return { removed: 0, error: error.message };
  }
};

// Debug helper: expose sync API in service worker console
if (typeof self !== 'undefined') {
  self.MangaBuffSync = {
    syncPullAll,
    getLastSyncTime,
    formatLastSyncTime,
    normalizeLocalCache,
    getDebugDumps,
    clearDebugDumps
  };
  log('MangaBuffSync debug API attached to self');
}

export default {
  syncPullAll,
  getLastSyncTime,
  formatLastSyncTime,
  getDebugDumps,
  clearDebugDumps
};
