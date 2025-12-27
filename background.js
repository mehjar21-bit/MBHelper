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

      
    if (message.action === 'mineHit') {
        if (!message.csrfToken) {
            logError('CSRF token is missing for mineHit');
            sendResponse({ success: false, error: 'CSRF token is missing' });
            return false;
        }
        if (!message.url) {
             logError('URL is missing for mineHit');
             sendResponse({ success: false, error: 'URL is missing' });
             return false;
        }

        fetchWithTimeout(message.url, {
            method: 'POST',
            headers: {
                'X-CSRF-Token': message.csrfToken,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/plain, */*'
            },
            body: null
        })
        .then(async response => {
            let responseData = null;
            try {
                responseData = await response.json();
            } catch (e) {
                 if (!response.ok) {
                     try {
                          const textError = await response.text();
                           sendResponse({ success: false, error: textError || `HTTP error! status: ${response.status}`, status: response.status });
                     } catch (readError) {
                          sendResponse({ success: false, error: `HTTP error! status: ${response.status}`, status: response.status });
                     }
                     return;
                 } else {
                      log(`Mine hit successful (${response.status}), but no JSON data received.`);
                      responseData = { message: 'Success (No JSON Data)'};
                 }
            }

            if (!response.ok) {
                logWarn(`Mine hit failed (${response.status}) with JSON response:`, responseData);
                const errorMsg = responseData?.error || responseData?.message || `HTTP error! status: ${response.status}`;
                sendResponse({ success: false, error: errorMsg, status: response.status, data: responseData });
            } else {
                 log(`Mine hit successful (${response.status}). Data:`, responseData);
                 sendResponse({ success: true, data: responseData });
            }
        })
        .catch(error => {
            logError(`Critical error during mineHit fetch to ${message.url}:`, error);
            sendResponse({ success: false, error: error.message || 'Network or timeout error during mine hit' });
        });

        return true;
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

// Обработчик alarm для периодической синхронизации
chrome.alarms.onAlarm.addListener((alarm) => {
    log('Alarm triggered:', alarm.name);
    handleSyncAlarm(alarm);
});