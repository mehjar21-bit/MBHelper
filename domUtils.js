import { log, logWarn, logError } from './utils.js';

export const addRefreshButton = (container, cardId, onRefresh) => {
  if (!container || !(container instanceof HTMLElement)) return;

  try {
    const existingBtn = container.querySelector('.card-refresh-btn');
    if (existingBtn) return; // Уже добавлена

    const btn = document.createElement('button');
    btn.classList.add('card-refresh-btn');
    btn.title = 'Обновить данные карты (без кэша)';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>`;
    
    btn.style.cssText = `
      position: absolute;
      bottom: 5px;
      left: 5px;
      width: 24px;
      height: 24px;
      padding: 0;
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid #4CAF50;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999;
      transition: all 0.2s;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(76, 175, 80, 0.8)';
      btn.style.transform = 'scale(1.1)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(0, 0, 0, 0.7)';
      btn.style.transform = 'scale(1)';
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.innerHTML = `<span style="font-size: 10px;">⏳</span>`;
      
      try {
        await onRefresh(cardId);
        btn.innerHTML = `<span style="font-size: 10px;">✓</span>`;
        setTimeout(() => {
          btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>`;
          btn.disabled = false;
          btn.style.opacity = '1';
        }, 1500);
      } catch (error) {
        logError(`Error refreshing card ${cardId}:`, error);
        btn.innerHTML = `<span style="font-size: 10px;">✗</span>`;
        setTimeout(() => {
          btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>`;
          btn.disabled = false;
          btn.style.opacity = '1';
        }, 1500);
      }
    });

    container.style.position = 'relative';
    container.appendChild(btn);
  } catch (error) {
    logError('Error adding refresh button:', error);
  }
};

