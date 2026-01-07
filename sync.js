import { log, logError, logWarn, isExtensionContextValid } from './utils.js';
import { SYNC_SERVER_URL } from './config.js';
const SYNC_BATCH_SIZE = 100; // Отправляем по 100 записей за раз
const PUSH_INTERVAL = 2 * 60 * 60 * 1000; // PUSH каждые 2 часа
const PULL_INTERVAL = 6 * 60 * 60 * 1000; // PULL каждые 6 часов
const AUTO_PUSH_THRESHOLD = 50; // Автоматический PUSH при накоплении 50+ записей

/**
 * Проверяет количество накопленных данных и автоматически запускает PUSH если >= порога
 */
export const checkAndAutoPush = async () => {
  if (!isExtensionContextValid()) return;

  try {
    const allData = await chrome.storage.local.get(null);
    const lastSyncTime = allData._lastSyncTime || 0;

    const pendingEntries = Object.entries(allData)
      .filter(([key, value]) => {
        if (!key.startsWith('owners_') && !key.startsWith('wishlist_')) return false;
        return value && value.timestamp && value.timestamp > lastSyncTime;
      });

    if (pendingEntries.length >= AUTO_PUSH_THRESHOLD) {
      log(`🚀 Auto-PUSH: ${pendingEntries.length} pending entries (threshold: ${AUTO_PUSH_THRESHOLD})`);
      await syncCacheToServer();
    }
  } catch (error) {
    logError('Error in checkAndAutoPush:', error);
  }
};

/**
 * Отправляет конкретные записи на сервер (для фонового обновления)
 */
export const pushToSync = async (entries) => {
  if (!isExtensionContextValid()) return;
  if (!entries || entries.length === 0) return;

  try {
    const manifest = chrome.runtime.getManifest();
    const response = await fetch(`${SYNC_SERVER_URL}/sync/push`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Extension-Version': manifest.version
      },
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
        count: value.count,
        timestamp: value.timestamp
      }));

    if (dataToSync.length === 0) {
      log('No new data to sync (all entries already synced)');
      return;
    }

    // Проверяем автоматический PUSH при накоплении
    const isForcedPush = dataToSync.length >= AUTO_PUSH_THRESHOLD;
    if (isForcedPush) {
      log(`🚀 Auto-PUSH triggered: ${dataToSync.length} entries accumulated (threshold: ${AUTO_PUSH_THRESHOLD})`);
    }

    log(`Syncing ${dataToSync.length} new/updated entries to server...`);

    let totalProcessed = 0;
    let totalSkipped = 0;

    // Отправляем батчами
    for (let i = 0; i < dataToSync.length; i += SYNC_BATCH_SIZE) {
      const batch = dataToSync.slice(i, i + SYNC_BATCH_SIZE);
      
      try {
        const manifest = chrome.runtime.getManifest();
        const response = await fetch(`${SYNC_SERVER_URL}/sync/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Extension-Version': manifest.version
          },
          body: JSON.stringify({ entries: batch })
        });

        if (!response.ok) {
          const errorText = await response.text();
          logWarn(`Sync batch ${Math.floor(i / SYNC_BATCH_SIZE) + 1} failed: ${response.status} - ${errorText}`);
          continue;
        }
        
        const result = await response.json();
        totalProcessed += (result.processed || 0);
        totalSkipped += (result.skipped || 0);
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
    if (cardIds.length === 0) {
      log(`Fetching ALL cache from server (first sync) ${SYNC_SERVER_URL} ...`);
    } else {
      log(`Fetching fresh cache from server ${SYNC_SERVER_URL} ...`);
    }

    // Разбиваем на батчи по 100 ID (чтобы не перегружать сервер)
    const PULL_BATCH_SIZE = 500; // Увеличен с 100 для ускорения синхронизации
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (let i = 0; i < cardIds.length; i += PULL_BATCH_SIZE) {
      const batch = cardIds.slice(i, i + PULL_BATCH_SIZE);
      
      const manifest = chrome.runtime.getManifest();
      const response = await fetch(`${SYNC_SERVER_URL}/sync/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Version': manifest.version,
        },
        body: JSON.stringify({ cardIds: batch })
      });

      if (!response.ok) {
        logError(`Failed to fetch cache batch: ${response.status}`);
        continue; // Пропускаем этот батч, продолжаем со следующим
      }

      const { entries } = await response.json();
      
      if (!entries || entries.length === 0) {
        log(`No new data from server for batch ${Math.floor(i / PULL_BATCH_SIZE) + 1}`);
        continue;
      }

      // Получаем текущие локальные данные для сравнения
      const localData = await chrome.storage.local.get(null);

      // Обновляем локальное хранилище только если серверные данные свежее
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
      
      totalUpdated += updated;
      totalSkipped += skipped;
      
      if (tooOld > 0) {
        log(`Rejected ${tooOld} old entries`);
      }
    }
    
    log(`Pull completed: ${totalUpdated} updated, ${totalSkipped} skipped`);
  } catch (error) {
    logError('Error fetching cache from server:', error);
  }
};

