#!/usr/bin/env node
/**
 * ZenBTW Social Slides Generator
 * Reads pending topics from slides-topics.json, generates HTML slides via Claude,
 * screenshots with Puppeteer (1080×1920 PNG), updates slides/manifest.json.
 *
 * Usage: node scripts/generate-slides.js
 * Env:   ANTHROPIC_API_KEY (required)
 */

import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.join(__dirname, '..');
const TOPICS_FILE = path.join(ROOT, 'slides-topics.json');
const MANIFEST    = path.join(ROOT, 'slides', 'manifest.json');
const SLIDES_DIR  = path.join(ROOT, 'slides');
const TODAY       = new Date().toISOString().split('T')[0];

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadTopics()    { return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8')); }
function saveTopics(d)   { fs.writeFileSync(TOPICS_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function loadManifest()  {
  if (fs.existsSync(MANIFEST)) return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return { sets: [] };
}
function saveManifest(d) { fs.writeFileSync(MANIFEST, JSON.stringify(d, null, 2), 'utf8'); }
function pendingTopics(data) {
  return data.queue.filter(t => t.status === 'pending').sort((a, b) => a.priority - b.priority);
}

// ── Website asset capture ─────────────────────────────────────────────────────
// ASSETS maps key → relative path from slides/SETID/ to slides/assets/
let ASSETS = {};

async function captureAssets(browser) {
  const assetsDir = path.join(SLIDES_DIR, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const pages = [
    { key: 'home',  url: 'https://zenbtw.nl/',             file: 'site-home.png'  },
    { key: 'tools', url: 'https://zenbtw.nl/hulpmiddelen/', file: 'site-tools.png' },
    { key: 'blog',  url: 'https://zenbtw.nl/blog/',         file: 'site-blog.png'  },
  ];

  for (const { key, url, file } of pages) {
    const filePath = path.join(assetsDir, file);

    // Re-use cached version if < 7 days old
    if (fs.existsSync(filePath)) {
      const age = Date.now() - fs.statSync(filePath).mtimeMs;
      if (age < 7 * 24 * 60 * 60 * 1000) {
        ASSETS[key] = `../assets/${file}`;
        console.log(`  📦 Cached: ${file}`);
        continue;
      }
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 1.5 });
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      await page.screenshot({ path: filePath, type: 'png', clip: { x: 0, y: 0, width: 1280, height: 820 } });
      ASSETS[key] = `../assets/${file}`;
      console.log(`  📸 Captured: ${url}`);
    } catch (e) {
      console.warn(`  ⚠️  Could not capture ${url}: ${e.message}`);
    }
    await page.close();
  }
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(topic, type) {
  const typeDesc = type === 'poster'
    ? 'één krachtige losse poster (1 slide)'
    : 'een Instagram/TikTok carrousel (4-7 slides)';

  return `Je maakt informatieve social media content voor Nederlandse marketplace verkopers (Vinted, Etsy, Shopify, Marktplaats, Bol.com).

Toon: menselijk, helder en informatief. Geen alarmisme, geen hype, geen dwingende taal. ZenBTW is de plek waar verkopers overzichtelijke, eerlijke informatie vinden — geen angst-marketing. Schrijf zoals een slimme vriend die toevallig alles van BTW weet.

Maak ${typeDesc} over: "${topic}"

Brand: ZenBTW — gratis BTW-tool voor marketplace verkopers in Nederland.
Stijl: donkergroen (#1a4731), clean, vertrouwen-opwekkend. ZenBTW naam in footer van elke slide.

Geef ALLEEN geldig JSON terug (geen markdown):

{
  "type": "${type}",
  "tag": "DAC7 | KOR | OSS | Etsy | Vinted | Shopify | Belasting | BTW Tips",
  "slides": [ ... ]
}

BESCHIKBARE TEMPLATES + EXACTE JSON VELDEN:

━━━ "hook" ━━━
{
  "template": "hook",
  "tag": "Kleine pil bovenaan bijv. 'Vinted verkopers'",
  "title": "Krachtige statement\nmax 2-3 regels",
  "highlight": "Dit deel wordt groen — paar woorden max",
  "sub": "Ondertitel 1 zin — concreet en prikkelend",
  "pill": "⚠️ Swipe voor de feiten",
  "dark": false,
  "asset": "home | tools | blog"
}
Gebruik dark:true voor een donkergroene achtergrond variant.
asset bepaalt welke ZenBTW screenshot getoond wordt (default: tools).

━━━ "stat" ━━━
{
  "template": "stat",
  "eyebrow": "KOR 2026",
  "number": "€20.000",
  "label": "is de grens waarboven je BTW moet afdragen",
  "context": "Aanvullende zin van max 20 woorden",
  "source": "Bron: Belastingdienst.nl",
  "asset": "home | tools | blog"
}

━━━ "info" ━━━
{
  "template": "info",
  "title": "Wanneer meldt Vinted jou aan?",
  "asset": "home | tools | blog",
  "cards": [
    { "icon": "🎯", "title": "DAC7 drempel", "body": "30 verkopen én €2.000 omzet", "accent": "green|red|yellow|blue|neutral" },
    { "icon": "✅", "title": "Beide drempels gehaald", "body": "Dan deelt Vinted naam, BSN en omzet", "accent": "red" }
  ]
}
Cards: 2-4 stuks. accent bepaalt kaartkleur.

━━━ "steps" ━━━
{
  "template": "steps",
  "title": "OSS aangifte in 3 stappen",
  "subtitle": "Doe het zelf, geen boekhouder nodig",
  "asset": "tools",
  "steps": [
    { "title": "Registreer via Mijn Belastingdienst", "body": "Kies OSS aanmelden — duurt 10 minuten" },
    { "title": "Houd EU-omzet per land bij", "body": "Per land en per BTW-tarief apart" },
    { "title": "Dien elk kwartaal in", "body": "Deadline: laatste dag van de maand erna" }
  ]
}
Steps: 2-5 stuks.

━━━ "compare" ━━━
{
  "template": "compare",
  "title": "KOR of OSS — wat past bij jou?",
  "col_a": "KOR",
  "col_b": "OSS",
  "col_a_color": "#1a4731",
  "col_b_color": "#2563eb",
  "rows": [
    { "label": "Grens", "a": "€20.000 NL", "b": "€10.000 EU", "highlight": false },
    { "label": "BTW afdragen", "a": "❌ Nee", "b": "✅ Ja", "highlight": true }
  ],
  "footer_note": "Twijfel je? Gebruik de gratis ZenBTW checker."
}

━━━ "persona" ━━━ (vergelijkingstabel met personen — POPULAIR format)
{
  "template": "persona",
  "title": "E-commerce BTW 2026",
  "subtitle": "Wie moet wat betalen?",
  "personas": [
    {
      "name": "Laura", "age": 34, "initials": "LV", "color": "#e8f0ec",
      "platform": "Etsy", "omzet_nl": "€2.000", "omzet_eu": "€1.500", "totaal": "€3.500",
      "kor": false, "oss": true, "btw_plicht": true,
      "advies": "Start OSS aangifte", "advies_kleur": "red"
    }
  ]
}

━━━ "list" ━━━
{
  "template": "list",
  "tag": "Checklist",
  "title": "Alles geregeld als Etsy verkoper?",
  "asset": "tools",
  "items": [
    { "text": "KOR aangemeld bij Belastingdienst", "done": true },
    { "text": "OSS aangifte gedaan dit kwartaal", "done": false }
  ],
  "note": "Gebruik ZenBTW om dit gratis bij te houden."
}

━━━ "cta" ━━━ (ALTIJD de LAATSTE slide van een carrousel)
{
  "template": "cta",
  "question": "Weet jij waar jij staat?",
  "sub": "Controleer gratis in 30 seconden — geen account nodig",
  "button": "Check mijn BTW-status →",
  "features": ["100% gratis", "Alle platforms", "Direct resultaat"]
}

STIJLREGELS:
- Carrousel: altijd beginnen met "hook", eindigen met "cta"
- Gebruik ECHTE bedragen: KOR €20k NL · OSS €10k EU · DAC7: 30 transacties EN €2.000
- Schrijf menselijk, toegankelijk Nederlands — informatief en concreet, niet bang-makend
- Geen woorden als "pas op", "gevaar", "belasting-bom" — wel: "goed om te weten", "zo zit het"
- Persona-template = meest engaging, gebruik hem als je een vergelijking maakt
- Poster = 1 slide: gebruik "stat" of "hook"
- CTA: vriendelijk en laagdrempelig — uitnodigend, niet urgent
- "highlight" bij hook = het label bovenin de groene pil (bijv. "Goed om te weten", "Let op")
- "title" bij hook = de grote vetgedrukte headline, max 8 woorden
- "sub" bij hook = de uitleg onder de separator, max 2 zinnen
- "pill" bij hook = een feitenpil onderaan, bijv. "DAC7 · 30 verkopen + €2k = automatische melding"

Geef ALLEEN de JSON terug.`;
}

// ── Shared CSS ────────────────────────────────────────────────────────────────
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">`;

const BASE = (bg = '#f7f6f3') => `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1350px;background:${bg};font-family:'Inter',sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased;color:#1a1814}
</style></head><body>`;

// Inline dashboard mockup (no screenshot needed — avoids network dependency)
const DASHBOARD_MOCKUP = () => `
<div style="border-radius:18px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.13);border:1.5px solid rgba(26,71,49,0.15)">
  <div style="background:#1a4731;padding:12px 18px;display:flex;align-items:center;gap:10px">
    <div style="display:flex;gap:6px">
      <div style="width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,0.2)"></div>
      <div style="width:11px;height:11px;border-radius:50%;background:rgba(255,255,255,0.2)"></div>
      <div style="width:11px;height:11px;border-radius:50%;background:#4ade80"></div>
    </div>
    <div style="flex:1;background:rgba(255,255,255,0.1);border-radius:6px;padding:5px 12px;font-size:13px;color:rgba(255,255,255,0.65)">🔒 zenbtw.nl/hulpmiddelen</div>
  </div>
  <div style="background:#fff;padding:28px 28px 24px">
    <div style="font-size:18px;font-weight:800;color:#1a1814;margin-bottom:18px">Hulpmiddelen</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#f5f0e8;border-radius:12px;padding:18px 20px;border-left:4px solid #1a4731">
        <div style="font-size:11px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">BTW berekenen</div>
        <div style="font-size:26px;font-weight:900;color:#1a1814;margin-bottom:4px">€ 2.310</div>
        <div style="font-size:11px;color:#9a9088">Omzet: €11.000</div>
      </div>
      <div style="background:#f5f0e8;border-radius:12px;padding:18px 20px;border-left:4px solid #4ade80">
        <div style="font-size:11px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">KOR drempel</div>
        <div style="font-size:26px;font-weight:900;color:#1a4731;margin-bottom:4px">✓ Vrij</div>
        <div style="font-size:11px;color:#9a9088">Onder €20.000</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <div style="flex:1;background:#f5f0e8;border-radius:10px;padding:12px 16px">
        <div style="font-size:11px;color:#9a9088;margin-bottom:2px">Jaarlijkse omzet</div>
        <div style="font-size:17px;font-weight:700;color:#1a1814">€ 11.000</div>
      </div>
      <div style="background:#1a4731;border-radius:10px;padding:13px 22px">
        <span style="font-size:14px;font-weight:700;color:#fff">Bereken →</span>
      </div>
    </div>
  </div>
</div>`;

// Breadcrumb footer with progress dots
const FOOTER = (dark = false, index = 0, total = 5) => {
  const dots = Array.from({ length: total }, (_, i) =>
    `<div style="width:28px;height:4px;border-radius:2px;background:${i === index ? (dark ? '#fff' : '#1a4731') : (dark ? 'rgba(255,255,255,0.25)' : '#c8c2b8')}"></div>`
  ).join('');
  return `<div style="position:absolute;bottom:0;left:0;right:0;padding:22px 56px;display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(26,71,49,0.12)'}">
  <span style="font-size:15px;color:${dark ? 'rgba(255,255,255,0.4)' : '#9a9088'};font-weight:500">zenbtw.nl</span>
  <div style="display:flex;gap:6px">${dots}</div>
  <span style="font-size:15px;color:${dark ? 'rgba(255,255,255,0.4)' : '#9a9088'};font-weight:500">@zenbtw</span>
</div>`;
};

// Tag label pill (green badge)
const TAG = (text) => `<div style="font-size:15px;font-weight:700;color:#4ade80;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:14px;background:#1a4731;display:inline-block;padding:5px 14px;border-radius:6px">${text}</div>`;

// Breadcrumb chrome (bookmark + left bar + ghost number + header)
const CHROME = (slideNum, totalNum, category) => `
  <div style="position:absolute;top:0;right:88px;width:52px;height:96px;background:#1a4731;clip-path:polygon(0 0,100% 0,100% 100%,50% 78%,0 100%);z-index:10"></div>
  <div style="position:absolute;left:0;top:0;bottom:0;width:8px;background:#1a4731;z-index:10"></div>
  <div style="position:absolute;top:40px;right:-20px;font-size:360px;font-weight:900;color:rgba(26,71,49,0.05);line-height:1;pointer-events:none;user-select:none;letter-spacing:-0.06em;z-index:1">${slideNum}</div>
  <div style="position:absolute;top:68px;left:56px;z-index:5">
    <div style="font-size:15px;font-weight:800;color:#1a4731;letter-spacing:0.12em;text-transform:uppercase">${category}</div>
    <div style="font-size:14px;color:#9a9088;font-weight:500;margin-top:3px">Slide ${slideNum} van ${totalNum}</div>
  </div>`;

// ── HOOK template (breadcrumb editorial) ──────────────────────────────────────
const HOOK = (s, index = 0, total = 5) => {
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const titleLen = (s.title || '').replace(/\n/g, '').length;
  const fs       = titleLen > 50 ? '58' : titleLen > 35 ? '66' : '72';

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.tag || 'ZenBTW')}

  <!-- Daniel presentator — kleiner voor het kortere format -->
  <img src="../assets/daniel-presentator.png"
       style="position:absolute;top:80px;right:-30px;width:340px;height:auto;z-index:4"
       alt="Daniel">

  <!-- Headline links -->
  <div style="position:absolute;top:140px;left:56px;right:370px;z-index:5">
    ${s.highlight ? TAG(s.highlight) : ''}
    <h1 style="font-size:${fs}px;font-weight:900;color:#1a1814;line-height:0.93;letter-spacing:-0.03em">${(s.title || '').replace(/\n/g, '<br>')}</h1>
  </div>

  <!-- Scheidingslijn -->
  <div style="position:absolute;top:430px;left:56px;right:56px;height:1.5px;background:rgba(26,71,49,0.15);z-index:5"></div>

  <!-- Body content — van 460px tot footer -->
  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:460px;padding-bottom:88px">

    ${s.sub ? `<p style="font-size:27px;font-weight:500;color:#3a3530;line-height:1.5;margin-bottom:28px;flex-shrink:0">${s.sub}</p>` : ''}

    <div style="flex:1;display:flex;flex-direction:column;gap:0;min-height:0">
      <div style="flex:1">${DASHBOARD_MOCKUP()}</div>

      ${s.pill ? `<div style="background:#1a4731;border-radius:14px;padding:20px 26px;display:flex;align-items:center;gap:14px;margin-top:20px;flex-shrink:0">
        <span style="font-size:24px;flex-shrink:0">📋</span>
        <div style="font-size:17px;font-weight:700;color:#fff;line-height:1.4">${s.pill}</div>
      </div>` : ''}

      <div style="display:flex;align-items:center;gap:12px;margin-top:20px;flex-shrink:0">
        <div style="width:40px;height:40px;border-radius:50%;background:#1a4731;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <span style="font-size:20px;font-weight:700;color:#1a1814">Swipe voor meer</span>
      </div>
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── STAT template ─────────────────────────────────────────────────────────────
const STAT = (s, index = 0, total = 5) => {
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const numLen   = (s.number || '').length;
  const numFs    = numLen > 7 ? '120' : numLen > 5 ? '150' : '190';
  const labelLen = (s.label || '').length;
  const labelFs  = labelLen > 50 ? '48' : labelLen > 35 ? '56' : '64';

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.eyebrow || 'De cijfers')}

  <!-- Full-height flex content -->
  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:160px;padding-bottom:88px">

    <!-- Headline -->
    <div style="flex-shrink:0;padding-bottom:36px">
      <h1 style="font-size:${labelFs}px;font-weight:900;color:#1a1814;line-height:0.96;letter-spacing:-0.03em">${s.label || ''}</h1>
    </div>

    <!-- Giant number card — neemt het meeste ruimte in -->
    <div style="flex:2;background:#fff;border-radius:24px;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:52px 56px;margin-bottom:24px;min-height:340px">
      <div style="position:absolute;top:0;left:0;bottom:0;width:8px;background:#1a4731"></div>
      <div style="font-size:${numFs}px;font-weight:900;color:#1a4731;line-height:0.85;letter-spacing:-0.05em">${s.number || ''}</div>
      ${s.source ? `<div style="margin-top:28px;font-size:17px;color:#9a9088;font-weight:500">${s.source}</div>` : ''}
    </div>

    <!-- Context tekst -->
    ${s.context ? `<div style="flex-shrink:0;background:#fff;border-radius:18px;padding:32px 36px;margin-bottom:20px">
      <p style="font-size:28px;font-weight:500;color:#3a3530;line-height:1.5">${s.context}</p>
    </div>` : ''}

    <!-- Spacer + tip box onderaan -->
    <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end">
      <div style="background:#1a4731;border-radius:18px;padding:28px 32px;display:flex;align-items:center;gap:18px">
        <span style="font-size:28px;flex-shrink:0">💡</span>
        <div style="font-size:19px;font-weight:600;color:#fff;line-height:1.45">Gebruik de gratis ZenBTW hulpmiddelen om te checken waar jij staat — geen account nodig.</div>
      </div>
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── INFO template ─────────────────────────────────────────────────────────────
const accentStyles = {
  green:   { bg: '#f0fdf4', border: '#86efac', bar: '#22c55e', title: '#15803d', body: '#166534' },
  red:     { bg: '#fef2f2', border: '#fecaca', bar: '#ef4444', title: '#dc2626', body: '#7f1d1d' },
  yellow:  { bg: '#fffbeb', border: '#fde68a', bar: '#f59e0b', title: '#d97706', body: '#78350f' },
  blue:    { bg: '#eff6ff', border: '#bfdbfe', bar: '#3b82f6', title: '#2563eb', body: '#1e3a8a' },
  neutral: { bg: '#fff',    border: '#e8e5de', bar: '#94a3b8', title: '#1a1814', body: '#4a4640' },
};

const INFO = (s, index = 0, total = 5) => {
  const cards    = (s.cards || []).slice(0, 4);
  const twoCol   = cards.length === 4;
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const titleLen = (s.title || '').length;

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.tag || 'Uitleg')}

  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:160px;padding-bottom:88px">

    <!-- Headline -->
    <div style="flex-shrink:0;padding-bottom:36px">
      <h1 style="font-size:${titleLen > 42 ? '50' : titleLen > 28 ? '60' : '70'}px;font-weight:900;color:#1a1814;line-height:0.95;letter-spacing:-0.03em">${s.title || ''}</h1>
    </div>

    <!-- Cards vullen de rest van de hoogte -->
    <div style="flex:1;display:${twoCol ? 'grid' : 'flex'};${twoCol ? 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr' : 'flex-direction:column'};gap:18px;min-height:0">
      ${cards.map(c => {
        const a = accentStyles[c.accent] || accentStyles.neutral;
        return `<div style="background:#fff;border:1.5px solid ${a.border};border-left:6px solid ${a.bar};border-radius:0 20px 20px 0;padding:${twoCol ? '32px 28px' : '36px 40px'};display:flex;flex-direction:column;gap:16px;overflow:hidden">
          <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
            <div style="font-size:${twoCol ? '40' : '46'}px;flex-shrink:0">${c.icon || '•'}</div>
            <h3 style="font-size:${twoCol ? '23' : '28'}px;font-weight:800;color:${a.title};line-height:1.2">${c.title || ''}</h3>
          </div>
          <p style="font-size:${twoCol ? '21' : '25'}px;color:${a.body};line-height:1.55;font-weight:500;flex:1">${c.body || c.text || ''}</p>
        </div>`;
      }).join('')}
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── STEPS template ────────────────────────────────────────────────────────────
const STEPS = (s, index = 0, total = 5) => {
  const steps    = (s.steps || []).slice(0, 5);
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const titleLen = (s.title || '').length;

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.tag || 'Stappenplan')}

  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:160px;padding-bottom:88px">

    <!-- Headline -->
    <div style="flex-shrink:0;padding-bottom:32px">
      <h1 style="font-size:${titleLen > 42 ? '50' : titleLen > 28 ? '60' : '70'}px;font-weight:900;color:#1a1814;line-height:0.95;letter-spacing:-0.03em${s.subtitle ? ';margin-bottom:12px' : ''}">${s.title || ''}</h1>
      ${s.subtitle ? `<p style="font-size:24px;color:#9a9088;font-weight:500">${s.subtitle}</p>` : ''}
    </div>

    <!-- Steps vullen de rest van de hoogte -->
    <div style="flex:1;display:flex;flex-direction:column;gap:0;justify-content:space-between;min-height:0">
      ${steps.map((st, i) => `
      <div style="display:flex;gap:24px;align-items:stretch;flex:1;${i < steps.length - 1 ? 'margin-bottom:16px' : ''}">
        <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:68px">
          <div style="width:68px;height:68px;background:#1a4731;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;flex-shrink:0">${String(i + 1).padStart(2, '0')}</div>
          ${i < steps.length - 1 ? `<div style="width:2px;flex:1;background:linear-gradient(to bottom,#1a4731 0%,rgba(26,71,49,0.08) 100%);margin:8px 0"></div>` : ''}
        </div>
        <div style="background:#fff;border:1.5px solid rgba(26,71,49,0.1);border-radius:18px;padding:32px 36px;flex:1;display:flex;flex-direction:column;justify-content:center">
          <h4 style="font-size:26px;font-weight:800;color:#1a1814;margin-bottom:10px;line-height:1.2">${st.title || ''}</h4>
          <p style="font-size:22px;color:#4a4640;line-height:1.55;font-weight:500">${st.body || st.text || ''}</p>
        </div>
      </div>`).join('')}
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── COMPARE template ──────────────────────────────────────────────────────────
const COMPARE = (s, index = 0, total = 5) => {
  const rows     = s.rows || [];
  const colA     = s.col_a   || 'A';
  const colB     = s.col_b   || 'B';
  const colorA   = s.col_a_color || '#1a4731';
  const colorB   = s.col_b_color || '#2563eb';
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const titleLen = (s.title || '').length;

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.tag || 'Vergelijking')}

  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:160px;padding-bottom:88px">

    <div style="flex-shrink:0;padding-bottom:36px">
      <h1 style="font-size:${titleLen > 38 ? '50' : titleLen > 24 ? '60' : '70'}px;font-weight:900;color:#1a1814;line-height:0.95;letter-spacing:-0.03em">${s.title || ''}</h1>
    </div>

    <!-- Tabel vult de rest -->
    <div style="flex:1;display:flex;flex-direction:column;min-height:0">
      <!-- Header row -->
      <div style="display:grid;grid-template-columns:200px 1fr 1fr;margin-bottom:8px;flex-shrink:0">
        <div></div>
        <div style="background:${colorA};border-radius:16px 16px 0 0;padding:22px 20px;text-align:center">
          <span style="font-size:30px;font-weight:800;color:#fff">${colA}</span>
        </div>
        <div style="background:${colorB};border-radius:16px 16px 0 0;padding:22px 20px;text-align:center;margin-left:10px">
          <span style="font-size:30px;font-weight:800;color:#fff">${colB}</span>
        </div>
      </div>

      <!-- Data rows -->
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;justify-content:space-between">
        ${rows.map((r) => `
        <div style="display:grid;grid-template-columns:200px 1fr 1fr;flex:1">
          <div style="background:#fff;border:1.5px solid rgba(26,71,49,0.1);border-radius:14px;padding:20px 22px;display:flex;align-items:center">
            <span style="font-size:20px;font-weight:700;color:#1a1814">${r.label || ''}</span>
          </div>
          <div style="background:${r.highlight ? '#f0fdf4' : '#fff'};border:1.5px solid ${r.highlight ? '#86efac' : 'rgba(26,71,49,0.1)'};border-radius:14px;padding:20px 22px;text-align:center;margin-left:10px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:20px;color:#1a1814;font-weight:600">${r.a || ''}</span>
          </div>
          <div style="background:${r.highlight ? '#eff6ff' : '#fff'};border:1.5px solid ${r.highlight ? '#bfdbfe' : 'rgba(26,71,49,0.1)'};border-radius:14px;padding:20px 22px;text-align:center;margin-left:10px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:20px;color:#1a1814;font-weight:600">${r.b || ''}</span>
          </div>
        </div>`).join('')}
      </div>

      ${s.footer_note ? `<div style="flex-shrink:0;margin-top:20px;background:#fff;border:1.5px solid rgba(26,71,49,0.15);border-left:5px solid #1a4731;border-radius:0 14px 14px 0;padding:22px 28px;font-size:22px;color:#1a4731;font-weight:700">${s.footer_note}</div>` : ''}
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── PERSONA template ──────────────────────────────────────────────────────────
const boolIcon = (over) => over
  ? `<div style="display:flex;align-items:center;justify-content:center;gap:5px"><span style="font-size:22px">❌</span><span style="font-size:15px;font-weight:700;color:#dc2626">Over</span></div>`
  : `<div style="display:flex;align-items:center;justify-content:center;gap:5px"><span style="font-size:22px">✅</span><span style="font-size:15px;font-weight:700;color:#16a34a">Veilig</span></div>`;

