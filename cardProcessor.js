// cardProcessor.js (СЫ v4 - Always Show)
import { isExtensionContextValid, getElements, log, logWarn, logError } from './utils.js';
import { getWishlistCount, getOwnersCount } from './api.js';
import { addTextLabel } from './domUtils.js';
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

      // Проверить, есть ли кэш
      let needsRequest = false;
      if (showWishlist) {
        const cached = await chrome.storage.local.get([`wishlist_${cardId}`]).then(r => r[`wishlist_${cardId}`]);
        if (!cached) needsRequest = true;
      }
      if (showOwners) {
        const cached = await chrome.storage.local.get([`owners_${cardId}`]).then(r => r[`owners_${cardId}`]);
        if (!cached) needsRequest = true;
      }
      if (needsRequest) hasRequestsInBatch = true;

      if (context === 'deckView' || context === 'userCards') { /* ... */ }

      item.querySelector('.wishlist-warning')?.remove();
      item.querySelector('.owners-count')?.remove();

      const tasks = [];

      if (showWishlist) {
          tasks.push(
              getWishlistCount(cardId).then(count => {
                  if (!item.isConnected) return;
                  const position = (showOwners && context !== 'userCards') ? 'top' : 'top';
                  addTextLabel(item, 'wishlist-warning', `${count}`, `Хотят: ${count}`, position, 'wishlist', {
                      color: count >= settings.wishlistWarning ? '#FFA500' : '#00FF00'
                  }, context);
              }).catch(error => logError(`Error getting wishlist count for card ${cardId} in ${context}:`, error))
          );
      }

      if (showOwners) {
          tasks.push(
              getOwnersCount(cardId).then(count => {
                  if (!item.isConnected) return;
                  const position = showWishlist ? 'middle' : 'top';
                  addTextLabel(item, 'owners-count', `${count}`, `ладеют: ${count}`, position, 'owners', {}, context);
              }).catch(error => logError(`Error getting owners count for card ${cardId} in ${context}:`, error))
          );
      }

      await Promise.all(tasks);
    }); 

    await Promise.all(promises);
    if (hasRequestsInBatch && cardItems.length > BATCH_SIZE && i + BATCH_SIZE < cardItems.length) {
        await new Promise(r => setTimeout(r, 25000));
    }
  } 
};
