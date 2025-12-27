import { LOG_PREFIX } from './config.js';

export const cachedElements = new Map();

export const log = (message, ...args) => console.log(`${LOG_PREFIX} ${message}`, ...args);
export const logWarn = (message, ...args) => console.warn(`${LOG_PREFIX} ${message}`, ...args);
export const logError = (message, ...args) => console.error(`${LOG_PREFIX} ${message}`, ...args);

export const isExtensionContextValid = () => {
  try {
    return !!chrome.runtime.id;
  } catch (e) {
    logError(`Extension context invalidated:`, e);
    return false;
  }
};

export const getElements = (selector) => {
    const dynamicSelectors = [
        '.trade__inventory-item',
        '.card-filter-list__card',
        '.trade__main-item',
        '.lootbox__card', 
        '.deck__item'
    ];
    if (!cachedElements.has(selector) || dynamicSelectors.includes(selector)) {
        const elements = Array.from(document.querySelectorAll(selector));
        cachedElements.set(selector, elements);
    }
    return cachedElements.get(selector) || []; 
};

export const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

export const waitForElements = (selector, timeout, single = false) => {
  return new Promise(resolve => {
    let intervalId;
    const timerId = setTimeout(() => {
      clearInterval(intervalId);
      logWarn(`Timeout waiting for ${selector}`);
      resolve(single ? null : []);
    }, timeout);

    intervalId = setInterval(() => {
      const elements = single ? document.querySelector(selector) : Array.from(document.querySelectorAll(selector));
      if ((single && elements) || (!single && elements.length > 0)) {
        clearInterval(intervalId);
        clearTimeout(timerId);
        log(`Found ${single ? 'element' : elements.length + ' elements'} for ${selector}`);
        resolve(elements);
      }
    }, 100);
  });
};