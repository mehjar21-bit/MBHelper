import { initialContextState } from './config.js';

const log = (msg, ...args) => console.log(`[Interface] ${msg}`, ...args);
const logError = (msg, ...args) => console.error(`[Interface] ${msg}`, ...args);

function updateSliderTrack(style, value, min, max) {
  value = Number(value);
  min = Number(min);
  max = Number(max);
  if (isNaN(value) || isNaN(min) || isNaN(max) || max <= min) { return; }
  const percentage = ((value - min) / (max - min)) * 100;
  let gradient;
  switch (style) {
    case 'style-1': gradient = `linear-gradient(to right, #8a4af3 ${percentage}%, #3a3a3a ${percentage}%)`; break;
    case 'style-2': gradient = `linear-gradient(to right, #3498db ${percentage}%, #ddd ${percentage}%)`; break;
    case 'style-3': gradient = `linear-gradient(to right, #e67e22 ${percentage}%, #444 ${percentage}%)`; break;
    default: gradient = `linear-gradient(to right, #8a4af3 ${percentage}%, #3a3a3a ${percentage}%)`;
  }
  const slider = document.getElementById('wishlistWarning');
  if (slider) { slider.style.background = gradient; }
  else { logError('Slider element "wishlistWarning" not found in updateSliderTrack'); }
}

function generateContextSettingsUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) { logError(`Container "${containerId}" not found...`); return; }
    while (container.children.length > 3) { container.removeChild(container.lastChild); }

    for (const contextName in initialContextState) {
        if (initialContextState.hasOwnProperty(contextName)) {
            const defaults = initialContextState[contextName];
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('context-name');
            nameSpan.textContent = contextName;

            const createToggleCell = (type) => {
                const toggleSpan = document.createElement('span');
                toggleSpan.classList.add('context-toggle');
                if (defaults.hasOwnProperty(type)) {
                    const label = document.createElement('label');
                    label.classList.add('toggle-switch');
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = `context-${contextName}-${type}`;
                    checkbox.dataset.context = contextName;
                    checkbox.dataset.type = type;
                    const track = document.createElement('span');
                    track.classList.add('switch-track');
                    const thumb = document.createElement('span');
                    thumb.classList.add('switch-thumb');
                    track.appendChild(thumb);
                    label.appendChild(checkbox);
                    label.appendChild(track);
                    toggleSpan.appendChild(label);
                } else {
                    toggleSpan.textContent = '-';
                    toggleSpan.style.textAlign = 'center';
                }
                return toggleSpan;
            };

            const wishlistToggleSpan = createToggleCell('wishlist');
            const ownersToggleSpan = createToggleCell('owners');

            container.appendChild(nameSpan);
            container.appendChild(wishlistToggleSpan);
            container.appendChild(ownersToggleSpan);
        }
    }
    log('Context settings UI generated with toggle switches.');
}

function toggleSettingsAvailability(enabled) {
    const container = document.getElementById('settingsContainer');
    if (!container) return;
    if (enabled) {
        container.classList.remove('settings-disabled');
        log('Interface settings enabled.');
    } else {
        container.classList.add('settings-disabled');
        log('Interface settings disabled (except master switch).');
    }
}


