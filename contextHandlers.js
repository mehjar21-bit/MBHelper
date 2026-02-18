import { getSettings } from './settings.js';
import { processCards } from './cardProcessor.js';
import { getElements, waitForElements, log, logWarn, logError, debounce, cachedElements, isExtensionContextValid } from './utils.js';
import { contextsSelectors, BASE_URL, initialContextState } from './config.js';
import { contextState } from './main.js';
import { addTextLabel, addCombinedPackLabel } from './domUtils.js';
import { forceRefreshCard } from './api.js';

// State for owner-direct-trade feature
let ownerLinksObserver = null;
let ownerListenersAttached = false;
let ownerStorageListenerAdded = false;

export const initUserCards = async () => {
  const controlsContainer = document.querySelector('.card-controls.scroll-hidden');
  if (!controlsContainer) {
      logWarn('initUserCards: Controls container not found.');
      return;
  }
  controlsContainer.querySelector('.wishlist-toggle-btn')?.remove();

  const settings = await getSettings();
  const toggleBtn = document.createElement('button');
  toggleBtn.classList.add('button', 'wishlist-toggle-btn');
  toggleBtn.style.marginLeft = '10px';
  controlsContainer.appendChild(toggleBtn);

  const updateUserCardButtonState = () => {
      getSettings().then(currentSettings => {
          const currentContextState = contextState['userCards'] || initialContextState['userCards']; 
          if (currentSettings.alwaysShowWishlist) {
              toggleBtn.textContent = 'Желающие (всегда)';
              toggleBtn.disabled = true;
              toggleBtn.style.opacity = '0.7';
              if (contextState.userCards) contextState.userCards.wishlist = true;
          } else {
              const isActive = currentContextState.wishlist;
              toggleBtn.textContent = isActive ? 'Скрыть желающих' : 'Показать желающих';
              toggleBtn.disabled = false;
              toggleBtn.style.opacity = '1';
          }
      });
  };

  updateUserCardButtonState();

  toggleBtn.addEventListener('click', async () => {
    const currentSettings = await getSettings();
    if (currentSettings.alwaysShowWishlist) return;

    toggleBtn.disabled = true;
    toggleBtn.textContent = 'Загрузка...';

    if (contextState.userCards) {
         contextState.userCards.wishlist = !contextState.userCards.wishlist;
    } else {
         contextState.userCards = { ...initialContextState.userCards, wishlist: !initialContextState.userCards.wishlist };
    }

    cachedElements.delete(contextsSelectors.userCards); 
    await processCards('userCards', currentSettings); 
    updateUserCardButtonState(); 
    log(`UserCards: Toggled wishlist visibility: ${contextState.userCards?.wishlist}`);
  });

  const cardItems = getElements(contextsSelectors.userCards);
  // Completely disable right-click (context menu) on card items to prevent accidental redirects/actions
  cardItems.forEach(item => {
    try {
      // Remove any previously attached handlers if present
      item.removeEventListener('contextmenu', handleUserCardContextMenu);
    } catch (e) { /* ignore */ }
    // Add a blocking listener that prevents default context menu and stops propagation
    item.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      log('UserCards: Right-click suppressed by extension');
      return false;
    }, { passive: false });
  });

   // Always run initial processing once so metadata-only badges (например A+) are applied
   log('initUserCards: Running initial processing (metadata badges + counters if enabled).');
   cachedElements.delete(contextsSelectors.userCards);
   await processCards('userCards', settings);
};

const handleUserCardContextMenu = async (e) => {
  // Disabled: previously saved card data and redirected to market/create on right-click.
  log('UserCards ContextMenu: Disabled (right-click -> market redirect removed).');
};


