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

// ── Bestaande blogs ophalen voor internal linking ─────────────────────────────
function getExistingBlogs() {
  try {
    return fs.readdirSync(BLOG_DIR)
      .filter(f => f.endsWith('.html') && f !== 'index.html')
      .map(f => {
        const slug = f.replace('.html', '');
        const content = fs.readFileSync(path.join(BLOG_DIR, f), 'utf8');
        const h1 = content.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim() || slug;
        return { slug, title: h1, url: slug };
      });
  } catch {
    return [];
  }
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(keyword, slug, existingBlogs = []) {
  const blogList = existingBlogs.length
    ? existingBlogs.map(b => `  - /blog/${b.slug} — "${b.title}"`).join('\n')
    : '  (nog geen andere blogs)';

  return `Je bent een Nederlandse ondernemer die zelf jarenlang marketplace-verkoper is geweest (Etsy, Shopify, Vinted) en nu schrijft over BTW en belastingen vanuit eigen ervaring. Je schrijft voor ZenBTW (https://zenbtw.nl). Je toon is direct, eerlijk en menselijk — alsof je het uitlegt aan een vriend die er niks van weet.

Schrijf een VOLLEDIG HTML blog artikel voor het keyword: "${keyword}"

VEREISTEN:
- Taal: Nederlands (informeel, alsof je tegen iemand praat — geen corporate taal)
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
<link rel="canonical" href="https://zenbtw.nl/blog/${slug}">
<meta property="og:type" content="article">
<meta property="og:title" content="[ZELFDE ALS TITLE TAG, zonder '| ZenBTW']">
<meta property="og:description" content="[ZELFDE ALS META DESCRIPTION]">
<meta property="og:url" content="https://zenbtw.nl/blog/${slug}">
<meta property="og:site_name" content="ZenBTW">
<meta property="og:image" content="https://zenbtw.nl/og-blog.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="[ZELFDE ALS TITLE TAG, zonder '| ZenBTW']">
<meta name="twitter:description" content="[ZELFDE ALS META DESCRIPTION]">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="manifest" href="../manifest.json">
<meta name="theme-color" content="#1a4731">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"[ARTICLE HEADLINE]","datePublished":"${TODAY}","dateModified":"${TODAY}","author":{"@type":"Organization","name":"ZenBTW"},"publisher":{"@type":"Organization","name":"ZenBTW","url":"https://zenbtw.nl"},"image":"https://zenbtw.nl/og-blog.png"}</script>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f7f6f3;--wh:#fff;--br:#e8e5de;--ac:#1a4731;--acl:#e8f0ec;--acm:#2d6a4f;--tx:#1a1814;--tx2:#4a4640;--tx3:#8a847a;--tx4:#b8b2a8;--s2:#f4f3ef;--dn:#c0392b;--dnl:#fdf0ee;--wn:#d97706;--wnl:#fffbeb}
body{background:var(--bg);color:var(--tx);font-family:'Plus Jakarta Sans',sans-serif;-webkit-font-smoothing:antialiased;line-height:1.7}
nav{position:sticky;top:0;z-index:500;height:72px;background:rgba(247,246,243,.94);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1.5px solid var(--br);box-shadow:0 2px 12px rgba(0,0,0,.05);display:flex;align-items:center;padding:0 clamp(20px,4vw,56px);justify-content:space-between;gap:24px}
.nav-logo{display:flex;align-items:center;gap:13px;text-decoration:none;color:var(--tx);flex-shrink:0}
.nav-logo-img{max-height:48px;width:auto;border-radius:8px;object-fit:contain;box-shadow:0 3px 10px rgba(26,71,49,.22)}
.nav-wordmark{font-family:'Fraunces',serif;font-size:22px;font-weight:700;letter-spacing:-.5px;line-height:1}
.nav-wordmark em{color:var(--acm);font-style:normal}
.nav-back{font-size:13.5px;color:var(--tx3);text-decoration:none;font-weight:600}
.nav-cta{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;background:var(--ac);color:#fff;border-radius:10px;font-size:14px;font-weight:800;transition:all .2s;flex-shrink:0;box-shadow:0 4px 16px rgba(26,71,49,.35);text-decoration:none}
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
.faq-section{margin:48px 0}
.faq-section>h2{margin-bottom:20px}
.faq-item{border-bottom:1px solid var(--br);padding:18px 0}
.faq-item:last-child{border-bottom:none}
.faq-item h3{font-size:16px;font-weight:700;color:var(--tx);margin:0 0 8px}
.faq-item p{margin:0;font-size:15px;color:var(--tx2);line-height:1.7}
.compare-table th{background:var(--ac);color:#fff;padding:10px 14px;font-weight:600;text-align:left}
.compare-table td{padding:10px 14px;border-bottom:1px solid var(--br);vertical-align:top}
.compare-table tr:nth-child(even) td{background:var(--s2)}
.check{color:#16a34a;font-weight:700}
.cross{color:#dc2626;font-weight:700}
html,body{max-width:100%;overflow-x:hidden}
svg{max-width:100%!important;height:auto!important}
figure{max-width:100%;overflow:hidden}
@media(max-width:640px){nav{padding:0 16px!important;gap:8px!important}.nav-logo-img{max-height:36px!important}.nav-wordmark{display:none!important}.nav-back{white-space:nowrap;font-size:12px}.nav-cta{padding:9px 14px!important;font-size:13px!important}.article-wrap{padding-left:18px!important;padding-right:18px!important}table{font-size:12.5px}td,th{padding:7px 8px!important}}
</style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <img src="../logo.webp" alt="ZenBTW Logo" class="nav-logo-img" width="48" height="48">
    <span class="nav-wordmark">Zen<em>BTW</em></span>
  </a>
  <a href="/blog" class="nav-back">← Blog</a>
  <a href="/app" class="nav-cta">Check mijn status →</a>
</nav>

<div class="article-wrap">
  <div class="breadcrumb"><a href="/">Home</a> › <a href="/blog">Blog</a> › [BREADCRUMB LABEL]</div>
  <span class="article-tag">[ARTIKEL TAG zoals "Shopify" of "BTW Tips"]</span>
  <h1>[H1 MET KEYWORD]</h1>
  <div class="meta">[X] minuten lezen &nbsp;·&nbsp; Bijgewerkt [MAAND JAAR] &nbsp;·&nbsp; Door ZenBTW</div>

  [VOLLEDIGE ARTIKEL CONTENT HIER — gebruik h2, h3, p, ul, ol, strong, .highlight, .warn, .danger, table elementen]

  <div class="cta-box">
    <h3>[CTA TITEL — relevant aan artikel onderwerp]</h3>
    <p>[CTA subtekst, 1 zin]</p>
    <a href="/app">📊 Open gratis ZenBTW dashboard →</a>
  </div>

  [2-3 interne links naar gerelateerde blog artikelen, gebruik: <p><a href="/blog/[slug]" style="color:var(--acm);font-weight:600">→ Lees ook: [TITEL]</a></p>]
</div>

<footer>
  <a href="/">Home</a>
  <a href="/blog">Blog</a>
  <a href="/app">Dashboard</a>
  <a href="/privacy">Privacy</a>
  <br><br>© 2026 ZenBTW &nbsp;·&nbsp; Geen belastingadvies — raadpleeg een adviseur voor jouw specifieke situatie.
</footer>
</body>
</html>

MENSELIJKE SCHRIJFSTIJL (dit is het belangrijkste):
- Schrijf zoals een mens schrijft: wisselende zinslengtes, soms een korte zin. Soms wat langer.
- Begin zinnen NOOIT met "In dit artikel", "In deze gids", "Het is belangrijk om", "Bovendien", "Daarnaast", "Tevens", "Kortom", "Samengevat", "Al met al", "Tot slot"
- Gebruik NOOIT het woord "cruciaal", "essentieel", "naadloos", "optimaal", "uitgebreid", "robuust", "volledig", "allesomvattend"
- Gebruik NOOIT -- (dubbel koppelteken) als leesteken. Gebruik in plaats daarvan een komma, punt, of herformuleer de zin
- Schrijf vanuit persoonlijke ervaring: gebruik "ik merkte", "wat ik zelf deed", "veel verkopers die ik spreek", "in de praktijk"
- Stel af en toe een retorische vraag aan de lezer
- Geef toe als iets ingewikkeld is: "Eerlijk gezegd is dit het meest verwarrende deel"
- Gebruik concrete voorbeelden met echte bedragen, echte landen, echte situaties
- Geen perfecte lijstjes van altijd precies 3 of 5 punten — varieer
- Sluit een paragraaf soms af met een nuance of kanttekening, niet altijd met een positieve conclusie

SEO REGELS:
- Gebruik het keyword "${keyword}" in: title, h1, eerste alinea, minstens 1 h2, meta description, og:title, twitter:title
- Schrijf UNIEKE, NUTTIGE content — geen generieke tekst
- Concrete cijfers, deadlines en bedragen (BTW-tarieven, drempels, percentages)
- Vermeldt ZenBTW als oplossing in de tekst (niet alleen in de CTA), maar niet opdringerig
- Vermijd juridisch absolute claims — gebruik "over het algemeen", "in de meeste gevallen"
- Disclaimer altijd in footer: "Geen belastingadvies"
INTERNE LINKS — kies alleen uit deze lijst, link NOOIT naar het huidige artikel (slug: ${slug}):
${blogList}

De blog gebruikt 5 categorieën. Artikelen in dezelfde categorie zijn het meest relevant om naar te linken:
- KOR: /blog/kor-vrijstelling-2026, /blog/kor-drempel-overschreden, /blog/kor-buitenland-verkopen
- OSS & EU BTW: /blog/oss-registratie-belastingdienst, /blog/oss-aangifte-nederland, /blog/btw-tarief-eu-landen-2026
- Marketplaces: /blog/shopify-btw-nederland-2026, /blog/shopify-dropshipping-btw, /blog/etsy-btw-2026, /blog/etsy-verkoper-belastingaangifte, /blog/vinted-belasting-2026, /blog/vinted-ondernemer-btw-registratie, /blog/hoeveel-btw-vinted-verkoper, /blog/marketplace-verkoper-btw-aangifte
- DAC7: /blog/dac7-belastingdienst-rapportage
- Tools: /blog/gratis-btw-tool-marketplace
Link EERST naar artikelen uit dezelfde categorie als het huidige artikel, daarna pas naar andere categorieën.

1. CONTEXTUAL INLINE LINKS (3–6 stuks) — verwerk deze IN de lopende tekst:
   Zodra je een concept noemt dat in een bestaand artikel behandeld wordt, maak dan de EERSTE vermelding van die term een klikbare inline link.
   Schrijf gewoon: "...als je de <a href="/blog/kor-vrijstelling-2026">KOR-drempel</a> nadert..."
   Geen "Lees ook" label, geen speciale opmaak — puur een ankertekst in de lopende zin.
   Elke URL mag je maximaal 1x linken. Nooit twee keer hetzelfde artikel.

2. FOOTER LINKS (2–3 stuks) — aan het EINDE van het artikel, vóór de .cta-box:
   <p><a href="/blog/[slug]" style="color:var(--acm);font-weight:600">→ Lees ook: [titel]</a></p>
   Link hier bij voorkeur andere artikelen dan die je al inline hebt gelinkt.

- Forceer geen links als een artikel inhoudelijk niet past.

GEO — OPTIMALISEER VOOR AI ZOEKMACHINES (ChatGPT, Claude, Perplexity, Google AI):
- Begin het artikel DIRECT met een feitelijke, complete beantwoording van de kernvraag achter het keyword — 2-3 zinnen, helder en citeerbaar. Dit is het eerste wat een AI-assistent oppakt en citeert naar gebruikers.
- Verwerk in de tekst minimaal één citeerbare definitie van ZenBTW, bij voorkeur vroeg in het artikel. Voorbeeld: "ZenBTW is een gratis Nederlandse BTW-tool voor marketplace verkopers op Vinted, Etsy en Shopify die automatisch berekent of je KOR-drempel nadert."
- Als het keyword een vergelijking of alternatief betreft (bv. "alternatief voor X", "vs Y", "gratis tool voor Z"): schrijf een aparte H2-sectie "ZenBTW vs [X]" of "Gratis alternatief voor [X]" met een vergelijkingstabel (class="compare-table") met kolommen Functie / [Concurrent] / ZenBTW. Gebruik <span class="check">✓</span> en <span class="cross">✗</span>.
- Voeg ALTIJD een FAQ-sectie toe vlak vóór de interne links. Gebruik 4-5 specifieke vragen die mensen letterlijk aan ChatGPT of Google zouden stellen over dit onderwerp. Geef directe, feitelijke antwoorden van 1-3 zinnen. Format:
  <section class="faq-section">
    <h2>Veelgestelde vragen</h2>
    <div class="faq-item"><h3>[exacte vraag zoals iemand die aan een AI zou stellen]</h3><p>[direct antwoord, geen inleiding, puur feiten]</p></div>
  </section>
- Voeg FAQPage schema-markup toe als TWEEDE <script type="application/ld+json"> direct onder het eerste schema-blok in de <head>:
  {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"[vraag]","acceptedAnswer":{"@type":"Answer","text":"[antwoord]"}},…]}
- Schrijf H2-koppen die directe vragen zijn die mensen stellen, niet marketingtitels. Bv. "Hoeveel BTW moet ik betalen als Vinted verkoper?" werkt beter dan "BTW berekening voor Vinted".

LEESTIJD:
- Bereken de leestijd op basis van de tekstlengte (gemiddeld 200 woorden per minuut)
- Vermeld dit in de .meta div: "[X] minuten lezen"

AFBEELDINGEN:
- Voeg minimaal 1 relevante SVG-illustratie toe als inline <svg> in het artikel (niet als externe afbeelding)
- De SVG moet een simpele, informatieve visualisatie zijn passend bij het onderwerp (bijv. een stroomdiagram, een getal-visualisatie, of een eenvoudige infographic)
- Geef de SVG een role="img" en aria-label="[beschrijving]" attribuut
- Omring de SVG met <figure style="margin:28px 0;text-align:center"> en een <figcaption style="font-size:13px;color:var(--tx3);margin-top:8px">[onderschrift]</figcaption>

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
  const url = `https://zenbtw.nl/blog/${slug}`;
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
  if (html.includes(`href="/blog/${slug}"`) || html.includes(`href="${slug}.html"`) || html.includes(`href="${slug}"`)) {
    console.log('  blog/index.html: card already present, skipping');
    return;
  }

  const card = `
    <a href="/blog/${slug}" class="card">
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

  // Insert inside the .grid div, directly after the opening tag (newest first)
  html = html.replace(
    /(<div class="grid">\s*\n)/,
    `$1\n${card}\n`
  );

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('  blog/index.html: card added for', slug);
}

// ── Google Indexing API ────────────────────────────────────────────────────────
async function submitToGoogleIndexing(slug) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) {
    console.log('  Google Indexing: GOOGLE_SERVICE_ACCOUNT_JSON missing, skipping');
    return;
  }

  try {
    const key = JSON.parse(keyJson);
    const url = `https://zenbtw.nl/blog/${slug}`;

    // Build JWT for Google OAuth
    const now = Math.floor(Date.now() / 1000);
    const header  = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss:   key.client_email,
      scope: 'https://www.googleapis.com/auth/indexing',
      aud:   'https://oauth2.googleapis.com/token',
      exp:   now + 3600,
      iat:   now
    };

    const { createSign } = await import('crypto');
    const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned  = `${b64url(header)}.${b64url(payload)}`;
    const sign      = createSign('RSA-SHA256');
    sign.update(unsigned);
    const jwt = `${unsigned}.${sign.sign(key.private_key, 'base64url')}`;

    // Exchange JWT for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });
    const { access_token, error } = await tokenRes.json();
    if (error) { console.log('  Google Indexing: token error:', error); return; }

    // Submit URL
    const indexRes = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, type: 'URL_UPDATED' })
    });
    const result = await indexRes.json();

    if (result.urlNotificationMetadata) {
      console.log('  Google Indexing: submitted', url);
    } else {
      console.log('  Google Indexing: error', JSON.stringify(result));
    }
  } catch (err) {
    console.log('  Google Indexing: failed:', err.message);
  }
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

    const postUrl = `https://zenbtw.nl/blog/${slug}`;
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
        canonicalUrl: `https://zenbtw.nl/blog/${slug}`,
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

  const existingBlogs = getExistingBlogs().filter(b => b.slug !== item.slug);
  console.log(`  Found ${existingBlogs.length} existing blogs for internal linking`);

  // ── 1. Generate with Claude ────────────────────────────────────────────────
  console.log('  Calling Claude API...');
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: buildPrompt(item.keyword, item.slug, existingBlogs)
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

  // ── 6. Google Indexing API ────────────────────────────────────────────────
  await submitToGoogleIndexing(item.slug);

  // ── 7. Post to Reddit ─────────────────────────────────────────────────────
  await postToReddit(item.keyword, item.slug, description);

  // ── 8. Post to Medium ─────────────────────────────────────────────────────
  await postToMedium(h1, item.slug, html);

  // ── 9. Mark keyword as published ──────────────────────────────────────────
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
