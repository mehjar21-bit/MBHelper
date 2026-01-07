import { syncCacheToServer, syncCacheFromServer, initPeriodicSync, handleSyncAlarm } from './sync.js';

const BASE_URL = 'https://mangabuff.ru';
const log = (message, ...args) => console.log(`[Background] ${message}`, ...args);
const logError = (message, ...args) => console.error(`[Background] ${message}`, ...args);
const logWarn = (message, ...args) => console.warn(`[Background] ${message}`, ...args);

const fetchWithTimeout = async (url, options, timeout = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    log(`Выполняем запрос: ${url}`, options);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
        logError(`Таймаут запроса ${url} (${timeout}ms)`);
    } else {
        logError(`Ошибка при выполнении запроса ${url}:`, error);
    }
    clearTimeout(id);
    throw error;
  }
};


const fetchPage = async (url, page, csrfToken) => {
    const fullUrl = `${BASE_URL}/cards/${url}${page > 1 ? `?page=${page}` : ''}`;
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount <= maxRetries) {
      try {
        const response = await fetchWithTimeout(fullUrl, {
          method: 'GET',
          headers: { 'X-CSRF-Token': csrfToken }
        });
        if (!response.ok) {
          if (response.status === 429 && retryCount < maxRetries) {
            const backoffMs = 1000 * Math.pow(2, retryCount);
            logWarn(`429 Too Many Requests for ${fullUrl}, retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, backoffMs));
            retryCount++;
            continue;
          }
          if (response.status === 404) {
            log(`Страница ${fullUrl} не найдена (404), считаем, что данных нет`);
            return "";
          }
          let errorText = `HTTP error! status: ${response.status}`;
          try { const errorData = await response.text(); errorText += `, details: ${errorData}`; } catch (e) { /* ignore */ }
          throw new Error(errorText);
        }
        return await response.text();
      } catch (error) {
        if (retryCount < maxRetries) {
          const backoffMs = 1000 * Math.pow(2, retryCount);
          logWarn(`Error fetching ${fullUrl}, retrying in ${backoffMs}ms (attempt ${retryCount + 1}/${maxRetries}):`, error);
          await new Promise(r => setTimeout(r, backoffMs));
          retryCount++;
          continue;
        }
        logError(`Ошибка при запросе ${fullUrl} после ${maxRetries} попыток:`, error);
        return "";
      }
    }
  };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('Получено сообщение:', message, 'от:', sender);

    if (message.action === 'fetchWishlistCount') {
        log(`Запрашиваем список желающих для карты ${message.cardId}, страница ${message.page}`);
        fetchPage(`${message.cardId}/offers/want`, message.page, message.csrfToken).then(text => {
          sendResponse({ success: true, text });
        }).catch(error => {
          logError(`Критическая ошибка при fetchWishlistCount для ${message.cardId}:`, error);
          sendResponse({ success: false, error: error.message, text: "" });
        });
        return true;
      }

      if (message.action === 'fetchOwnersCount') {
        log(`Запрашиваем список владельцев для карты ${message.cardId}, страница ${message.page}`);
        fetchPage(`${message.cardId}/users`, message.page, message.csrfToken).then(text => {
          sendResponse({ success: true, text });
        }).catch(error => {
          logError(`Критическая ошибка при fetchOwnersCount для ${message.cardId}:`, error);
          sendResponse({ success: false, error: error.message, text: "" });
        });
        return true;
      }

      if (message.action === 'clearWishlistCache') {
        log('Обрабатываем clearWishlistCache');
        chrome.storage.local.clear(() => {
          if (chrome.runtime.lastError) {
            logError('Ошибка при очистке кэша:', chrome.runtime.lastError);
            sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
          } else {
            log('Кэш успешно очищен');
            chrome.tabs.query({ url: 'https://mangabuff.ru/*' }, tabs => {
              if (chrome.runtime.lastError) {
                   logError('Ошибка при запросе вкладок:', chrome.runtime.lastError);
                   sendResponse({ status: 'success', warning: 'Cache cleared, but failed to query tabs.' });
                   return;
              }
              if (tabs.length === 0) {
                log('Вкладки mangabuff.ru не найдены');
                sendResponse({ status: 'success' });
                return;
              }
              let responsesPending = tabs.length;
              const tabsLength = tabs.length;
              tabs.forEach(tab => {
                log(`Отправляем clearWishlistCache на вкладку ${tab.id}`);
                try {
                    chrome.tabs.sendMessage(tab.id, { action: 'clearWishlistCache' }, response => {
                        responsesPending--;
                        if (chrome.runtime.lastError) {
                             logWarn(`Ошибка при отправке/получении ответа от вкладки ${tab.id}:`, chrome.runtime.lastError.message || 'No response');
                        } else {
                             log(`Ответ от вкладки ${tab.id}:`, response);
                        }
                        if (responsesPending === 0) {
                             log('Завершены все ответы от вкладок по clearWishlistCache');
                        }
                    });
                } catch (error) {
                     logError(`Не удалось отправить сообщение на вкладку ${tab.id}:`, error);
                     responsesPending--;
                     if (responsesPending === 0) {
                         log('Завершены все ответы от вкладок по clearWishlistCache (с ошибками отправки)');
                     }
                }
              });
              sendResponse({ status: 'success', info: `Sent clear request to ${tabsLength} tabs.` });
            });
          }
        });
        return true;
      }

    if (message.action === 'triggerSync') {
        log('Manual sync triggered from interface');
        
        (async () => {
          try {
            // PUSH локальных изменений
            await syncCacheToServer();
            
            // Получаем все card IDs из локального хранилища для точечного PULL
            const allData = await chrome.storage.local.get(null);
            const cardIds = Object.keys(allData)
              .filter(key => key.startsWith('owners_') || key.startsWith('wishlist_'))
              .map(key => {
                const match = key.match(/^(?:owners|wishlist)_(\d+)$/);
                return match ? parseInt(match[1], 10) : null;
              })
              .filter(id => id !== null);

            const uniqueCardIds = [...new Set(cardIds)];

            if (uniqueCardIds.length > 0) {
              log(`Syncing ${uniqueCardIds.length} card IDs from interface`);
              await syncCacheFromServer(uniqueCardIds);
            } else {
              // Если локального кэша нет — делаем полный PULL
              log('No local card IDs found, performing full pull');
              await syncCacheFromServer([]);
            }
            
            log('Manual sync completed');
            sendResponse({ success: true, message: 'Sync completed' });
          } catch (error) {
            logError('Manual sync error:', error);
            sendResponse({ success: false, error: error.message });
          }
        })();
        
        return true; // Указываем что ответ будет асинхронным
    }

    logWarn(`Неизвестное действие получено: ${message.action}`);
    sendResponse({ status: 'unknown_action', received: message });
    return false;
});

// Инициализация периодической синхронизации при загрузке расширения
chrome.runtime.onInstalled.addListener(() => {
    log('Extension installed, initializing periodic sync...');
    initPeriodicSync();
});

// Инициализация при запуске service worker (каждый раз при загрузке Chrome)
chrome.runtime.onStartup.addListener(() => {
    log('Browser startup, initializing periodic sync...');
    initPeriodicSync();
});

// Обработчик alarm для периодической синхронизации
chrome.alarms.onAlarm.addListener((alarm) => {
    log('Alarm triggered:', alarm.name);
    handleSyncAlarm(alarm);
});