export const handleMarketCreatePage = async () => {
  log('MarketCreate: Entering page');
  try {
    const { selectedMarketCardData } = await chrome.storage.local.get(['selectedMarketCardData']);

    if (selectedMarketCardData && selectedMarketCardData.instanceId && selectedMarketCardData.imageUrl) {
      log(`MarketCreate: Found selected card data:`, selectedMarketCardData);

      const firstCardItem = await waitForElements(contextsSelectors.marketCreate, 5000, true); 
      if (!firstCardItem) {
          logWarn('MarketCreate: No cards loaded in time.');
          await chrome.storage.local.remove('selectedMarketCardData'); 
          return;
      }
      log('MarketCreate: First card item found:', firstCardItem);

      firstCardItem.click();
      log('MarketCreate: Clicked on the first card item.');

      const cardShowContainer = await waitForElements('.card-show', 5000, true);
      if (!cardShowContainer) {
          logWarn('MarketCreate: .card-show container did not appear after clicking first card.');
          await chrome.storage.local.remove('selectedMarketCardData'); 
          return;
      }
      log('MarketCreate: .card-show container appeared.');

      const cardShowHeader = cardShowContainer.querySelector('.card-show__header');
      const cardShowImage = cardShowContainer.querySelector('.card-show__image');

      if (cardShowHeader) {
          cardShowHeader.style.backgroundImage = `url("${selectedMarketCardData.imageUrl}")`;
          log('MarketCreate: Updated card-show header background image.');
      } else {
           logWarn('MarketCreate: .card-show__header not found.');
      }

      if (cardShowImage) {
          cardShowImage.src = selectedMarketCardData.imageUrl;
          log('MarketCreate: Updated card-show image src.');
      } else {
            logWarn('MarketCreate: .card-show__image not found.');
      }

      const hiddenInputName = 'card_id'; 
      const hiddenIdInput = cardShowContainer.closest('form')?.querySelector(`input[name="${hiddenInputName}"]`); 

      if (hiddenIdInput) {
          hiddenIdInput.value = selectedMarketCardData.instanceId;
          log(`MarketCreate: Updated hidden input [name="${hiddenInputName}"] value to: ${selectedMarketCardData.instanceId}`);
          hiddenIdInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenIdInput.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
          logError(`MarketCreate: Hidden input [name="${hiddenInputName}"] not found! The lot might be created with the wrong card ID.`);
      }

      await chrome.storage.local.remove('selectedMarketCardData');
      log('MarketCreate: Removed card data from local storage. Card selection finished.');

    } else {
      log('MarketCreate: No selected card data found in local storage.');
      if (selectedMarketCardData) {
          await chrome.storage.local.remove('selectedMarketCardData');
      }
    }
  } catch (error) {
    logError('MarketCreate: Error handling page logic:', error);
    try { await chrome.storage.local.remove('selectedMarketCardData'); } catch (e) { /* ignore cleanup error */ }
  }
};

