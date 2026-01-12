import { log, logError, logWarn, isExtensionContextValid } from './utils.js';
import { SYNC_SERVER_URL, EXTENSION_VERSION } from './config.js';

/**
 * Получает ВСЕ данные с сервера одним запросом (для кнопки синхронизации)
 * Сервер кэширует ответ на 5 минут
 */
export const syncPullAll = async () => {
  if (!isExtensionContextValid()) {
    throw new Error('Extension context invalid');
  }

  try {
    log(`📥 Fetching all data from server ${SYNC_SERVER_URL}/sync/pull-all ...`);
    
    const response = await fetch(`${SYNC_SERVER_URL}/sync/pull-all`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const { entries, count, cached } = await response.json();

    if (!entries || entries.length === 0) {
      log('No data from server');
      return { updated: 0, skipped: 0, total: 0 };
    }

    log(`📦 Received ${count} entries from server (cached: ${cached})`);

    // Получаем текущие локальные данные для сравнения
    const localData = await chrome.storage.local.get(null);
    
    const storageUpdate = {};
    let updated = 0;
    let skipped = 0;
    let tooOld = 0;
    
    const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // Не принимаем данные старше 30 дней
    const now = Date.now();
    
    entries.forEach(entry => {
      const { key, count, timestamp } = entry;
      const localEntry = localData[key];
      
      // Проверяем возраст серверных данных
      const age = now - timestamp;
      if (age > MAX_AGE) {
        tooOld++;
        return;
      }
      
      // Обновляем только если серверные данные свежее или локальных нет
      if (!localEntry || !localEntry.timestamp || localEntry.timestamp < timestamp) {
        storageUpdate[key] = { count, timestamp };
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
      logWarn(`⚠️ Rejected ${tooOld} entries (older than 30 days)`);
    }
    
    log(`✅ Sync complete: ${updated} updated, ${skipped} skipped (local fresher)`);
    
    return { updated, skipped, total: entries.length };
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

// Debug helper: expose sync API in service worker console
if (typeof self !== 'undefined') {
  self.MangaBuffSync = {
    syncPullAll,
    getLastSyncTime,
    formatLastSyncTime
  };
  log('MangaBuffSync debug API attached to self');
}

export default {
  syncPullAll,
  getLastSyncTime,
  formatLastSyncTime
};
