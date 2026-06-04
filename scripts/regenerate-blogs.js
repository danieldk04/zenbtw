#!/usr/bin/env node
/**
 * ZenBTW Batch Blog Regenerator
 * Rewrites ALL existing blogs with the improved human-like style prompt.
 * Uses max_tokens: 8192 to prevent truncation.
 *
 * Usage: node scripts/regenerate-blogs.js
 * Env:   ANTHROPIC_API_KEY (required)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const BLOG_DIR  = path.join(ROOT, 'blog');
const SITEMAP   = path.join(ROOT, 'sitemap.xml');
const TODAY     = new Date().toISOString().split('T')[0];

// ── All blogs to regenerate ──────────────────────────────────────────────────
const BLOGS = [
  { slug: 'btw-tarief-eu-landen-2026',      keyword: 'btw tarief eu landen overzicht 2026' },
  { slug: 'dac7-belastingdienst-rapportage', keyword: 'DAC7 belastingdienst rapportage 2026' },
  { slug: 'etsy-btw-2026',                  keyword: 'Etsy BTW 2026 wanneer BTW betalen als verkoper' },
  { slug: 'etsy-verkoper-belastingaangifte', keyword: 'Etsy verkoper belastingaangifte Nederland' },
  { slug: 'kor-drempel-overschreden',        keyword: 'KOR drempel overschreden wat nu stappenplan 2026' },
  { slug: 'kor-vrijstelling-2026',           keyword: 'KOR vrijstelling 2026 voorwaarden kleine ondernemersregeling' },
  { slug: 'marketplace-verkoper-btw-aangifte', keyword: 'marketplace verkoper BTW aangifte hoe doe je het' },
  { slug: 'oss-aangifte-nederland',          keyword: 'OSS aangifte Nederland 2026 stap voor stap gids' },
  { slug: 'oss-registratie-belastingdienst', keyword: 'OSS registratie belastingdienst stappenplan 2026' },
  { slug: 'shopify-btw-nederland-2026',      keyword: 'Shopify BTW Nederland 2026 compleet overzicht' },
  { slug: 'shopify-dropshipping-btw',        keyword: 'Shopify dropshipping BTW Nederland zo regel je het' },
  { slug: 'vinted-belasting-2026',           keyword: 'Vinted belasting 2026 BTW betalen over verkopen' },
  { slug: 'vinted-ondernemer-btw-registratie', keyword: 'Vinted ondernemer BTW registratie wat je moet weten' },
];

// ── Prompt (zelfde stijl als generate-blog.js) ────────────────────────────────
function buildPrompt(keyword, slug) {
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
<link rel="canonical" href="https://zenbtw.nl/blog/${slug}.html">
<meta property="og:type" content="article">
<meta property="og:title" content="[ZELFDE ALS TITLE TAG, zonder '| ZenBTW']">
<meta property="og:description" content="[ZELFDE ALS META DESCRIPTION]">
<meta property="og:url" content="https://zenbtw.nl/blog/${slug}.html">
<meta property="og:site_name" content="ZenBTW">
<meta property="og:image" content="https://zenbtw.nl/og-blog.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="[ZELFDE ALS TITLE TAG, zonder '| ZenBTW']">
<meta name="twitter:description" content="[ZELFDE ALS META DESCRIPTION]">
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
</style>
</head>
<body>
<nav>
  <a href="../index.html" class="nav-logo">
    <img src="../logo.webp" alt="ZenBTW Logo" class="nav-logo-img" width="48" height="48">
    <span class="nav-wordmark">Zen<em>BTW</em></span>
  </a>
  <a href="index.html" class="nav-back">← Blog</a>
  <a href="../app.html" class="nav-cta">Check mijn status →</a>
</nav>

<div class="article-wrap">
  <div class="breadcrumb"><a href="../index.html">Home</a> › <a href="index.html">Blog</a> › [BREADCRUMB LABEL]</div>
  <span class="article-tag">[ARTIKEL TAG zoals "Shopify" of "BTW Tips"]</span>
  <h1>[H1 MET KEYWORD]</h1>
  <div class="meta">[X] minuten lezen &nbsp;·&nbsp; Bijgewerkt ${new Date().toLocaleDateString('nl-NL', {month:'long', year:'numeric'})} &nbsp;·&nbsp; Door ZenBTW</div>

  [VOLLEDIGE ARTIKEL CONTENT — gebruik h2, h3, p, ul, ol, strong, .highlight, .warn, .danger, table]

  <div class="cta-box">
    <h3>[CTA TITEL relevant aan artikel]</h3>
    <p>[CTA subtekst, 1 zin]</p>
    <a href="../app.html">📊 Open gratis ZenBTW dashboard →</a>
  </div>

  [2-3 interne links: <p><a href="[slug].html" style="color:var(--acm);font-weight:600">→ Lees ook: [TITEL]</a></p>]
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

MENSELIJKE SCHRIJFSTIJL (verplicht):
- Schrijf zoals een mens schrijft: wisselende zinslengtes, soms een korte zin. Soms wat langer.
- Begin zinnen NOOIT met "In dit artikel", "In deze gids", "Het is belangrijk om", "Bovendien", "Daarnaast", "Tevens", "Kortom", "Samengevat", "Al met al", "Tot slot"
- Gebruik NOOIT het woord "cruciaal", "essentieel", "naadloos", "optimaal", "uitgebreid", "robuust", "volledig", "allesomvattend"
- Gebruik NOOIT -- (dubbel koppelteken). Gebruik komma's, punten of herformuleer.
- Schrijf vanuit persoonlijke ervaring: gebruik "ik merkte", "wat ik zelf deed", "veel verkopers die ik spreek", "in de praktijk"
- Stel af en toe een retorische vraag aan de lezer
- Geef toe als iets ingewikkeld is: "Eerlijk gezegd is dit het meest verwarrende deel"
- Gebruik concrete voorbeelden met echte bedragen, echte landen, echte situaties
- Varieer het aantal punten in lijstjes — niet altijd 3 of 5
- Sluit paragrafen soms af met een nuance of kanttekening

SEO REGELS:
- Keyword in: title, h1, eerste alinea, minstens 1 h2, meta description
- Concrete cijfers, deadlines en bedragen
- Noem ZenBTW als oplossing in de tekst (niet alleen in CTA)
- Gerelateerde interne links naar: etsy-btw-2026.html, vinted-belasting-2026.html, kor-drempel-overschreden.html, oss-aangifte-nederland.html, shopify-btw-nederland-2026.html

LEESTIJD: bereken op basis van ~200 woorden/minuut, vermeld in .meta div.

AFBEELDINGEN: voeg minimaal 1 relevante inline SVG toe als visualisatie.
Omring met <figure style="margin:28px 0;text-align:center"> en <figcaption>.

BELANGRIJK: Geef ALLEEN de volledige HTML terug. Geen markdown, geen uitleg, geen code blocks.
De HTML moet compleet zijn van <!DOCTYPE> tot </html>.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanHtml(raw) {
  return raw
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const client = new Anthropic();
  const total = BLOGS.length;
  let done = 0;
  let failed = [];

  console.log(`\n🔄 ZenBTW Blog Regenerator — ${total} blogs\n`);

  for (const blog of BLOGS) {
    console.log(`[${done + 1}/${total}] ${blog.slug}`);
    console.log(`  Keyword: "${blog.keyword}"`);

    try {
      const message = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: buildPrompt(blog.keyword, blog.slug) }]
      });

      const rawHtml = message.content[0]?.text || '';
      if (!rawHtml) throw new Error('Claude returned no content');

      const html = cleanHtml(rawHtml);

      // Sanity check: must end with </html>
      if (!html.includes('</html>')) {
        throw new Error(`Response incomplete — missing </html> (${html.length} chars, stop_reason: ${message.stop_reason})`);
      }

      const outPath = path.join(BLOG_DIR, `${blog.slug}.html`);
      fs.writeFileSync(outPath, html, 'utf8');

      const size = fs.statSync(outPath).size;
      console.log(`  ✅ Saved (${(size/1024).toFixed(1)} KB, stop: ${message.stop_reason})`);
      done++;

    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      failed.push({ slug: blog.slug, error: err.message });
    }

    // Wacht 3 seconden tussen calls om rate limiting te vermijden
    if (done + failed.length < total) {
      await sleep(3000);
    }
  }

  console.log(`\n✅ Done: ${done}/${total} blogs regenerated`);
  if (failed.length) {
    console.log(`❌ Failed (${failed.length}):`);
    failed.forEach(f => console.log(`  - ${f.slug}: ${f.error}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
