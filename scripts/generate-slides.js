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
- Wissel lichte en donkere slides af voor visuele dynamiek (stat en cta zijn donker)
- Poster = 1 slide: gebruik "stat" of "hook" met dark:true
- CTA: vriendelijk en laagdrempelig — uitnodigend, niet urgent

Geef ALLEEN de JSON terug.`;
}

// ── Shared CSS ────────────────────────────────────────────────────────────────
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">`;

const BASE = (bg = '#f7f6f3') => `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;background:${bg};font-family:'Inter',sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased;color:#1a1814}
</style></head><body>`;

// Browser mockup frame wrapping a screenshot
const MOCKUP = (src, urlLabel = 'zenbtw.nl', maxH = 340) => {
  if (!src) return '';
  return `<div style="border-radius:14px;overflow:hidden;box-shadow:0 16px 56px rgba(0,0,0,0.2);border:1px solid rgba(0,0,0,0.07)">
  <div style="background:#1c1c1e;padding:13px 16px;display:flex;align-items:center;gap:8px">
    <div style="display:flex;gap:7px;flex-shrink:0">
      <div style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#febc2e"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#28c840"></div>
    </div>
    <div style="flex:1;background:#2c2c2e;border-radius:7px;padding:6px 14px;margin:0 8px;font-size:13px;color:#888;font-family:-apple-system,sans-serif;white-space:nowrap;overflow:hidden">🔒 ${urlLabel}</div>
  </div>
  <div style="overflow:hidden;height:${maxH}px">
    <img src="${src}" style="width:100%;display:block" />
  </div>
</div>`;
};

// Shared footer strip with shield logo + wordmark
const FOOTER = (dark = false) => `
<div style="flex-shrink:0;padding:30px 72px;display:flex;align-items:center;justify-content:space-between;border-top:${dark ? '1px solid rgba(255,255,255,0.12)' : '1.5px solid #e8e5de'}">
  <div style="display:flex;align-items:center;gap:13px">
    <div style="width:40px;height:40px;background:${dark ? 'rgba(255,255,255,0.14)' : '#1a4731'};border-radius:10px;display:flex;align-items:center;justify-content:center">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="${dark ? '#1a4731' : '#fff'}"/></svg>
    </div>
    <span style="font-family:'Inter',sans-serif;font-size:27px;font-weight:700;color:${dark ? '#fff' : '#1a4731'}">Zen<span style="color:${dark ? '#4ade80' : '#2d6a4f'}">BTW</span></span>
  </div>
  <span style="font-size:19px;color:${dark ? 'rgba(255,255,255,0.4)' : '#8a847a'};font-weight:500">zenbtw.nl</span>
</div>`;

// Tag pill
const TAG = (text, dark = false) => `<div style="display:inline-flex;align-items:center;padding:10px 22px;background:${dark ? 'rgba(255,255,255,0.12)' : '#e8f0ec'};border-radius:100px;font-size:17px;font-weight:700;color:${dark ? 'rgba(255,255,255,0.85)' : '#1a4731'};letter-spacing:0.05em;text-transform:uppercase;margin-bottom:28px">${text}</div>`;

