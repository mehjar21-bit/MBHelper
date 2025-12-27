import { isExtensionContextValid, log, logError } from './utils.js';

const defaultSettings = {
  extensionEnabled: true,
  wishlistWarning: 10,
  wishlistStyle: 'style-1',
  alwaysShowWishlist: false,
  alwaysShowOwners: false,
  mineHitCount: 100
};

export const getSettings = async () => {
  if (!isExtensionContextValid()) {
    return Promise.resolve({ ...defaultSettings });
  }
  try {
    const settings = await chrome.storage.sync.get(Object.keys(defaultSettings));
    const mergedSettings = { ...defaultSettings, ...settings };
    return mergedSettings;
  } catch (error) {
    logError('Failed to load settings from storage:', error);
    return { ...defaultSettings };
  }
};