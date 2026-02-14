#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FAILED_FILE = path.join(__dirname, '..', 'failed_cards.json');
const MAX_ATTEMPTS = 5;

function loadFailed() {
  try {
    if (fs.existsSync(FAILED_FILE)) return JSON.parse(fs.readFileSync(FAILED_FILE, 'utf8') || '{}');
  } catch (e) { }
  return {};
}

function saveFailed(obj) {
  fs.writeFileSync(FAILED_FILE + '.tmp', JSON.stringify(obj, null, 2));
  fs.renameSync(FAILED_FILE + '.tmp', FAILED_FILE);
}

(async function main(){
  const failed = loadFailed();
  const ids = Object.keys(failed).map(k => ({ id: k, attempts: failed[k].attempts || 0 }));
  if (ids.length === 0) {
    console.log('No failed cards to retry.');
    process.exit(0);
  }

  for (const it of ids) {
    const id = it.id;
    const attempts = it.attempts;
    if (attempts >= MAX_ATTEMPTS) {
      console.log(`Skipping ${id} (attempts=${attempts} >= ${MAX_ATTEMPTS})`);
      continue;
    }

    console.log(`Retrying card ${id} (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
    // Run scraper for this single id
    const res = spawnSync('node', ['scraper-v2.js', `--workers=1`, `--from=${id}`, `--to=${id}`, '--headless'], { stdio: 'inherit' });

    if (res.status === 0) {
      console.log(`Success for ${id} — removing from failed list`);
      delete failed[id];
      saveFailed(failed);
    } else {
      console.log(`Failed for ${id} (exit ${res.status}). Incrementing attempts.`);
      failed[id] = failed[id] || {};
      failed[id].attempts = (failed[id].attempts || 0) + 1;
      failed[id].lastTry = new Date().toISOString();
      failed[id].lastError = `Retry exit ${res.status}`;
      saveFailed(failed);
    }
  }
})();