const adviesColor = { red: '#dc2626', orange: '#d97706', green: '#16a34a' };
const adviesBg    = { red: '#fef2f2', orange: '#fffbeb', green: '#f0fdf4' };

const PERSONA = (s, index = 0, total = 5) => {
  const personas = (s.personas || []).slice(0, 3);
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const rows = [
    { label: 'Platform',    key: 'platform',   type: 'text' },
    { label: 'Omzet NL',   key: 'omzet_nl',   type: 'text' },
    { label: 'Omzet EU',   key: 'omzet_eu',   type: 'text' },
    { label: 'Totaal',     key: 'totaal',     type: 'text', bold: true },
    { label: 'KOR (€20k)', key: 'kor',        type: 'bool' },
    { label: 'OSS (€10k)', key: 'oss',        type: 'bool' },
    { label: 'BTW-plicht', key: 'btw_plicht', type: 'bool' },
    { label: 'Advies',     key: 'advies',     type: 'advies' },
  ];

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.tag || 'Vergelijking')}

  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:160px;padding-bottom:88px">

    <div style="flex-shrink:0;padding-bottom:28px">
      <h1 style="font-size:${(s.title||'').length > 38 ? '50' : '62'}px;font-weight:900;color:#1a1814;line-height:0.95;letter-spacing:-0.03em${s.subtitle ? ';margin-bottom:10px' : ''}">${s.title || ''}</h1>
      ${s.subtitle ? `<p style="font-size:23px;color:#9a9088;font-weight:500">${s.subtitle}</p>` : ''}
    </div>

    <!-- Tabel vult de rest -->
    <div style="flex:1;background:#fff;border-radius:20px;overflow:hidden;border:1.5px solid rgba(26,71,49,0.12);display:flex;flex-direction:column;min-height:0">
      <!-- Avatar row -->
      <div style="display:grid;grid-template-columns:150px repeat(${personas.length},1fr);background:#f5f0e8;flex-shrink:0;border-bottom:2px solid rgba(26,71,49,0.1)">
        <div></div>
        ${personas.map(p => `
        <div style="display:flex;flex-direction:column;align-items:center;padding:22px 8px">
          <div style="width:76px;height:76px;border-radius:50%;background:${p.color || '#e8f0ec'};border:3px solid #1a4731;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#1a4731;margin-bottom:10px">${p.initials || (p.name || '?').slice(0, 2)}</div>
          <div style="font-size:20px;font-weight:800;color:#1a1814">${p.name}</div>
          <div style="font-size:15px;color:#9a9088">(${p.age})</div>
        </div>`).join('')}
      </div>
      <!-- Data rows vullen height -->
      <div style="flex:1;display:flex;flex-direction:column">
        ${rows.map((r, ri) => `
        <div style="display:grid;grid-template-columns:150px repeat(${personas.length},1fr);flex:1;background:${ri % 2 === 0 ? '#fff' : '#f9f8f5'};border-bottom:1px solid rgba(26,71,49,0.07)">
          <div style="padding:0 18px;font-size:17px;font-weight:700;color:#4a4640;border-right:1.5px solid rgba(26,71,49,0.07);display:flex;align-items:center">${r.label}</div>
          ${personas.map(p => {
            const val = p[r.key];
            let cell = '';
            if (r.type === 'bool') cell = boolIcon(val);
            else if (r.type === 'advies') cell = `<div style="padding:8px 12px;background:${adviesBg[p.advies_kleur] || '#f0fdf4'};border-radius:10px;font-size:16px;font-weight:800;color:${adviesColor[p.advies_kleur] || '#16a34a'};text-align:center;line-height:1.3">${val || ''}</div>`;
            else cell = `<span style="font-size:${r.bold ? '20' : '18'}px;font-weight:${r.bold ? '800' : '500'};color:#1a1814">${val || ''}</span>`;
            return `<div style="padding:0 12px;display:flex;align-items:center;justify-content:center;border-right:1px solid rgba(26,71,49,0.07)">${cell}</div>`;
          }).join('')}
        </div>`).join('')}
      </div>
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── LIST template ─────────────────────────────────────────────────────────────
const LIST = (s, index = 0, total = 5) => {
  const items    = s.items || [];
  const slideNum = String(index + 1).padStart(2, '0');
  const totalNum = String(total).padStart(2, '0');
  const titleLen = (s.title || '').length;

  return `${BASE('#f5f0e8')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#f5f0e8">
  ${CHROME(slideNum, totalNum, s.tag || 'Checklist')}

  <div style="position:absolute;top:0;left:56px;right:56px;bottom:0;display:flex;flex-direction:column;z-index:5;padding-top:160px;padding-bottom:88px">

    <div style="flex-shrink:0;padding-bottom:36px">
      <h1 style="font-size:${titleLen > 40 ? '50' : titleLen > 26 ? '60' : '70'}px;font-weight:900;color:#1a1814;line-height:0.95;letter-spacing:-0.03em">${s.title || ''}</h1>
    </div>

    <!-- Items vullen de rest van de hoogte -->
    <div style="flex:1;display:flex;flex-direction:column;gap:14px;justify-content:space-between;min-height:0">
      ${items.map(it => `
      <div style="display:flex;align-items:center;gap:24px;background:#fff;border:1.5px solid ${it.done ? '#86efac' : 'rgba(26,71,49,0.1)'};border-left:6px solid ${it.done ? '#22c55e' : '#c8c2b8'};border-radius:0 18px 18px 0;padding:28px 34px;flex:1">
        <div style="width:56px;height:56px;border-radius:50%;background:${it.done ? '#f0fdf4' : '#f5f0e8'};border:2.5px solid ${it.done ? '#22c55e' : '#c8c2b8'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:26px">${it.done ? '✅' : '○'}</div>
        <span style="font-size:26px;color:${it.done ? '#1a1814' : '#6b7280'};font-weight:${it.done ? '700' : '500'};line-height:1.3">${it.text || ''}</span>
      </div>`).join('')}
      ${s.note ? `<div style="flex-shrink:0;background:#1a4731;border-radius:16px;padding:24px 30px;font-size:20px;color:#fff;font-weight:600;line-height:1.4">${s.note}</div>` : ''}
    </div>
  </div>

  ${FOOTER(false, index, total)}
</div>
</body></html>`;
};