// ── HOOK template ─────────────────────────────────────────────────────────────
const HOOK = (s) => {
  const dark      = s.dark === true;
  const bg        = dark ? '#1a4731' : '#f7f6f3';
  const tx        = dark ? '#fff'    : '#1a1814';
  const tx2       = dark ? 'rgba(255,255,255,0.72)' : '#4a4640';
  const hl        = dark ? '#4ade80' : '#1a4731';
  const titleLen  = (s.title || '').replace(/\n/g, '').length;
  const fs        = titleLen > 55 ? '70' : titleLen > 38 ? '80' : '90';
  const assetSrc  = ASSETS[s.asset] || ASSETS.tools || ASSETS.home || null;

  if (dark) {
    return `${BASE(bg)}
<div style="width:1080px;height:1920px;position:relative;overflow:hidden">
  <!-- Diagonale crème-sectie bovenin voor Daniel -->
  <div style="position:absolute;top:0;left:0;right:0;height:860px;background:#f5f3ee;clip-path:polygon(0 0,100% 0,100% 720px,0 860px)"></div>

  <!-- Dot patroon crème sectie -->
  <svg style="position:absolute;top:0;left:0;width:100%;height:860px;opacity:0.04" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="1.5" fill="#1a4731"/></pattern></defs>
    <rect width="1080" height="860" fill="url(#dots)"/>
  </svg>

  <!-- Groene ondersectie -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:1120px;background:#1a4731"></div>
  <svg style="position:absolute;bottom:0;left:0;width:100%;height:1120px;opacity:0.03" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="grid" x="0" y="0" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M 64 0 L 0 0 0 64" fill="none" stroke="#fff" stroke-width="0.6"/></pattern></defs>
    <rect width="1080" height="1120" fill="url(#grid)"/>
  </svg>

  <!-- Badge linksboven -->
  ${s.tag ? `<div style="position:absolute;top:68px;left:72px;z-index:10;display:inline-flex;align-items:center;gap:10px;background:#1a4731;border-radius:100px;padding:10px 24px">
    <div style="width:7px;height:7px;border-radius:50%;background:#4ade80"></div>
    <span style="font-size:16px;font-weight:800;color:#fff;letter-spacing:0.08em;text-transform:uppercase">${s.tag}</span>
  </div>` : ''}

  <!-- Daniel presentator -->
  <img src="../assets/daniel-presentator.png"
       style="position:absolute;top:30px;right:-20px;width:410px;height:auto;z-index:6"
       alt="Daniel - ZenBTW">

  <!-- Speech bubble bij Daniel -->
  ${s.sub ? `<div style="position:absolute;top:330px;right:355px;z-index:7;background:#fff;border-radius:18px 18px 18px 4px;padding:15px 20px;box-shadow:0 6px 28px rgba(0,0,0,0.1);max-width:210px">
    <div style="font-size:17px;font-weight:700;color:#1a1814;line-height:1.35">${s.sub}</div>
    <div style="position:absolute;left:18px;bottom:-12px;width:0;height:0;border-left:12px solid transparent;border-right:0;border-top:12px solid #fff"></div>
  </div>` : ''}

  <!-- Hoofd content onderste sectie -->
  <div style="position:absolute;top:810px;left:0;right:0;padding:0 72px;z-index:8">
    <h1 style="font-size:${fs}px;font-weight:900;line-height:0.94;letter-spacing:-0.04em;color:#fff;margin-bottom:20px;white-space:pre-line">${(s.title || '').replace(/<[^>]+>/g, '')}${s.highlight ? `\n<span style="color:#4ade80">${s.highlight}</span>` : ''}</h1>
    ${assetSrc ? `<div style="margin-bottom:36px">${MOCKUP(assetSrc, 'zenbtw.nl', 260)}</div>` : ''}
    ${s.pill ? `<div style="display:inline-flex;align-items:center;gap:12px;background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.18);border-radius:100px;padding:16px 34px;font-size:24px;font-weight:700;color:rgba(255,255,255,0.9);margin-top:24px">${s.pill}</div>` : ''}
  </div>

  ${FOOTER(true)}
</div>
</body></html>`;
  }

  // Light variant — browser mockup fills top, text below
  return `${BASE(bg)}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column;position:relative;overflow:hidden">
  <div style="position:absolute;left:0;top:0;bottom:0;width:10px;background:#1a4731"></div>
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  ${assetSrc ? `<div style="padding:44px 72px 0;flex-shrink:0;position:relative;z-index:2">${MOCKUP(assetSrc, 'zenbtw.nl', 360)}</div>` : ''}

  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:36px 80px 36px 90px;position:relative;z-index:2">
    ${s.tag ? TAG(s.tag) : ''}
    <h1 style="font-family:'Inter',sans-serif;font-size:${fs}px;font-weight:900;line-height:1.08;letter-spacing:-0.03em;color:${tx};margin-bottom:26px;white-space:pre-line">${(s.title || '').replace(/<[^>]+>/g, '')}${s.highlight ? `\n<span style="color:${hl}">${s.highlight}</span>` : ''}</h1>
    ${s.sub ? `<p style="font-size:30px;color:${tx2};line-height:1.5;font-weight:500;max-width:860px;margin-bottom:44px">${s.sub}</p>` : ''}
    ${s.pill ? `<div style="display:inline-flex;align-items:center;gap:12px;background:#fff3cd;border:2px solid #f0c040;border-radius:100px;padding:16px 34px;font-size:26px;font-weight:700;color:#7a5c00;width:fit-content">${s.pill}</div>` : ''}
  </div>
  ${FOOTER()}
</div>
</body></html>`;
};