export const addManualRefreshButton = (onRefresh) => {
  try {
    const existingBtn = document.querySelector('.manual-refresh-global-btn');
    if (existingBtn) return;

    let isRefreshing = false;
    let refreshAborted = false;

    const btn = document.createElement('button');
    btn.classList.add('manual-refresh-global-btn');
    btn.title = 'Принудительно загрузить данные для всех карт на странице';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>
      <span style="margin-left: 6px;">Обновить карты</span>`;
    
    // Отслеживаем клики по пагинации для сброса состояния
    const resetButton = () => {
      if (isRefreshing) {
        refreshAborted = true;
        isRefreshing = false;
        btn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
          <span style="margin-left: 6px;">Обновить карты</span>`;
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    };

    // Слушаем клики по кнопкам пагинации
    document.addEventListener('click', (e) => {
      const paginationBtn = e.target.closest('.pagination__button a, button[data-page]');
      if (paginationBtn) {
        resetButton();
      }
    }, true);

    // Наблюдаем за изменениями в пагинации
    const paginationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target.matches && mutation.target.matches('.pagination, [class*="pagination"]')) {
          resetButton();
          break;
        }
      }
    });

    const paginationContainer = document.querySelector('.pagination, .manga-cards, [class*="cards"]');
    if (paginationContainer) {
      paginationObserver.observe(paginationContainer.parentElement || document.body, {
        childList: true,
        subtree: true
      });
    }
    
    btn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      padding: 12px 20px;
      background: linear-gradient(135deg, rgba(76, 175, 80, 0.9), rgba(56, 142, 60, 0.9));
      border: 2px solid #4CAF50;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-size: 14px;
      font-weight: bold;
      color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.3s;
      font-family: Arial, sans-serif;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'linear-gradient(135deg, rgba(76, 175, 80, 1), rgba(56, 142, 60, 1))';
      btn.style.transform = 'scale(1.05) translateY(-2px)';
      btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'linear-gradient(135deg, rgba(76, 175, 80, 0.9), rgba(56, 142, 60, 0.9))';
      btn.style.transform = 'scale(1) translateY(0)';
      btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (isRefreshing) return;
      
      isRefreshing = true;
      refreshAborted = false;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="animation: spin 1s linear infinite;">
          <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
        </svg>
        <span style="margin-left: 6px;">Загрузка...</span>`;
      
      const style = document.createElement('style');
      style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
      document.head.appendChild(style);
      
      try {
        await onRefresh();
        
        if (refreshAborted) return;
        
        btn.innerHTML = `
          <span style="font-size: 18px;">✓</span>
          <span style="margin-left: 6px;">Готово!</span>`;
        setTimeout(() => {
          if (refreshAborted) return;
          btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            <span style="margin-left: 6px;">Обновить карты</span>`;
          btn.disabled = false;
          btn.style.opacity = '1';
          isRefreshing = false;
        }, 2000);
      } catch (error) {
        if (refreshAborted) return;
        
        logError('Error refreshing all cards:', error);
        btn.innerHTML = `
          <span style="font-size: 18px;">✗</span>
          <span style="margin-left: 6px;">Ошибка</span>`;
        setTimeout(() => {
          if (refreshAborted) return;
          btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
            <span style="margin-left: 6px;">Обновить карты</span>`;
          btn.disabled = false;
          btn.style.opacity = '1';
          isRefreshing = false;
        }, 2000);
      }
    });

    document.body.appendChild(btn);
    log('Manual refresh button added');
  } catch (error) {
    logError('Error adding manual refresh button:', error);
  }
};

export const addTextLabel = (container, className, text, title, position, type, options = {}, context) => {
  if (!container || !(container instanceof HTMLElement)) {
      return;
  }

  try {
    const existingLabel = container.querySelector(`.${className}`);
    if (existingLabel) existingLabel.remove();

    const div = document.createElement('div');
    div.classList.add(className);
    div.title = title;

    const svgIconContainer = document.createElement('span');
    svgIconContainer.style.display = 'inline-flex';
    svgIconContainer.style.alignItems = 'center';

    let svgString = '';
    switch (type) {
      case 'wishlist':
        svgString = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle;">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>`;
        break;
      case 'owners':
        svgString = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle;">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>`;
        break;
      case 'level':
        // Magic wand icon for level/enchantment
        svgString = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle;">
            <path d="m4.863 2.855 1.55-.442.442-1.55a1.191 1.191 0 0 1 2.29 0l.442 1.55 1.55.442a1.191 1.191 0 0 1 0 2.29l-1.55.442-.442 1.55a1.191 1.191 0 0 1 -2.29 0l-.442-1.55-1.55-.442a1.191 1.191 0 0 1 0-2.29zm18.274 12-1.55-.442-.442-1.55a1.191 1.191 0 0 0 -2.29 0l-.442 1.55-1.55.442a1.191 1.191 0 0 0 0 2.29l1.55.442.442 1.55a1.191 1.191 0 0 0 2.29 0l.442-1.55 1.55-.442a1.191 1.191 0 0 0 0-2.29zm-5.382-10.355 1.356.387.389 1.357a1.042 1.042 0 0 0 2 0l.387-1.355 1.358-.389a1.042 1.042 0 0 0 0-2l-1.356-.387-.389-1.358a1.042 1.042 0 0 0 -2 0l-.387 1.356-1.358.389a1.042 1.042 0 0 0 0 2zm-.6 8.148-10.469 10.216a3.926 3.926 0 0 1 -5.537-.013 3.929 3.929 0 0 1 0-5.55l10.524-10.268a3.923 3.923 0 0 1 6.664 2.832 3.894 3.894 0 0 1 -1.184 2.785zm-6.18 1.839-1.309-1.305-6.409 6.253a.921.921 0 0 0 .014 1.294.943.943 0 0 0 1.306 0zm4.364-4.642a.924.924 0 0 0 -1.569-.667l-1.955 1.907 1.307 1.307 1.937-1.892a.92.92 0 0 0 .278-.653z"/>
          </svg>`;
        break;
      case 'mine':
        // Cards icon from free-icon-font-cards-blank
        svgString = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle;">
            <path d="M13,4H3c-1.654,0-3,1.346-3,3V24H16V7c0-1.654-1.346-3-3-3Zm10.88,2.693l-4.781,16.414-1.099-.409V7c0-2.757-2.243-5-5-5h-4.243c.243-.691,.72-1.271,1.373-1.63,.705-.385,1.515-.473,2.283-.25l9.436,2.856c1.577,.459,2.492,2.128,2.03,3.716Z"/>
          </svg>`;
        break;
      default:
        svgString = '';
    }

    svgIconContainer.innerHTML = svgString;

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    textSpan.style.lineHeight = '1';

    div.appendChild(svgIconContainer);
    div.appendChild(textSpan);

    const isUserCards = context === 'userCards';
    const isDeckView = context === 'deckView';
    // Для лейблов из lootbox (level/mine) помещаем их слева, чтобы не пересекаться с wishlist/owners
    const positionStyle = (isUserCards || className?.startsWith?.('lootbox-')) ? 'left: 5px;' : 'right: 5px;';
    const topPosition = (position === 'top') ? '5px' : (position === 'middle' ? '25px' : '45px');
    const deckViewStyles = isDeckView ? `
      z-index: 1000;
      font-size: 14px;
      padding: 3px 6px;
      background-color: rgba(0, 0, 0, 0.8);
      border: 1px solid ${options.color || '#FFFFFF'};
    ` : '';

    div.style.cssText = `
      position: absolute;
      top: ${topPosition};
      ${positionStyle}
      color: ${options.color || '#FFFFFF'};
      font-size: 12px;
      background-color: rgba(0, 0, 0, 0.7);
      padding: 2px 5px;
      border-radius: 3px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 4px;
      ${deckViewStyles}
    `;

    if (isDeckView) {
         container.style.position = 'relative';
    } else {
         if (getComputedStyle(container).position === 'static') {
             container.style.position = 'relative';
         }
    }

    container.appendChild(div);

  } catch (error) {
      logError(`Error adding label "${className}" in context "${context}":`, error, container);
  }
};

