import { LOG_PREFIX, initialContextState, contextsSelectors, getCurrentContext } from './config.js';
import { isExtensionContextValid, log, logWarn, logError, cachedElements, debounce, waitForElements } from './utils.js';
import { setCsrfToken, csrfToken, pendingRequests } from './api.js';
import { getSettings } from './settings.js';
import { addExtensionSettingsButton } from './domUtils.js';
import { processCards } from './cardProcessor.js';
import { initUserCards, handleMarketCreatePage, initStatsButtons, initPackPage } from './contextHandlers.js';
import { setupObserver } from './observer.js';

export let contextState = {};
let currentObserver = null;

const cleanupExtensionFeatures = () => {
    log('Cleaning up extension features...');

    if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
        log('Observer disconnected.');
    }

    document.querySelector('.wishlist-toggle-btn')?.remove();
    const statButtonSelectors = [
        '.tradeOffer-wishlist-btn', '.tradeOffer-owners-btn',
        '.remelt-wishlist-btn', '.remelt-owners-btn',
        '.market-wishlist-btn', '.market-owners-btn',
        '.split-wishlist-btn', '.split-owners-btn',
        '.deckCreate-wishlist-btn', '.deckCreate-owners-btn',
        '.marketCreate-wishlist-btn', '.marketCreate-owners-btn',
        '.marketRequestCreate-wishlist-btn', '.marketRequestCreate-owners-btn',
        '.auctions-wishlist-btn', '.auctions-owners-btn',
    ];
    statButtonSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(btn => btn.remove());
    });
    log('Removed dynamic buttons.');

    const oldLabels = document.querySelectorAll('.wishlist-warning, .owners-count');
    oldLabels.forEach(label => label.remove());
    log(`Removed ${oldLabels.length} labels.`);

    cachedElements.clear();
    log('Cleared cached elements.');

};

const initializeObserver = (context) => {
     if (context !== 'pack' && context !== 'marketRequestView') {
         setupObserver(context, obs => { currentObserver = obs; });
     }
}