export const initStatsButtons = async (context, targetSelector, buttonClass, effectiveState = null) => {
    const targetDiv = document.querySelector(targetSelector);
    if (!targetDiv) {
        logWarn(`initStatsButtons: Target selector '${targetSelector}' not found for context '${context}'.`);
        return;
    }
    const settings = await getSettings();
    const currentContextState = effectiveState || contextState[context] || initialContextState[context];
    log(`[DEBUG] initStatsButtons for ${context}:`, {
        effectiveState,
        currentContextState,
        contextStateGlobal: contextState[context],
        initialState: initialContextState[context]
    }); 

    const buttonsConfig = [
      { name: 'wishlist', text: 'Желают', activeClass: `${buttonClass}--active`, dataAttr: `data-${context}-wishlist-btn` },
      { name: 'owners', text: 'Владеют', activeClass: `${buttonClass}--active`, dataAttr: `data-${context}-owners-btn` }
    ];

    let nextSiblingElement = null;
    if (context === 'tradeOffer') {
        const possibleButtons = targetDiv.querySelectorAll('button, a.button, .button');
        nextSiblingElement = Array.from(possibleButtons).find(el => el.textContent.trim().includes('Анимированные'));
    }

    buttonsConfig.forEach(({ name, text, activeClass, dataAttr }) => {
      const alwaysShowSetting = name === 'wishlist' ? settings.alwaysShowWishlist : settings.alwaysShowOwners;
      const existingButton = targetDiv.querySelector(`[${dataAttr}]`);

      let btn = existingButton; 

      if (!btn) {
        btn = document.createElement('button');
        btn.classList.add(...buttonClass.split(' ').filter(Boolean), `${context}-${name}-btn`);
        btn.setAttribute(dataAttr, 'true');
        btn.style.display = 'inline-block';
        btn.style.verticalAlign = 'middle';
        btn.style.transition = 'background-color 0.3s ease, opacity 0.3s ease'; 
        btn.style.marginLeft = '5px'; 

        if (nextSiblingElement) {
             targetDiv.insertBefore(btn, nextSiblingElement);
        } else {
             targetDiv.appendChild(btn); 
        }

        btn.addEventListener('click', async () => {
          const currentSettingsClick = await getSettings();
          const currentAlwaysShow = name === 'wishlist' ? currentSettingsClick.alwaysShowWishlist : currentSettingsClick.alwaysShowOwners;
          if (currentAlwaysShow) return; 

          btn.disabled = true;
          btn.textContent = '...';

          if (contextState[context]) {
              contextState[context][name] = !contextState[context][name];
          } else {
              contextState[context] = { ...initialContextState[context], [name]: !initialContextState[context][name] };
          }
          const isActive = contextState[context][name]; 

          updateButtonAppearance(btn, isActive, name, activeClass, text, currentAlwaysShow); 

          // Сбрасываем флаг обработки карт при изменении настроек
          const cardSelector = contextsSelectors[context];
          if (cardSelector) {
            document.querySelectorAll(cardSelector).forEach(card => {
              card.removeAttribute('data-mb-processed');
            });
          }

          cachedElements.delete(contextsSelectors[context]);
          processCards(context, currentSettingsClick)
            .catch(err => logError(`Error processing cards after ${name} toggle in ${context}:`, err))
            .finally(() => {
                 btn.disabled = false;
                 updateButtonAppearance(btn, contextState[context]?.[name], name, activeClass, text, currentAlwaysShow);
                 log(`${context}: Toggled ${name} visibility: ${contextState[context]?.[name]}`);
          });
        });
      }

      updateButtonAppearance(btn, currentContextState[name], name, activeClass, text, alwaysShowSetting);
    });

    const shouldProcessInitially = (settings.alwaysShowWishlist || currentContextState.wishlist) || (settings.alwaysShowOwners || currentContextState.owners);
    log(`[DEBUG] initStatsButtons shouldProcessInitially check for ${context}:`, {
        alwaysShowWishlist: settings.alwaysShowWishlist,
        alwaysShowOwners: settings.alwaysShowOwners,
        currentContextStateWishlist: currentContextState.wishlist,
        currentContextStateOwners: currentContextState.owners,
        shouldProcessInitially
    });
    if (shouldProcessInitially) {
      log(`initStatsButtons: Initial processing needed for ${context}.`);
      cachedElements.delete(contextsSelectors[context]); 
      await processCards(context, settings); 
    }
};

const updateButtonAppearance = (btn, isActive, type, activeClass, defaultText, alwaysShow) => {
    if (!btn) return; 
    const label = type === 'wishlist' ? 'Желают' : 'Владеют';
    if (alwaysShow) {
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.textContent = `${label} (всегда)`;
        btn.classList.remove(activeClass); 
        btn.style.backgroundColor = '';
        btn.style.color = '';
        btn.style.borderColor = ''; 
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        if (isActive) {
            btn.classList.add(activeClass);
            btn.style.backgroundColor = '#8e44ad'; 
            btn.style.color = '#FFFFFF';
            btn.style.borderColor = '#8e44ad';
            btn.textContent = `Скрыть ${label.toLowerCase()}`;
        } else {
            btn.classList.remove(activeClass);
            btn.style.backgroundColor = '';
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.textContent = `Показать ${label.toLowerCase()}`;
        }
    }
}


