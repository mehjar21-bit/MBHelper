const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');

const ACCOUNTS_FILE = path.join(__dirname, 'scraper-accounts.json');

if (!fs.existsSync(ACCOUNTS_FILE)) {
  console.error('Accounts file not found:', ACCOUNTS_FILE);
  process.exit(1);
}

let accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise(resolve => rl.question(q, resolve));

function parseProxyUrl(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    let u = new URL(proxyUrl);
    return {
      protocol: u.protocol.replace(':',''),
      host: u.hostname,
      port: u.port,
      username: u.username || null,
      password: u.password || null,
      url: proxyUrl
    };
  } catch (e) {
    return null;
  }
}

async function setupAccountFlow(account) {
  console.log('\n=== Setup for', account.name, '===');
  const proxy = parseProxyUrl(account.proxy);

  const launchArgs = ['--no-sandbox'];
  if (proxy) {
    if (proxy.protocol && proxy.protocol.startsWith('socks')) {
      launchArgs.push(`--proxy-server=socks5://${proxy.host}:${proxy.port}`);
      if (proxy.username) console.log('Note: SOCKS5 auth is not supported directly by Chromium; auth may fail.');
    } else {
      launchArgs.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
    }
    console.log('Using proxy:', proxy.url);
  } else {
    console.log('No proxy for this account');
  }

  const browser = await puppeteer.launch({ headless: false, args: launchArgs });
  const page = await browser.newPage();

  if (proxy && proxy.username && proxy.password && !(proxy.protocol && proxy.protocol.startsWith('socks'))) {
    try {
      await page.authenticate({ username: proxy.username, password: proxy.password });
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const newPage = await target.page();
          if (newPage) await newPage.authenticate({ username: proxy.username, password: proxy.password });
        }
      });
    } catch (e) {
      console.warn('Could not set proxy auth on page:', e.message);
    }
  }

  // Quick browser IP check
  if (proxy) {
    try {
      const ipPage = await browser.newPage();
      await ipPage.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 15000 });
      const ipText = await ipPage.evaluate(() => document.body.textContent);
      const ip = JSON.parse(ipText).ip;
      console.log('Browser public IP:', ip);
      await ipPage.close();
    } catch (e) {
      console.warn('Proxy IP check failed:', e.message);
    }
  }

  await page.goto('https://mangabuff.ru/login', { waitUntil: 'networkidle2' });
  console.log('Login page opened for', account.name);
  console.log('Please login in the opened browser window for this account.');
  await question('Press Enter when you have completed login for this account...');

  const cookies = await page.cookies();
  let csrf = null;
  try {
    csrf = await page.$eval('meta[name="csrf-token"]', el => el.content);
  } catch (e) {
    // ignore
  }

  account.cookies = cookies;
  account.csrf = csrf;
  account.enabled = true;
  account.createdAt = new Date().toISOString();

  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  console.log('Saved cookies for', account.name);

  await browser.close();
}

(async () => {
  for (const acc of accounts) {
    // Skip accounts that already have cookies
    if (acc.cookies && acc.cookies.length > 0) {
      console.log('Skipping', acc.name, '- already has cookies');
      continue;
    }
    await setupAccountFlow(acc);
  }

  console.log('\nAll accounts processed.');
  rl.close();
})();