// ── CTA template (donkergroen, eindslide) ─────────────────────────────────────
const CTA = (s, index = 0, total = 5) => {
  const features = s.features || ['100% gratis', 'Alle platforms', 'Direct resultaat'];

  return `${BASE('#1a4731')}
<div style="width:1080px;height:1350px;position:relative;overflow:hidden;background:#1a4731">
  <div style="position:absolute;width:900px;height:900px;border-radius:50%;background:rgba(255,255,255,0.03);top:-350px;left:-200px;pointer-events:none"></div>
  <div style="position:absolute;top:0;right:88px;width:52px;height:96px;background:rgba(255,255,255,0.15);clip-path:polygon(0 0,100% 0,100% 100%,50% 78%,0 100%);z-index:10"></div>
  <div style="position:absolute;left:0;top:0;bottom:0;width:8px;background:rgba(255,255,255,0.15);z-index:10"></div>

  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 80px 100px;text-align:center;z-index:2">
    <div style="width:96px;height:96px;background:rgba(255,255,255,0.1);border-radius:24px;display:flex;align-items:center;justify-content:center;margin-bottom:44px">
      <svg width="50" height="50" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="rgba(255,255,255,0.9)"/></svg>
    </div>

    <h1 style="font-size:74px;font-weight:900;color:#fff;line-height:1.05;letter-spacing:-0.03em;margin-bottom:28px">${s.question || 'Weet jij waar jij staat?'}</h1>
    <p style="font-size:30px;color:rgba(255,255,255,0.7);line-height:1.48;max-width:800px;margin-bottom:56px;font-weight:500">${s.sub || 'Controleer gratis in 30 seconden — geen account nodig'}</p>

    ${DASHBOARD_MOCKUP()}

    <div style="background:#fff;border-radius:18px;padding:28px 64px;font-size:30px;font-weight:800;color:#1a4731;margin-top:44px;margin-bottom:36px">${s.button || 'Check mijn BTW-status →'}</div>

    <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center">
      ${features.map(f => `<div style="background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.2);border-radius:100px;padding:11px 24px;font-size:20px;color:rgba(255,255,255,0.75);font-weight:600">✓ ${f}</div>`).join('')}
    </div>
  </div>

  ${FOOTER(true, index, total)}
</div>
</body></html>`;
};