// ── STAT template ─────────────────────────────────────────────────────────────
const STAT = (s) => {
  const numLen   = (s.number || '').length;
  const numFs    = numLen > 7 ? '120' : numLen > 5 ? '148' : numLen > 3 ? '180' : '210';
  const assetSrc = ASSETS[s.asset] || ASSETS.home || null;

  return `${BASE('#1a4731')}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column;position:relative;overflow:hidden">
  <div style="position:absolute;width:1100px;height:1100px;border-radius:50%;background:rgba(255,255,255,0.03);top:-500px;right:-350px;pointer-events:none"></div>
  <div style="position:absolute;right:0;bottom:0;width:400px;height:400px;background:rgba(255,255,255,0.03);border-radius:400px 0 0 0;pointer-events:none"></div>
  <div style="height:10px;background:rgba(255,255,255,0.18);flex-shrink:0"></div>

  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:72px 90px 40px;position:relative;z-index:2">
    ${s.eyebrow ? `<div style="display:flex;align-items:center;gap:16px;margin-bottom:44px">
      <div style="width:48px;height:3px;background:rgba(255,255,255,0.4);border-radius:2px"></div>
      <span style="font-size:20px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.55)">${s.eyebrow}</span>
    </div>` : ''}

    <div style="font-family:'Inter',sans-serif;font-size:${numFs}px;font-weight:900;color:#fff;line-height:0.88;letter-spacing:-0.04em;margin-bottom:28px">${s.number || ''}</div>
    <div style="font-size:40px;color:rgba(255,255,255,0.88);font-weight:600;line-height:1.28;max-width:840px;margin-bottom:40px">${s.label || ''}</div>

    ${s.context ? `<div style="background:rgba(255,255,255,0.09);border:1.5px solid rgba(255,255,255,0.13);border-radius:18px;padding:28px 36px;margin-bottom:40px">
      <p style="font-size:25px;color:rgba(255,255,255,0.72);line-height:1.55">${s.context}</p>
    </div>` : ''}

    ${assetSrc ? MOCKUP(assetSrc, 'zenbtw.nl · BTW checker', 310) : ''}

    ${s.source ? `<div style="margin-top:24px;font-size:18px;color:rgba(255,255,255,0.3);font-weight:500">${s.source}</div>` : ''}
  </div>
  ${FOOTER(true)}
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

const INFO = (s) => {
  const cards    = (s.cards || []).slice(0, 4);
  const twoCol   = cards.length === 4;
  const assetSrc = ASSETS[s.asset] || ASSETS.tools || ASSETS.home || null;

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:48px 72px 24px;flex-shrink:0">
    <h1 style="font-family:'Inter',sans-serif;font-size:${(s.title || '').length > 42 ? '50' : '58'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
  </div>

  ${assetSrc ? `<div style="padding:0 72px 28px;flex-shrink:0">${MOCKUP(assetSrc, 'zenbtw.nl', 240)}</div>` : ''}

  <div style="flex:1;padding:0 72px;display:${twoCol ? 'grid' : 'flex'};${twoCol ? 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:20px' : 'flex-direction:column;gap:20px'};align-content:center">
    ${cards.map(c => {
      const a = accentStyles[c.accent] || accentStyles.neutral;
      return `<div style="background:${a.bg};border:1.5px solid ${a.border};border-left:6px solid ${a.bar};border-radius:0 18px 18px 0;padding:${twoCol ? '28px 32px' : '30px 40px'};display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:center;gap:16px">
          <div style="font-size:${twoCol ? '40' : '44'}px;flex-shrink:0">${c.icon || '•'}</div>
          <h3 style="font-size:${twoCol ? '24' : '28'}px;font-weight:800;color:${a.title};line-height:1.2">${c.title || ''}</h3>
        </div>
        <p style="font-size:${twoCol ? '21' : '24'}px;color:${a.body};line-height:1.55;font-weight:500">${c.body || c.text || ''}</p>
      </div>`;
    }).join('')}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── STEPS template ────────────────────────────────────────────────────────────
const STEPS = (s) => {
  const steps    = (s.steps || []).slice(0, 5);
  const manySteps = steps.length >= 4;
  const fs       = manySteps ? '21' : '24';
  const titleFs  = manySteps ? '22' : '25';
  const pad      = manySteps ? '24px 30px' : '28px 36px';
  const assetSrc = ASSETS[s.asset] || ASSETS.tools || ASSETS.home || null;

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:48px 72px 24px;flex-shrink:0">
    <h1 style="font-family:'Inter',sans-serif;font-size:${(s.title || '').length > 42 ? '50' : '56'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em;margin-bottom:${s.subtitle ? '14px' : '0'}">${s.title || ''}</h1>
    ${s.subtitle ? `<p style="font-size:25px;color:#8a847a;font-weight:500">${s.subtitle}</p>` : ''}
  </div>

  ${assetSrc ? `<div style="padding:0 72px 24px;flex-shrink:0">${MOCKUP(assetSrc, 'zenbtw.nl', 240)}</div>` : ''}

  <div style="flex:1;padding:0 72px;display:flex;flex-direction:column;gap:16px;justify-content:center">
    ${steps.map((st, i) => `
    <div style="display:flex;gap:24px;align-items:stretch">
      <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
        <div style="width:60px;height:60px;background:#1a4731;border-radius:14px;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;font-size:24px;font-weight:700;color:#fff;flex-shrink:0">${String(i + 1).padStart(2, '0')}</div>
        ${i < steps.length - 1 ? `<div style="width:2px;flex:1;background:linear-gradient(to bottom,#1a4731 0%,rgba(26,71,49,0.1) 100%);margin:5px 0;min-height:16px"></div>` : ''}
      </div>
      <div style="background:#fff;border:1.5px solid #e8e5de;border-radius:16px;padding:${pad};flex:1">
        <h4 style="font-size:${titleFs}px;font-weight:700;color:#1a1814;margin-bottom:7px;line-height:1.2">${st.title || ''}</h4>
        <p style="font-size:${fs}px;color:#4a4640;line-height:1.5">${st.body || st.text || ''}</p>
      </div>
    </div>`).join('')}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── COMPARE template ──────────────────────────────────────────────────────────
const COMPARE = (s) => {
  const rows   = s.rows || [];
  const colA   = s.col_a   || 'A';
  const colB   = s.col_b   || 'B';
  const colorA = s.col_a_color || '#1a4731';
  const colorB = s.col_b_color || '#2563eb';

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <!-- Top accent strip with tiny mockup -->
  ${ASSETS.tools ? `<div style="flex-shrink:0;margin:0;overflow:hidden;height:200px;position:relative">
    <img src="${ASSETS.tools}" style="width:100%;position:absolute;top:0;left:0;filter:brightness(0.4) saturate(0.6)" />
    <div style="position:absolute;inset:0;display:flex;align-items:center;padding:0 72px">
      <h1 style="font-family:'Inter',sans-serif;font-size:${(s.title || '').length > 38 ? '46' : '54'}px;font-weight:700;color:#fff;line-height:1.1;letter-spacing:-0.02em;text-shadow:0 2px 16px rgba(0,0,0,0.4)">${s.title || ''}</h1>
    </div>
  </div>` : `<div style="padding:52px 72px 24px;flex-shrink:0">
    <h1 style="font-family:'Inter',sans-serif;font-size:${(s.title || '').length > 38 ? '48' : '56'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
  </div>`}

  <div style="flex:1;padding:${ASSETS.tools ? '28px' : '0'} 72px;display:flex;flex-direction:column;justify-content:center">
    <!-- Header row -->
    <div style="display:grid;grid-template-columns:260px 1fr 1fr;margin-bottom:10px">
      <div></div>
      <div style="background:${colorA};border-radius:14px 14px 0 0;padding:20px 24px;text-align:center">
        <span style="font-family:'Inter',sans-serif;font-size:30px;font-weight:700;color:#fff">${colA}</span>
      </div>
      <div style="background:${colorB};border-radius:14px 14px 0 0;padding:20px 24px;text-align:center;margin-left:8px">
        <span style="font-family:'Inter',sans-serif;font-size:30px;font-weight:700;color:#fff">${colB}</span>
      </div>
    </div>
    ${rows.map((r, i) => `
    <div style="display:grid;grid-template-columns:260px 1fr 1fr;margin-bottom:8px">
      <div style="background:${r.highlight ? '#f0fdf4' : '#fff'};border:1.5px solid ${r.highlight ? '#86efac' : '#e8e5de'};border-radius:12px;padding:18px 20px;display:flex;align-items:center">
        <span style="font-size:20px;font-weight:700;color:#1a1814">${r.label || ''}</span>
      </div>
      <div style="background:${r.highlight ? '#f0fdf4' : (i % 2 === 0 ? '#fff' : '#f9f8f5')};border:1.5px solid ${r.highlight ? '#86efac' : '#e8e5de'};border-radius:12px;padding:18px 24px;text-align:center;margin-left:8px;display:flex;align-items:center;justify-content:center">
        <span style="font-size:20px;color:#1a1814;font-weight:500">${r.a || ''}</span>
      </div>
      <div style="background:${r.highlight ? '#eff6ff' : (i % 2 === 0 ? '#fff' : '#f9f8f5')};border:1.5px solid ${r.highlight ? '#bfdbfe' : '#e8e5de'};border-radius:12px;padding:18px 24px;text-align:center;margin-left:8px;display:flex;align-items:center;justify-content:center">
        <span style="font-size:20px;color:#1a1814;font-weight:500">${r.b || ''}</span>
      </div>
    </div>`).join('')}
    ${s.footer_note ? `<div style="margin-top:20px;background:#e8f0ec;border-radius:12px;padding:18px 24px;font-size:21px;color:#1a4731;font-weight:600;text-align:center">${s.footer_note}</div>` : ''}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── PERSONA template ──────────────────────────────────────────────────────────
const boolIcon = (over) => over
  ? `<div style="display:flex;align-items:center;justify-content:center;gap:5px"><span style="font-size:22px">❌</span><span style="font-size:15px;font-weight:700;color:#dc2626">Over</span></div>`
  : `<div style="display:flex;align-items:center;justify-content:center;gap:5px"><span style="font-size:22px">✅</span><span style="font-size:15px;font-weight:700;color:#16a34a">Veilig</span></div>`;

const adviesColor = { red: '#dc2626', orange: '#d97706', green: '#16a34a' };
const adviesBg    = { red: '#fef2f2', orange: '#fffbeb', green: '#f0fdf4' };

const PERSONA = (s) => {
  const personas = (s.personas || []).slice(0, 3);
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

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <!-- Header with blurred site screenshot background -->
  ${ASSETS.tools ? `<div style="flex-shrink:0;height:180px;position:relative;overflow:hidden">
    <img src="${ASSETS.tools}" style="width:100%;position:absolute;top:0;left:0;filter:brightness(0.35) saturate(0.5)" />
    <div style="position:absolute;inset:0;padding:0 56px;display:flex;flex-direction:column;justify-content:center">
      <h1 style="font-family:'Inter',sans-serif;font-size:50px;font-weight:700;color:#fff;line-height:1.1;letter-spacing:-0.02em;text-shadow:0 2px 12px rgba(0,0,0,0.4)">${s.title || ''}</h1>
      ${s.subtitle ? `<p style="font-size:22px;color:rgba(255,255,255,0.7);font-weight:500;margin-top:8px">${s.subtitle}</p>` : ''}
    </div>
  </div>` : `<div style="padding:44px 56px 20px;flex-shrink:0">
    <h1 style="font-family:'Inter',sans-serif;font-size:50px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
    ${s.subtitle ? `<p style="font-size:22px;color:#8a847a;font-weight:500;margin-top:8px">${s.subtitle}</p>` : ''}
  </div>`}

  <!-- Avatar row -->
  <div style="display:grid;grid-template-columns:190px repeat(${personas.length},1fr);padding:0 56px;flex-shrink:0;background:#fff;border-bottom:1.5px solid #e8e5de">
    <div></div>
    ${personas.map(p => `
    <div style="display:flex;flex-direction:column;align-items:center;padding:18px 8px">
      <div style="width:76px;height:76px;border-radius:50%;background:${p.color || '#e8f0ec'};border:3px solid #1a4731;display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;font-size:24px;font-weight:700;color:#1a4731;margin-bottom:8px">${p.initials || (p.name || '?').slice(0, 2)}</div>
      <div style="font-size:19px;font-weight:700;color:#1a1814">${p.name}</div>
      <div style="font-size:15px;color:#8a847a">(${p.age})</div>
    </div>`).join('')}
  </div>

  <!-- Table rows -->
  <div style="flex:1;padding:0 56px;display:flex;flex-direction:column;justify-content:center">
    ${rows.map((r, ri) => `
    <div style="display:grid;grid-template-columns:190px repeat(${personas.length},1fr);background:${ri % 2 === 0 ? '#fff' : '#f7f6f3'};border-bottom:1px solid #e8e5de;${ri === 0 ? 'border-top:1px solid #e8e5de' : ''}">
      <div style="padding:16px 14px;font-size:17px;font-weight:700;color:#4a4640;border-right:1.5px solid #e8e5de;display:flex;align-items:center">${r.label}</div>
      ${personas.map(p => {
        const val = p[r.key];
        let cell = '';
        if (r.type === 'bool') cell = boolIcon(val);
        else if (r.type === 'advies') cell = `<div style="padding:7px 10px;background:${adviesBg[p.advies_kleur] || '#f0fdf4'};border-radius:8px;font-size:16px;font-weight:800;color:${adviesColor[p.advies_kleur] || '#16a34a'};text-align:center;line-height:1.2">${val || ''}</div>`;
        else cell = `<span style="font-size:${r.bold ? '19' : '17'}px;font-weight:${r.bold ? '700' : '500'};color:#1a1814">${val || ''}</span>`;
        return `<div style="padding:13px 10px;display:flex;align-items:center;justify-content:center;border-right:1px solid #e8e5de">${cell}</div>`;
      }).join('')}
    </div>`).join('')}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── LIST template ─────────────────────────────────────────────────────────────
const LIST = (s) => {
  const items    = s.items || [];
  const assetSrc = ASSETS[s.asset] || ASSETS.tools || ASSETS.home || null;

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:48px 72px 20px;flex-shrink:0">
    ${s.tag ? TAG(s.tag) : ''}
    <h1 style="font-family:'Inter',sans-serif;font-size:${(s.title || '').length > 40 ? '50' : '58'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
  </div>

  ${assetSrc ? `<div style="padding:0 72px 24px;flex-shrink:0">${MOCKUP(assetSrc, 'zenbtw.nl · hulpmiddelen', 240)}</div>` : ''}

  <div style="flex:1;padding:0 72px;display:flex;flex-direction:column;gap:18px;justify-content:center">
    ${items.map(it => `
    <div style="display:flex;align-items:center;gap:24px;background:#fff;border:1.5px solid ${it.done ? '#86efac' : '#e8e5de'};border-left:6px solid ${it.done ? '#22c55e' : '#d1d5db'};border-radius:0 16px 16px 0;padding:26px 32px">
      <div style="width:52px;height:52px;border-radius:50%;background:${it.done ? '#f0fdf4' : '#f9f8f5'};border:2.5px solid ${it.done ? '#22c55e' : '#d1d5db'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:26px">${it.done ? '✅' : '○'}</div>
      <span style="font-size:26px;color:${it.done ? '#1a1814' : '#6b7280'};font-weight:${it.done ? '600' : '500'}">${it.text || ''}</span>
    </div>`).join('')}
    ${s.note ? `<div style="margin-top:6px;background:#e8f0ec;border-radius:14px;padding:22px 28px;font-size:21px;color:#1a4731;font-weight:600">${s.note}</div>` : ''}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── CTA template ──────────────────────────────────────────────────────────────
const CTA = (s) => {
  const features = s.features || ['100% gratis', 'Alle platforms', 'Direct resultaat'];
  const assetSrc = ASSETS.home || ASSETS.tools || null;

  return `${BASE('#1a4731')}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column;position:relative;overflow:hidden">
  <div style="position:absolute;width:900px;height:900px;border-radius:50%;background:rgba(255,255,255,0.04);top:-350px;left:-200px;pointer-events:none"></div>
  <div style="height:10px;background:rgba(255,255,255,0.15);flex-shrink:0"></div>

  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 80px 40px;position:relative;z-index:2;text-align:center">
    <!-- Shield icon -->
    <div style="width:100px;height:100px;background:rgba(255,255,255,0.1);border-radius:24px;display:flex;align-items:center;justify-content:center;margin-bottom:40px">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="rgba(255,255,255,0.9)"/></svg>
    </div>

    <h1 style="font-family:'Inter',sans-serif;font-size:76px;font-weight:900;color:#fff;line-height:1.05;letter-spacing:-0.03em;margin-bottom:28px">${s.question || 'Weet jij waar jij staat?'}</h1>
    <p style="font-size:30px;color:rgba(255,255,255,0.7);line-height:1.48;max-width:800px;margin-bottom:44px;font-weight:500">${s.sub || 'Controleer gratis in 30 seconden — geen account nodig'}</p>

    <!-- Product screenshot -->
    ${assetSrc ? `<div style="width:100%;margin-bottom:44px">${MOCKUP(assetSrc, 'zenbtw.nl', 360)}</div>` : ''}

    <!-- CTA button -->
    <div style="background:#fff;border-radius:18px;padding:28px 64px;font-size:32px;font-weight:800;color:#1a4731;margin-bottom:36px;letter-spacing:-0.01em">${s.button || 'Check mijn BTW-status →'}</div>

    <!-- Feature pills -->
    <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center">
      ${features.map(f => `<div style="background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.18);border-radius:100px;padding:11px 24px;font-size:20px;color:rgba(255,255,255,0.72);font-weight:600">✓ ${f}</div>`).join('')}
    </div>
  </div>

  ${FOOTER(true)}
</div>
</body></html>`;
};

// ── Renderer ──────────────────────────────────────────────────────────────────
function renderSlide(slide) {
  switch (slide.template) {
    case 'hook':    return HOOK(slide);
    case 'stat':    return STAT(slide);
    case 'info':    return INFO(slide);
    case 'steps':   return STEPS(slide);
    case 'compare': return COMPARE(slide);
    case 'persona': return PERSONA(slide);
    case 'list':    return LIST(slide);
    case 'cta':     return CTA(slide);
    default:        return HOOK(slide);
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function screenshot(browser, htmlPath, pngPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
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

      fs.writeFileSync(htmlPath, renderSlide(slides[i]), 'utf8');
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