export const initPackPage = async () => {
  const packContainer = document.querySelector('.lootbox__inner');
  if (!packContainer) {
    logWarn('PackPage: Pack container (.lootbox__inner) not found');
    return;
  }
  const settings = await getSettings();
  const context = 'pack';
  const currentPackState = contextState[context] || initialContextState[context];

  const processExistingCards = async () => {
      const initialCards = packContainer.querySelectorAll(contextsSelectors.pack);
      if (initialCards.length > 0) {
          // Скрываем все оригинальные метки .lootbox__card-meta
          initialCards.forEach(card => {
              const originalMeta = card.querySelector('.lootbox__card-meta');
              if (originalMeta) originalMeta.style.display = 'none';
          });
          
          cachedElements.delete(contextsSelectors.pack);
          await processCards('pack', settings);
      }
  };

  await processExistingCards();

  // Инициализируем текущий pack-id
  let lastPackId = document.querySelector('.lootbox__row')?.getAttribute('data-pack-id') || null;
  if (lastPackId) {
      log(`PackPage: Initial pack-id: ${lastPackId}`);
  }
  
  const observerCallback = async (mutations) => {
      if (!isExtensionContextValid()) {
          logWarn('PackPage: Observer callback skipped, extension context lost.');
          return;
      }
      let cardsChanged = false;
      let packIdChanged = false;
      
      for (const mutation of mutations) {
          if (mutation.type === 'childList') {
              if (Array.from(mutation.addedNodes).some(node => node.nodeType === 1 && node.matches?.(contextsSelectors.pack)) ||
                  Array.from(mutation.removedNodes).some(node => node.nodeType === 1 && node.matches?.(contextsSelectors.pack))) {
                  cardsChanged = true;
                  break;
              }
              if (Array.from(mutation.addedNodes).some(node => node.nodeType === 1 && node.querySelector?.(contextsSelectors.pack)) ||
                  Array.from(mutation.removedNodes).some(node => node.nodeType === 1 && node.querySelector?.(contextsSelectors.pack))) {
                   cardsChanged = true;
                   break;
              }

          } else if (mutation.type === 'attributes') {
              // Отслеживаем изменение data-pack-id у .lootbox__row (новый набор карт)
              if (mutation.attributeName === 'data-pack-id' && mutation.target.matches?.('.lootbox__row')) {
                  const newPackId = mutation.target.getAttribute('data-pack-id');
                  if (newPackId && newPackId !== lastPackId) {
                      log(`PackPage: data-pack-id changed: ${lastPackId} → ${newPackId}`);
                      lastPackId = newPackId;
                      packIdChanged = true;
                      cardsChanged = true;
                      break;
                  }
              }
              // Отслеживаем изменения в самих карточках
              if ((mutation.attributeName === 'data-id' || mutation.attributeName === 'class') && mutation.target.matches?.(contextsSelectors.pack)) {
                  cardsChanged = true;
                  break;
              }
          }
      }

      if (cardsChanged) {
          const currentSettings = await getSettings(); 
          const currentPackStateUpdated = contextState[context] || initialContextState[context]; 

          // Если это смена pack-id, ждём появления новых data-id у карточек
          if (packIdChanged) {
              log('PackPage: Waiting for new card IDs to appear...');
              
              // Собираем текущие ID карт (старые)
              const getCardIds = () => {
                  const cards = packContainer.querySelectorAll(contextsSelectors.pack);
                  return Array.from(cards).map(c => c.getAttribute('data-id')).filter(Boolean);
              };
              
              const oldIds = getCardIds();
              log(`PackPage: Old card IDs: ${oldIds.join(', ')}`);
              
              // Ждём, пока ID изменятся (макс 5 секунд)
              let attempts = 0;
              const maxAttempts = 50; // 50 * 100ms = 5 секунд
              
              while (attempts < maxAttempts) {
                  await new Promise(r => setTimeout(r, 100));
                  const newIds = getCardIds();
                  
                  // Проверяем, изменились ли ID
                  const idsChanged = newIds.length > 0 && 
                      (newIds.length !== oldIds.length || 
                       newIds.some((id, idx) => id !== oldIds[idx]));
                  
                  if (idsChanged) {
                      log(`PackPage: New card IDs detected: ${newIds.join(', ')}`);
                      break;
                  }
                  
                  attempts++;
              }
              
              if (attempts >= maxAttempts) {
                  logWarn('PackPage: Timeout waiting for new card IDs');
              }
          }

          // Сбрасываем признак обработанности и удаляем старые метки у видимых карточек
          try {
              const cardItems = packContainer.querySelectorAll(contextsSelectors.pack);
              cardItems.forEach(card => {
                  const id = card.getAttribute('data-id') || card.getAttribute('data-card-id');
                  card.removeAttribute('data-mb-processed');
                  card.querySelector('.pack-combined-label')?.remove();
                  
                  // Скрываем оригинальную метку
                  const originalMeta = card.querySelector('.lootbox__card-meta');
                  if (originalMeta) originalMeta.style.display = 'none';

                  if (!id) return;

                  // Показываем временный placeholder (комбинированная метка)
                  const showWishlist = currentSettings.alwaysShowWishlist || currentPackStateUpdated.wishlist;
                  const showOwners = currentSettings.alwaysShowOwners || currentPackStateUpdated.owners;
                  
                  const placeholderData = {};
                  if (showWishlist) placeholderData.wishlist = '…';
                  if (showOwners) placeholderData.owners = '…';
                  placeholderData.tooltip = 'Загрузка…';
                  
                  addCombinedPackLabel(card, placeholderData, 'pack');
              });
          } catch (e) { /* ignore */ }
          
          // Перезапускаем стандартную обработку
          cachedElements.delete(contextsSelectors.pack);
          await processCards(context, currentSettings);
      }
  }; 

  if (!packContainer._extensionObserver) {
      const observer = new MutationObserver(observerCallback);
      observer.observe(packContainer, {
          childList: true, 
          subtree: true,   
          attributes: true, 
          attributeFilter: ['data-id', 'class', 'data-pack-id'] 
      });
      packContainer._extensionObserver = observer; 
      log('PackPage: Setup observer for pack container');
  } else {
       logWarn('PackPage: Observer already exists for pack container.');
  }
};

