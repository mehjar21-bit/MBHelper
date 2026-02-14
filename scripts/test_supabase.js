#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('URL=', url);
console.log('KEY_HEAD=', key ? key.slice(0, 10) + '…' : '<missing>');

if (!url || !key) {
  console.error('ERR Missing URL or key in environment');
  process.exit(2);
}

axios.get(url + '/rest/v1/cache_entries?select=key&limit=1', {
  headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
})
  .then(r => {
    console.log('OK', r.status);
    console.log('BODY SAMPLE:', JSON.stringify(r.data).slice(0, 200));
    process.exit(0);
  })
  .catch(e => {
    console.error('ERR', e.response?.status, e.response?.data || e.message);
    process.exit(1);
  });
