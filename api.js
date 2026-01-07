// api.js (С ОПТИМИЗАЦИЕЙ ПО ПАГИНАЦИИ)
import { isExtensionContextValid, log, logWarn, logError } from './utils.js';
import { MAX_CONCURRENT_REQUESTS } from './config.js';

export const pendingRequests = new Map();
export let activeRequests = 0;
export let csrfToken = null;

export const setCsrfToken = (token) => {
    csrfToken = token;
}

// Функция для принудительного обновления карты (без кэша)
export const forceRefreshCard = async (cardId) => {
  if (!isExtensionContextValid()) return null;

  try {
    // Удаляем кэш для этой карты
    await chrome.storage.local.remove([`wishlist_${cardId}`, `owners_${cardId}`]);
    log(`Cache cleared for card ${cardId}`);

    // Получаем свежие данные (сохранятся локально, отправятся на сервер по расписанию)
    const [wishlistData, ownersData] = await Promise.all([
      getUserCount('wishlist', cardId),
      getUserCount('owners', cardId)
    ]);

    log(`Card ${cardId} refreshed successfully`);
    return { wishlist: wishlistData?.count ?? 0, owners: ownersData?.count ?? 0 };
  } catch (error) {
    logError(`Error force refreshing card ${cardId}:`, error);
    return null;
  }
};

const getLastPageNumber = (doc) => {
    const paginationButtons = doc.querySelectorAll('ul.pagination li.pagination__button a[href*="page="]');
    let maxPage = 1;
    paginationButtons.forEach(link => {
        const url = link.getAttribute('href');
        const match = url.match(/page=(\d+)/);
        if (match && match[1]) {
            const pageNum = parseInt(match[1], 10);
            if (!isNaN(pageNum) && pageNum > maxPage) {
                maxPage = pageNum;
            }
        }
    });
    return maxPage;
};

const countItemsOnPage = (doc, type) => {
    const selector = type === 'wishlist' ? '.profile__friends-item' : '.card-show__owner';
    return doc.querySelectorAll(selector).length;
};

