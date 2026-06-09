#!/usr/bin/env node
/**
 * Sets up and maintains category structure across all blog files.
 * - Adds / refreshes category filter bar on blog/index.html
 * - Adds data-cat to every card in blog/index.html
 * - Adds category breadcrumb link inside each article
 * - Adds "Meer over [category]" related-articles section to each article
 * Idempotent — safe to run after every new blog post.
 * Usage: node scripts/setup-categories.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, '..', 'blog');

// ── Category definitions ──────────────────────────────────────────────────────

const KNOWN = {
  'kor-vrijstelling-2026':           'kor',
  'kor-drempel-overschreden':        'kor',
  'kor-buitenland-verkopen':         'kor',
  'oss-registratie-belastingdienst': 'oss',
  'oss-aangifte-nederland':          'oss',
  'btw-tarief-eu-landen-2026':       'oss',
  'shopify-btw-nederland-2026':      'platforms',
  'shopify-dropshipping-btw':        'platforms',
  'etsy-btw-2026':                   'platforms',
  'etsy-verkoper-belastingaangifte': 'platforms',
  'vinted-belasting-2026':           'platforms',
  'vinted-ondernemer-btw-registratie': 'platforms',
  'hoeveel-btw-vinted-verkoper':     'platforms',
  'marketplace-verkoper-btw-aangifte': 'platforms',
  'dac7-belastingdienst-rapportage': 'dac7',
  'gratis-btw-tool-marketplace':     'tools',
  // future articles auto-detected below
};

const CAT_META = {
  kor:       { label: 'KOR',           tag: 'KOR' },
  oss:       { label: 'OSS & EU BTW',  tag: 'OSS & EU BTW' },
  platforms: { label: 'Marketplaces',  tag: null },   // keep platform-specific tag
  dac7:      { label: 'DAC7',          tag: 'DAC7' },
  tools:     { label: 'Tools',         tag: 'Tools' },
};

function detectCategory(slug) {
  if (/\bkor\b/.test(slug))                           return 'kor';
  if (/\boss\b|btw-tarief-eu|oss-aangifte/.test(slug)) return 'oss';
  if (/\bdac7\b/.test(slug))                          return 'dac7';
  if (/tool|calculator|alternatief|boekhoudtool/.test(slug)) return 'tools';
  return 'platforms';
}

function catOf(slug) {
  return KNOWN[slug] ?? detectCategory(slug);
}

// ── Read existing blogs ───────────────────────────────────────────────────────

function readBlogs() {
  const files = fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .map(f => f.replace('.html', ''));

  const blogs = files.map(slug => {
    const html = fs.readFileSync(path.join(BLOG_DIR, `${slug}.html`), 'utf8');
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]
      ?.replace(/<[^>]+>/g, '').trim() || slug;
    const tag = (html.match(/class="article-tag">([^<]+)</) || [])[1]?.trim() || '';
    return { slug, h1, tag, cat: catOf(slug) };
  });

  return blogs;
}

// ── CSS snippets ──────────────────────────────────────────────────────────────

const INDEX_CSS = `
/* ── Category filter ── */
.cat-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px}
.cat-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:30px;border:1.5px solid var(--br);background:var(--wh);color:var(--tx2);font-size:13px;font-weight:700;cursor:pointer;transition:all .16s;white-space:nowrap;font-family:inherit;letter-spacing:-.1px}
.cat-btn:hover{border-color:var(--acm);color:var(--acm);background:var(--acl)}
.cat-btn.active{background:var(--ac);border-color:var(--ac);color:#fff;box-shadow:0 4px 14px rgba(26,71,49,.28)}
.cat-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 5px;border-radius:9px;font-size:11px;font-weight:700}
.cat-btn.active .cat-count{background:rgba(255,255,255,.22);color:#fff}
.cat-btn:not(.active) .cat-count{background:var(--s2);color:var(--tx4)}
.card.cat-hidden{display:none}
.cat-empty{display:none;grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--tx3);font-size:15px}
.cat-empty.on{display:block}`;

const ARTICLE_CSS = `
/* ── Category related section ── */
.cat-related{background:var(--s2);border:1.5px solid var(--br);border-radius:12px;padding:22px 24px;margin:40px 0 0}
.cat-related-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.cat-related-lbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx4)}
.cat-related-all{font-size:13px;font-weight:600;color:var(--acm);text-decoration:none}
.cat-related-all:hover{text-decoration:underline}
.cat-related-links{display:flex;flex-direction:column;gap:6px}
.cat-related-link{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--wh);border:1px solid var(--br);border-radius:8px;text-decoration:none;color:var(--tx2);font-size:14px;font-weight:600;transition:all .15s;line-height:1.4}
.cat-related-link:hover{border-color:var(--acm);color:var(--ac);background:var(--acl)}
.cat-related-link span{color:var(--acm);font-size:13px;flex-shrink:0}`;

// ── blog/index.html ───────────────────────────────────────────────────────────

function updateBlogIndex(blogs) {
  const indexPath = path.join(BLOG_DIR, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  // ── 1. CSS (idempotent) ──────────────────────────────────────────────────
  if (!html.includes('/* ── Category filter')) {
    html = html.replace('</style>', INDEX_CSS + '\n</style>');
  }

  // ── 2. Cat-bar (rebuild each run so counts stay current) ─────────────────
  const counts = {};
  for (const b of blogs) {
    counts[b.cat] = (counts[b.cat] || 0) + 1;
  }
  const total = blogs.length;

  const catBar = `<div class="cat-bar">
  <button class="cat-btn active" data-filter="all">Alle <span class="cat-count">${total}</span></button>
  <button class="cat-btn" data-filter="kor">KOR <span class="cat-count">${counts.kor || 0}</span></button>
  <button class="cat-btn" data-filter="oss">OSS &amp; EU BTW <span class="cat-count">${counts.oss || 0}</span></button>
  <button class="cat-btn" data-filter="platforms">Marketplaces <span class="cat-count">${counts.platforms || 0}</span></button>
  <button class="cat-btn" data-filter="dac7">DAC7 <span class="cat-count">${counts.dac7 || 0}</span></button>
  <button class="cat-btn" data-filter="tools">Tools <span class="cat-count">${counts.tools || 0}</span></button>
