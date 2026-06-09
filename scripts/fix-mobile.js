#!/usr/bin/env node
/**
 * Adds responsive mobile CSS to all existing article HTML files.
 * Fixes:
 *  - Nav overflows viewport on mobile (wordmark + CTA > 390px)
 *  - Horizontal scrolling caused by nav / SVGs / tables
 * Idempotent. Run: node scripts/fix-mobile.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, '..', 'blog');

const MOBILE_CSS = `
/* ── Mobile fixes ── */
html,body{max-width:100%;overflow-x:hidden}
svg{max-width:100%!important;height:auto!important}
figure{max-width:100%;overflow:hidden}
@media(max-width:640px){
  nav{padding:0 16px!important;gap:8px!important}
  .nav-logo-img{max-height:36px!important}
  .nav-wordmark{display:none!important}
  .nav-back{white-space:nowrap;font-size:12px}
  .nav-cta{padding:9px 14px!important;font-size:13px!important}
  table{font-size:12.5px}
  td,th{padding:7px 8px!important}
  .article-wrap{padding-left:18px!important;padding-right:18px!important}
}`;

const files = fs.readdirSync(BLOG_DIR)
  .filter(f => f.endsWith('.html') && f !== 'index.html')
  .map(f => path.join(BLOG_DIR, f));

let n = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes('/* ── Mobile fixes')) continue; // already patched
  html = html.replace('</style>', MOBILE_CSS + '\n</style>');
  fs.writeFileSync(file, html, 'utf8');
  console.log('  patched', path.basename(file));
  n++;
}

console.log(`\nDone. ${n} files patched.`);
