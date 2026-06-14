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
function loadTopics() { return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8')); }
function saveTopics(d) { fs.writeFileSync(TOPICS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

function loadManifest() {
  if (fs.existsSync(MANIFEST)) return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return { sets: [] };
}
function saveManifest(d) { fs.writeFileSync(MANIFEST, JSON.stringify(d, null, 2), 'utf8'); }

function pendingTopics(data) {
  return data.queue
    .filter(t => t.status === 'pending')
    .sort((a, b) => a.priority - b.priority);
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(topic, type) {
  const slideCount = type === 'poster' ? 1 : 'tussen 4 en 6';
  const typeDesc = type === 'poster'
    ? 'één krachtige losse poster (1 slide)'
    : 'een Instagram/TikTok carrousel (4-6 slides)';

  return `Je bent een social media content expert die viral informatieve content maakt voor Nederlandse marketplace verkopers (Vinted, Etsy, Shopify, Marktplaats). Je begrijpt hoe creators zoals Graham Stephan, Humphrey Yang en Nederlandse finfluencers hun visuals opbouwen.

Maak ${typeDesc} over het onderwerp: "${topic}"

De content is voor ZenBTW — een gratis BTW-tool voor marketplace verkopers. Gebruik de ZenBTW-stijl (donkergroen #1a4731, clean, modern) maar zet NIET op elke slide een logo of merknaam. Laat het voelen als nuttige, authentieke content.

Geef de output als geldig JSON (geen markdown, geen uitleg eromheen):

{
  "type": "${type}",
  "slides": [
    {
      "template": "hook|stat|info|steps|compare|cta",
      ... template-specifieke velden (zie hieronder)
    }
  ]
}

TEMPLATE SPECIFICATIES:

"hook" — pakkende openingsslide:
{
  "template": "hook",
  "title": "Meerdere regels\ntekst hier",
  "highlight": "Dit deel wordt groen gekleurd",
  "sub": "Ondertitel in kleinere tekst",
  "label": "Optionele pil onderaan zoals '⚠️ Swipe voor de feiten'"
}

"stat" — één groot cijfer of feit (donkergroene achtergrond):
{
  "template": "stat",
  "eyebrow": "KOR 2026",
  "number": "€20k",
  "label": "is de grens waarboven je BTW moet afdragen",
  "context": "Aanvullende uitlegzin van max 1-2 zinnen",
  "source": "Bron: Belastingdienst.nl"
}

"info" — 2-4 informatiekaartjes:
{
  "template": "info",
  "title": "Wanneer meldt Vinted jou?",
  "cards": [
    {"icon": "🎯", "title": "DAC7 drempel", "text": "30 verkopen én meer dan €2.000 omzet per jaar", "type": "green|warn|neutral"},
    {"icon": "✅", "title": "Beide drempels", "text": "Dan wordt jouw naam, BSN en omzet gedeeld", "type": "red"},
    {"icon": "💡", "title": "Eén drempel", "text": "28 verkopen maar €4.000 omzet? Geen melding.", "type": "green"}
  ]
}

"steps" — genummerd stappenplan:
{
  "template": "steps",
  "title": "Zo doe je OSS-aangifte in 3 stappen",
  "steps": [
    {"num": "01", "title": "Registreer bij Belastingdienst", "text": "Via Mijn Belastingdienst Zakelijk, kies 'Aanmelden OSS'"},
    {"num": "02", "title": "Houd je EU-omzet bij", "text": "Per land en per BTW-tarief apart administreren"},
    {"num": "03", "title": "Dien kwartaalaangifte in", "text": "Uiterlijk laatste dag van de maand na het kwartaal"}
  ]
}

"compare" — vergelijkingstabel:
{
  "template": "compare",
  "title": "KOR vs OSS — wat past bij jou?",
  "headers": ["", "KOR", "OSS"],
  "rows": [
    ["Grens", "€20.000 NL", "€10.000 EU"],
    ["BTW afdragen", "❌ Nee", "✅ Ja"],
    ["Voor wie", "Kleine NL-verkoper", "EU-verkoper"]
  ]
}

"cta" — laatste slide (call to action):
{
  "template": "cta",
  "question": "Weet jij of je de grens nadert?",
  "sub": "Controleer het gratis in 30 seconden",
  "action": "Check mijn BTW-status →",
  "url_label": "zenbtw.nl"
}

REGELS:
- Schrijf in correct, informeel Nederlands
- Gebruik echte bedragen en drempels (KOR €20k NL, OSS €10k EU, DAC7 30 transacties + €2k)
- Maak de hook-slide pakkend — een statement dat mensen doen stoppen met scrollen
- Geen overmatige branding — één vermelding van ZenBTW max (in de CTA of context)
- De carrousel moet logisch opbouwen: hook → uitleg → details → CTA
- Poster: 1 slide, type "stat" of "hook"

Geef ALLEEN de JSON terug, niets anders.`;
}

// ── HTML templates ────────────────────────────────────────────────────────────
const BASE_HEAD = (title) => `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;font-family:'Plus Jakarta Sans',sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased}
</style>
</head>
<body>`;

const HOOK = (s) => `${BASE_HEAD(s.title || 'Hook')}
<div style="width:1080px;height:1920px;background:#f7f6f3;display:flex;flex-direction:column;position:relative">
  <div style="height:8px;background:linear-gradient(90deg,#1a4731,#2d6a4f,#1a4731);flex-shrink:0"></div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:80px 90px;position:relative">
    <div style="font-family:'Fraunces',serif;font-size:200px;color:#1a4731;opacity:0.07;line-height:1;margin-bottom:-80px;margin-left:-10px">"</div>
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 60 ? '72' : '88'}px;font-weight:700;line-height:1.12;color:#1a1814;letter-spacing:-0.02em;margin-bottom:40px;white-space:pre-line">${s.title || ''}<br><span style="color:#1a4731">${s.highlight || ''}</span></h1>
    ${s.sub ? `<p style="font-size:34px;color:#4a4640;line-height:1.5;font-weight:500;margin-bottom:60px">${s.sub}</p>` : ''}
    ${s.label ? `<div style="display:inline-flex;align-items:center;gap:12px;background:#fff3cd;border:2px solid #f0c040;border-radius:100px;padding:16px 32px;font-size:28px;font-weight:700;color:#7a5c00;width:fit-content">${s.label}</div>` : ''}
  </div>
  ${s.slideNum !== undefined ? `<div style="display:flex;gap:8px;align-items:center;justify-content:center;padding:0 0 24px"><div style="width:24px;height:6px;border-radius:3px;background:#1a4731;opacity:0.8"></div>${Array(Math.max(0,(s.totalSlides||6)-1)).fill(0).map(()=>'<div style="width:8px;height:8px;border-radius:50%;background:#c8c2b8"></div>').join('')}</div>` : ''}
  <div style="padding:36px 90px;display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid #e8e5de">
    <span style="font-family:'Fraunces',serif;font-size:30px;font-weight:700;color:#1a4731">ZenBTW</span>
    <span style="font-size:20px;color:#8a847a;font-weight:500">BTW checker voor verkopers</span>
  </div>
</div>
</body></html>`;

const STAT = (s) => `${BASE_HEAD(s.label || 'Stat')}
<div style="width:1080px;height:1920px;background:#1a4731;display:flex;flex-direction:column;position:relative;overflow:hidden">
  <div style="position:absolute;width:700px;height:700px;border-radius:50%;background:rgba(255,255,255,0.04);top:-200px;right:-200px"></div>
  <div style="position:absolute;width:500px;height:500px;border-radius:50%;background:rgba(255,255,255,0.04);bottom:100px;left:-150px"></div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:100px 90px;position:relative;z-index:2">
    ${s.eyebrow ? `<div style="font-size:20px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:40px;display:flex;align-items:center;gap:12px"><span style="display:block;width:40px;height:2px;background:rgba(255,255,255,0.3)"></span>${s.eyebrow}</div>` : ''}
    <div style="font-family:'Fraunces',serif;font-size:${s.number && s.number.length > 4 ? '160' : '200'}px;font-weight:900;color:#fff;line-height:0.9;letter-spacing:-0.04em;margin-bottom:32px">${s.number || ''}</div>
    <div style="font-size:42px;color:rgba(255,255,255,0.85);font-weight:600;line-height:1.3;margin-bottom:50px;max-width:820px">${s.label || ''}</div>
    ${s.context ? `<div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:28px 36px;font-size:26px;color:rgba(255,255,255,0.7);line-height:1.5;max-width:860px">${s.context}</div>` : ''}
    ${s.source ? `<div style="margin-top:32px;font-size:18px;color:rgba(255,255,255,0.35);font-weight:500">${s.source}</div>` : ''}
  </div>
  <div style="padding:40px 90px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,0.12);position:relative;z-index:2">
    <span style="font-family:'Fraunces',serif;font-size:32px;font-weight:700;color:rgba(255,255,255,0.9)">ZenBTW</span>
    <div style="background:rgba(255,255,255,0.12);border-radius:100px;padding:12px 28px;font-size:20px;color:rgba(255,255,255,0.7);font-weight:600">zenbtw.nl</div>
  </div>
</div>
</body></html>`;

const cardBg = (t) => t === 'red' ? '#fef2f2' : t === 'green' ? '#f0fdf4' : t === 'warn' ? '#fffbeb' : '#fff';
const cardBorder = (t) => t === 'red' ? '#fecaca' : t === 'green' ? '#86efac' : t === 'warn' ? '#f0c040' : '#e8e5de';

const INFO = (s) => `${BASE_HEAD(s.title || 'Info')}
<div style="width:1080px;height:1920px;background:#f7f6f3;display:flex;flex-direction:column">
  <div style="height:8px;background:linear-gradient(90deg,#1a4731,#2d6a4f,#1a4731);flex-shrink:0"></div>
  <div style="padding:56px 90px 40px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 40 ? '54' : '62'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
  </div>
  <div style="flex:1;padding:0 90px;display:flex;flex-direction:column;gap:24px;justify-content:center">
    ${(s.cards || []).map(c => `
    <div style="background:${cardBg(c.type)};border:1.5px solid ${cardBorder(c.type)};border-radius:20px;padding:36px 44px;display:flex;align-items:flex-start;gap:28px">
      <div style="font-size:44px;flex-shrink:0;margin-top:2px">${c.icon || '•'}</div>
      <div>
        <h4 style="font-size:28px;font-weight:700;color:#1a1814;margin-bottom:10px">${c.title || ''}</h4>
        <p style="font-size:24px;color:#4a4640;line-height:1.5">${c.text || ''}</p>
      </div>
    </div>`).join('')}
  </div>
  <div style="padding:36px 90px;display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid #e8e5de;flex-shrink:0">
    <span style="font-family:'Fraunces',serif;font-size:30px;font-weight:700;color:#1a4731">ZenBTW</span>
    <span style="font-size:20px;color:#8a847a">zenbtw.nl</span>
  </div>
</div>
</body></html>`;

const STEPS = (s) => `${BASE_HEAD(s.title || 'Steps')}
<div style="width:1080px;height:1920px;background:#f7f6f3;display:flex;flex-direction:column">
  <div style="height:8px;background:linear-gradient(90deg,#1a4731,#2d6a4f,#1a4731);flex-shrink:0"></div>
  <div style="padding:56px 90px 40px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 40 ? '54' : '60'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
  </div>
  <div style="flex:1;padding:0 90px;display:flex;flex-direction:column;gap:28px;justify-content:center">
    ${(s.steps || []).map((st, i) => `
    <div style="background:#fff;border:1.5px solid #e8e5de;border-radius:20px;padding:36px 44px;display:flex;align-items:flex-start;gap:32px;position:relative">
      <div style="width:72px;height:72px;background:#1a4731;border-radius:16px;display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:28px;font-weight:700;color:#fff;flex-shrink:0">${st.num || String(i+1).padStart(2,'0')}</div>
      <div>
        <h4 style="font-size:28px;font-weight:700;color:#1a1814;margin-bottom:8px">${st.title || ''}</h4>
        <p style="font-size:22px;color:#4a4640;line-height:1.5">${st.text || ''}</p>
      </div>
      ${i < (s.steps.length - 1) ? `<div style="position:absolute;left:90px;bottom:-16px;width:2px;height:16px;background:#1a4731;opacity:0.3;z-index:1;transform:translateX(35px)"></div>` : ''}
    </div>`).join('')}
  </div>
  <div style="padding:36px 90px;display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid #e8e5de;flex-shrink:0">
    <span style="font-family:'Fraunces',serif;font-size:30px;font-weight:700;color:#1a4731">ZenBTW</span>
    <span style="font-size:20px;color:#8a847a">zenbtw.nl</span>
  </div>
</div>
</body></html>`;

const COMPARE = (s) => `${BASE_HEAD(s.title || 'Compare')}
<div style="width:1080px;height:1920px;background:#f7f6f3;display:flex;flex-direction:column">
  <div style="height:8px;background:linear-gradient(90deg,#1a4731,#2d6a4f,#1a4731);flex-shrink:0"></div>
  <div style="padding:56px 90px 40px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 40 ? '54' : '60'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title || ''}</h1>
  </div>
  <div style="flex:1;padding:0 90px;display:flex;flex-direction:column;justify-content:center">
    <table style="width:100%;border-collapse:collapse;font-size:26px">
      <thead>
        <tr>
          ${(s.headers || []).map((h, i) => `<th style="padding:20px 24px;text-align:${i===0?'left':'center'};font-weight:700;font-size:24px;background:${i===0?'#f4f3ef':'#1a4731'};color:${i===0?'#4a4640':'#fff'};border:1px solid #e8e5de">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${(s.rows || []).map((row, ri) => `
        <tr style="background:${ri%2===0?'#fff':'#f9f8f5'}">
          ${row.map((cell, ci) => `<td style="padding:20px 24px;border:1px solid #e8e5de;text-align:${ci===0?'left':'center'};font-weight:${ci===0?'600':'400'};color:${ci===0?'#1a1814':'#4a4640'}">${cell}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div style="padding:36px 90px;display:flex;align-items:center;justify-content:space-between;border-top:1.5px solid #e8e5de;flex-shrink:0">
    <span style="font-family:'Fraunces',serif;font-size:30px;font-weight:700;color:#1a4731">ZenBTW</span>
    <span style="font-size:20px;color:#8a847a">zenbtw.nl</span>
  </div>
</div>
</body></html>`;

const CTA = (s) => `${BASE_HEAD('Check je BTW-status')}
<div style="width:1080px;height:1920px;background:#1a4731;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:100px 90px;text-align:center;position:relative;overflow:hidden">
  <div style="position:absolute;width:800px;height:800px;border-radius:50%;background:rgba(255,255,255,0.04);top:-300px;left:-200px"></div>
  <div style="position:absolute;width:600px;height:600px;border-radius:50%;background:rgba(255,255,255,0.04);bottom:-200px;right:-100px"></div>
  <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:40px">
    <div style="font-size:80px">📊</div>
    <h1 style="font-family:'Fraunces',serif;font-size:72px;font-weight:700;color:#fff;line-height:1.1;letter-spacing:-0.02em">${s.question || 'Weet jij of je de grens nadert?'}</h1>
    <p style="font-size:36px;color:rgba(255,255,255,0.75);line-height:1.4;max-width:800px">${s.sub || 'Controleer het gratis in 30 seconden'}</p>
    <div style="background:#fff;border-radius:20px;padding:28px 60px;font-size:34px;font-weight:800;color:#1a4731;margin-top:20px">${s.action || 'Check mijn BTW-status →'}</div>
    <div style="font-size:26px;color:rgba(255,255,255,0.5);font-weight:500">${s.url_label || 'zenbtw.nl'}</div>
  </div>
</div>
</body></html>`;

function renderSlide(slide, meta = {}) {
  const s = { ...slide, ...meta };
  switch (slide.template) {
    case 'hook':    return HOOK(s);
    case 'stat':    return STAT(s);
    case 'info':    return INFO(s);
    case 'steps':   return STEPS(s);
    case 'compare': return COMPARE(s);
    case 'cta':     return CTA(s);
    default:        return HOOK(s);
  }
}

// ── Screenshot ────────────────────────────────────────────────────────────────
async function screenshot(browser, htmlPath, pngPath) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
  // Extra wait for Google Fonts
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
  await page.close();
  console.log(`    📸 ${path.basename(pngPath)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const data     = loadTopics();
  const manifest = loadManifest();
  const pending  = pendingTopics(data);
  const maxRun   = data.settings?.maxPerRun || 8;

  if (!pending.length) {
    console.log('✅ No pending topics — queue is empty');
    process.exit(0);
  }

  const toProcess = pending.slice(0, maxRun);
  console.log(`\n🎨 Generating ${toProcess.length} slide set(s)...\n`);

  const client  = new Anthropic();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  for (const item of toProcess) {
    console.log(`\n📌 "${item.topic}" [${item.type}]`);

    // ── 1. Generate content via Claude ────────────────────────────────────────
    console.log('  Calling Claude...');
    let slideData;
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: buildPrompt(item.topic, item.type) }]
      });
      const raw = msg.content[0].text.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      slideData = JSON.parse(raw);
    } catch (err) {
      console.error(`  ❌ Claude error: ${err.message}`);
      continue;
    }

    const slides = slideData.slides || [];
    if (!slides.length) { console.log('  ⚠️  No slides returned, skipping'); continue; }

    // ── 2. Build output folder ────────────────────────────────────────────────
    const setId  = `${TODAY}-${item.slug}`;
    const setDir = path.join(SLIDES_DIR, setId);
    fs.mkdirSync(setDir, { recursive: true });

    const htmlFiles = [];
    const pngFiles  = [];

    // ── 3. Render HTML + screenshot ───────────────────────────────────────────
    for (let i = 0; i < slides.length; i++) {
      const num      = String(i + 1).padStart(2, '0');
      const htmlPath = path.join(setDir, `${num}.html`);
      const pngPath  = path.join(setDir, `${num}.png`);

      const html = renderSlide(slides[i], { slideNum: i, totalSlides: slides.length });
      fs.writeFileSync(htmlPath, html, 'utf8');

      await screenshot(browser, htmlPath, pngPath);

      htmlFiles.push(`slides/${setId}/${num}.html`);
      pngFiles.push(`slides/${setId}/${num}.png`);
    }

    console.log(`  ✅ ${slides.length} slides saved to slides/${setId}/`);

    // ── 4. Update manifest ────────────────────────────────────────────────────
    manifest.sets.unshift({
      id:     setId,
      topic:  item.topic,
      date:   TODAY,
      type:   item.type,
      slides: slides.length,
      files:  htmlFiles,
      pngs:   pngFiles
    });

    // ── 5. Mark as published ──────────────────────────────────────────────────
    const idx = data.queue.findIndex(t => t.slug === item.slug);
    data.queue[idx].status      = 'published';
    data.queue[idx].publishedDate = TODAY;
    data.queue[idx].outputDir   = `slides/${setId}`;
    data.published.push(data.queue[idx]);
    data.queue.splice(idx, 1);
  }

  await browser.close();
  saveManifest(manifest);
  saveTopics(data);

  console.log(`\n🎉 Done! ${toProcess.length} set(s) generated.`);
  console.log(`   ${pendingTopics(loadTopics()).length} topics remaining in queue`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
