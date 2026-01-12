/**
 * MangaBuff Scraper v2.0
 * Поддержка множества прокси и аккаунтов
 * Запись в Supabase через REST API
 * 
 * Использование:
 *   node scraper-v2.js                    # Обычный запуск
 *   node scraper-v2.js --setup            # Настройка аккаунтов (логин)
 *   node scraper-v2.js --workers=3        # Запуск с 3 воркерами
 *   node scraper-v2.js --from=1000        # Начать с карты 1000
 *   node scraper-v2.js --to=5000          # Закончить на карте 5000
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const axios = require('axios');

// ==================== КОНФИГУРАЦИЯ ====================

const CONFIG_FILE = 'scraper-config.json';
const PROGRESS_FILE = 'scraper_progress.json';
const ACCOUNTS_FILE = 'scraper-accounts.json';

let config = {
  supabase: {
    url: 'https://mgusmnddeiutqjpmdqfk.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndXNtbmRkZWl1dHFqcG1kcWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDY1MjQsImV4cCI6MjA4MjM4MjUyNH0.kVqc7_aV0g4s9Begc2hq1_sQyINuSvUJEK3VCg1S5KA'
  },
  scraping: {
    maxCardId: 332550,
    batchSize: 100,
    delayMin: 100,
    delayMax: 500,
    saveProgressEvery: 10,
    retryAttempts: 3,
    timeout: 30000
  },
  proxies: [],
  workers: {
    count: 1,
    cardsPerWorker: 1000
  }
};

let accounts = [];

// ==================== УТИЛИТЫ ====================

const log = (workerId, msg, ...args) => {
  const prefix = workerId !== null ? `[Worker ${workerId}]` : '[Main]';
  console.log(`${new Date().toISOString()} ${prefix} ${msg}`, ...args);
};

const logError = (workerId, msg, ...args) => {
  const prefix = workerId !== null ? `[Worker ${workerId}]` : '[Main]';
  console.error(`${new Date().toISOString()} ${prefix} ERROR: ${msg}`, ...args);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const randomDelay = () => {
  const { delayMin, delayMax } = config.scraping;
  return delayMin + Math.random() * (delayMax - delayMin);
};

// Загрузка конфигурации
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...loaded };
    log(null, 'Config loaded from', CONFIG_FILE);
  } else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    log(null, 'Default config created:', CONFIG_FILE);
  }
}

// Загрузка аккаунтов
function loadAccounts() {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    log(null, `Loaded ${accounts.length} account(s)`);
  }
}

// Сохранение аккаунтов
function saveAccounts() {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  log(null, 'Accounts saved to', ACCOUNTS_FILE);
}

// Получение прокси для воркера (round-robin)
function getProxyForWorker(workerId) {
  const enabledProxies = config.proxies.filter(p => p.enabled);
  if (enabledProxies.length === 0) return null;
  return enabledProxies[workerId % enabledProxies.length];
}

// Получение аккаунта для воркера (round-robin)
function getAccountForWorker(workerId) {
  const enabledAccounts = accounts.filter(a => a.enabled && a.cookies);
  if (enabledAccounts.length === 0) return null;
  return enabledAccounts[workerId % enabledAccounts.length];
}

// ==================== ПАРСИНГ ====================

function getLastPageNumber(doc) {
  const paginationButtons = doc.querySelectorAll('ul.pagination li.pagination__button a[href*="page="]');
  let maxPage = 1;
  paginationButtons.forEach(link => {
    const url = link.getAttribute('href');
    const match = url.match(/page=(\d+)/);
    if (match && match[1]) {
      const pageNum = parseInt(match[1], 10);
      if (!isNaN(pageNum) && pageNum > maxPage) {
        maxPage = pageNum;
      }
    }
  });
  return maxPage;
}

function countItemsOnPage(doc, type) {
  const selector = type === 'wishlist' ? '.profile__friends-item' : '.card-show__owner';
  return doc.querySelectorAll(selector).length;
}

async function getCount(page, cardId, type, workerId) {
  const baseUrl = type === 'owners' 
    ? `https://mangabuff.ru/cards/${cardId}/users` 
    : `https://mangabuff.ru/cards/${cardId}/offers/want`;
  
  const { timeout, retryAttempts } = config.scraping;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      await page.goto(`${baseUrl}?page=1`, { waitUntil: 'networkidle2', timeout });
      const content = await page.content();
      const doc = new JSDOM(content).window.document;
      
      // Проверяем, не заблокированы ли мы
      if (content.includes('Too Many Requests') || content.includes('429')) {
        log(workerId, `Rate limited on card ${cardId}, waiting 30s...`);
        await sleep(30000);
        continue;
      }
      
      const countPerPage = countItemsOnPage(doc, type);
      const lastPageNum = getLastPageNumber(doc);
      
      if (lastPageNum <= 1) {
        return countPerPage;
      }
      
      // Загружаем последнюю страницу
      await page.goto(`${baseUrl}?page=${lastPageNum}`, { waitUntil: 'networkidle2', timeout });
      const lastContent = await page.content();
      const lastDoc = new JSDOM(lastContent).window.document;
      const countOnLastPage = countItemsOnPage(lastDoc, type);
      
      return (countPerPage * (lastPageNum - 1)) + countOnLastPage;
    } catch (error) {
      if (attempt < retryAttempts) {
        log(workerId, `Retry ${attempt}/${retryAttempts} for ${type} card ${cardId}: ${error.message}`);
        await sleep(2000 * attempt);
      } else {
        logError(workerId, `Failed ${type} for card ${cardId} after ${retryAttempts} attempts`);
        return -1; // Ошибка
      }
    }
  }
  return -1;
}

// ==================== ЗАПИСЬ В SUPABASE (REST API) ====================

async function testSupabaseConnection() {
  try {
    const response = await axios.get(
      `${config.supabase.url}/rest/v1/cache_entries?select=key&limit=1`,
      {
        headers: {
          'apikey': config.supabase.key,
          'Authorization': `Bearer ${config.supabase.key}`
        },
        timeout: 10000
      }
    );
    log(null, `✔ Supabase connected`);
    return true;
  } catch (error) {
    logError(null, 'Supabase connection failed:', error.message);
    return false;
  }
}

async function pushToDatabase(entries, workerId) {
  try {
    log(workerId, `Saving ${entries.length} entries to Supabase...`);
    
    // Upsert через REST API
    const response = await axios.post(
      `${config.supabase.url}/rest/v1/cache_entries`,
      entries.map(e => ({
        key: e.key,
        count: e.count,
        timestamp: e.timestamp
      })),
      {
        headers: {
          'apikey': config.supabase.key,
          'Authorization': `Bearer ${config.supabase.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'  // Upsert
        },
        timeout: 30000
      }
    );
    
    log(workerId, `✔ Saved ${entries.length} entries`);
    return true;
  } catch (error) {
    logError(workerId, 'Error saving to Supabase:', error.response?.data || error.message);
    return false;
  }
}

// ==================== ВОРКЕР ====================

async function runWorker(workerId, startId, endId) {
  log(workerId, `Starting: cards ${startId} to ${endId}`);
  
  const account = getAccountForWorker(workerId);
  const proxy = getProxyForWorker(workerId);
  
  if (!account) {
    logError(workerId, 'No account available! Run with --setup first.');
    return;
  }
  
  // Настройки браузера
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  
  if (proxy) {
    launchOptions.args.push(`--proxy-server=${proxy.url}`);
    log(workerId, `Using proxy: ${proxy.url.replace(/:[^:@]+@/, ':***@')}`);
  }
  
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  // Устанавливаем cookies
  await page.setCookie(...account.cookies);
  log(workerId, `Using account: ${account.name}`);
  
  // Прогресс воркера
  const progressKey = `worker_${workerId}`;
  let progress = {};
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  
  let currentId = progress[progressKey]?.lastId || startId;
  let batchBuffer = [];
  let processedCount = 0;
  let errorCount = 0;
  
  for (let id = currentId; id <= endId; id++) {
    try {
      const owners = await getCount(page, id, 'owners', workerId);
      const wishlist = await getCount(page, id, 'wishlist', workerId);
      const timestamp = Date.now();
      
      if (owners >= 0 && wishlist >= 0) {
        batchBuffer.push(
          { key: `owners_${id}`, count: owners, timestamp },
          { key: `wishlist_${id}`, count: wishlist, timestamp }
        );
        processedCount++;
        log(workerId, `Card ${id}: owners=${owners}, wishlist=${wishlist}`);
      } else {
        errorCount++;
      }
    } catch (error) {
      logError(workerId, `Error for card ${id}:`, error.message);
      errorCount++;
    }

    // Отправляем батч
    if (batchBuffer.length >= config.scraping.batchSize) {
      await pushToDatabase(batchBuffer, workerId);
      batchBuffer = [];
    }

    // Сохраняем прогресс
    if (id % config.scraping.saveProgressEvery === 0) {
      progress[progressKey] = { lastId: id, processedCount, errorCount };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    }

    await sleep(randomDelay());
  }

  // Отправляем остаток
  if (batchBuffer.length > 0) {
    await pushToDatabase(batchBuffer, workerId);
  }

  log(workerId, `Completed: processed=${processedCount}, errors=${errorCount}`);
  await browser.close();
}

// ==================== НАСТРОЙКА АККАУНТОВ ====================

async function setupAccounts() {
  log(null, '=== Account Setup Mode ===');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const question = (q) => new Promise(resolve => rl.question(q, resolve));
  
  const accountName = await question('Enter account name (e.g., account1): ');
  const useProxy = await question('Use proxy? (y/n): ');
  
  let proxyUrl = null;
  if (useProxy.toLowerCase() === 'y') {
    proxyUrl = await question('Enter proxy URL (http://user:pass@host:port): ');
  }
  
  const launchOptions = {
    headless: false,
    args: ['--no-sandbox']
  };
  
  if (proxyUrl) {
    launchOptions.args.push(`--proxy-server=${proxyUrl}`);
  }
  
  log(null, 'Launching browser for login...');
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  await page.goto('https://mangabuff.ru/login');
  
  log(null, '');
  log(null, '===========================================');
  log(null, 'Please login manually in the browser.');
  log(null, 'After login, press Enter in this terminal.');
  log(null, '===========================================');
  log(null, '');
  
  await question('Press Enter after login...');
  
  // Сохраняем cookies и CSRF
  const cookies = await page.cookies();
  let csrf = null;
  try {
    csrf = await page.$eval('meta[name="csrf-token"]', el => el.content);
  } catch (e) {
    log(null, 'Could not get CSRF token (not critical)');
  }
  
  const newAccount = {
    name: accountName,
    cookies: cookies,
    csrf: csrf,
    proxy: proxyUrl,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  
  // Добавляем или обновляем аккаунт
  const existingIndex = accounts.findIndex(a => a.name === accountName);
  if (existingIndex >= 0) {
    accounts[existingIndex] = newAccount;
    log(null, `Account "${accountName}" updated.`);
  } else {
    accounts.push(newAccount);
    log(null, `Account "${accountName}" added.`);
  }
  
  saveAccounts();
  
  await browser.close();
  rl.close();
  
  log(null, 'Setup complete! You can now run the scraper.');
}

// ==================== ГЛАВНАЯ ФУНКЦИЯ ====================

async function main() {
  const args = process.argv.slice(2);
  
  loadConfig();
  loadAccounts();
  
  // Режим настройки (не требует БД)
  if (args.includes('--setup')) {
    await setupAccounts();
    return;
  }
  
  // Показать статус (не требует БД)
  if (args.includes('--status')) {
    log(null, '=== Scraper Status ===');
    log(null, `Accounts: ${accounts.filter(a => a.enabled && a.cookies).length} active`);
    log(null, `Proxies: ${config.proxies.filter(p => p.enabled).length} active`);
    
    if (fs.existsSync(PROGRESS_FILE)) {
      const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      log(null, 'Progress:', progress);
    }
    return;
  }
  
  // Парсим аргументы
  let workerCount = config.workers.count;
  let fromId = 1;
  let toId = config.scraping.maxCardId;
  
  for (const arg of args) {
    if (arg.startsWith('--workers=')) {
      workerCount = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--from=')) {
      fromId = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--to=')) {
      toId = parseInt(arg.split('=')[1], 10);
    }
  }
  
  const enabledAccounts = accounts.filter(a => a.enabled && a.cookies);
  if (enabledAccounts.length === 0) {
    logError(null, 'No accounts configured! Run: node scraper-v2.js --setup');
    return;
  }
  
  // Проверяем подключение к Supabase
  const connected = await testSupabaseConnection();
  if (!connected) {
    logError(null, 'Cannot start without Supabase connection');
    return;
  }
  
  // Ограничиваем воркеры количеством аккаунтов
  workerCount = Math.min(workerCount, enabledAccounts.length);
  
  log(null, '=== Starting Scraper ===');
  log(null, `Cards: ${fromId} to ${toId}`);
  log(null, `Database: Supabase REST API`);  
  log(null, `Workers: ${workerCount}`);
  log(null, `Accounts: ${enabledAccounts.length}`);
  log(null, `Proxies: ${config.proxies.filter(p => p.enabled).length}`);
  log(null, '');
  
  // Распределяем карты по воркерам
  const totalCards = toId - fromId + 1;
  const cardsPerWorker = Math.ceil(totalCards / workerCount);
  
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const start = fromId + (i * cardsPerWorker);
    const end = Math.min(start + cardsPerWorker - 1, toId);
    
    if (start <= toId) {
      workers.push(runWorker(i, start, end));
    }
  }
  
  await Promise.all(workers);
  
  log(null, '=== All workers completed ===');
}

main().catch(err => {
  logError(null, 'Fatal error:', err);
  process.exit(1);
});