const initPage = async () => {
    if (!isExtensionContextValid()) {
        logWarn('Extension context is not valid. Aborting initialization.');
        return;
    }
    log('Starting page initialization...');

    addExtensionSettingsButton();

    const settings = await getSettings();
    log('Settings loaded in initPage:', settings);

    if (!settings.extensionEnabled) {
        log('Extension is globally disabled via settings. Initialization stopped.');
        cleanupExtensionFeatures();
        return;
    }

    log('Extension is enabled, proceeding with initialization.');
    
    // Триггер фоновой синхронизации при первой загрузке страницы
    try {
        chrome.runtime.sendMessage({ action: 'triggerSync' }, response => {
            if (chrome.runtime.lastError) {
                logWarn('Failed to trigger background sync:', chrome.runtime.lastError);
            } else {
                log('Background sync triggered successfully');
            }
        });
    } catch (error) {
        logWarn('Could not trigger sync on page load:', error);
    }
    
    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    if (token) {
        setCsrfToken(token);
    } else {
        logWarn('CSRF token meta tag not found!');
    }

    const context = getCurrentContext();
    log('Current context detected:', context);


    if (!context) {
        log('No specific context detected. Initialization finished.');
        return;
    }

    log(`Initializing context: ${context}`);
    let effectiveInitialContextState = {};
        try {
            const { userContextStates } = await chrome.storage.sync.get(['userContextStates']);
            const savedStates = userContextStates || {};
            effectiveInitialContextState = {
                ...(initialContextState[context] || {}),
                ...(savedStates[context] || {})
            };
            contextState = { ...contextState, [context]: { ...effectiveInitialContextState } };
            log(`Current global contextState after init:`, contextState);

            try {
                 switch (context) {
                      case 'userCards': await initUserCards(); break;
                      case 'marketCreate':
                          await initStatsButtons(context, '.card-filter-form__lock-status', 'card-filter-form__lock');
                          await handleMarketCreatePage();
                          break;
                      case 'trade':
                          if (settings.alwaysShowWishlist || contextState[context]?.wishlist || settings.alwaysShowOwners || contextState[context]?.owners) {
                              cachedElements.delete(contextsSelectors.trade);
                              await processCards('trade', settings);
                          }
                          break;
                      case 'pack': await initPackPage(); break;
                      case 'deckView':
                         if (settings.alwaysShowWishlist || contextState[context]?.wishlist || settings.alwaysShowOwners || contextState[context]?.owners) {
                            cachedElements.delete(contextsSelectors.deckView);
                            await processCards('deckView', settings);
                         }
                         break;
                      case 'tradeOffer': await initStatsButtons(context, '.trade__rank-wrapper .trade__rank', 'trade__type-card-button'); break;
                      case 'remelt':
                      case 'market':
                      case 'split':
                      case 'deckCreate':
                      case 'marketRequestCreate':
                          if (settings.alwaysShowWishlist || contextState[context]?.wishlist || settings.alwaysShowOwners || contextState[context]?.owners) {
                              cachedElements.delete(contextsSelectors[context]);
                              await processCards(context, settings);
                          }
                          await initStatsButtons(context, '.card-filter-form__lock-status', 'card-filter-form__lock');
                          break;
                      case 'auctions':
                          if (settings.alwaysShowWishlist || contextState[context]?.wishlist || settings.alwaysShowOwners || contextState[context]?.owners) {
                              cachedElements.delete(contextsSelectors[context]);
                              await processCards(context, settings);
                          }
                          await initStatsButtons(context, '.card-filter-form__lock-status', 'card-filter-form__lock');
                          break;
                      case 'marketRequestView':
                         if (settings.alwaysShowWishlist || contextState[context]?.wishlist || settings.alwaysShowOwners || contextState[context]?.owners) {
                             log(`Processing cards for ${context}`);
                             cachedElements.delete(contextsSelectors[context]);
                             await processCards(context, settings);
                         }
                         break;
                      default: logWarn(`No specific initialization logic for context: ${context}`);
                 }
            } catch (error) { logError(`Error during context initialization for ${context}:`, error); }

            initializeObserver(context);

            log('Page initialization finished for context:', context);
        } catch (storageError) {
             logError('Failed to load settings or userContextStates during initPage:', storageError);
             contextState = { ...contextState, [context]: { ...(initialContextState[context] || {}) } };
             logWarn(`Initialized ${context} with default state due to storage error.`);
             log(`Current global contextState after storage error:`, contextState);
        }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
} else {
    initPage();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionContextValid()) { logWarn('Received message, but extension context is invalid.'); return false; }
    log(`Received message: ${message.action}`, message);

    if (message.action === 'clearWishlistCache') {
        log('Processing clearWishlistCache message...');
        cachedElements.clear();
        pendingRequests.clear();
        getSettings().then(settings => {
            if (settings.extensionEnabled) {
                const context = getCurrentContext();
                if (context && contextsSelectors[context]) {
                   const oldLabels = document.querySelectorAll('.wishlist-warning, .owners-count');
                   oldLabels.forEach(label => label.remove());
                   log(`Removed ${oldLabels.length} old labels.`);
                   log('Reprocessing context after cache clear...');
                   const currentState = contextState[context] || {};
                   const effectiveState = { ...(initialContextState[context] || {}), ...currentState };
                   contextState = { ...contextState, [context]: effectiveState };
                   if (context === 'userCards') { initUserCards(); }
                   else if (['tradeOffer', 'remelt', 'market', 'split', 'deckCreate', 'marketCreate', 'marketRequestCreate'].includes(context)) {
                      const buttonConfigMap = {
                         'tradeOffer': { selector: '.trade__rank-wrapper .trade__rank', class: 'trade__type-card-button' },
                         'remelt': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                         'market': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                         'split': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                         'deckCreate': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                         'marketCreate': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                         'marketRequestCreate': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                         'auctions': { selector: '.card-filter-form__lock-status', class: 'card-filter-form__lock' },
                      };
                      const buttonConfig = buttonConfigMap[context];
                      if (buttonConfig) { initStatsButtons(context, buttonConfig.selector, buttonConfig.class); }
                      else { logWarn(`Button config not found for ${context}...`); processCards(context, settings); }
                   } else if (context === 'pack') { initPackPage(); }
                   else if (context === 'trade' || context === 'deckView' || context === 'marketRequestView') {
                        cachedElements.delete(contextsSelectors[context]);
                        processCards(context, settings);
                   }
                   else { logWarn(`Unhandled context ${context} in clear cache reprocessing.`); }
                } else {
                    log(`No active context requiring card reprocessing after cache clear. Current context: ${context}`);
                }
            } else {
                 log('Cache cleared, but extension is globally disabled. No reprocessing needed.');
                 const oldLabels = document.querySelectorAll('.wishlist-warning, .owners-count');
                 oldLabels.forEach(label => label.remove());
            }
        }).catch(error => logError('Error getting settings during cache clear:', error));
        sendResponse({ status: 'cache_cleared_on_page' });
        return true;
    } else {
          sendResponse({ status: 'unknown_action_on_page', received: message.action });
    }
    return true;
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'sync') {
        log('Detected change in sync settings:', changes);
        if (!isExtensionContextValid()) { logWarn('Settings changed, but context invalid...'); return; }

        if (changes.extensionEnabled) {
            const newValue = changes.extensionEnabled.newValue;
            log(`Global enable switch changed to: ${newValue}`);
            if (newValue) {
                await initPage();
            } else {
                cleanupExtensionFeatures();
            }
        } else {
            const changedKeys = Object.keys(changes);
            const relevantKeys = ['wishlistStyle', 'wishlistWarning', 'alwaysShowWishlist', 'alwaysShowOwners', 'userContextStates'];
            const otherSettingsChanged = changedKeys.some(key => relevantKeys.includes(key));

            if (otherSettingsChanged) {
                 log('Detected change in other relevant sync settings.');
                 const settings = await getSettings();
                 if (settings.extensionEnabled) {
                     log('Extension is enabled, re-initializing due to setting change.');
                     await initPage();
                 } else {
                      log('Other settings changed, but extension is disabled. No action needed.');
                 }
            }
        }
    }
});
