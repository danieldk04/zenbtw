#!/usr/bin/env node
/**
 * Adds contextual inline links to existing blog posts.
 * Links the first occurrence of key terms (outside headings/anchors) to
 * the most relevant article. Run once: node scripts/add-internal-links.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR   = path.join(__dirname, '..', 'blog');

// Rules are tried in order. For each rule the keywords are tried in order;
// the first keyword that matches (outside anchors/headings) wins.
// Each target URL is linked at most once per file.
const LINK_RULES = [
  {
    url: '/blog/kor-vrijstelling-2026',
    keywords: ['KOR-vrijstelling', 'KOR-drempel', 'KOR-grens', 'Kleine Ondernemersregeling'],
  },
  {
    url: '/blog/oss-registratie-belastingdienst',
    keywords: ['OSS-registratie', 'OSS aanmelden', 'One Stop Shop', 'OSS-aangifte'],
  },
  {
    url: '/blog/dac7-belastingdienst-rapportage',
    keywords: ['DAC7-richtlijn', 'DAC7-rapportage', 'DAC7-melding', 'DAC7'],
  },
  {
    url: '/blog/marketplace-verkoper-btw-aangifte',
    keywords: ['deemed supplier', 'deemed-supplier'],
  },
  {
    url: '/blog/shopify-dropshipping-btw',
    keywords: ['Shopify dropshipping', 'dropshipping BTW', 'dropshipping'],
  },
  {
    url: '/blog/etsy-verkoper-belastingaangifte',
    keywords: ['Etsy belastingaangifte', 'belastingaangifte als Etsy-verkoper', 'Etsy-verkoper belasting'],
  },
  {
    url: '/blog/vinted-ondernemer-btw-registratie',
    keywords: ['Vinted BTW registratie', 'BTW registreren als Vinted', 'Vinted ondernemer BTW'],
  },
  {
    url: '/blog/shopify-btw-nederland-2026',
    keywords: ['Shopify BTW Nederland', 'Shopify-verkoper BTW', 'Shopify-winkel BTW'],
  },
  {
    url: '/blog/kor-buitenland-verkopen',
    keywords: ['KOR bij buitenlandse verkopen', 'KOR als je aan het buitenland verkoopt', 'buitenlandse verkopen KOR'],
  },
  {
    url: '/blog/btw-tarief-eu-landen-2026',
    keywords: ['BTW-tarief in het land van de koper', 'BTW-tarief EU-land', 'EU-BTW-tarieven'],
  },
  {
    url: '/blog/gratis-btw-tool-marketplace',
    keywords: ['gratis BTW-tool voor marketplace', 'gratis BTW tool marketplace'],
  },
  {
    url: '/blog/hoeveel-btw-vinted-verkoper',
    keywords: ['hoeveel BTW als Vinted verkoper', 'BTW betalen als Vinted verkoper'],
  },
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the ranges [start, end) of all <a>…</a> and <h1-3>…</h1-3> blocks in html.
function blockedRanges(html) {
  const re = /<(?:a\b[^>]*|h[1-3][^>]*)>[\s\S]*?<\/(?:a|h[1-3])>/gi;
  const ranges = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isBlocked(start, end, ranges) {
  return ranges.some(([rs, re]) => start >= rs && end <= re);
}

// Link the first safe occurrence of `keyword` in `content` to `url`.
// Returns new content string, or the original if no match.
function linkFirst(content, keyword, url) {
  const escaped = escapeRegex(keyword);
  // Negative lookbehind/ahead: not preceded or followed by word char or hyphen
  const re = new RegExp(`(?<![\\w\\-])${escaped}(?![\\w\\-])`, 'gi');
  const skip = blockedRanges(content);

  let match;
  while ((match = re.exec(content)) !== null) {
    const s = match.index, e = s + match[0].length;
    if (!isBlocked(s, e, skip)) {
      return content.slice(0, s) + `<a href="${url}">${match[0]}</a>` + content.slice(e);
    }
  }
  return content;
}

function processFile(filePath) {
  const slug = path.basename(filePath, '.html');
  const html  = fs.readFileSync(filePath, 'utf8');

  // Isolate the article-wrap section so we never touch <head>/nav/footer
  const wrapStart = html.indexOf('<div class="article-wrap">');
  const footerIdx = html.indexOf('<footer');
  if (wrapStart === -1 || footerIdx === -1) return false;

  const wrapEnd   = html.lastIndexOf('</div>', footerIdx) + 6; // include </div>
  const before    = html.slice(0, wrapStart);
  let   content   = html.slice(wrapStart, wrapEnd);
  const after     = html.slice(wrapEnd);

  let changed = false;

  for (const { url, keywords } of LINK_RULES) {
    if (url === `/blog/${slug}`) continue;          // no self-links
    if (content.includes(`href="${url}"`)) continue; // already linked

    for (const keyword of keywords) {
      const next = linkFirst(content, keyword, url);
      if (next !== content) {
        console.log(`  [${slug}] "${keyword}" → ${url}`);
        content = next;
        changed = true;
        break;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, before + content + after, 'utf8');
  }
  return changed;
}

const files = fs.readdirSync(BLOG_DIR)
  .filter(f => f.endsWith('.html') && f !== 'index.html')
  .map(f => path.join(BLOG_DIR, f));

console.log(`Processing ${files.length} blog files…\n`);
let n = 0;
for (const f of files) {
  if (processFile(f)) n++;
}
console.log(`\nDone. Updated ${n}/${files.length} files.`);