/**
 * Полная загрузка всех записей из сервера (для нового пользователя)
 */
export const syncCachePullAll = async () => {
  // Полная выгрузка отключена для снижения трафика и стоимости
  log('PULL ALL is disabled. Use targeted sync via syncCacheFromServer.');
  return;
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
  // PUSH каждые 2 часа
  chrome.alarms.create('syncPush', { periodInMinutes: 120 });
  // PULL каждые 6 часов
  chrome.alarms.create('syncPull', { periodInMinutes: 360 });
  log('Periodic sync initialized: PUSH every 2h, PULL every 6h');
};

/**
 * Обработчик alarm для синхронизации
 */
export const handleSyncAlarm = async (alarm) => {
  if (alarm.name === 'syncPush') {
    log('⬆️ PUSH alarm triggered - sending local data to server');
    try {
      await syncCacheToServer();
      log('PUSH completed via alarm');
    } catch (error) {
      logError('Error in PUSH alarm:', error);
    }
  } else if (alarm.name === 'syncPull') {
    log('⬇️ PULL alarm triggered - refreshing stale entries only');
    try {
      // Собираем список «протухших» карточек из локального кэша
      const allData = await chrome.storage.local.get(null);
      const now = Date.now();

      const ownersTTL = 30 * 24 * 60 * 60 * 1000; // 30 дней
      const wishlistTTLDefault = 7 * 24 * 60 * 60 * 1000; // 7 дней
      const wishlistTTLZero = 24 * 60 * 60 * 1000; // 1 день, если count=0

      const staleIdsSet = new Set();

      for (const [key, value] of Object.entries(allData)) {
        if (!value || !value.timestamp) continue;
        const isOwner = key.startsWith('owners_');
        const isWishlist = key.startsWith('wishlist_');
        if (!isOwner && !isWishlist) continue;

        const cardId = key.split('_')[1];
        if (!cardId) continue;

        let ttl = isOwner ? ownersTTL : (value.count === 0 ? wishlistTTLZero : wishlistTTLDefault);
        const age = now - value.timestamp;
        if (age > ttl) {
          staleIdsSet.add(cardId);
        }
      }

      // Ограничиваем количество карточек для PULL, чтобы снизить egress
      const MAX_PULL_CARDS = 200;
      const staleIds = Array.from(staleIdsSet).slice(0, MAX_PULL_CARDS);

      if (staleIds.length === 0) {
        log('No stale cards found for limited PULL');
        return;
      }

      await syncCacheFromServer(staleIds);
      log(`Limited PULL completed for ${staleIds.length} cards`);
    } catch (error) {
      logError('Error in limited PULL alarm:', error);
    }
  }
};

// Debug helper: expose sync API in service worker console for manual triggering
if (typeof self !== 'undefined') {
  self.MangaBuffSync = {
    syncCacheToServer,
    syncCacheFromServer,
    syncCachePullAll,
    checkAndAutoPush,
    initPeriodicSync,
    handleSyncAlarm,
  };
  log('MangaBuffSync debug API attached to self');
}

export default {
  syncCacheToServer,
  syncCacheFromServer,
  syncCachePullAll,
  checkAndAutoPush,
  compareAndUpdateCache,
  initPeriodicSync,
  handleSyncAlarm
};
