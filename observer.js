import { isExtensionContextValid, debounce, log, logWarn, cachedElements } from './utils.js';
import { contextsSelectors, getCurrentContext } from './config.js';
import { getSettings } from './settings.js';
import { processCards } from './cardProcessor.js';
import { initUserCards } from './contextHandlers.js';
import { contextState } from './main.js';

export const setupObserver = (context, observerCreatedCallback) => {
  if (!context || !contextsSelectors[context]) {
    logWarn(`Observer: Not set up - invalid context or no selector defined: ${context}`);
    return;
  }

  let targetSelector;
  switch (context) {
      case 'tradeOffer': targetSelector = '.trade__inventory-list'; break;
      case 'pack': return;
      case 'deckView': targetSelector = '.deck__items'; break;
      case 'userCards': targetSelector = '.manga-cards'; break;
      case 'trade': targetSelector = '.trade__main'; break;
      case 'remelt':
      case 'market':
      case 'split':
      case 'deckCreate':
      case 'marketCreate':
      case 'marketRequestCreate':
      case 'auctions': return; // Disable observer for auctions to prevent excessive calls
      default:
          logWarn(`Observer: No target selector defined for context ${context}.`);
          return;
  }

  const targetNode = document.querySelector(targetSelector);
  if (!targetNode) {
      logWarn(`Observer: Target node not found with selector: ${targetSelector} for context ${context}`);
      setTimeout(() => {
          const delayedNode = document.querySelector(targetSelector);
          if (delayedNode) {
              log(`Observer: Target node ${targetSelector} found after delay. Setting up observer.`);
              observeNode(delayedNode, context, observerCreatedCallback);
          } else {
              logWarn(`Observer: Target node ${targetSelector} still not found after delay.`);
          }
      }, 1000);
      return;
  }

  observeNode(targetNode, context, observerCreatedCallback);
};

const observeNode = (targetNode, context, observerCreatedCallback) => {
    const observerCallback = debounce(async (mutations) => {
        if (!isExtensionContextValid()) {
            logWarn('Observer: Extension context lost, skipping mutation processing.');
            return;
        }

        let cardListChanged = false;
        const cardSelector = contextsSelectors[context];

        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                const addedNodesMatch = Array.from(mutation.addedNodes).some(node => node.matches?.(cardSelector));
                const removedNodesMatch = Array.from(mutation.removedNodes).some(node => node.matches?.(cardSelector));

                if (addedNodesMatch || removedNodesMatch) {
                    cardListChanged = true;
                    break;
                }
                if (context === 'userCards' && (mutation.target === targetNode || mutation.target.closest(targetSelector))) {
                     if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                         cardListChanged = true;
                         break;
                     }
                }
                 if (context === 'trade' && mutation.target === targetNode) {
                     if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                         cardListChanged = true;
                         break;
                     }
                 }
            }
        }

        if (cardListChanged) {
            log(`Observer: Detected card list change in context: ${context}. Reprocessing.`);
            const currentSettings = await getSettings();

            if (context === 'userCards') {
                await initUserCards();
            }

            const needsProcessing = (contextState[context]?.wishlist || currentSettings.alwaysShowWishlist)
                                 || (contextState[context]?.owners || currentSettings.alwaysShowOwners);

            if (needsProcessing) {
                log(`Observer: Reprocessing cards for ${context} as labels are active.`);
                cachedElements.delete(contextsSelectors[context]);
                await processCards(context, currentSettings);
            } else {
                log(`Observer: Card list changed, but no labels are active for context ${context}. No reprocessing needed.`);
                const oldLabels = targetNode.querySelectorAll('.wishlist-warning, .owners-count');
                oldLabels.forEach(label => label.remove());
            }
        }
    }, 5000);

    const observer = new MutationObserver(observerCallback);
    observer.observe(targetNode, {
        childList: true,
        subtree: true,
    });

    if (typeof observerCreatedCallback === 'function') {
        observerCreatedCallback(observer);
    }
    log(`Observer: Setup observer for context ${context} on target: ${targetSelector}`);
}