// Комбинированная горизонтальная метка для pack-контекста (как у создателей сайта)
export const addCombinedPackLabel = (container, data, context) => {
  if (!container || !(container instanceof HTMLElement)) return;

  try {
    // Удаляем старую комбинированную метку
    const existingLabel = container.querySelector('.pack-combined-label');
    if (existingLabel) existingLabel.remove();

    // Собираем части
    const parts = [];

    // Wishlist (иконка + значение)
    if (data.wishlist !== undefined && data.wishlist !== null) {
      const wishlistSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right: 4px;">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
      </svg>`;
      const wishlistColor = data.wishlistWarning && data.wishlist >= data.wishlistWarning ? '#FFA500' : '#00FF00';
      parts.push(`<span style="display: inline-flex; align-items: center; color: ${wishlistColor};">${wishlistSvg}${data.wishlist}${data.wishlistOld ? ' ⏱️' : ''}</span>`);
    }

    // Owners (иконка + значение)
    if (data.owners !== undefined && data.owners !== null) {
      const ownersSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right: 4px;">
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
      </svg>`;
      parts.push(`<span style="display: inline-flex; align-items: center;">${ownersSvg}${data.owners}${data.ownersOld ? ' ⏱️' : ''}</span>`);
    }

    // Level (иконка + значение)
    if (data.level) {
      const levelSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right: 4px;">
        <path d="m4.863 2.855 1.55-.442.442-1.55a1.191 1.191 0 0 1 2.29 0l.442 1.55 1.55.442a1.191 1.191 0 0 1 0 2.29l-1.55.442-.442 1.55a1.191 1.191 0 0 1 -2.29 0l-.442-1.55-1.55-.442a1.191 1.191 0 0 1 0-2.29zm18.274 12-1.55-.442-.442-1.55a1.191 1.191 0 0 0 -2.29 0l-.442 1.55-1.55.442a1.191 1.191 0 0 0 0 2.29l1.55.442.442 1.55a1.191 1.191 0 0 0 2.29 0l.442-1.55 1.55-.442a1.191 1.191 0 0 0 0-2.29zm-5.382-10.355 1.356.387.389 1.357a1.042 1.042 0 0 0 2 0l.387-1.355 1.358-.389a1.042 1.042 0 0 0 0-2l-1.356-.387-.389-1.358a1.042 1.042 0 0 0 -2 0l-.387 1.356-1.358.389a1.042 1.042 0 0 0 0 2zm-.6 8.148-10.469 10.216a3.926 3.926 0 0 1 -5.537-.013 3.929 3.929 0 0 1 0-5.55l10.524-10.268a3.923 3.923 0 0 1 6.664 2.832 3.894 3.894 0 0 1 -1.184 2.785zm-6.18 1.839-1.309-1.305-6.409 6.253a.921.921 0 0 0 .014 1.294.943.943 0 0 0 1.306 0zm4.364-4.642a.924.924 0 0 0 -1.569-.667l-1.955 1.907 1.307 1.307 1.937-1.892a.92.92 0 0 0 .278-.653z"/>
      </svg>`;
      parts.push(`<span style="display: inline-flex; align-items: center; color: #FFD700;">${levelSvg}${data.level}</span>`);
    }

    // Mine (иконка + значение)
    if (data.mine) {
      const mineSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="margin-right: 4px;">
        <path d="M13,4H3c-1.654,0-3,1.346-3,3V24H16V7c0-1.654-1.346-3-3-3Zm10.88,2.693l-4.781,16.414-1.099-.409V7c0-2.757-2.243-5-5-5h-4.243c.243-.691,.72-1.271,1.373-1.63,.705-.385,1.515-.473,2.283-.25l9.436,2.856c1.577,.459,2.492,2.128,2.03,3.716Z"/>
      </svg>`;
      parts.push(`<span style="display: inline-flex; align-items: center; color: #00BFFF;">${mineSvg}${data.mine}</span>`);
    }

    // A+ (метка анимации)
    if (data.anim) {
      parts.push(`<span style="display: inline-flex; align-items: center; color: #FF69B4; font-weight: bold;">A+</span>`);
    }

    if (parts.length === 0) return; // Ничего не показываем

    // Создаём контейнер с разделителями (стиль как у .lootbox__card-pill)
    const div = document.createElement('div');
    div.classList.add('pack-combined-label');
    div.innerHTML = parts.join('<span style="margin: 0 6px; color: rgba(255,255,255,0.4);">|</span>');
    div.title = data.tooltip || 'Информация о карте';

    div.style.cssText = `
      position: absolute;
      top: 1px;
      left: 5px;
      right: 5px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 95px;
      background: rgba(0, 0, 0, 0.45);
      color: #fff;
      white-space: nowrap;
      z-index: 10;
    `;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    // Скрываем оригинальную метку .lootbox__card-meta
    const originalMeta = container.querySelector('.lootbox__card-meta');
    if (originalMeta) {
      originalMeta.style.display = 'none';
    }

    container.appendChild(div);
    log(`Added combined pack label to card with ${parts.length} parts`);

  } catch (error) {
    logError(`Error adding combined pack label in context "${context}":`, error, container);
  }
};


export const addExtensionSettingsButton = async () => {
  try {
    // Проверяем стелс режим
    const { stealthMode } = await chrome.storage.sync.get(['stealthMode']);
    const isStealthMode = stealthMode !== undefined ? stealthMode : true;
    
    // В стелс режиме не показываем кнопку
    if (isStealthMode) {
      log('Stealth mode enabled - hiding settings button');
      return;
    }
    
    const menu = document.querySelector('.dropdown__content .menu--profile');
    if (!menu || menu.querySelector('.menu__item--extension-settings')) return;
    const settingsButton = document.createElement('a');
    settingsButton.classList.add('menu__item', 'menu__item--extension-settings');
    settingsButton.target = '_blank';
    settingsButton.href = chrome.runtime.getURL('interface.html');
    settingsButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: middle; margin-right: 8px;">
        <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
      </svg>
      Настройки расширения`;
    menu.appendChild(settingsButton);
    log('Added extension settings button');
  } catch (error) {
      logError('Error adding settings button:', error);
  }
};