// initOwnerDirectTrade: override owner link clicks to navigate directly to trade offers (bypass profile)
export const initOwnerDirectTrade = () => {
  log('initOwnerDirectTrade: Initializing (will respect tradeMode setting)');

  const attachListeners = () => {
    if (ownerListenersAttached) return;
    const ownerLinks = document.querySelectorAll(contextsSelectors.cardOwners);
    ownerLinks.forEach(link => {
      try { link.removeEventListener('click', handleOwnerDirectClick); } catch (e) {}
      link.addEventListener('click', handleOwnerDirectClick);
      // mark for easier debugging
      link.dataset.mbextOwner = '1';
    });
    ownerListenersAttached = true;
    log(`initOwnerDirectTrade: Attached to ${ownerLinks.length} owner links`);
  };

  const detachListeners = () => {
    const ownerLinks = document.querySelectorAll(contextsSelectors.cardOwners);
    ownerLinks.forEach(link => {
      try { link.removeEventListener('click', handleOwnerDirectClick); } catch (e) {}
      delete link.dataset.mbextOwner;
    });
    ownerListenersAttached = false;
    log('initOwnerDirectTrade: Detached owner listeners');
  };

  // Initialize based on current setting (default true)
  chrome.storage.local.get(['tradeMode'], (res) => {
    let enabled = res.tradeMode;
    if (typeof enabled === 'undefined') {
      enabled = true;
      chrome.storage.local.set({ tradeMode: true });
    }
    if (enabled) attachListeners(); else detachListeners();
  });

  // React to storage changes (tradeMode toggle)
  const storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (changes.tradeMode) {
      const enabled = changes.tradeMode.newValue;
      if (enabled) attachListeners(); else detachListeners();
    }
  };
  if (!ownerStorageListenerAdded) {
    chrome.storage.onChanged.addListener(storageListener);
    ownerStorageListenerAdded = true;
  }

  // MutationObserver to attach to newly added links when tradeMode enabled
  if (!ownerLinksObserver) {
    ownerLinksObserver = new MutationObserver((mutations) => {
      // if tradeMode currently enabled, attach listeners after small debounce
      chrome.storage.local.get(['tradeMode'], (r) => {
        if (!r.tradeMode) return;
        // re-attach to any new links
        attachListeners();
      });
    });
    ownerLinksObserver.observe(document.body, { childList: true, subtree: true });
  }
};

