export const BASE_URL = 'https://mangabuff.ru';
export const SYNC_SERVER_URL = 'https://mbhelper-production.up.railway.app'; // Production Railway
export const LOG_PREFIX = '[MangaBuffExt]';
export const MAX_CONCURRENT_REQUESTS = 5; 

export const initialContextState = {
  userCards: { wishlist: false },
  trade: { wishlist: true, owners: true },
  tradeOffer: { wishlist: false, owners: false },
  remelt: { wishlist: false, owners: false },
  market: { wishlist: false, owners: false },
  split: { wishlist: false, owners: false },
  pack: { wishlist: true, owners: false },
  deckCreate: { wishlist: false, owners: false },
  marketCreate: { wishlist: false, owners: false },
  marketRequestCreate: { wishlist: false, owners: false },
  marketRequestView: { wishlist: true, owners: false }, 
  deckView: { wishlist: false, owners: false },
  auctions: { wishlist: false, owners: false }
};

export const contextsSelectors = {
  userCards: '.manga-cards__item[data-card-id]',
  trade: '.trade__main-item',
  tradeOffer: '.trade__inventory-item',
  remelt: '.card-filter-list__card',
  pack: '.lootbox__card[data-id]',
  market: '.card-filter-list__card',
  split: '.card-filter-list__card',
  deckCreate: '.card-filter-list__card',
  marketCreate: '.card-filter-list__card',
  marketRequestCreate: '.card-filter-list__card[data-card-id]',
  marketRequestView: '.card-pool__item[data-id]', 
  deckView: '.deck__item',
  auctions: '.card-filter-list__card',
};

export const getCurrentContext = () => {
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search); 

  const contextsMap = {
    '/users/\\d+/cards': 'userCards',
    '/trades/\\d+': 'trade',
    '/trades/offers/\\d+': 'tradeOffer',
    '/cards/pack': 'pack',
    '/cards/remelt': 'remelt',
    '/market/\\d+': 'market', 
    '/cards/split': 'split',
    '/market/create': 'marketCreate',
    '/decks/create': 'deckCreate',
    '/decks/\\d+': 'deckView',
    '/auctions': 'auctions',
    '/auctions/\\d+': 'auctions',
    '/market/requests/create': 'marketRequestCreate',
    '/market/requests/\\d+': 'marketRequestView' 
  };
  for (const [pattern, context] of Object.entries(contextsMap)) {
    const regex = new RegExp(`^${pattern}$`);
    if (context === 'marketRequestCreate' && path === '/market/requests/create') {
      console.log(`${LOG_PREFIX} Detected context: ${context}`);
      return context;
    } else if (regex.test(path)) {
      console.log(`${LOG_PREFIX} Detected context: ${context}`);
      return context;
    }
  }
  console.log(`${LOG_PREFIX} No context detected for path: ${path}`);
  return null;
};