import { log, logError, logWarn, isExtensionContextValid } from './utils.js';
import { SYNC_SERVER_URL } from './config.js';
const SYNC_BATCH_SIZE = 100; // Отправляем по 100 записей за раз
const SYNC_INTERVAL = 30 * 60 * 1000; // Синхронизация каждые 30 минут

/**
 * Отправляет конкретные записи на сервер (для фонового обновления)
 */
export const pushToSync = async (entries) => {
  if (!isExtensionContextValid()) return;
  if (!entries || entries.length === 0) return;

  try {
    const response = await fetch(`${SYNC_SERVER_URL}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries })
    });

    if (!response.ok) {
      throw new Error(`Push failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    log(`Pushed ${entries.length} entries to server:`, result);
  } catch (error) {
    logError('Failed to push entries to sync server:', error);
  }
};

/**
 * Отправляет свежие данные на сервер
 */
export const syncCacheToServer = async () => {
  if (!isExtensionContextValid()) return;

  try {
    log(`Starting cache sync to server ${SYNC_SERVER_URL} ...`);
    
    // Получаем все данные из локального хранилища
    const allData = await chrome.storage.local.get(null);
    
    if (!allData || Object.keys(allData).length === 0) {
      log('No data to sync');
      return;
    }

    // Получаем время последней синхронизации
    const lastSyncTime = allData._lastSyncTime || 0;
    const now = Date.now();

    // Подготавливаем данные для отправки (только изменённые с момента последней синхронизации)
    const dataToSync = Object.entries(allData)
      .filter(([key, value]) => {
        if (!key.startsWith('owners_') && !key.startsWith('wishlist_')) return false;
        // Отправляем только если timestamp свежее последней синхронизации
        return value && value.timestamp && value.timestamp > lastSyncTime;
      })
      .map(([key, value]) => ({
        key,
        ...value
      }));

    if (dataToSync.length === 0) {
      log('No new data to sync (all entries already synced)');
      return;
    }

    log(`Syncing ${dataToSync.length} new/updated entries to server...`);
    
    // Выводим примеры данных
    if (dataToSync.length > 0) {
      log(`Sample entries: ${dataToSync.slice(0, 3).map(e => e.key).join(', ')}`);
    }

    let totalProcessed = 0;
    let totalSkipped = 0;

    // Отправляем батчами
    for (let i = 0; i < dataToSync.length; i += SYNC_BATCH_SIZE) {
      const batch = dataToSync.slice(i, i + SYNC_BATCH_SIZE);
      
      try {
        log(`→ PUSH batch ${Math.floor(i / SYNC_BATCH_SIZE) + 1}: ${batch.length} entries to ${SYNC_SERVER_URL}`);
        const response = await fetch(`${SYNC_SERVER_URL}/sync/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ entries: batch })
        });

        if (!response.ok) {
          const errorText = await response.text();
          logWarn(`Sync batch ${Math.floor(i / SYNC_BATCH_SIZE) + 1} failed: ${response.status} - ${errorText}`);
          continue;
        }
        
        const result = await response.json();
        const processed = result.processed || 0;
        const skipped = result.skipped || 0;
        
        totalProcessed += processed;
        totalSkipped += skipped;
        
        log(`✔ PUSH ok batch ${Math.floor(i / SYNC_BATCH_SIZE) + 1}/${Math.ceil(dataToSync.length / SYNC_BATCH_SIZE)} - updated: ${processed}, skipped: ${skipped}`);
      } catch (error) {
        logError(`Error syncing batch:`, error);
      }
    }

    // Сохраняем время последней успешной синхронизации
    await chrome.storage.local.set({ _lastSyncTime: now });
    
    log(`Cache sync completed: ${totalProcessed} updated, ${totalSkipped} skipped`);
  } catch (error) {
    logError('Error during cache sync:', error);
  }
};

/**
 * Получает свежие данные с сервера и обновляет локальный кэш
 */
export const syncCacheFromServer = async (cardIds = []) => {
  if (!isExtensionContextValid()) return;

  try {
    log(`Fetching fresh cache from server ${SYNC_SERVER_URL} ...`);

    if (cardIds.length === 0) {
      log('No card IDs specified for sync pull');
      return;
    }

    log(`→ PULL ${cardIds.length} ids from ${SYNC_SERVER_URL}`);
    const response = await fetch(`${SYNC_SERVER_URL}/sync/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cardIds })
    });

    if (!response.ok) {
      logError(`Failed to fetch cache: ${response.status}`);
      return;
    }

    const { entries } = await response.json();
    
    if (!entries || entries.length === 0) {
      log('No new data from server');
      return;
    }

    // Получаем текущие локальные данные для сравнения
    const localData = await chrome.storage.local.get(null);

    // Обновляем локальное хранилище только если серверные данные свежее
    const storageUpdate = {};
    let updated = 0;
    let skipped = 0;
    
    entries.forEach(entry => {
      const { key, count, timestamp } = entry;
      const localEntry = localData[key];
      
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
    
    log(`Pull: updated ${updated}, skipped ${skipped} (local fresher) entries`);
  } catch (error) {
    logError('Error fetching cache from server:', error);
  }
};

/**
 * Полная загрузка всех записей из сервера (для нового пользователя)
 */
export const syncCachePullAll = async (limit = 5000) => {
  if (!isExtensionContextValid()) return;

  try {
    log(`PULL ALL from server ${SYNC_SERVER_URL} (limit=${limit}) ...`);

    const response = await fetch(`${SYNC_SERVER_URL}/sync/all?limit=${limit}`, {
      method: 'GET'
    });

    if (!response.ok) {
      logError(`Failed to pull all cache: ${response.status}`);
      return;
    }

    const { entries } = await response.json();

    if (!entries || entries.length === 0) {
      log('No data from server (pull all)');
      return;
    }

    // Получаем текущие локальные данные для сравнения
    const localData = await chrome.storage.local.get(null);
    
    const storageUpdate = {};
    let updated = 0;
    let skipped = 0;
    
    entries.forEach(entry => {
      const { key, count, timestamp } = entry;
      const localEntry = localData[key];
      
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
    
    log(`Pull-all: updated ${updated}, skipped ${skipped} (local fresher) entries`);
  } catch (error) {
    logError('Error pulling all cache from server:', error);
  }
};

/**
 * Сравнивает timestamp и обновляет запись если локальная свежее
 */
export const compareAndUpdateCache = async (key, serverData) => {
  try {
    const localData = await chrome.storage.local.get([key]).then(r => r[key]);
    
    if (!localData) {
      // Нет локальных данных, берём с сервера
      await chrome.storage.local.set({
        [key]: serverData
      });
      return true;
    }

    if (localData.timestamp > serverData.timestamp) {
      // Локальные данные свежее, отправляем на сервер
      log(`Local data for ${key} is fresher, will sync to server`);
      return false; // Сигнал для отправки на сервер
    }

    // Серверные данные свежее, обновляем
    await chrome.storage.local.set({
      [key]: serverData
    });
    return true;
  } catch (error) {
    logError(`Error comparing cache for ${key}:`, error);
    return false;
  }
};

/**
 * Инициализирует периодическую синхронизацию
 */
export const initPeriodicSync = () => {
  // Создаём alarm для периодической синхронизации
  chrome.alarms.create('syncCache', { periodInMinutes: 30 });
  log('Periodic sync initialized (every 30 minutes)');
};

/**
 * Обработчик alarm для синхронизации
 */
export const handleSyncAlarm = (alarm) => {
  if (alarm.name === 'syncCache') {
    log('Sync alarm triggered');
    syncCacheToServer().catch(error => logError('Error in sync alarm:', error));
  }
};

// Debug helper: expose sync API in service worker console for manual triggering
if (typeof self !== 'undefined') {
  self.MangaBuffSync = {
    syncCacheToServer,
    syncCacheFromServer,
    syncCachePullAll,
    initPeriodicSync,
    handleSyncAlarm,
  };
  log('MangaBuffSync debug API attached to self');
}

export default {
  syncCacheToServer,
  syncCacheFromServer,
  syncCachePullAll,
  compareAndUpdateCache,
  initPeriodicSync,
  handleSyncAlarm
};