function handleOwnerDirectClick(e) {
  // Allow modifier clicks and non-left buttons to behave normally
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

  e.preventDefault();
  e.stopPropagation();

  const href = e.currentTarget?.getAttribute('href');
  if (!href) return;

  try {
    const url = new URL(href, location.origin);
    const userMatch = url.pathname.match(/\/users\/(\d+)/);
    const userId = userMatch ? userMatch[1] : null;
    const cardUserId = url.searchParams.get('card_user_id');

    if (!userId) {
      logWarn('initOwnerDirectTrade: could not extract userId from href', href);
      return;
    }

    if (cardUserId) {
      // keep compatibility: store auto-select id used on trade page
      sessionStorage.setItem('mbext_autoSelectCardId', cardUserId);
      log(`initOwnerDirectTrade: Redirecting to trade for user ${userId} with card_user_id=${cardUserId}`);
      window.location.href = `${BASE_URL}/trades/offers/${userId}?card_user_id=${cardUserId}`;
    } else {
      log(`initOwnerDirectTrade: Redirecting to trade for user ${userId} (no card_user_id in link)`);
      window.location.href = `${BASE_URL}/trades/offers/${userId}`;
    }
  } catch (err) {
    logError('initOwnerDirectTrade: error redirecting to trade', err, href);
  }
}

export const initTradeOfferAutoSelect = () => {
  log('initTradeOfferAutoSelect: Checking for auto-select card');
  
  // Проверяем, есть ли сохранённый ID карты
  const cardId = sessionStorage.getItem('mbext_autoSelectCardId');
  if (!cardId) {
    log('initTradeOfferAutoSelect: No card ID found in sessionStorage');
    return;
  }

  log(`initTradeOfferAutoSelect: Found cardId ${cardId}, attempting auto-select`);
  
  // Удаляем из sessionStorage чтобы не срабатывало повторно
  sessionStorage.removeItem('mbext_autoSelectCardId');

  // Ждём загрузки карт (может потребоваться время)
  const trySelectCard = (attempts = 0) => {
    if (attempts > 20) { // Максимум 10 секунд (20 * 500ms)
      logWarn('initTradeOfferAutoSelect: Timeout waiting for cards to load');
      return;
    }

    // Ищем карту в инвентаре партнера по data-card-id или data-id
    const partnerCards = document.querySelectorAll('.card-filter-list__card[data-card-id], .card-filter-list__card[data-id]');
    let targetCard = null;

    partnerCards.forEach(card => {
      const cardDataId = card.getAttribute('data-card-id') || card.getAttribute('data-id');
      if (cardDataId === cardId) {
        targetCard = card;
      }
    });

    if (targetCard) {
      log(`initTradeOfferAutoSelect: Found target card, clicking...`);
      targetCard.click();
      
      // Визуальная индикация
      targetCard.style.border = '3px solid #9d4edd';
      setTimeout(() => {
        if (targetCard.style) targetCard.style.border = '';
      }, 2000);
    } else {
      // Карты ещё не загрузились, пробуем снова
      setTimeout(() => trySelectCard(attempts + 1), 500);
    }
  };

  // Начинаем попытки выбора карты
  trySelectCard();
};

// State for trade offer filters
let tradeOfferFilterObserver = null;
let tradeOfferFilterListenersAttached = false;

