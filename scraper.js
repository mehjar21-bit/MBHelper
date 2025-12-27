const puppeteer = require('puppeteer');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY = 'http://Kv9UeH:wL2xbe@147.45.81.14:8000';
const SYNC_SERVER_URL = 'https://mbhelper-production.up.railway.app';
const BATCH_SIZE = 100; // Отправляем по 100 записей за раз

const MAX_ID = 328320;
const PROGRESS_FILE = 'scraper_progress.json';
const OUTPUT_FILE = 'all_cards_config.json';

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

async function getCount(page, cardId, type) {
    const baseUrl = type === 'owners' ? `https://mangabuff.ru/cards/${cardId}/users` : `https://mangabuff.ru/cards/${cardId}/offers/want`;
    const url = `${baseUrl}?page=1`;
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const content = await page.content();
        const doc = new JSDOM(content).window.document;
        const countPerPage = countItemsOnPage(doc, type);
        const lastPageNum = getLastPageNumber(doc);
        if (lastPageNum <= 1) {
            return countPerPage;
        }
        // Fetch last page
        const lastUrl = `${baseUrl}?page=${lastPageNum}`;
        await page.goto(lastUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        const lastContent = await page.content();
        const lastDoc = new JSDOM(lastContent).window.document;
        const countOnLastPage = countItemsOnPage(lastDoc, type);
        return (countPerPage * (lastPageNum - 1)) + countOnLastPage;
    } catch (error) {
        console.warn(`Failed to fetch ${type} for card ${cardId}: ${error.message}`);
        return 0;
    }
}

// Функция для отправки данных на сервер батчами
async function pushToServer(entries) {
    try {
        console.log(`→ Pushing ${entries.length} entries to server...`);
        const response = await axios.post(`${SYNC_SERVER_URL}/sync/push`, {
            entries: entries
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        if (response.status >= 200 && response.status < 300) {
            const result = response.data;
            console.log(`✔ Push OK: updated=${result.processed || 0}, skipped=${result.skipped || 0}`);
            return true;
        } else {
            console.error(`✘ Push failed: ${response.status}`, response.data);
            return false;
        }
    } catch (error) {
        console.error('✘ Error pushing to server:', error.message);
        return false;
    }
}

async function scrape() {
    let data = {};
    let startId = 1;

    // Load progress
    if (fs.existsSync(PROGRESS_FILE)) {
        data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
        const cardIds = Object.keys(data)
            .filter(key => key.startsWith('owners_'))
            .map(key => parseInt(key.split('_')[1], 10));
        if (cardIds.length > 0) {
            startId = Math.max(...cardIds) + 1;
        }
        console.log(`Resuming from card ${startId}`);
    }

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://mangabuff.ru/login');
    console.log('Please login manually and press Enter in the terminal.');
    await new Promise(resolve => {
        process.stdin.once('data', resolve);
    });

    const cookies = await page.cookies();
    const csrf = await page.$eval('meta[name="csrf-token"]', el => el.content);

    let batchBuffer = []; // Буфер для батчевой отправки

    for (let id = startId; id <= MAX_ID; id++) {
        try {
            console.log(`Processing card ${id}...`);
            const owners = await getCount(page, id, 'owners');
            const wishlist = await getCount(page, id, 'wishlist');
            const timestamp = Date.now();
            
            data[`owners_${id}`] = { count: owners, timestamp };
            data[`wishlist_${id}`] = { count: wishlist, timestamp };
            
            // Добавляем в батч для отправки
            batchBuffer.push(
                { key: `owners_${id}`, count: owners, timestamp },
                { key: `wishlist_${id}`, count: wishlist, timestamp }
            );
            
            console.log(`Card ${id}: owners=${owners}, wishlist=${wishlist}`);
        } catch (error) {
            console.error(`Error for card ${id}:`, error);
            const timestamp = Date.now();
            data[`owners_${id}`] = { count: 0, timestamp };
            data[`wishlist_${id}`] = { count: 0, timestamp };
            
            batchBuffer.push(
                { key: `owners_${id}`, count: 0, timestamp },
                { key: `wishlist_${id}`, count: 0, timestamp }
            );
        }

        // Отправляем батч на сервер если набралось достаточно данных
        if (batchBuffer.length >= BATCH_SIZE) {
            await pushToServer(batchBuffer);
            batchBuffer = [];
        }

        // Сохраняем прогресс локально каждые 10 карт
        if (id % 10 === 0) {
            fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
            console.log(`Progress saved at card ${id}`);
        }

        // Задержка для избежания rate limit
        await new Promise(r => setTimeout(r, 50 + Math.random() * 500));
    }

    // Отправляем оставшиеся данные
    if (batchBuffer.length > 0) {
        console.log('Pushing remaining entries...');
        await pushToServer(batchBuffer);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log('Scraping complete. Data saved to', OUTPUT_FILE);
    await browser.close();
}

scrape().catch(console.error);