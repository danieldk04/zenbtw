#!/usr/bin/env node
/**
 * ZenBTW Automated Blog Generator
 * Reads next keyword from keywords.json, calls Claude API to generate
 * a Dutch SEO-optimized blog post, saves HTML to blog/, updates sitemap.xml.
 *
 * Usage: node scripts/generate-blog.js
 * Env:   ANTHROPIC_API_KEY (required)
 *        REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD (optional)
 *        MEDIUM_TOKEN (optional)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────
const KEYWORDS_FILE = path.join(ROOT, 'keywords.json');
const BLOG_DIR      = path.join(ROOT, 'blog');
const SITEMAP_FILE  = path.join(ROOT, 'sitemap.xml');
const TODAY         = new Date().toISOString().split('T')[0];

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadKeywords() {
  return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
}

function saveKeywords(data) {
  fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function nextPending(data) {
  return data.queue
    .filter(k => k.status === 'pending')
    .sort((a, b) => a.priority - b.priority)[0] || null;
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(keyword, slug) {
  return `Je bent een Nederlandse SEO-copywriter gespecialiseerd in belastingen en e-commerce voor marketplace verkopers (Etsy, Shopify, Vinted). Je schrijft voor ZenBTW (https://zenbtw.nl) — een gratis BTW-dashboard voor marketplace verkopers.

Schrijf een VOLLEDIG HTML blog artikel voor het keyword: "${keyword}"

VEREISTEN:
- Taal: Nederlands (informeel maar professioneel)
- Lengte: 900-1200 woorden zichtbare tekst
- Datum: ${TODAY}
- Slug: ${slug}

HTML STRUCTUUR (gebruik EXACT dit format, vervang ALLEEN de content):

<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>[SEO TITLE 55-60 tekens met keyword] | ZenBTW</title>
<meta name="description" content="[Meta description 140-155 tekens, bevat keyword, prikkelend]">
<link rel="canonical" href="https://zenbtw.nl/blog/${slug}.html">
<link rel="manifest" href="../manifest.json">
<meta name="theme-color" content="#1a4731">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"[ARTICLE HEADLINE]","datePublished":"${TODAY}","dateModified":"${TODAY}","author":{"@type":"Organization","name":"ZenBTW"},"publisher":{"@type":"Organization","name":"ZenBTW","url":"https://zenbtw.nl"}}</script>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f7f6f3;--wh:#fff;--br:#e8e5de;--ac:#1a4731;--acl:#e8f0ec;--acm:#2d6a4f;--tx:#1a1814;--tx2:#4a4640;--tx3:#8a847a;--tx4:#b8b2a8;--s2:#f4f3ef;--dn:#c0392b;--dnl:#fdf0ee;--wn:#d97706;--wnl:#fffbeb}
body{background:var(--bg);color:var(--tx);font-family:'Plus Jakarta Sans',sans-serif;-webkit-font-smoothing:antialiased;line-height:1.7}
nav{background:var(--wh);border-bottom:1px solid var(--br);padding:0 clamp(20px,5vw,80px);height:64px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;font-family:'Fraunces',serif;font-size:18px;font-weight:700;color:var(--tx)}
.nav-logo em{color:var(--acm);font-style:normal}
.nav-back{font-size:13.5px;color:var(--tx3);text-decoration:none;font-weight:500}
.nav-cta{padding:9px 20px;background:var(--ac);color:#fff;border-radius:8px;font-size:13.5px;font-weight:700;text-decoration:none}
.article-wrap{max-width:720px;margin:0 auto;padding:clamp(40px,6vw,72px) clamp(20px,5vw,40px) 100px}
.article-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:5px;background:var(--acl);color:var(--acm);margin-bottom:14px}
h1{font-family:'Fraunces',serif;font-size:clamp(26px,4vw,38px);font-weight:700;letter-spacing:-.02em;color:var(--tx);margin-bottom:14px;line-height:1.2}
.meta{font-size:13.5px;color:var(--tx3);margin-bottom:36px;padding-bottom:24px;border-bottom:1px solid var(--br)}
h2{font-size:21px;font-weight:700;color:var(--tx);margin:40px 0 14px;letter-spacing:-.01em;font-family:'Fraunces',serif}
h3{font-size:16px;font-weight:700;color:var(--tx2);margin:26px 0 10px}
p{font-size:15.5px;color:var(--tx2);margin-bottom:16px;line-height:1.78}
ul,ol{padding-left:22px;margin-bottom:16px}
li{font-size:15.5px;color:var(--tx2);margin-bottom:8px;line-height:1.7}
strong{color:var(--tx)}
.highlight{background:var(--acl);border-left:4px solid var(--ac);border-radius:0 8px 8px 0;padding:16px 20px;margin:24px 0}
.highlight p{margin:0;color:var(--acm);font-weight:600;font-size:14.5px}
.warn{background:var(--wnl);border-left:4px solid var(--wn);border-radius:0 8px 8px 0;padding:16px 20px;margin:24px 0}
.warn p{margin:0;color:#92400e;font-size:14.5px}
.danger{background:var(--dnl);border-left:4px solid var(--dn);border-radius:0 8px 8px 0;padding:16px 20px;margin:24px 0}
.danger p{margin:0;color:var(--dn);font-size:14.5px;font-weight:600}
table{width:100%;border-collapse:collapse;margin:24px 0;font-size:14px}
th{background:var(--ac);color:#fff;padding:10px 14px;text-align:left;font-weight:600}
td{padding:9px 14px;border-bottom:1px solid var(--br);color:var(--tx2)}
tr:nth-child(even) td{background:var(--s2)}
.cta-box{background:var(--ac);border-radius:14px;padding:28px 32px;margin:48px 0 0;text-align:center}
.cta-box h3{font-size:20px;font-weight:700;color:#fff;margin-bottom:10px;font-family:'Fraunces',serif}
.cta-box p{font-size:14.5px;color:rgba(255,255,255,.8);margin-bottom:22px}
.cta-box a{display:inline-block;padding:12px 28px;background:#fff;color:var(--ac);border-radius:9px;text-decoration:none;font-size:14.5px;font-weight:700}
.breadcrumb{font-size:13px;color:var(--tx4);margin-bottom:20px}
.breadcrumb a{color:var(--tx3);text-decoration:none}
footer{text-align:center;padding:32px 24px;font-size:13px;color:var(--tx4);border-top:1px solid var(--br);margin-top:60px}
footer a{color:var(--tx3);text-decoration:none;margin:0 8px}
</style>
</head>
<body>
<nav>
  <a href="../index.html" class="nav-logo">Zen<em>BTW</em></a>
  <a href="index.html" class="nav-back">← Blog</a>
  <a href="../app.html" class="nav-cta">Gratis starten →</a>
</nav>

<div class="article-wrap">
  <div class="breadcrumb"><a href="../index.html">Home</a> › <a href="index.html">Blog</a> › [BREADCRUMB LABEL]</div>
  <span class="article-tag">[ARTIKEL TAG zoals "Shopify" of "BTW Tips"]</span>
  <h1>[H1 MET KEYWORD]</h1>
  <div class="meta">[X] minuten lezen &nbsp;·&nbsp; Bijgewerkt [MAAND JAAR] &nbsp;·&nbsp; Door ZenBTW</div>

  [VOLLEDIGE ARTIKEL CONTENT HIER — gebruik h2, h3, p, ul, ol, strong, .highlight, .warn, .danger, table elementen]

  <div class="cta-box">
    <h3>[CTA TITEL — relevant aan artikel onderwerp]</h3>
    <p>[CTA subtekst, 1 zin]</p>
    <a href="../app.html">📊 Open gratis ZenBTW dashboard →</a>
  </div>

  [2-3 interne links naar gerelateerde blog artikelen, gebruik: <p><a href="[slug].html" style="color:var(--acm);font-weight:600">→ Lees ook: [TITEL]</a></p>]
</div>

<footer>
  <a href="../index.html">Home</a>
  <a href="index.html">Blog</a>
  <a href="../app.html">Dashboard</a>
  <a href="../privacy.html">Privacy</a>
  <br><br>© 2026 ZenBTW &nbsp;·&nbsp; Geen belastingadvies — raadpleeg een adviseur voor jouw specifieke situatie.
</footer>
</body>
</html>

SEO REGELS:
- Gebruik het keyword "${keyword}" in: title, h1, eerste alinea, minstens 1 h2, meta description
- Schrijf UNIEKE, NUTTIGE content — geen generieke tekst
- Concrete cijfers, deadlines en bedragen (BTW-tarieven, drempels, percentages)
- Vermeldt ZenBTW als oplossing in de tekst (niet alleen in de CTA), maar niet opdringerig
- Eindig elke sectie met een concrete take-away
- Vermijd juridisch absolute claims — gebruik "over het algemeen", "in de meeste gevallen"
- Disclaimer altijd in footer: "Geen belastingadvies"
- Gerelateerde interne links naar bestaande artikelen: etsy-btw-2026.html, vinted-belasting-2026.html, kor-drempel-overschreden.html, oss-aangifte-nederland.html

Geef ALLEEN de volledige HTML terug, zonder extra uitleg of markdown code blocks.`;
}

// ── HTML post-processing ──────────────────────────────────────────────────────
function cleanHtml(raw) {
  // Strip any markdown code fences Claude might add
  return raw
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

// ── Sitemap updater ────────────────────────────────────────────────────────────
function updateSitemap(slug) {
  const url = `https://zenbtw.nl/blog/${slug}.html`;
  let xml = fs.readFileSync(SITEMAP_FILE, 'utf8');

  // Don't add duplicate
  if (xml.includes(url)) {
    console.log('  sitemap: URL already present, skipping');
    return;
  }

  const newEntry = `  <url>
    <loc>${url}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;

  xml = xml.replace('</urlset>', `${newEntry}\n</urlset>`);
  fs.writeFileSync(SITEMAP_FILE, xml, 'utf8');
  console.log('  sitemap: added', url);
}

// ── Blog index updater ─────────────────────────────────────────────────────────
function updateBlogIndex(slug, title, description, tag) {
  const indexPath = path.join(BLOG_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.log('  blog/index.html not found, skipping index update');
    return;
  }

  let html = fs.readFileSync(indexPath, 'utf8');

  // Don't add duplicate
  if (html.includes(`href="${slug}.html"`)) {
    console.log('  blog/index.html: card already present, skipping');
    return;
  }

  const card = `
    <a href="${slug}.html" class="card">
      <div class="card-body">
        <span class="card-tag">${tag}</span>
        <h2>${title}</h2>
        <p>${description}</p>
        <div class="card-meta">
          <span>${new Date().toLocaleDateString('nl-NL', {month:'long', year:'numeric'})}</span>
          <span class="card-read">Lees artikel →</span>
        </div>
      </div>
    </a>`;

  // Insert inside the .grid div, just before its closing tag
  // The grid closes with "  </div>\n\n  <div class="cta-strip""
  html = html.replace(
    /(\s*)<\/div>\s*\n\s*<div class="cta-strip"/,
    `$1${card}\n\n  </div>\n\n  <div class="cta-strip"`
  );

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('  blog/index.html: card added for', slug);
}

// ── Reddit poster ─────────────────────────────────────────────────────────────
async function postToReddit(keyword, slug, description) {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    console.log('  Reddit: env vars missing, skipping');
    return;
  }

  try {
    // Get access token
    const creds = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ZenBTW/1.0 by ' + REDDIT_USERNAME
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD
      })
    });
    const { access_token } = await tokenRes.json();

    const postUrl = `https://zenbtw.nl/blog/${slug}.html`;
    const subreddits = ['r/DutchFIRE', 'r/financialindependence', 'r/Netherlands', 'r/Ondernemen'];

    // Post to the first subreddit (rotate based on day to avoid spam)
    const dayOfWeek = new Date().getDay();
    const subreddit = subreddits[dayOfWeek % subreddits.length].replace('r/', '');

    const submitRes = await fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ZenBTW/1.0 by ' + REDDIT_USERNAME
      },
      body: new URLSearchParams({
        sr: subreddit,
        kind: 'link',
        title: `[ZenBTW] ${keyword} — nieuw artikel`,
        url: postUrl,
        resubmit: 'false'
      })
    });

    const result = await submitRes.json();
    if (result.json?.errors?.length > 0) {
      console.log('  Reddit: error', result.json.errors);
    } else {
      console.log('  Reddit: posted to r/' + subreddit);
    }
  } catch (err) {
    console.log('  Reddit: failed:', err.message);
  }
}

// ── Medium poster ─────────────────────────────────────────────────────────────
async function postToMedium(title, slug, htmlContent) {
  const { MEDIUM_TOKEN } = process.env;
  if (!MEDIUM_TOKEN) {
    console.log('  Medium: MEDIUM_TOKEN missing, skipping');
    return;
  }

  try {
    // Get user ID
    const userRes = await fetch('https://api.medium.com/v1/me', {
      headers: { 'Authorization': `Bearer ${MEDIUM_TOKEN}` }
    });
    const { data: user } = await userRes.json();

    // Extract just the article body for Medium (strip nav/footer)
    const bodyMatch = htmlContent.match(/<div class="article-wrap">([\s\S]*?)<\/div>\s*<footer/);
    const articleHtml = bodyMatch ? bodyMatch[1] : htmlContent;

    const postRes = await fetch(`https://api.medium.com/v1/users/${user.id}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MEDIUM_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title,
        contentFormat: 'html',
        content: articleHtml,
        canonicalUrl: `https://zenbtw.nl/blog/${slug}.html`,
        publishStatus: 'public',
        tags: ['BTW', 'Belasting', 'E-commerce', 'Nederland', 'Ondernemen']
      })
    });

    const result = await postRes.json();
    if (result.data?.url) {
      console.log('  Medium: published at', result.data.url);
    } else {
      console.log('  Medium: error', JSON.stringify(result));
    }
  } catch (err) {
    console.log('  Medium: failed:', err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const data = loadKeywords();
  const item = nextPending(data);

  if (!item) {
    console.log('✅ No pending keywords — queue is empty');
    process.exit(0);
  }

  console.log(`\n🔍 Processing keyword: "${item.keyword}" → ${item.slug}.html`);

  // ── 1. Generate with Claude ────────────────────────────────────────────────
  console.log('  Calling Claude API...');
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: buildPrompt(item.keyword, item.slug)
      }
    ]
  });

  const rawHtml = message.content[0].type === 'text' ? message.content[0].text : '';
  if (!rawHtml) {
    console.error('  Claude returned no content');
    process.exit(1);
  }

  const html = cleanHtml(rawHtml);

  // ── 2. Extract title + description for index/Reddit ────────────────────────
  const titleMatch  = html.match(/<title>(.*?)\s*\|\s*ZenBTW<\/title>/);
  const descMatch   = html.match(/<meta name="description" content="(.*?)"/);
  const h1Match     = html.match(/<h1>(.*?)<\/h1>/);
  const tagMatch    = html.match(/class="article-tag">([^<]+)</);

  const title       = titleMatch?.[1]  || item.keyword;
  const description = descMatch?.[1]   || '';
  const h1          = h1Match?.[1]     || title;
  const tag         = tagMatch?.[1]    || 'Blog';

  console.log(`  Title: ${title}`);
  console.log(`  H1:    ${h1}`);

  // ── 3. Save HTML file ──────────────────────────────────────────────────────
  const outPath = path.join(BLOG_DIR, `${item.slug}.html`);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ✅ Saved: blog/${item.slug}.html`);

  // ── 4. Update sitemap ──────────────────────────────────────────────────────
  updateSitemap(item.slug);

  // ── 5. Update blog index ───────────────────────────────────────────────────
  updateBlogIndex(item.slug, h1, description, tag);

  // ── 6. Post to Reddit ─────────────────────────────────────────────────────
  await postToReddit(item.keyword, item.slug, description);

  // ── 7. Post to Medium ─────────────────────────────────────────────────────
  await postToMedium(h1, item.slug, html);

  // ── 8. Mark keyword as published ──────────────────────────────────────────
  const idx = data.queue.findIndex(k => k.slug === item.slug);
  data.queue[idx].status = 'published';
  data.queue[idx].publishedDate = TODAY;
  data.queue[idx].outputFile = `blog/${item.slug}.html`;
  data.published.push(data.queue[idx]);
  data.queue.splice(idx, 1);
  saveKeywords(data);

  console.log(`\n🎉 Done! Published: blog/${item.slug}.html`);
  console.log(`   ${data.queue.filter(k=>k.status==='pending').length} keywords remaining in queue`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