export const initTradeOfferFilters = async () => {
  log('initTradeOfferFilters: Setting up rank filter listeners');
  
  // Cleanup previous observers/listeners if exist
  if (tradeOfferFilterObserver) {
    tradeOfferFilterObserver.disconnect();
    tradeOfferFilterObserver = null;
  }
  
  const filterButtons = document.querySelectorAll('.card-filter-form__rank');
  if (!filterButtons || filterButtons.length === 0) {
    logWarn('initTradeOfferFilters: No rank filter buttons found');
    return;
  }
  
  log(`initTradeOfferFilters: Found ${filterButtons.length} rank filter buttons`);
  
  // Контейнер с карточками для наблюдения
  const cardContainer = document.querySelector('.card-filter-list');
  if (!cardContainer) {
    logWarn('initTradeOfferFilters: Card container not found');
    return;
  }
  
  // Debounced function to reprocess cards after filter change
  const reprocessCards = debounce(async () => {
    log('initTradeOfferFilters: Reprocessing cards after filter change');
    const settings = await getSettings();
    
    // Сбрасываем флаги обработки карт
    const cardSelector = contextsSelectors.tradeOffer;
    if (cardSelector) {
      document.querySelectorAll(cardSelector).forEach(card => {
        card.removeAttribute('data-mb-processed');
      });
    }
    
    cachedElements.delete(contextsSelectors.tradeOffer);
    await processCards('tradeOffer', settings);
  }, 500); // 500ms delay to wait for content to update
  
  // Setup MutationObserver to detect when cards change
  tradeOfferFilterObserver = new MutationObserver((mutations) => {
    // Check if cards were added/removed/changed, но игнорируем изменения от наших меток
    const hasCardChanges = mutations.some(mutation => {
      if (mutation.type === 'childList') {
        // Игнорируем добавление/удаление наших меток
        const addedLabels = Array.from(mutation.addedNodes).some(node => 
          node.classList?.contains('wishlist-warning') || 
          node.classList?.contains('owners-count') ||
          node.classList?.contains('available-animation') ||
          node.classList?.contains('lootbox-level') ||
          node.classList?.contains('lootbox-mine') ||
          node.classList?.contains('manual-refresh-btn')
        );
        const removedLabels = Array.from(mutation.removedNodes).some(node => 
          node.classList?.contains('wishlist-warning') || 
          node.classList?.contains('owners-count') ||
          node.classList?.contains('available-animation') ||
          node.classList?.contains('lootbox-level') ||
          node.classList?.contains('lootbox-mine') ||
          node.classList?.contains('manual-refresh-btn')
        );
        
        // Если изменения только от меток - игнорируем
        if ((addedLabels || removedLabels) && 
            mutation.addedNodes.length + mutation.removedNodes.length <= 5) {
          return false;
        }
        
        // Проверяем добавление/удаление карточек
        const hasCardNodes = Array.from(mutation.addedNodes).some(node => 
          node.classList?.contains('card-filter-list__card')
        ) || Array.from(mutation.removedNodes).some(node => 
          node.classList?.contains('card-filter-list__card')
        );
        
        return hasCardNodes;
      }
      return false;
    });
    
    if (hasCardChanges) {
      log('initTradeOfferFilters: Card changes detected, reprocessing...');
      reprocessCards();
    }
  });
  
  // Observe card container for changes
  tradeOfferFilterObserver.observe(cardContainer, {
    childList: true,
    subtree: true
  });
  
  // Also add click listeners to filter buttons as backup
  if (!tradeOfferFilterListenersAttached) {
    filterButtons.forEach(button => {
      button.addEventListener('click', () => {
        log(`initTradeOfferFilters: Filter button clicked: ${button.getAttribute('data-rank') || 'All'}`);
        // Wait a bit for content to update, then reprocess
        setTimeout(async () => {
          const settings = await getSettings();
          
          // Сбрасываем флаги обработки карт
          const cardSelector = contextsSelectors.tradeOffer;
          if (cardSelector) {
            document.querySelectorAll(cardSelector).forEach(card => {
              card.removeAttribute('data-mb-processed');
            });
          }
          
          cachedElements.delete(contextsSelectors.tradeOffer);
          await processCards('tradeOffer', settings);
        }, 800);
      });
    });
    tradeOfferFilterListenersAttached = true;
    log('initTradeOfferFilters: Click listeners attached to filter buttons');
  }
};