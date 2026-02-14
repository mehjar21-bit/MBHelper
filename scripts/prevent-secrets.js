#!/usr/bin/env node
// Simple pre-commit scanner for staged files to prevent committing secrets
const { execSync } = require('child_process');
const fs = require('fs');

const patterns = [
  /SUPABASE_KEY/i,
  /SUPABASE_ANON_KEY/i,
  /SUPABASE_SERVICE_ROLE/i,
  /DATABASE_URL/i,
  /postgresql:\/\//i,
  /-----BEGIN PRIVATE KEY-----/i
];

try {
  const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  if (staged.length === 0) process.exit(0);

  let found = false;
  staged.forEach(file => {
    try {
      const content = fs.readFileSync(file, 'utf8');

      // Skip example files and templates
      if (file.toLowerCase().endsWith('.example') || file.toLowerCase().includes('.example.')) return;

      patterns.forEach(p => {
        if (!p.test(content)) return;

        // Only flag if looks like an assignment or contains an actual secret-like token (JWT or long string)
        const looksLikeAssignment = new RegExp(p.source + "\\s*=", 'i').test(content);
        const looksLikeQuotedSecret = /['\"][A-Za-z0-9-_]{20,}['\"]/i.test(content);
        const looksLikeJWT = /[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/.test(content);

        if (looksLikeAssignment || looksLikeQuotedSecret || looksLikeJWT) {
          console.error(`Potential secret found in ${file}: matches ${p}`);
          found = true;
        }
      });
    } catch (e) {
      // ignore binary files or unreadable
    }
  });

  if (found) {
    console.error('\nCommit rejected: secrets detected in staged files. Remove them or add to .gitignore before committing.');
    process.exit(1);
  }
  process.exit(0);
} catch (e) {
  // If git command fails, do not block commit
  console.error('Secret scanner failed:', e.message);
  process.exit(0);
}
