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

// Сохраняет ограниченный дамп HTML для последующего анализа (макс 5 записей на карту)
async function saveDebugPage(cardId, type, page, text, reason = '') {
  try {
    const key = `debug_${type}_${cardId}`;
    const snippet = (text || '').slice(0, 5000); // храним первые 5KB
    const entry = { page, ts: Date.now(), len: (text || '').length, reason, snippet };
    const existing = await chrome.storage.local.get([key]).then(r => r[key]) || [];
    existing.push(entry);
    while (existing.length > 5) existing.shift();
    await chrome.storage.local.set({ [key]: existing });
    log(`Saved debug dump for ${key} (page ${page}, len ${entry.len}, reason: ${reason})`);
  } catch (e) {
    logError('Failed to save debug dump:', e);
  }
}

const getUserCount = async (type, cardId, retries = 2, forceNetwork = false) => {
  if (!isExtensionContextValid()) return 0;

  const cacheKey = `${type}_${cardId}`;
  if (!csrfToken) {
      csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  if (!forceNetwork) {
    try {
      const cached = await chrome.storage.local.get([cacheKey]).then(r => r[cacheKey]);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        const isOld = age > 30 * 24 * 60 * 60 * 1000; // Старше 30 дней
        
        // Если данные старые - запускаем фоновое обновление (force, без удаления кеша)
        if (isOld) {
          log(`Cache is old (${Math.floor(age / (24 * 60 * 60 * 1000))} days) for ${cacheKey}, scheduling background refresh`);
          // Фоновое обновление без ожидания и без удаления текущего кэша
          setTimeout(() => backgroundRefresh(type, cardId, cacheKey), 1000);
        }
        
        // Логируем хит кэша и возвращаем кэшированные данные с метаданными
        log(`Cache hit for ${cacheKey}: count=${cached.count}, age=${Math.floor(age / (24 * 60 * 60 * 1000))}d, isOld=${isOld}`);
        return { count: cached.count, timestamp: cached.timestamp, isOld };
      }
    } catch (error) {
        logError(`Error accessing local storage for cache key ${cacheKey}:`, error);
    }
  } else if (forceNetwork) {
    log(`Force network fetch for ${cacheKey}`);
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
            // Сохраняем дамп для анализа (если был какой-то ответ)
            try {
              if (responsePage1 && responsePage1.text) {
                saveDebugPage(cardId, type, 1, responsePage1.text, 'no_or_empty_response_page1').catch(e => logError('saveDebugPage failed:', e));
              } else {
                saveDebugPage(cardId, type, 1, '', 'no_response_page1').catch(e => logError('saveDebugPage failed:', e));
              }
            } catch (e) { /* ignore */ }

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
            log(`Page 1 response length: ${responsePage1.text.length}`);
            if ((responsePage1.text || '').length < 500) {
              saveDebugPage(cardId, type, 1, responsePage1.text, 'short_response_page1').catch(e => logError('saveDebugPage failed:', e));
            }

            const docPage1 = new DOMParser().parseFromString(responsePage1.text, 'text/html');
            const countPerPage = countItemsOnPage(docPage1, type);
            const lastPageNum = getLastPageNumber(docPage1);
            log(`Page 1 fetched: countPerPage=${countPerPage}, lastPageNum=${lastPageNum}`);

            // Подозрительная ситуация: owners page1 содержит 0 — сохраним дамп для анализа
            if (type === 'owners' && countPerPage === 0) {
              saveDebugPage(cardId, type, 1, responsePage1.text, 'owners_zero_page1').catch(e => logError('saveDebugPage failed:', e));
            }

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
                     log(`Last page (${lastPageNum}) response length: ${responseLastPage.text.length}`);
                     if ((responseLastPage.text || '').length < 500) {
                       saveDebugPage(cardId, type, lastPageNum, responseLastPage.text, 'short_response_last_page').catch(e => logError('saveDebugPage failed:', e));
                     }
                     const docLastPage = new DOMParser().parseFromString(responseLastPage.text, 'text/html');
                     const countOnLastPage = countItemsOnPage(docLastPage, type);
                     log(`Last page (${lastPageNum}) fetched: countOnLastPage=${countOnLastPage}`);

                     total = (countPerPage * (lastPageNum - 1)) + countOnLastPage;
                     log(`Calculated total ${type} count: (${countPerPage} * ${lastPageNum - 1}) + ${countOnLastPage} = ${total}`);
                 }
            }
        }

      const timestamp = Date.now();
      if (isExtensionContextValid()) {
          // Специальное правило: owners === 0 считается некорректным (на нашем домене такого быть не может).
          // В этом случае НЕ перезаписываем существующий кэш, увеличиваем счётчик неудач и планируем ретрай с экспоненциальной задержкой.
          if (type === 'owners' && total === 0) {
            try {
              const existing = await chrome.storage.local.get([cacheKey]).then(r => r[cacheKey]);
              logWarn(`Owners fetch returned 0 for ${cacheKey}. Treating as transient error; will not overwrite existing cache.`);

              // Сохраняем дампы page1/lastPage для последующей диагностики
              try {
                if (responsePage1 && responsePage1.text) saveDebugPage(cardId, type, 1, responsePage1.text, 'owners_zero_detected').catch(e => logError('saveDebugPage failed:', e));
                if (typeof responseLastPage !== 'undefined' && responseLastPage && responseLastPage.text) saveDebugPage(cardId, type, responseLastPage.page || 'last', responseLastPage.text, 'owners_zero_lastpage').catch(e => logError('saveDebugPage failed:', e));
              } catch (e) { /* ignore */ }

              const failKey = `fail_${cacheKey}`;
              const prevFails = (await chrome.storage.local.get([failKey]).then(r => r[failKey])) || 0;
              const newFails = prevFails + 1;
              await chrome.storage.local.set({ [failKey]: newFails });

              if (newFails <= 5) {
                // Exponential backoff, cap at 5 minutes
                const delay = Math.min(5 * 60 * 1000, 5000 * Math.pow(2, newFails - 1));
                log(`Scheduling retry #${newFails} for ${cacheKey} in ${Math.round(delay/1000)}s`);
                setTimeout(() => backgroundRefresh(type, cardId, cacheKey), delay);
              } else {
                logWarn(`Owners fetch failed ${newFails} times for ${cacheKey}; pausing retries until manual refresh.`);
              }

              if (existing) {
                // Вернём существующие корректные данные, не перезаписывая их
                return { count: existing.count, timestamp: existing.timestamp, isOld: false };
              } else {
                // Нет существующих данных — вернём 0, но не будем кэшировать его как корректное значение
                return { count: 0, timestamp, isOld: false };
              }
            } catch (e) {
              logError(`Error handling owners=0 for ${cacheKey}:`, e);
            }
          }

          // Обычный путь: сохраняем значение (включая wishlist=0), сбрасываем счётчик ошибок при успехе
          let ttl = (total === 0) ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
          try {
            await chrome.storage.local.set({ [cacheKey]: { count: total, timestamp, ttl } });
            // Сбрасываем счётчик неудач
            const failKey = `fail_${cacheKey}`;
            await chrome.storage.local.set({ [failKey]: 0 });

            log(`Fetched (Optimized) and cached ${type} count for card ${cardId}: ${total} (TTL: ${ttl / (24 * 60 * 60 * 1000)} days)`);

            // Автоматический push не выполняется (push disabled on server) — пропускаем
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
    
    // Делаем реальный запрос, не удаляя текущий кэш (forceNetwork=true)
    const result = await getUserCount(type, cardId, 0, true);
    log(`Background refresh completed for ${cacheKey}`);
  } catch (error) {
    logError(`Background refresh failed for ${cacheKey}:`, error);
  }
};

export const getWishlistCount = cardId => getUserCount('wishlist', cardId);
export const getOwnersCount = cardId => getUserCount('owners', cardId);