</div>
<div class="cat-empty">Geen artikelen gevonden in deze categorie.</div>`;

  // Remove old cat-bar if it exists, then replace section-label
  html = html.replace(/<div class="cat-bar">[\s\S]*?<\/div>\s*<div class="cat-empty">.*?<\/div>/g, '');
  html = html.replace('<div class="section-label">Alle artikelen</div>', catBar);
  // If section-label was already gone, inject after the grid opens
  if (!html.includes('class="cat-bar"')) {
    html = html.replace('<div class="grid">', catBar + '\n  <div class="grid">');
  }

  // ── 3. data-cat on each card ──────────────────────────────────────────────
  for (const { slug, cat } of blogs) {
    // Remove existing data-cat (for idempotency), then add fresh
    html = html.replace(
      new RegExp(`(href="(?:/blog/)?${slug}(?:\\.html)?")(?:\\s+data-cat="[^"]*")?`, 'g'),
      `$1 data-cat="${cat}"`
    );
    // Fix leftover .html in hrefs
    html = html.replace(
      new RegExp(`href="${slug}\\.html"`, 'g'),
      `href="${slug}"`
    );
  }

  // ── 4. Filter JS (idempotent) ─────────────────────────────────────────────
  if (!html.includes('dataset.filter')) {
    const filterJs = `<script>
(function(){
  var btns=document.querySelectorAll('.cat-btn');
  var cards=document.querySelectorAll('.card[data-cat]');
  var empty=document.querySelector('.cat-empty');
  function run(f){
    btns.forEach(function(b){b.classList.toggle('active',b.dataset.filter===f);});
    var n=0;
    cards.forEach(function(c){var s=f==='all'||c.dataset.cat===f;c.classList.toggle('cat-hidden',!s);if(s)n++;});
    if(empty)empty.classList.toggle('on',n===0);
    history.replaceState(null,'',f==='all'?location.pathname:'#'+f);
  }
  btns.forEach(function(b){b.addEventListener('click',function(){run(b.dataset.filter);});});
  var h=location.hash.slice(1);
  if(h&&document.querySelector('[data-filter="'+h+'"]'))run(h);else run('all');
})();
</script>`;
    html = html.replace('</body>', filterJs + '\n</body>');
  }

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`  blog/index.html — filter bar updated (${total} articles, ${Object.keys(counts).length} categories)`);
}

// ── Article files ─────────────────────────────────────────────────────────────

function buildRelatedSection(currentSlug, blogs) {
  const cat = catOf(currentSlug);
  const meta = CAT_META[cat];
  const siblings = blogs.filter(b => b.cat === cat && b.slug !== currentSlug);
  if (siblings.length === 0) return '';

  const links = siblings.map(b =>
    `    <a href="/blog/${b.slug}" class="cat-related-link"><span>→</span> ${b.h1}</a>`
  ).join('\n');

  return `
<section class="cat-related">
  <div class="cat-related-hd">
    <span class="cat-related-lbl">Meer over ${meta.label}</span>
    <a href="/blog#${cat}" class="cat-related-all">Alle ${meta.label}-artikelen →</a>
  </div>
  <div class="cat-related-links">
${links}
  </div>
</section>`;
}

function updateArticle(slug, blogs) {
  const filePath = path.join(BLOG_DIR, `${slug}.html`);
  if (!fs.existsSync(filePath)) return false;
  let html = fs.readFileSync(filePath, 'utf8');

  const cat = catOf(slug);
  const meta = CAT_META[cat];
  let changed = false;

  // ── 1. CSS ────────────────────────────────────────────────────────────────
  if (!html.includes('/* ── Category related')) {
    html = html.replace('</style>', ARTICLE_CSS + '\n</style>');
    changed = true;
  }

  // ── 2. Breadcrumb: fix href and add category ──────────────────────────────
  // Normalise old relative href to absolute, then strip any stray whitespace
  html = html.replace(/href="\.\/"(\s+class="[^"]*")?\s*>(Blog)<\/a>/g,
    'href="/blog"$1>$2</a>');
  html = html.replace(/href="\/blog"\s+>/g, 'href="/blog">');

  const bcCatLink = `<a href="/blog#${cat}">${meta.label}</a>`;
  if (!html.includes(bcCatLink)) {
    html = html.replace(
      /(<a href="\/blog"[^>]*>Blog<\/a> › )(?!<a href="\/blog#)([^<]+)(<\/div>)/,
      `$1${bcCatLink} › $2$3`
    );
    changed = true;
  }

  // ── 3. Related section: remove old, insert fresh before .cta-box ─────────
  html = html.replace(/<section class="cat-related">[\s\S]*?<\/section>\s*/g, '');
  const related = buildRelatedSection(slug, blogs);
  if (related) {
    html = html.replace('<div class="cta-box">', related + '\n<div class="cta-box">');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`  [${slug}] cat=${cat}`);
  }
  return changed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Setting up blog categories…\n');
const blogs = readBlogs();
updateBlogIndex(blogs);

let n = 0;
for (const { slug } of blogs) {
  if (updateArticle(slug, blogs)) n++;
}

console.log(`\nDone. ${n}/${blogs.length} article files updated.`);