const getUserCount = async (type, cardId, retries = 2) => {
  if (!isExtensionContextValid()) return 0;

  const cacheKey = `${type}_${cardId}`;
  if (!csrfToken) {
      csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  // Проверяем, является ли карта специальной (ID 328340-329239)
  const cardIdNum = parseInt(cardId, 10);
  const isSpecialCard = cardIdNum >= 328340 && cardIdNum <= 329239;
  
  // Для специальных карт НЕ используем кэш, всегда делаем свежий запрос
  if (!isSpecialCard) {
    try {
      const cached = await chrome.storage.local.get([cacheKey]).then(r => r[cacheKey]);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        // Динамический TTL: используем сохранённый ttl, иначе дефолт (owners=30 дней, wishlist=7 дней)
        const defaultTtl = (type === 'owners')
          ? 30 * 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
        const effectiveTtl = typeof cached.ttl === 'number' && cached.ttl > 0 ? cached.ttl : defaultTtl;
        const isOld = age > effectiveTtl; 
        
        // Если данные старые - запускаем фоновое обновление
        if (isOld) {
          log(`Cache is old (${Math.floor(age / (24 * 60 * 60 * 1000))} days) for ${cacheKey}, scheduling background refresh`);
          // Фоновое обновление без ожидания
          setTimeout(() => backgroundRefresh(type, cardId, cacheKey), 1000);
        }
        
        // Возвращаем кэшированные данные с метаданными
        return { count: cached.count, timestamp: cached.timestamp, isOld };
      }
    } catch (error) {
        logError(`Error accessing local storage for cache key ${cacheKey}:`, error);
    }
  } else {
    log(`Special card ${cardId} (${type}) - skipping cache, always fresh request`);
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  log(`Getting OPTIMIZED ${type} count for card ${cardId}`);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const requestPromise = (async () => {
    // Wait for an available slot. Use short randomized waits to avoid long blocking
    // and to reduce bursts that lead to 429 responses. Also cap iterations to avoid
    // waiting indefinitely.
    let waitIterations = 0;
    while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        const waitMs = 300 + Math.floor(Math.random() * 200); // 300-500ms
        await sleep(waitMs);
        waitIterations++;
        if (waitIterations > 20) {
            logWarn(`Waited ${(waitIterations * waitMs)}ms for request slot, proceeding anyway.`);
            break;
        }
    }
    activeRequests++;

    // Случайная задержка перед запросами
    await sleep(500 + Math.random() * 500);

    let total = 0;

    try {
        if (!isExtensionContextValid()) throw new Error('Extension context lost before first page fetch');

        let responsePage1 = await chrome.runtime.sendMessage({
            action: `fetch${type.charAt(0).toUpperCase() + type.slice(1)}Count`,
            cardId,
            page: 1, 
            csrfToken
        });

        if (!responsePage1 || !responsePage1.success || !responsePage1.text) {
            if (responsePage1?.error?.includes('404')) {
                 log(`Card ${cardId} not found for ${type} (404 on page 1). Count is 0.`);
                 total = 0;
            } else {
                logWarn(`Failed to fetch page 1 for ${type} count, card ${cardId}:`, responsePage1?.error || 'No response or text');
                 if (retries > 0) {
                     logWarn(`Retrying fetch for card ${cardId} (page 1), retries left: ${retries - 1}`);
                     activeRequests--;
                     pendingRequests.delete(cacheKey);
                     return await getUserCount(type, cardId, retries - 1); 
                 }
                 throw new Error(`Failed to fetch page 1 after retries for card ${cardId}`);
            }
        } else {
            const docPage1 = new DOMParser().parseFromString(responsePage1.text, 'text/html');
            const countPerPage = countItemsOnPage(docPage1, type);
            const lastPageNum = getLastPageNumber(docPage1);
            log(`Page 1 fetched: countPerPage=${countPerPage}, lastPageNum=${lastPageNum}`);

            if (lastPageNum <= 1) {
                total = countPerPage;
                log(`Only one page found. Total ${type} count: ${total}`);
            } else {
                if (!isExtensionContextValid()) throw new Error('Extension context lost before last page fetch');

                 log(`Fetching last page (${lastPageNum}) for card ${cardId}`);
                 // Задержка между страницами
                 await sleep(1000);
                 let responseLastPage = await chrome.runtime.sendMessage({
                     action: `fetch${type.charAt(0).toUpperCase() + type.slice(1)}Count`,
                     cardId,
                     page: lastPageNum, 
                     csrfToken
                 });

                 if (!responseLastPage || !responseLastPage.success || !responseLastPage.text) {
                     logWarn(`Failed to fetch last page (${lastPageNum}) for ${type} count, card ${cardId}:`, responseLastPage?.error || 'No response or text');
                      total = 0; 
                      logWarn(`Could not calculate total count accurately due to last page fetch error.`);
                 } else {
                     const docLastPage = new DOMParser().parseFromString(responseLastPage.text, 'text/html');
                     const countOnLastPage = countItemsOnPage(docLastPage, type);
                     log(`Last page (${lastPageNum}) fetched: countOnLastPage=${countOnLastPage}`);

                     total = (countPerPage * (lastPageNum - 1)) + countOnLastPage;
                     log(`Calculated total ${type} count: (${countPerPage} * ${lastPageNum - 1}) + ${countOnLastPage} = ${total}`);
                 }
            }
        }

        const timestamp = Date.now();
        if (isExtensionContextValid() && (total > 0 || (type === 'wishlist' && total === 0))) {
          // Устанавливаем TTL: owners = 30 дней; wishlist = 7 дней, но 1 день если 0 владельцев
          let ttl;
          if (type === 'owners') {
            ttl = 30 * 24 * 60 * 60 * 1000;
          } else if (type === 'wishlist' && total === 0) {
            ttl = 24 * 60 * 60 * 1000; // 1 день
          } else {
            ttl = 7 * 24 * 60 * 60 * 1000; // 7 дней
          }
          try {
            await chrome.storage.local.set({ [cacheKey]: { count: total, timestamp, ttl } });
            log(`Fetched (Optimized) and cached ${type} count for card ${cardId}: ${total} (TTL: ${ttl / (24 * 60 * 60 * 1000)} days)`);
            
            // Проверяем накопленные данные для автоматического PUSH
            try {
              const { checkAndAutoPush } = await import('./sync.js');
              checkAndAutoPush();
            } catch (syncError) {
              // Игнорируем ошибки проверки
            }
          } catch (storageError) {
            logError(`Error setting local storage for cache key ${cacheKey}:`, storageError);
          }
      } else if (total < 0) {
          logWarn(`Fetch resulted in invalid count (${total}) for ${type}, card ${cardId}. Not caching.`);
          total = 0; 
      }
      return { count: total, timestamp, isOld: false }; 

    } catch (error) {
        logError(`Unhandled error during OPTIMIZED ${type} count fetch for card ${cardId}:`, error);
        if (retries > 0 && error.message !== 'Extension context lost before first page fetch' && error.message !== 'Extension context lost before last page fetch') {
            logWarn(`Retrying entire optimized fetch for card ${cardId} due to error: ${error.message}`);
            activeRequests--;
            pendingRequests.delete(cacheKey);
            return await getUserCount(type, cardId, retries - 1); 
        }
        return { count: 0, timestamp: Date.now(), isOld: false }; 
    } finally {
      activeRequests--;
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
};

// Фоновое обновление данных
const backgroundRefresh = async (type, cardId, cacheKey) => {
  if (!isExtensionContextValid()) return;
  
  try {
    log(`Background refresh started for ${cacheKey}`);
    
    // Удаляем из кэша чтобы getUserCount сделал реальный запрос
    const oldData = await chrome.storage.local.get([cacheKey]).then(r => r[cacheKey]);
    await chrome.storage.local.remove([cacheKey]);
    
    // Делаем реальный запрос (данные сохранятся локально, отправятся по расписанию)
    const result = await getUserCount(type, cardId, 0);
    log(`Background refresh completed for ${cacheKey}`);
  } catch (error) {
    logError(`Background refresh failed for ${cacheKey}:`, error);
  }
};

export const getWishlistCount = cardId => getUserCount('wishlist', cardId);
export const getOwnersCount = cardId => getUserCount('owners', cardId);