// ── Renderer ──────────────────────────────────────────────────────────────────
function renderSlide(slide, index = 0, total = 5) {
  switch (slide.template) {
    case 'hook':    return HOOK(slide, index, total);
    case 'stat':    return STAT(slide, index, total);
    case 'info':    return INFO(slide, index, total);
    case 'steps':   return STEPS(slide, index, total);
    case 'compare': return COMPARE(slide, index, total);
    case 'persona': return PERSONA(slide, index, total);
    case 'list':    return LIST(slide, index, total);
    case 'cta':     return CTA(slide, index, total);
    default:        return HOOK(slide, index, total);
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function screenshot(browser, htmlPath, pngPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  await page.close();
  console.log(`    📸 ${path.basename(pngPath)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY is not set'); process.exit(1); }

  const data    = loadTopics();
  const manifest = loadManifest();
  const pending  = pendingTopics(data);
  const maxRun   = data.settings?.maxPerRun || 8;

  if (!pending.length) { console.log('✅ No pending topics — queue is empty'); process.exit(0); }

  const toProcess = pending.slice(0, maxRun);
  console.log(`\n🎨 Generating ${toProcess.length} slide set(s)...\n`);

  const client  = new Anthropic();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  // Capture live website screenshots first
  console.log('📷 Capturing ZenBTW website screenshots...');
  await captureAssets(browser);
  console.log('');

  for (const item of toProcess) {
    console.log(`\n📌 "${item.topic}" [${item.type}]`);
    console.log('  Calling Claude...');

    let slideData;
    try {
      const msg = await client.messages.create({
        model: data.settings?.model || 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: buildPrompt(item.topic, item.type) }],
      });
      const raw = msg.content[0].text.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      slideData = JSON.parse(raw);
    } catch (err) {
      console.error(`  ❌ Claude/parse error: ${err.message}`);
      continue;
    }

    const slides = slideData.slides || [];
    if (!slides.length) { console.log('  ⚠️ No slides returned, skipping'); continue; }

    const setId  = `${TODAY}-${item.slug}`;
    const setDir = path.join(SLIDES_DIR, setId);
    fs.mkdirSync(setDir, { recursive: true });

    const htmlFiles = [], pngFiles = [];

    for (let i = 0; i < slides.length; i++) {
      const num      = String(i + 1).padStart(2, '0');
      const htmlPath = path.join(setDir, `${num}.html`);
      const pngPath  = path.join(setDir, `${num}.png`);

      fs.writeFileSync(htmlPath, renderSlide(slides[i], i, slides.length), 'utf8');
      await screenshot(browser, htmlPath, pngPath);

      htmlFiles.push(`slides/${setId}/${num}.html`);
      pngFiles.push(`slides/${setId}/${num}.png`);
    }

    console.log(`  ✅ ${slides.length} slides saved to slides/${setId}/`);

    manifest.sets.unshift({
      id: setId, topic: item.topic, date: TODAY, type: item.type,
      slides: slides.length, files: htmlFiles, pngs: pngFiles,
    });

    const idx = data.queue.findIndex(t => t.slug === item.slug);
    data.queue[idx].status    = 'published';
    data.queue[idx].publishedDate = TODAY;
    data.queue[idx].outputDir = `slides/${setId}`;
    data.published.push(data.queue[idx]);
    data.queue.splice(idx, 1);
  }

  await browser.close();
  saveManifest(manifest);
  saveTopics(data);
  console.log(`\n🎉 Done! ${toProcess.length} set(s) generated.`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
