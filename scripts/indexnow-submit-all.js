#!/usr/bin/env node
/**
 * Eenmalige (of periodieke) bulk-submit van alle URL's uit sitemap.xml naar IndexNow.
 * Handig om na activatie de volledige site in één keer aan te melden bij Bing/Yandex.
 *
 * Usage: node scripts/indexnow-submit-all.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const HOST = 'zenbtw.nl';
const INDEXNOW_KEY = '09e8be00428095e6561f7ca7137c8599';

function urlsFromSitemap() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
    .map(m => m[1].trim())
    .filter(u => u.includes(HOST));
}

async function main() {
  const urlList = urlsFromSitemap();
  if (!urlList.length) {
    console.error('Geen URL\'s in sitemap.xml gevonden');
    process.exit(1);
  }
  console.log(`IndexNow: ${urlList.length} URL's aanmelden voor ${HOST}...`);

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
  });
  console.log(`IndexNow: status ${res.status}`);
  if (res.status !== 200 && res.status !== 202) {
    console.log(await res.text());
    process.exit(1);
  }
  console.log('IndexNow: klaar ✅');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
