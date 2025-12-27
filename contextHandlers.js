import { getSettings } from './settings.js';
import { processCards } from './cardProcessor.js';
import { getElements, waitForElements, log, logWarn, logError, debounce, cachedElements, isExtensionContextValid } from './utils.js';
import { contextsSelectors, BASE_URL, initialContextState } from './config.js';
import { contextState } from './main.js'; 

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
  cardItems.forEach(item => {
    item.removeEventListener('contextmenu', handleUserCardContextMenu); 
    item.addEventListener('contextmenu', handleUserCardContextMenu);
  });

   const initialShowWishlist = settings.alwaysShowWishlist || contextState.userCards?.wishlist;
   if (initialShowWishlist) {
       log('initUserCards: Initial wishlist processing needed.');
       cachedElements.delete(contextsSelectors.userCards);
       await processCards('userCards', settings);
   }
};

const handleUserCardContextMenu = async (e) => {
  e.preventDefault();
  const item = e.currentTarget; 
  const lockButton = item.querySelector('.lock-card-btn');
  const imageDiv = item.querySelector('.manga-cards__image');

  if (!lockButton) {
    logWarn('UserCards ContextMenu: Lock button (.lock-card-btn) not found.');
    return;
  }
  if (!imageDiv) {
      logWarn('UserCards ContextMenu: Image div (.manga-cards__image) not found.');
      return;
  }

  const cardInstanceId = lockButton.getAttribute('data-id');
  const bgImageStyle = imageDiv.style.backgroundImage;
  const urlMatch = bgImageStyle.match(/url\("?(.+?)"?\)/);
  const imageUrl = urlMatch ? urlMatch[1] : null;

  if (!cardInstanceId) {
    logWarn('UserCards ContextMenu: Missing data-id on lock button.');
    return;
  }
   if (!imageUrl) {
     logWarn('UserCards ContextMenu: Could not extract image URL from style:', bgImageStyle);
     return;
   }


  log(`UserCards ContextMenu: Right-clicked card instance ID: ${cardInstanceId}, Image: ${imageUrl}`);

  const dataToSave = {
      instanceId: cardInstanceId,
      imageUrl: imageUrl
  };

  try {
    await chrome.storage.local.set({ selectedMarketCardData: dataToSave });
    log('UserCards ContextMenu: Saved card data to local storage:', dataToSave);
    window.location.href = `${BASE_URL}/market/create`; 
  } catch (error) {
    logError('UserCards ContextMenu: Error saving data or redirecting:', error);
    alert('Не удалось сохранить данные карты для создания лота.');
  }
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

export const initStatsButtons = async (context, targetSelector, buttonClass) => {
    const targetDiv = document.querySelector(targetSelector);
    if (!targetDiv) {
        logWarn(`initStatsButtons: Target selector '${targetSelector}' not found for context '${context}'.`);
        return;
    }
    const settings = await getSettings();
    const currentContextState = contextState[context] || initialContextState[context]; 

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
      if (settings.alwaysShowWishlist || currentPackState.wishlist) {
          const initialCards = packContainer.querySelectorAll(contextsSelectors.pack);
          if (initialCards.length > 0) {
              cachedElements.delete(contextsSelectors.pack);
              await processCards('pack', settings);
          }
      } else {
           const existingLabels = packContainer.querySelectorAll('.wishlist-warning, .owners-count');
           existingLabels.forEach(label => label.remove());
      }
  };

  await processExistingCards();

  const observerCallback = debounce(async (mutations) => {
      if (!isExtensionContextValid()) {
          logWarn('PackPage: Observer callback skipped, extension context lost.');
          return;
      }
      let cardsChanged = false;
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

          } else if (mutation.type === 'attributes' && (mutation.attributeName === 'data-id' || mutation.attributeName === 'class') && mutation.target.matches?.(contextsSelectors.pack)) {
              cardsChanged = true;
              break;
          }
      }

      if (cardsChanged) {
          const currentSettings = await getSettings(); 
          const currentPackStateUpdated = contextState[context] || initialContextState[context]; 
          const shouldShowLabels = currentSettings.alwaysShowWishlist || currentPackStateUpdated.wishlist;

          if (shouldShowLabels) {
              cachedElements.delete(contextsSelectors.pack);
              await processCards(context, currentSettings); 
          } else {
              const cardItems = getElements(contextsSelectors.pack);
              cardItems.forEach(item => {
                  item.querySelector('.wishlist-warning')?.remove();
                  item.querySelector('.owners-count')?.remove(); 
              });
          }
      }
  }, 300); 

  if (!packContainer._extensionObserver) {
      const observer = new MutationObserver(observerCallback);
      observer.observe(packContainer, {
          childList: true, 
          subtree: true,   
          attributes: true, 
          attributeFilter: ['data-id', 'class'] 
      });
      packContainer._extensionObserver = observer; 
      log('PackPage: Setup observer for pack container');
  } else {
       logWarn('PackPage: Observer already exists for pack container.');
  }
};