document.addEventListener('DOMContentLoaded', () => {
  log('DOM fully loaded, initializing interface');

  generateContextSettingsUI('contextSettingsGrid');

  const extensionEnabledEl = document.getElementById('extensionEnabled');
  const wishlistStyleEl = document.getElementById('wishlistStyle');
  const wishlistWarningEl = document.getElementById('wishlistWarning');
  const wishlistWarningValueEl = document.getElementById('wishlistWarningValue');
  const alwaysShowWishlistEl = document.getElementById('alwaysShowWishlist');
  const alwaysShowOwnersEl = document.getElementById('alwaysShowOwners');
  const mineHitCountEl = document.getElementById('mineHitCount');
  const saveBtn = document.getElementById('save');
  const saveSpinner = document.getElementById('saveSpinner');
  const clearCacheBtn = document.getElementById('clearCache');
  const clearCacheSpinner = document.getElementById('clearCacheSpinner');
  const exportCacheBtn = document.getElementById('exportCache');
  const importCacheInput = document.getElementById('importCache');
  const importCacheBtn = document.getElementById('importCacheBtn');
  const savedMessageEl = document.getElementById('savedMessage');
  const body = document.body;
  const styleButtons = document.querySelectorAll('.style-btn');
  const contextCheckboxes = document.querySelectorAll('#contextSettingsGrid input[type="checkbox"]');

  if (!extensionEnabledEl || !wishlistStyleEl || !wishlistWarningEl || !wishlistWarningValueEl || !alwaysShowWishlistEl || !alwaysShowOwnersEl || !mineHitCountEl || !saveBtn || !saveSpinner || !clearCacheBtn || !clearCacheSpinner || !exportCacheBtn || !importCacheInput || !importCacheBtn || !savedMessageEl || styleButtons.length === 0 || !document.getElementById('saveIcon') || !document.getElementById('saveText')) {
    logError('One or more required DOM elements not found!');
    return;
  }

  const settingsKeys = ['extensionEnabled', 'wishlistStyle', 'wishlistWarning', 'alwaysShowWishlist', 'alwaysShowOwners', 'userContextStates', 'mineHitCount'];
  chrome.storage.sync.get(settingsKeys, data => {
    const savedEnabled = data.extensionEnabled !== undefined ? data.extensionEnabled : true;
    const savedStyle = data.wishlistStyle || 'style-1';
    const savedWarning = data.wishlistWarning !== undefined ? data.wishlistWarning : 10;
    const savedAlwaysWishlist = data.alwaysShowWishlist || false;
    const savedAlwaysOwners = data.alwaysShowOwners || false;
    const savedMineHitCount = data.mineHitCount !== undefined ? data.mineHitCount : 100;
    const savedContextStates = data.userContextStates || {};

    extensionEnabledEl.checked = savedEnabled;
    wishlistStyleEl.value = savedStyle;
    wishlistWarningEl.value = savedWarning;
    wishlistWarningValueEl.textContent = savedWarning;
    alwaysShowWishlistEl.checked = savedAlwaysWishlist;
    alwaysShowOwnersEl.checked = savedAlwaysOwners;
    mineHitCountEl.value = savedMineHitCount;
    body.className = savedStyle;
    updateSliderTrack(savedStyle, savedWarning, wishlistWarningEl.min, wishlistWarningEl.max);

     styleButtons.forEach(btn => btn.classList.remove('active'));
     const activeBtn = document.querySelector(`.style-btn[data-style="${savedStyle}"]`);
     if (activeBtn) activeBtn.classList.add('active');

    const effectiveContextStates = {};
     for (const contextName in initialContextState) {
         effectiveContextStates[contextName] = {
             ...initialContextState[contextName],
             ...(savedContextStates[contextName] || {})
         };
     }
    contextCheckboxes.forEach(checkbox => {
        const context = checkbox.dataset.context;
        const type = checkbox.dataset.type;
        if (effectiveContextStates[context] && effectiveContextStates[context].hasOwnProperty(type)) {
            checkbox.checked = effectiveContextStates[context][type];
        }
    });

    toggleSettingsAvailability(savedEnabled);

    log('Settings loaded:', data);
  });

  extensionEnabledEl.addEventListener('change', () => {
      toggleSettingsAvailability(extensionEnabledEl.checked);
  });

  wishlistWarningEl.addEventListener('input', () => {
    const currentValue = wishlistWarningEl.value;
    wishlistWarningValueEl.textContent = currentValue;
    updateSliderTrack(body.className, currentValue, wishlistWarningEl.min, wishlistWarningEl.max);
  });

  styleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedStyle = btn.dataset.style;
      if (!selectedStyle) return;
      body.className = selectedStyle;
      wishlistStyleEl.value = selectedStyle;
      updateSliderTrack(selectedStyle, wishlistWarningEl.value, wishlistWarningEl.min, wishlistWarningEl.max);
      styleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  saveBtn.addEventListener('click', () => {
    const isEnabled = extensionEnabledEl.checked;
    const wishlistWarning = Number(wishlistWarningEl.value);
    const mineHitCount = Number(mineHitCountEl.value);

    if (isNaN(wishlistWarning) || wishlistWarning < 0) {
      alert('Порог желающих должен быть неотрицательным числом.');
      return;
    }
    if (isNaN(mineHitCount) || mineHitCount < 1) {
        alert('Количество ударов шахты должно быть числом больше нуля.');
        return;
    }
    if (mineHitCount > 1000) {
        alert('Установлено слишком большое количество ударов (макс. 1000).');
        return;
    }

    const saveIcon = document.getElementById('saveIcon');
    const saveText = document.getElementById('saveText');
    const originalIconClass = 'fas fa-save';
    const originalText = 'Сохранить';
    const successIconClass = 'fas fa-check';
    const successText = 'Сохранено!';

    saveBtn.disabled = true;
    saveSpinner.style.display = 'inline-block';
    saveIcon.style.display = 'none';
    saveText.textContent = 'Сохранение...';

    const settingsToSave = {
      extensionEnabled: isEnabled,
      wishlistStyle: wishlistStyleEl.value,
      wishlistWarning: wishlistWarning,
      alwaysShowWishlist: alwaysShowWishlistEl.checked,
      alwaysShowOwners: alwaysShowOwnersEl.checked,
      mineHitCount: mineHitCount
    };

    const userContextStates = {};
    contextCheckboxes.forEach(checkbox => {
        const context = checkbox.dataset.context;
        const type = checkbox.dataset.type;
        if (!userContextStates[context]) {
            userContextStates[context] = {};
        }
        if (initialContextState[context]?.hasOwnProperty(type)) {
             userContextStates[context][type] = checkbox.checked;
        }
    });
    settingsToSave.userContextStates = userContextStates;

    chrome.storage.sync.set(settingsToSave, () => {
        saveSpinner.style.display = 'none';
        saveIcon.style.display = 'inline-block';

        if (chrome.runtime.lastError) {
            logError('Error saving settings:', chrome.runtime.lastError);
            alert('Ошибка сохранения настроек: ' + chrome.runtime.lastError.message);
            saveBtn.disabled = false;
            saveIcon.className = originalIconClass;
            saveText.textContent = originalText;
            return;
        }

        log('Settings saved successfully:', settingsToSave);

        saveBtn.classList.add('saved');
        saveIcon.className = successIconClass;
        saveText.textContent = successText;

        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.classList.remove('saved');
            saveIcon.className = originalIconClass;
            saveText.textContent = originalText;
        }, 2000);

        savedMessageEl.classList.add('show');
        setTimeout(() => savedMessageEl.classList.remove('show'), 2000);
    });
  });

  clearCacheBtn.addEventListener('click', () => {
    if (!chrome.runtime || !chrome.runtime.id) { alert('Ошибка: расширение недоступно.'); return; }
    clearCacheBtn.disabled = true;
    clearCacheSpinner.style.display = 'inline-block';
    try {
      chrome.runtime.sendMessage({ action: 'clearWishlistCache' }, response => {
        clearCacheBtn.disabled = false;
        clearCacheSpinner.style.display = 'none';
         if (chrome.runtime.lastError) {
             logError('Error receiving response from clearWishlistCache:', chrome.runtime.lastError);
             alert('Ошибка при получении ответа от фонового скрипта: ' + chrome.runtime.lastError.message);
         } else if (response?.status === 'success' || response?.status === 'cache_cleared_on_page') {
             log('Cache clear confirmed by background/page.');
             alert('Кэш очищен!');
         } else {
             logWarn('Failed to clear cache or no confirmation received:', response);
             alert('Ошибка при очистке кэша: ' + (response?.error || response?.status || 'Нет ответа или неизвестная ошибка'));
         }
      });
    } catch (error) {
      clearCacheBtn.disabled = false;
      clearCacheSpinner.style.display = 'none';
      logError('Error sending clearWishlistCache message:', error);
      alert('Ошибка при отправке сообщения: ' + error.message);
    }
  });

  exportCacheBtn.addEventListener('click', async () => {
    try {
      const cache = await chrome.storage.local.get(null);
      const dataStr = JSON.stringify(cache, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      chrome.downloads.download({
        url: url,
        filename: 'card_cache.json',
        saveAs: true
      });
      alert('Кэш экспортирован в card_cache.json');
    } catch (error) {
      logError('Error exporting cache:', error);
      alert('Ошибка при экспорте кэша: ' + error.message);
    }
  });

  importCacheBtn.addEventListener('click', () => {
    importCacheInput.click();
  });

  importCacheInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const cache = JSON.parse(text);
      await chrome.storage.local.set(cache);
      alert('Кэш импортирован успешно!');
    } catch (error) {
      logError('Error importing cache:', error);
      alert('Ошибка при импорте кэша: ' + error.message);
    }
  });
});