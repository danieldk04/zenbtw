/**
 * Blog Model Comparison — schrijft hetzelfde artikel met twee modellen
 * Slaat op als blog/compare-opus-[slug].html en blog/compare-sonnet-[slug].html
 *
 * Usage: node scripts/compare-blog.js
 * Env:   ANTHROPIC_API_KEY (required)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const KEYWORDS_FILE = path.join(ROOT, 'keywords.json');
const BLOG_DIR      = path.join(ROOT, 'blog');
const TODAY         = new Date().toISOString().split('T')[0];

const MODELS = [
  { id: 'claude-opus-4-6',   label: 'Opus 4.6',   prefix: 'opus'   },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', prefix: 'sonnet' },
];

function nextPending() {
  const d = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
  return d.queue
    .filter(k => k.status === 'pending')
    .sort((a, b) => a.priority - b.priority)[0] || null;
}

function getExistingBlogs() {
  try {
    return fs.readdirSync(BLOG_DIR)
      .filter(f => f.endsWith('.html') && f !== 'index.html' && !f.startsWith('compare-'))
      .map(f => {
        const slug = f.replace('.html', '');
        const content = fs.readFileSync(path.join(BLOG_DIR, f), 'utf8');
        const h1 = content.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim() || slug;
        return { slug, title: h1 };
      });
  } catch { return []; }
}

function buildPrompt(keyword, slug, existingBlogs) {
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
.page-layout{display:grid;grid-template-columns:1fr 240px;gap:40px;max-width:1080px;margin:0 auto;padding:0 clamp(20px,4vw,56px)}
.article-wrap{min-width:0;padding:clamp(40px,6vw,72px) 0 100px}
.author-sidebar{padding-top:clamp(40px,6vw,72px)}
.author-sidebar .author-box{position:sticky;top:88px;flex-direction:column;align-items:center;text-align:center;padding:20px 18px;gap:12px}
.author-sidebar .author-img{width:80px;height:80px}
.author-sidebar .author-info{align-items:center}
.author-sidebar .author-bio{text-align:left;font-size:13px}
.author-box{display:flex;align-items:flex-start;gap:20px;background:var(--wh);border:1.5px solid var(--br);border-radius:14px;padding:24px 28px}
.author-img{width:72px;height:72px;border-radius:50%;object-fit:cover;flex-shrink:0;box-shadow:0 3px 10px rgba(0,0,0,.12)}
.author-info{display:flex;flex-direction:column;gap:4px}
.author-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
.author-name{font-size:17px;font-weight:700;color:var(--tx);font-family:'Fraunces',serif}
@media(max-width:960px){.page-layout{display:block;padding:0}.article-wrap{padding:clamp(40px,6vw,72px) clamp(20px,5vw,40px) 60px}.author-sidebar{display:none}.author-box-mobile{display:flex!important}}
.author-box-mobile{display:none;margin:0 clamp(20px,5vw,40px) 48px}
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

<div class="page-layout">
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

  [2-3 interne links naar gerelateerde blog artikelen]
</div>

<aside class="author-sidebar">
<div class="author-box">
  <img src="/author-daniel.jpg" alt="Daniel - oprichter ZenBTW" class="author-img">
  <div class="author-info">
    <span class="author-label">Over de auteur</span>
    <strong class="author-name">Daniel</strong>
    <p class="author-bio">Oprichter van ZenBTW en <a href="https://revaleur.com" target="_blank" rel="noopener">Revaleur</a> (680+ reviews, 4.9★). Met 4 jaar ervaring in finance helpt Daniel marketplace-verkopers grip te krijgen op BTW, KOR en OSS, zonder dat je er een boekhouder bij nodig hebt.</p>
  </div>
</div>
</aside>
</div>

<div class="author-box-mobile">
<div class="author-box">
  <img src="/author-daniel.jpg" alt="Daniel - oprichter ZenBTW" class="author-img">
  <div class="author-info">
    <span class="author-label">Over de auteur</span>
    <strong class="author-name">Daniel</strong>
    <p class="author-bio">Oprichter van ZenBTW en <a href="https://revaleur.com" target="_blank" rel="noopener">Revaleur</a> (680+ reviews, 4.9★). Met 4 jaar ervaring in finance helpt Daniel marketplace-verkopers grip te krijgen op BTW, KOR en OSS, zonder dat je er een boekhouder bij nodig hebt.</p>
  </div>
</div>
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

FEITELIJKE NAUWKEURIGHEID — VERPLICHT, GEEN UITZONDERINGEN:

KOR (Kleineondernemersregeling):
- Overschrijding van de €20.000-grens heeft GEEN terugwerkende kracht.
- Bij overschrijding reken je BTW per direct, vanaf de transactie die de grens doorbreekt.
- De wachttermijn na afmelding of overschrijding is: de rest van het lopende kalenderjaar + het volledige volgende kalenderjaar. NIET 3 jaar.
- Vrijwillige afmelding gaat in per het eerstvolgende aangiftetijdvak (kwartaal). Gedwongen afmelding (overschrijding) gaat per direct in.

Wanneer je een specifieke wettelijke of fiscale claim maakt:
- Gebruik ALTIJD en UITSLUITEND https://www.belastingdienst.nl als link-URL. NOOIT een dieper pad.

MENSELIJKE SCHRIJFSTIJL (dit is het belangrijkste):
- Schrijf zoals een mens schrijft: wisselende zinslengtes, soms een korte zin. Soms wat langer.
- Begin zinnen NOOIT met "In dit artikel", "In deze gids", "Het is belangrijk om", "Bovendien", "Daarnaast", "Tevens", "Kortom", "Samengevat", "Al met al", "Tot slot"
- Gebruik NOOIT het woord "cruciaal", "essentieel", "naadloos", "optimaal", "uitgebreid", "robuust", "volledig", "allesomvattend"
- Schrijf vanuit persoonlijke ervaring: gebruik "ik merkte", "wat ik zelf deed", "veel verkopers die ik spreek", "in de praktijk"
- Stel af en toe een retorische vraag aan de lezer
- Gebruik concrete voorbeelden met echte bedragen

SEO REGELS:
- Gebruik het keyword "${keyword}" in: title, h1, eerste alinea, minstens 1 h2, meta description
- Concrete cijfers, deadlines en bedragen
- Vermeldt ZenBTW als oplossing in de tekst (niet alleen in de CTA), maar niet opdringerig
- Disclaimer altijd in footer

INTERNE LINKS — kies alleen uit deze lijst:
${blogList}

Link categorie KOR: /blog/kor-vrijstelling-2026, /blog/kor-drempel-overschreden, /blog/kor-buitenland-verkopen
1. CONTEXTUAL INLINE LINKS (3-6 stuks) in de lopende tekst
2. FOOTER LINKS (2-3 stuks) vóór de .cta-box: <p><a href="/blog/[slug]" style="color:var(--acm);font-weight:600">→ Lees ook: [titel]</a></p>

GEO — OPTIMALISEER VOOR AI ZOEKMACHINES:
- Begin het artikel DIRECT met een feitelijke, complete beantwoording van de kernvraag — 2-3 zinnen, helder en citeerbaar
- Voeg ALTIJD een FAQ-sectie toe vlak vóór de interne links met 4-5 vragen (format: <section class="faq-section">...)
- Voeg FAQPage schema-markup toe als tweede <script type="application/ld+json"> in de <head>

AFBEELDINGEN:
- Voeg minimaal 1 relevante inline SVG toe (role="img", aria-label, omring met <figure>)

Geef ALLEEN de volledige HTML terug, zonder extra uitleg of markdown code blocks.`;
}

async function generate(client, model, label, keyword, slug, existingBlogs) {
  console.log(`\n⏳ Generating with ${label} (${model})...`);
  const t0 = Date.now();

  const msg = await client.messages.create({
    model,
    max_tokens: 8000,
    messages: [{ role: 'user', content: buildPrompt(keyword, slug, existingBlogs) }],
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const inputTokens  = msg.usage?.input_tokens  ?? '?';
  const outputTokens = msg.usage?.output_tokens ?? '?';
  console.log(`  ✅ Done in ${elapsed}s — in:${inputTokens} out:${outputTokens} tokens`);

  let html = msg.content[0].text
    .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '')
    .trim();

  // Inject comparison banner at top of body
  const banner = `<!-- VERGELIJKING: ${label} (${model}) — gegenereerd ${TODAY} -->
<div style="position:fixed;bottom:16px;right:16px;background:#1a4731;color:#fff;padding:10px 16px;border-radius:10px;font-family:sans-serif;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3)">
  📊 ${label}
</div>`;
  html = html.replace('<body>', `<body>\n${banner}`);

  return { html, inputTokens, outputTokens, elapsed };
}

async function main() {
  const client = new Anthropic();

  const kw = nextPending();
  if (!kw) { console.log('No pending keywords.'); process.exit(0); }

  const { keyword, slug } = kw;
  console.log(`\n📝 Comparing models for: "${keyword}" (${slug})\n`);

  const existingBlogs = getExistingBlogs();
  const results = {};

  for (const { id, label, prefix } of MODELS) {
    const result = await generate(client, id, label, keyword, slug, existingBlogs);
    const outFile = path.join(BLOG_DIR, `compare-${prefix}-${slug}.html`);
    fs.writeFileSync(outFile, result.html, 'utf8');
    console.log(`  💾 Saved: blog/compare-${prefix}-${slug}.html`);
    results[prefix] = { ...result, outFile };
  }

  // Write summary index
  const summaryPath = path.join(BLOG_DIR, `compare-index-${slug}.html`);
  fs.writeFileSync(summaryPath, `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<title>Blog vergelijking: ${keyword}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#f7f6f3;padding:40px 24px}
h1{font-size:22px;margin-bottom:8px;color:#1a1814}
p{font-size:14px;color:#4a4640;margin-bottom:32px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:960px}
.card{background:#fff;border:1.5px solid #e8e5de;border-radius:12px;padding:24px}
.card h2{font-size:16px;margin-bottom:6px;color:#1a4731}
.card .meta{font-size:13px;color:#8a847a;margin-bottom:16px}
.card a{display:inline-block;padding:10px 20px;background:#1a4731;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700}
</style>
</head>
<body>
<h1>Vergelijking: "${keyword}"</h1>
<p>Gegenereerd op ${TODAY}. Open beide artikelen en vergelijk kwaliteit, toon en SEO.</p>
<div class="grid">
  <div class="card">
    <h2>Opus 4.6 (huidig model)</h2>
    <div class="meta">~${results.opus.inputTokens} input · ~${results.opus.outputTokens} output · ${results.opus.elapsed}s</div>
    <a href="compare-opus-${slug}.html" target="_blank">Open Opus versie →</a>
  </div>
  <div class="card">
    <h2>Sonnet 4.6 (goedkoper)</h2>
    <div class="meta">~${results.sonnet.inputTokens} input · ~${results.sonnet.outputTokens} output · ${results.sonnet.elapsed}s</div>
    <a href="compare-sonnet-${slug}.html" target="_blank">Open Sonnet versie →</a>
  </div>
</div>
</body>
</html>`, 'utf8');

  console.log(`\n📋 Summary: blog/compare-index-${slug}.html`);
  console.log('\n✅ Done! Check both files to compare quality.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
