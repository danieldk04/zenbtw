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
function loadTopics()   { return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8')); }
function saveTopics(d)  { fs.writeFileSync(TOPICS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

function loadManifest() {
  if (fs.existsSync(MANIFEST)) return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return { sets: [] };
}
function saveManifest(d) { fs.writeFileSync(MANIFEST, JSON.stringify(d, null, 2), 'utf8'); }

function pendingTopics(data) {
  return data.queue.filter(t => t.status === 'pending').sort((a, b) => a.priority - b.priority);
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(topic, type) {
  const typeDesc = type === 'poster'
    ? 'één krachtige losse poster (1 slide)'
    : 'een Instagram/TikTok carrousel (4-7 slides)';

  return `Je bent een top social media content expert. Je maakt viral informatieve content voor Nederlandse marketplace verkopers (Vinted, Etsy, Shopify, Marktplaats). Je kent de stijl van creators zoals Graham Stephan, Humphrey Yang en Nederlandse finfluencers.

Maak ${typeDesc} over: "${topic}"

Brand: ZenBTW — gratis BTW-tool voor marketplace verkopers in Nederland.
Branding-stijl: donkergroen (#1a4731), clean, premium. ZenBTW naam in footer van elke slide. Geen schreeuwerige reclame.

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
  "dark": false
}
Gebruik dark:true voor een donkergroene achtergrond variant.

━━━ "stat" ━━━
{
  "template": "stat",
  "eyebrow": "KOR 2026",
  "number": "€20.000",
  "label": "is de grens waarboven je BTW moet afdragen",
  "context": "Aanvullende zin van max 20 woorden",
  "source": "Bron: Belastingdienst.nl"
}

━━━ "info" ━━━
{
  "template": "info",
  "title": "Wanneer meldt Vinted jou aan?",
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
    { "label": "BTW afdragen", "a": "❌ Nee", "b": "✅ Ja", "highlight": true },
    { "label": "Aangifte", "a": "Niet nodig", "b": "Per kwartaal", "highlight": false },
    { "label": "Voor wie", "a": "Kleine NL-verkoper", "b": "EU-verkoper", "highlight": false }
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
    },
    {
      "name": "Daan", "age": 22, "initials": "DB", "color": "#dbeafe",
      "platform": "Shopify", "omzet_nl": "€22.000", "omzet_eu": "€0", "totaal": "€22.000",
      "kor": false, "oss": true, "btw_plicht": true,
      "advies": "Pas op met facturen", "advies_kleur": "orange"
    },
    {
      "name": "Youssef", "age": 48, "initials": "YA", "color": "#fef9c3",
      "platform": "Vinted", "omzet_nl": "€8.000", "omzet_eu": "€0", "totaal": "€8.000",
      "kor": true, "oss": true, "btw_plicht": false,
      "advies": "100% zorgeloos", "advies_kleur": "green"
    }
  ]
}

━━━ "list" ━━━
{
  "template": "list",
  "tag": "Checklist",
  "title": "Alles geregeld als Etsy verkoper?",
  "items": [
    { "text": "KOR aangemeld bij Belastingdienst", "done": true },
    { "text": "EU-omzet bijgehouden per land", "done": true },
    { "text": "DAC7 drempel gecontroleerd", "done": false },
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
- Schrijf informeel Nederlands — prikkelend en direct
- Persona-template = meest engaging, gebruik hem als je een vergelijking maakt
- Wissel lichte en donkere slides af voor visuele dynamiek (stat en cta zijn donker)
- Poster = 1 slide: gebruik "stat" of "hook" met dark:true

Geef ALLEEN de JSON terug.`;
}

// ── Shared CSS ────────────────────────────────────────────────────────────────
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700;9..144,900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">`;

const BASE = (bg = '#f7f6f3') => `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080">${FONTS}
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;background:${bg};font-family:'Plus Jakarta Sans',sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased;color:#1a1814}
</style></head><body>`;

// Shared footer strip
const FOOTER = (dark = false) => `
<div style="flex-shrink:0;padding:32px 72px;display:flex;align-items:center;justify-content:space-between;border-top:${dark ? '1px solid rgba(255,255,255,0.12)' : '1.5px solid #e8e5de'}">
  <div style="display:flex;align-items:center;gap:14px">
    <div style="width:40px;height:40px;background:${dark ? 'rgba(255,255,255,0.15)' : '#1a4731'};border-radius:10px;display:flex;align-items:center;justify-content:center">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="${dark ? '#1a4731' : '#fff'}"/></svg>
    </div>
    <span style="font-family:'Fraunces',serif;font-size:28px;font-weight:700;color:${dark ? '#fff' : '#1a4731'}">Zen<span style="color:${dark ? '#4ade80' : '#2d6a4f'}">BTW</span></span>
  </div>
  <span style="font-size:20px;color:${dark ? 'rgba(255,255,255,0.45)' : '#8a847a'};font-weight:500">zenbtw.nl</span>
</div>`;

// Pill / tag badge
const TAG = (text, dark = false) => `<div style="display:inline-flex;align-items:center;padding:10px 22px;background:${dark ? 'rgba(255,255,255,0.12)' : '#e8f0ec'};border-radius:100px;font-size:18px;font-weight:700;color:${dark ? 'rgba(255,255,255,0.8)' : '#1a4731'};letter-spacing:0.04em;text-transform:uppercase;margin-bottom:36px">${text}</div>`;

// ── HOOK template ─────────────────────────────────────────────────────────────
const HOOK = (s) => {
  const dark = s.dark === true;
  const bg   = dark ? '#1a4731' : '#f7f6f3';
  const tx   = dark ? '#fff'    : '#1a1814';
  const tx2  = dark ? 'rgba(255,255,255,0.7)' : '#4a4640';
  const hl   = dark ? '#4ade80' : '#1a4731';
  const fs   = s.title && s.title.replace(/\n/g,'').length > 55 ? '74' : s.title && s.title.replace(/\n/g,'').length > 35 ? '84' : '94';

  return `${BASE(bg)}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column;position:relative;overflow:hidden">
  ${dark ? `<div style="position:absolute;width:900px;height:900px;border-radius:50%;background:rgba(255,255,255,0.03);top:-300px;right:-300px"></div>
  <div style="position:absolute;width:600px;height:600px;border-radius:50%;background:rgba(255,255,255,0.03);bottom:-100px;left:-200px"></div>` : ''}
  <!-- Left accent stripe -->
  <div style="position:absolute;left:0;top:0;bottom:0;width:10px;background:${dark ? 'rgba(255,255,255,0.15)' : '#1a4731'}"></div>
  <!-- Top stripe -->
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:80px 80px 60px 90px;position:relative;z-index:2">
    ${s.tag ? TAG(s.tag, dark) : ''}
    <h1 style="font-family:'Fraunces',serif;font-size:${fs}px;font-weight:900;line-height:1.08;letter-spacing:-0.03em;color:${tx};margin-bottom:32px;white-space:pre-line">${(s.title||'').replace(/<[^>]+>/g,'')}${s.highlight ? `\n<span style="color:${hl}">${s.highlight}</span>` : ''}</h1>
    ${s.sub ? `<p style="font-size:34px;color:${tx2};line-height:1.5;font-weight:500;max-width:860px;margin-bottom:52px">${s.sub}</p>` : ''}
    ${s.pill ? `<div style="display:inline-flex;align-items:center;gap:12px;background:${dark ? 'rgba(255,255,255,0.1)' : '#fff3cd'};border:2px solid ${dark ? 'rgba(255,255,255,0.2)' : '#f0c040'};border-radius:100px;padding:18px 36px;font-size:28px;font-weight:700;color:${dark ? '#fff' : '#7a5c00'};width:fit-content">${s.pill}</div>` : ''}
  </div>

  ${FOOTER(dark)}
</div>
</body></html>`;
};

// ── STAT template ─────────────────────────────────────────────────────────────
const STAT = (s) => `${BASE('#1a4731')}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column;position:relative;overflow:hidden">
  <div style="position:absolute;width:1000px;height:1000px;border-radius:50%;background:rgba(255,255,255,0.035);top:-400px;right:-300px"></div>
  <div style="position:absolute;width:700px;height:700px;border-radius:50%;background:rgba(255,255,255,0.035);bottom:-200px;left:-200px"></div>
  <div style="height:10px;background:rgba(255,255,255,0.2);flex-shrink:0"></div>

  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:90px;position:relative;z-index:2">
    ${s.eyebrow ? `<div style="display:flex;align-items:center;gap:16px;margin-bottom:48px">
      <div style="width:48px;height:3px;background:rgba(255,255,255,0.4);border-radius:2px"></div>
      <span style="font-size:20px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.55)">${s.eyebrow}</span>
    </div>` : ''}
    <div style="font-family:'Fraunces',serif;font-size:${s.number && s.number.length > 5 ? '148' : s.number && s.number.length > 3 ? '180' : '210'}px;font-weight:900;color:#fff;line-height:0.88;letter-spacing:-0.04em;margin-bottom:40px">${s.number||''}</div>
    <div style="font-size:44px;color:rgba(255,255,255,0.88);font-weight:600;line-height:1.25;max-width:860px;margin-bottom:48px">${s.label||''}</div>
    ${s.context ? `<div style="background:rgba(255,255,255,0.09);border:1.5px solid rgba(255,255,255,0.14);border-radius:18px;padding:30px 40px">
      <p style="font-size:26px;color:rgba(255,255,255,0.7);line-height:1.55">${s.context}</p>
    </div>` : ''}
    ${s.source ? `<div style="margin-top:28px;font-size:18px;color:rgba(255,255,255,0.32);font-weight:500">${s.source}</div>` : ''}
  </div>

  ${FOOTER(true)}
</div>
</body></html>`;

// ── INFO template ─────────────────────────────────────────────────────────────
const accentStyles = {
  green:   { bg: '#f0fdf4', border: '#86efac', title: '#15803d', body: '#166534' },
  red:     { bg: '#fef2f2', border: '#fecaca', title: '#dc2626', body: '#7f1d1d' },
  yellow:  { bg: '#fffbeb', border: '#fde68a', title: '#d97706', body: '#78350f' },
  blue:    { bg: '#eff6ff', border: '#bfdbfe', title: '#2563eb', body: '#1e3a8a' },
  neutral: { bg: '#fff',    border: '#e8e5de', title: '#1a1814', body: '#4a4640' },
};

const INFO = (s) => {
  const cards = (s.cards || []).slice(0, 4);
  const twoCol = cards.length === 4;

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:60px 72px 36px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 42 ? '52' : '60'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title||''}</h1>
  </div>

  <div style="flex:1;padding:0 72px;display:${twoCol ? 'grid' : 'flex'};${twoCol ? 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:24px' : 'flex-direction:column;gap:24px'};align-content:center">
    ${cards.map(c => {
      const a = accentStyles[c.accent] || accentStyles.neutral;
      return `<div style="background:${a.bg};border:2px solid ${a.border};border-radius:22px;padding:40px 44px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;align-items:center;gap:20px">
          <div style="font-size:48px;flex-shrink:0">${c.icon||'•'}</div>
          <h3 style="font-size:${twoCol ? '26' : '30'}px;font-weight:800;color:${a.title};line-height:1.2">${c.title||''}</h3>
        </div>
        <p style="font-size:${twoCol ? '22' : '25'}px;color:${a.body};line-height:1.55;font-weight:500">${c.body||c.text||''}</p>
      </div>`;
    }).join('')}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── STEPS template ────────────────────────────────────────────────────────────
const STEPS = (s) => {
  const steps = (s.steps || []).slice(0, 5);
  const fontSize = steps.length >= 4 ? '22' : '25';
  const titleFs = steps.length >= 4 ? '22' : '26';
  const padding = steps.length >= 4 ? '28px 36px' : '34px 44px';

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:60px 72px 36px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 42 ? '52' : '58'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em;margin-bottom:${s.subtitle ? '16px' : '0'}">${s.title||''}</h1>
    ${s.subtitle ? `<p style="font-size:26px;color:#8a847a;font-weight:500;margin-top:12px">${s.subtitle}</p>` : ''}
  </div>

  <div style="flex:1;padding:0 72px;display:flex;flex-direction:column;gap:20px;justify-content:center">
    ${steps.map((st, i) => `
    <div style="display:flex;gap:28px;align-items:stretch">
      <!-- Number column -->
      <div style="display:flex;flex-direction:column;align-items:center;gap:0;flex-shrink:0">
        <div style="width:64px;height:64px;background:#1a4731;border-radius:16px;display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:26px;font-weight:700;color:#fff;flex-shrink:0">${String(i+1).padStart(2,'0')}</div>
        ${i < steps.length - 1 ? `<div style="width:2px;flex:1;background:linear-gradient(to bottom,#1a4731,rgba(26,71,49,0.15));margin:6px 0;min-height:20px"></div>` : ''}
      </div>
      <!-- Content -->
      <div style="background:#fff;border:1.5px solid #e8e5de;border-radius:18px;padding:${padding};flex:1;margin-bottom:${i < steps.length - 1 ? '0' : '0'}">
        <h4 style="font-size:${titleFs}px;font-weight:700;color:#1a1814;margin-bottom:8px;line-height:1.2">${st.title||''}</h4>
        <p style="font-size:${fontSize}px;color:#4a4640;line-height:1.5">${st.body||st.text||''}</p>
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

  <div style="padding:60px 72px 36px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 38 ? '52' : '58'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title||''}</h1>
  </div>

  <div style="flex:1;padding:0 72px;display:flex;flex-direction:column;justify-content:center">
    <!-- Header row -->
    <div style="display:grid;grid-template-columns:280px 1fr 1fr;margin-bottom:12px">
      <div></div>
      <div style="background:${colorA};border-radius:14px 14px 0 0;padding:22px 28px;text-align:center">
        <span style="font-family:'Fraunces',serif;font-size:32px;font-weight:700;color:#fff">${colA}</span>
      </div>
      <div style="background:${colorB};border-radius:14px 14px 0 0;padding:22px 28px;text-align:center;margin-left:8px">
        <span style="font-family:'Fraunces',serif;font-size:32px;font-weight:700;color:#fff">${colB}</span>
      </div>
    </div>
    <!-- Rows -->
    ${rows.map((r, i) => `
    <div style="display:grid;grid-template-columns:280px 1fr 1fr;margin-bottom:8px">
      <div style="background:${r.highlight ? '#f0fdf4' : '#fff'};border:1.5px solid ${r.highlight ? '#86efac' : '#e8e5de'};border-radius:14px;padding:20px 24px;display:flex;align-items:center">
        <span style="font-size:22px;font-weight:700;color:#1a1814">${r.label||''}</span>
      </div>
      <div style="background:${r.highlight ? '#f0fdf4' : (i%2===0?'#fff':'#f9f8f5')};border:1.5px solid ${r.highlight ? '#86efac' : '#e8e5de'};border-radius:14px;padding:20px 28px;text-align:center;margin-left:8px;display:flex;align-items:center;justify-content:center">
        <span style="font-size:22px;color:#1a1814;font-weight:500">${r.a||''}</span>
      </div>
      <div style="background:${r.highlight ? '#eff6ff' : (i%2===0?'#fff':'#f9f8f5')};border:1.5px solid ${r.highlight ? '#bfdbfe' : '#e8e5de'};border-radius:14px;padding:20px 28px;text-align:center;margin-left:8px;display:flex;align-items:center;justify-content:center">
        <span style="font-size:22px;color:#1a1814;font-weight:500">${r.b||''}</span>
      </div>
    </div>`).join('')}
    ${s.footer_note ? `<div style="margin-top:24px;background:#e8f0ec;border-radius:14px;padding:20px 28px;font-size:22px;color:#1a4731;font-weight:600;text-align:center">${s.footer_note}</div>` : ''}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── PERSONA template ──────────────────────────────────────────────────────────
const boolIcon = (v) => v
  ? `<div style="display:flex;align-items:center;justify-content:center;gap:6px"><span style="font-size:24px">✅</span><span style="font-size:16px;font-weight:700;color:#16a34a">Veilig</span></div>`
  : `<div style="display:flex;align-items:center;justify-content:center;gap:6px"><span style="font-size:24px">❌</span><span style="font-size:16px;font-weight:700;color:#dc2626">Over</span></div>`;

const adviesColor = { red: '#dc2626', orange: '#d97706', green: '#16a34a' };
const adviesBg    = { red: '#fef2f2', orange: '#fffbeb', green: '#f0fdf4' };

const PERSONA = (s) => {
  const personas = (s.personas || []).slice(0, 3);
  const rows = [
    { label: 'Platform',     key: 'platform',   type: 'text' },
    { label: 'Omzet NL',    key: 'omzet_nl',   type: 'text' },
    { label: 'Omzet EU',    key: 'omzet_eu',   type: 'text' },
    { label: 'Totaal',      key: 'totaal',     type: 'text', bold: true },
    { label: 'KOR (€20k)',  key: 'kor',        type: 'bool' },
    { label: 'OSS (€10k)',  key: 'oss',        type: 'bool' },
    { label: 'BTW-plicht',  key: 'btw_plicht', type: 'bool' },
    { label: 'Advies',      key: 'advies',     type: 'advies' },
  ];

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:48px 56px 28px;flex-shrink:0">
    <h1 style="font-family:'Fraunces',serif;font-size:52px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title||''}</h1>
    ${s.subtitle ? `<p style="font-size:24px;color:#8a847a;font-weight:500;margin-top:10px">${s.subtitle}</p>` : ''}
  </div>

  <!-- Avatar row -->
  <div style="display:grid;grid-template-columns:200px repeat(${personas.length},1fr);padding:0 56px;gap:0;flex-shrink:0">
    <div></div>
    ${personas.map(p => `
    <div style="display:flex;flex-direction:column;align-items:center;padding:16px 8px">
      <div style="width:80px;height:80px;border-radius:50%;background:${p.color||'#e8f0ec'};border:3px solid #1a4731;display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:24px;font-weight:700;color:#1a4731;margin-bottom:10px">${p.initials||p.name.slice(0,2)}</div>
      <div style="font-size:20px;font-weight:700;color:#1a1814">${p.name}</div>
      <div style="font-size:16px;color:#8a847a">(${p.age})</div>
    </div>`).join('')}
  </div>

  <!-- Table -->
  <div style="flex:1;padding:0 56px;display:flex;flex-direction:column;gap:0;justify-content:center">
    ${rows.map((r, ri) => `
    <div style="display:grid;grid-template-columns:200px repeat(${personas.length},1fr);background:${ri%2===0?'#fff':'#f7f6f3'};border-bottom:1px solid #e8e5de;${ri===0?'border-top:1px solid #e8e5de;border-radius:14px 14px 0 0':''}${ri===rows.length-1?'border-radius:0 0 14px 14px':''}">
      <div style="padding:18px 16px;font-size:18px;font-weight:700;color:#4a4640;border-right:1.5px solid #e8e5de;display:flex;align-items:center">${r.label}</div>
      ${personas.map(p => {
        const val = p[r.key];
        let cell = '';
        if (r.type === 'bool') cell = boolIcon(!val);
        else if (r.type === 'advies') cell = `<div style="padding:8px 12px;background:${adviesBg[p.advies_kleur]||'#f0fdf4'};border-radius:8px;font-size:17px;font-weight:800;color:${adviesColor[p.advies_kleur]||'#16a34a'};text-align:center;line-height:1.2">${val||''}</div>`;
        else cell = `<span style="font-size:${r.bold?'20':'18'}px;font-weight:${r.bold?'700':'500'};color:#1a1814">${val||''}</span>`;
        return `<div style="padding:14px 12px;display:flex;align-items:center;justify-content:center;border-right:1px solid #e8e5de">${cell}</div>`;
      }).join('')}
    </div>`).join('')}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── LIST template ─────────────────────────────────────────────────────────────
const LIST = (s) => {
  const items = s.items || [];

  return `${BASE()}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column">
  <div style="height:10px;background:#1a4731;flex-shrink:0"></div>

  <div style="padding:60px 72px 36px;flex-shrink:0">
    ${s.tag ? TAG(s.tag) : ''}
    <h1 style="font-family:'Fraunces',serif;font-size:${s.title && s.title.length > 40 ? '52' : '60'}px;font-weight:700;color:#1a1814;line-height:1.1;letter-spacing:-0.02em">${s.title||''}</h1>
  </div>

  <div style="flex:1;padding:0 72px;display:flex;flex-direction:column;gap:22px;justify-content:center">
    ${items.map(it => `
    <div style="display:flex;align-items:center;gap:28px;background:#fff;border:1.5px solid ${it.done ? '#86efac' : '#e8e5de'};border-left:5px solid ${it.done ? '#16a34a' : '#d1d5db'};border-radius:18px;padding:30px 36px">
      <div style="width:56px;height:56px;border-radius:50%;background:${it.done ? '#f0fdf4' : '#f9f8f5'};border:2.5px solid ${it.done ? '#16a34a' : '#d1d5db'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:28px">
        ${it.done ? '✅' : '⬜'}
      </div>
      <span style="font-size:27px;color:${it.done ? '#1a1814' : '#6b7280'};font-weight:${it.done ? '600' : '500'};${it.done ? '' : 'opacity:0.7'}">${it.text||''}</span>
    </div>`).join('')}
    ${s.note ? `<div style="margin-top:8px;background:#e8f0ec;border-radius:16px;padding:24px 32px;font-size:22px;color:#1a4731;font-weight:600">${s.note}</div>` : ''}
  </div>

  ${FOOTER()}
</div>
</body></html>`;
};

// ── CTA template ──────────────────────────────────────────────────────────────
const CTA = (s) => {
  const features = s.features || ['100% gratis', 'Alle platforms', 'Direct resultaat'];

  return `${BASE('#1a4731')}
<div style="width:1080px;height:1920px;display:flex;flex-direction:column;position:relative;overflow:hidden">
  <div style="position:absolute;width:900px;height:900px;border-radius:50%;background:rgba(255,255,255,0.04);top:-350px;left:-200px"></div>
  <div style="position:absolute;width:700px;height:700px;border-radius:50%;background:rgba(255,255,255,0.04);bottom:-200px;right:-150px"></div>
  <div style="height:10px;background:rgba(255,255,255,0.15);flex-shrink:0"></div>

  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 80px 40px;position:relative;z-index:2;text-align:center">
    <!-- Shield icon large -->
    <div style="width:120px;height:120px;background:rgba(255,255,255,0.12);border-radius:28px;display:flex;align-items:center;justify-content:center;margin-bottom:52px">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="#fff" opacity="0.9"/></svg>
    </div>
    <h1 style="font-family:'Fraunces',serif;font-size:80px;font-weight:900;color:#fff;line-height:1.05;letter-spacing:-0.03em;margin-bottom:36px">${s.question||'Weet jij waar jij staat?'}</h1>
    <p style="font-size:34px;color:rgba(255,255,255,0.72);line-height:1.45;max-width:820px;margin-bottom:64px;font-weight:500">${s.sub||'Controleer gratis in 30 seconden — geen account nodig'}</p>
    <!-- CTA button -->
    <div style="background:#fff;border-radius:20px;padding:32px 72px;font-size:36px;font-weight:800;color:#1a4731;margin-bottom:52px;letter-spacing:-0.01em">${s.button||'Check mijn BTW-status →'}</div>
    <!-- Feature pills -->
    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center">
      ${features.map(f => `<div style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:100px;padding:12px 28px;font-size:22px;color:rgba(255,255,255,0.75);font-weight:600">✓ ${f}</div>`).join('')}
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

  const data     = loadTopics();
  const manifest = loadManifest();
  const pending  = pendingTopics(data);
  const maxRun   = data.settings?.maxPerRun || 8;

  if (!pending.length) { console.log('✅ No pending topics — queue is empty'); process.exit(0); }

  const toProcess = pending.slice(0, maxRun);
  console.log(`\n🎨 Generating ${toProcess.length} slide set(s)...\n`);

  const client  = new Anthropic();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  for (const item of toProcess) {
    console.log(`\n📌 "${item.topic}" [${item.type}]`);
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

    manifest.sets.unshift({ id: setId, topic: item.topic, date: TODAY, type: item.type, slides: slides.length, files: htmlFiles, pngs: pngFiles });

    const idx = data.queue.findIndex(t => t.slug === item.slug);
    data.queue[idx].status = 'published';
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
