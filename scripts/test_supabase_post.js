#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(2);
}

const now = Date.now();
const payload = [
  { key: `owners_test_${now}`, count: 1, timestamp: now },
  { key: `wishlist_test_${now}`, count: 2, timestamp: now }
];

console.log('POST payload sample:', payload[0]);

axios.post(url + '/rest/v1/cache_entries?on_conflict=key', payload, {
  headers: {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal'
  }
})
  .then(r => {
    console.log('POST OK', r.status, r.data);
    // Try to GET the inserted keys
    return axios.get(url + `/rest/v1/cache_entries?select=key,count,timestamp&key=eq.${payload[0].key}`, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
    });
  })
  .then(r => {
    console.log('GET after POST:', r.status, r.data);
    process.exit(0);
  })
  .catch(e => {
    console.error('ERR', e.response?.status, e.response?.data || e.message);
    process.exit(1);
  });
