// cardProcessor.js (СЫ v4 - Always Show)
import { isExtensionContextValid, getElements, log, logWarn, logError } from './utils.js';
import { getWishlistCount, getOwnersCount, forceRefreshCard } from './api.js';
import { addTextLabel, addRefreshButton, addCombinedPackLabel } from './domUtils.js';
import { contextsSelectors } from './config.js';
import { contextState } from './main.js';

// бработка карт
export const processCards = async (context, settings) => { 
  if (!isExtensionContextValid()) return;

  const selector = contextsSelectors[context];
  if (!selector) {
      logWarn(`No selector defined for context: ${context}`);
      return;
  }

  const cardItems = getElements(selector);
  if (!cardItems.length) return;

  const BATCH_SIZE = 5;

  // Diagnostics: log batch size and sample IDs
  try {
    const sampleIds = Array.from(cardItems).slice(0, 8).map(item => item.getAttribute('data-card-id') || item.getAttribute('data-id') || item.getAttribute('href')?.match(/\/cards\/(\d+)/)?.[1]).filter(Boolean);
    log(`processCards(${context}): totalItems=${cardItems.length}, sampleIds=${JSON.stringify(sampleIds)}`);
  } catch (e) { /* ignore */ }

  for (let i = 0; i < cardItems.length; i += BATCH_SIZE) {
    let hasRequestsInBatch = false;
    const batch = cardItems.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (item) => {
      let cardId = null;
      try { 
        if (context === 'trade') cardId = item.getAttribute('href')?.match(/\/cards\/(\d+)/)?.[1];
        else if (context === 'tradeOffer') cardId = item.getAttribute('data-card-id');
        else if (context === 'pack') cardId = item.getAttribute('data-id');
        else if (context === 'deckView') cardId = item.getAttribute('data-card-id');
        else cardId = item.getAttribute('data-card-id') || item.getAttribute('data-id');

        if (!cardId) { 
            throw new Error('Card ID not found');
        }
      } catch (idError) {
          logWarn(`Skipping item in ${context} due to ID error:`, idError.message, item.outerHTML);
          return;
      }

      const showWishlist = settings.alwaysShowWishlist || contextState[context]?.wishlist;
      const showOwners = settings.alwaysShowOwners || contextState[context]?.owners;

      // Проверка: если карта уже обработана и метки на месте - пропускаем
      const isProcessed = item.getAttribute('data-mb-processed') === 'true';
      const hasWishlistLabel = item.querySelector('.wishlist-warning') !== null;
      const hasOwnersLabel = item.querySelector('.owners-count') !== null;
      const hasAvailableAnimationLabel = item.querySelector('.available-animation') !== null;
      // Расширенная проверка: ищем признак анимации в ближайшем wrapper, в атрибутах и в классах самой карточки
      const classAttr = (item.getAttribute && item.getAttribute('class')) || '';
      const hasAvailableAnimationMeta = !!(
        item.closest('.manga-cards__item-wrapper--available-animation') ||
        /available-animation/.test(classAttr) ||
        item.getAttribute('data-anim')
      );
      
      if (isProcessed && 
          (!showWishlist || hasWishlistLabel) && 
          (!showOwners || hasOwnersLabel) &&
          (!hasAvailableAnimationMeta || hasAvailableAnimationLabel || !settings.showAvailableAnimation)) {
        return; // Уже обработана, пропускаем
      }

      // Проверить, есть ли кэш (доп. логирование для отладки)
      let needsRequest = false;
      if (showWishlist && !hasWishlistLabel) {
        const cached = await chrome.storage.local.get([`wishlist_${cardId}`]).then(r => r[`wishlist_${cardId}`]);
        if (cached) {
          const ageDays = Math.floor((Date.now() - (cached.timestamp || 0)) / (24 * 60 * 60 * 1000));
          log(`Cache hit for wishlist_${cardId}: count=${cached.count}, age=${ageDays}d, isOld=${!!cached.isOld}`);
        } else {
          log(`Cache check: wishlist_${cardId} NOT FOUND`);
          needsRequest = true;
        }
      }
      if (showOwners && !hasOwnersLabel) {
        const cached = await chrome.storage.local.get([`owners_${cardId}`]).then(r => r[`owners_${cardId}`]);
        if (cached) {
          const ageDays = Math.floor((Date.now() - (cached.timestamp || 0)) / (24 * 60 * 60 * 1000));
          log(`Cache hit for owners_${cardId}: count=${cached.count}, age=${ageDays}d, isOld=${!!cached.isOld}`);
          if (cached.count === 0) logWarn(`Cache check: owners_${cardId} has count=0 (suspicious)`);
        } else {
          log(`Cache check: owners_${cardId} NOT FOUND`);
          needsRequest = true;
        }
      }
      if (needsRequest) hasRequestsInBatch = true;

      if (context === 'deckView' || context === 'userCards') { /* ... */ }

      item.querySelector('.wishlist-warning')?.remove();
      item.querySelector('.owners-count')?.remove();
      item.querySelector('.available-animation')?.remove();
      item.querySelector('.lootbox-level')?.remove();
      item.querySelector('.lootbox-mine')?.remove();
      item.querySelector('.pack-combined-label')?.remove();

      // Добавляем кнопку обновления
      addRefreshButton(item, cardId, async (id) => {
        // Удаляем старые метки
        item.querySelector('.wishlist-warning')?.remove();
        item.querySelector('.owners-count')?.remove();
        
        // Принудительно обновляем данные
        const result = await forceRefreshCard(id);
        
        if (result) {
          // Показываем свежие данные
          if (showWishlist) {
            const displayText = `${result.wishlist}`;
            const tooltipText = `Хотят: ${result.wishlist} (только что обновлено)`;
            const position = (showOwners && context !== 'userCards') ? 'top' : 'top';
            addTextLabel(item, 'wishlist-warning', displayText, tooltipText, position, 'wishlist', {
              color: result.wishlist >= settings.wishlistWarning ? '#FFA500' : '#00FF00',
              opacity: 1
            }, context);
          }
          
          if (showOwners) {
            const displayText = `${result.owners}`;
            const tooltipText = `Владеют: ${result.owners} (только что обновлено)`;
            const position = showWishlist ? 'middle' : 'top';
            addTextLabel(item, 'owners-count', displayText, tooltipText, position, 'owners', {
              opacity: 1
            }, context);
          }

          // Показываем метку A+ при ручном обновлении, если включено в настройках
          if (settings.showAvailableAnimation) {
            const hasAvailableAnimationMetaRefresh = !!(item.closest('.manga-cards__item-wrapper--available-animation') || item.getAttribute('data-anim'));
            if (hasAvailableAnimationMetaRefresh) {
              const animPosition = (showWishlist && showOwners) ? 'bottom' : (showWishlist ? 'middle' : 'top');
              addTextLabel(item, 'available-animation', 'A+', 'Доступна анимация', animPosition, 'anim', { opacity: 1 }, context);
            }
          }
        }
      });

      // Для pack-контекста используем комбинированную горизонтальную метку
      if (context === 'pack') {
          const packData = {};
          const tasks = [];

          // Собираем wishlist
          if (showWishlist) {
              tasks.push(
                  getWishlistCount(cardId).then(data => {
                      if (!item.isConnected) return;
                      packData.wishlist = data?.count ?? 0;
                      packData.wishlistOld = data?.isOld ?? false;
                      packData.wishlistWarning = settings.wishlistWarning;
                  }).catch(error => logError(`Error getting wishlist count for card ${cardId}:`, error))
              );
          }

          // Собираем owners
          if (showOwners) {
              tasks.push(
                  getOwnersCount(cardId).then(data => {
                      if (!item.isConnected) return;
                      packData.owners = data?.count ?? 0;
                      packData.ownersOld = data?.isOld ?? false;
                  }).catch(error => logError(`Error getting owners count for card ${cardId}:`, error))
              );
          }

          await Promise.all(tasks);

          // Извлекаем level и mine из .lootbox__card-pill
          try {
              const pill = item.querySelector('.lootbox__card-pill');
              if (pill) {
                  const levelEl = pill.querySelector('[data-type="level"]');
                  const mineEl = pill.querySelector('[data-type="mine"]');

                  if (levelEl) {
                      packData.level = levelEl.textContent.trim();
                  }

                  if (mineEl) {
                      const mineText = mineEl.textContent.replace(/[^0-9+]/g, '').trim();
                      if (mineText) {
                          packData.mine = mineText;
                      }
                  }
              }
          } catch (e) { /* ignore */ }

          // Добавляем A+ если есть анимация
          if (hasAvailableAnimationMeta && settings.showAvailableAnimation) {
              packData.anim = true;
          }

          // Добавляем комбинированную метку
          addCombinedPackLabel(item, packData, context);

      } else {
          // Для остальных контекстов - отдельные метки
          const tasks = [];

          if (showWishlist) {
              tasks.push(
                  getWishlistCount(cardId).then(data => {
                      if (!item.isConnected) return;
                      const count = data?.count ?? 0;
                      const isOld = data?.isOld ?? false;
                      const position = (showOwners && context !== 'userCards') ? 'top' : 'top';
                      
                      const displayText = isOld ? `${count} ⏱️` : `${count}`;
                      const age = isOld ? Math.floor((Date.now() - data.timestamp) / (24 * 60 * 60 * 1000)) : 0;
                      const tooltipText = isOld ? `Хотят: ${count} (данные ${age} дн. назад)` : `Хотят: ${count}`;
                      
                      addTextLabel(item, 'wishlist-warning', displayText, tooltipText, position, 'wishlist', {
                          color: count >= settings.wishlistWarning ? '#FFA500' : '#00FF00',
                          opacity: isOld ? 0.8 : 1
                      }, context);
                  }).catch(error => logError(`Error getting wishlist count for card ${cardId} in ${context}:`, error))
              );
          }

          if (showOwners) {
              tasks.push(
                  getOwnersCount(cardId).then(data => {
                      if (!item.isConnected) return;
                      const count = data?.count ?? 0;
                      const isOld = data?.isOld ?? false;
                      const position = showWishlist ? 'middle' : 'top';
                      
                      const displayText = isOld ? `${count} ⏱️` : `${count}`;
                      const age = isOld ? Math.floor((Date.now() - data.timestamp) / (24 * 60 * 60 * 1000)) : 0;
                      const tooltipText = isOld ? `Владеют: ${count} (данные ${age} дн. назад)` : `Владеют: ${count}`;
                      
                      addTextLabel(item, 'owners-count', displayText, tooltipText, position, 'owners', {
                          opacity: isOld ? 0.8 : 1
                      }, context);
                  }).catch(error => logError(`Error getting owners count for card ${cardId} in ${context}:`, error))
              );
          }

          await Promise.all(tasks);

          // Добавляем метку A+ из метаданных
          if (hasAvailableAnimationMeta && settings.showAvailableAnimation) {
              const animPosition = (showWishlist && showOwners) ? 'bottom' : (showWishlist ? 'middle' : 'top');
              addTextLabel(item, 'available-animation', 'A+', 'Доступна анимация', animPosition, 'anim', { opacity: 1 }, context);
          }
      }
      
      // Отмечаем карту как обработанную
      item.setAttribute('data-mb-processed', 'true');
    }); 

    await Promise.all(promises);
    
    // Задержка между батчами только если были реальные запросы к API (не из кэша)
    if (hasRequestsInBatch && cardItems.length > BATCH_SIZE && i + BATCH_SIZE < cardItems.length) {
        log(`CardProcessor: Cooldown 25s after batch ${Math.floor(i/BATCH_SIZE) + 1} in ${context} (had API requests)`);
        await new Promise(r => setTimeout(r, 25000));
    }
  } 
};
