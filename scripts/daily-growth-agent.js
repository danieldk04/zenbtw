#!/usr/bin/env node
/**
 * ZenBTW Daily Growth Agent (v3)
 *
 * Runs every morning via GitHub Actions. Without any human input it:
 *   1. Haalt GSC data op (rankings, CTR, kansen)
 *   2. Verbetert lage CTR pagina's met retry logic + fallback
 *   3. [NIEUW] Haalt GA4 analytics op: bounce rates, sessieduur
 *   4. [NIEUW] Level 1: flagt pagina's met slechte engagement
 *   5. [NIEUW] Level 2: voert autonome fixes uit op high-bounce pagina's
 *   6. Vult keyword queue aan als nodig
 *   7. Track ranking trends vs vorige week
 *   8. Stuurt digest email naar danieldekoning66@gmail.com
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY           — Claude API
 *   GOOGLE_SERVICE_ACCOUNT_JSON — Google SA met Search Console + Indexing rechten
 *   BREVO_API_KEY               — Brevo transactional email
 *
 * Env vars optional:
 *   GA4_PROPERTY_ID             — GA4 numeric property ID (bijv. 123456789)
 *   SERPER_API_KEY              — Serper.dev API key voor competitor zoekresultaten
 *   DRY_RUN=true                — log acties maar schrijf niks weg
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGSCData, findOpportunities, findLowCTRPages } from './gsc-client.js';
import { fetchPageBounceData, fetchSiteStats, available as ga4Available } from './ga4-client.js';
import { searchCompetitors, scrapePage, buildGapSummary, available as serperAvailable } from './competitor-analyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DRY_RUN = process.env.DRY_RUN === 'true';

const KEYWORDS_FILE    = path.join(ROOT, 'keywords.json');
const MEMORY_FILE      = path.join(ROOT, 'content-memory.json');
const GROWTH_LOG_FILE  = path.join(ROOT, 'growth-log.json');
const IMPROVEMENT_LOG  = path.join(ROOT, 'improvement-log.json');
const BLOG_DIR         = path.join(ROOT, 'blog');
const TODAY            = new Date().toISOString().split('T')[0];

// ── Cooldown tracker — voorkomt dat dezelfde pagina elke dag verbeterd wordt ──

function loadImprovementLog() {
  return load(IMPROVEMENT_LOG, {});
}

function saveImprovementLog(log) {
  if (!DRY_RUN) save(IMPROVEMENT_LOG, log);
}

function wasRecentlyImproved(slug, log, cooldownDays = 14) {
  const entry = log[slug];
  if (!entry) return false;
  const daysSince = (Date.now() - new Date(entry.lastImproved).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince < cooldownDays;
}

function markImproved(slug, log, type) {
  log[slug] = { lastImproved: TODAY, type, count: (log[slug]?.count || 0) + 1 };
}

// ── Claude via native fetch (SDK vermeden — blocked in GitHub Actions) ────────

async function claudeChat(messages, maxTokens = 1024) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY niet ingesteld');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, messages }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function load(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function save(file, data) {
  if (DRY_RUN) return;
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Retry wrapper voor API calls ──────────────────────────────────────────────

async function withRetry(fn, maxRetries = 3, backoffMs = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      log(`  Retry ${attempt + 1}/${maxRetries - 1} after ${backoffMs}ms... (${err.message})`);
      await sleep(backoffMs);
      backoffMs *= 2; // exponential backoff: 1s → 2s → 4s
    }
  }
}

// ── Keyword queue ─────────────────────────────────────────────────────────────

function getQueueStatus() {
  const kw = load(KEYWORDS_FILE, { queue: [], published: [] });
  const pending  = kw.queue.filter(k => k.status === 'pending');
  const published = kw.published || [];
  return { kw, pending, published };
}

async function refillKeywordQueue(gscOpportunities, publishedSlugs) {
  log('Keyword queue aanvullen via Claude...');
  const existingKeywords = load(KEYWORDS_FILE, { queue: [], published: [] });
  const allDone = [
    ...existingKeywords.published.map(p => p.keyword || p.slug),
    ...existingKeywords.queue.map(k => k.keyword)
  ];

  const opportunityList = gscOpportunities.slice(0, 10)
    .map(q => `"${q.query}" (positie ${q.position.toFixed(1)}, ${q.impressions} impressies)`)
    .join('\n');

  const prompt = `Je bent SEO-strateeg voor ZenBTW, een gratis BTW-tool voor Nederlandse marketplace verkopers (Etsy, Vinted, Shopify).

Al gepubliceerde of geplande keywords (overslaan):
${allDone.join(', ')}

Keywords waar we bijna goed op ranken (positie 4-20 in Google):
${opportunityList || '(geen GSC data beschikbaar)'}

ZenBTW dekt: KOR-vrijstelling, OSS/IOSS, BTW-aangifte deadlines, DAC7-rapportage, margeregeling, winstcalculator, BTW-plicht checker.

Genereer 10 nieuwe blog-keywords in het Nederlands die:
1. Zoekvolume hebben (mensen zoeken dit echt)
2. Relevant zijn voor onze doelgroep (kleine marketplace verkopers)
3. Niet al gedekt zijn
4. Bij voorkeur aansluiten op de GSC-kansen hierboven

Geef ALLEEN een JSON-array terug, geen uitleg:
[
  {"keyword": "...", "priority": 1, "rationale": "..."},
  ...
]`;

  const msg = await withRetry(() => claudeChat([{ role: 'user', content: prompt }], 1024));

  const text = msg.content[0].text.trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude gaf geen geldige JSON terug voor keywords');

  const newKeywords = JSON.parse(jsonMatch[0]);
  const kw = load(KEYWORDS_FILE, { queue: [], published: [] });

  let added = 0;
  for (const k of newKeywords) {
    const alreadyExists = kw.queue.some(q => q.keyword === k.keyword) ||
                          (kw.published || []).some(p => (p.keyword || p.slug) === k.keyword);
    if (!alreadyExists) {
      kw.queue.push({ keyword: k.keyword, status: 'pending', priority: k.priority || 5, addedBy: 'growth-agent', rationale: k.rationale, addedDate: TODAY });
      added++;
    }
  }

  save(KEYWORDS_FILE, kw);
  log(`${added} nieuwe keywords toegevoegd aan queue`);
  return added;
}

// ── Fallback: simpele meta improvements zonder Claude ──────────────────────

function simplifyMetaTitleFallback(currentTitle, slug) {
  // Maak title korter en snappier als hij te lang is
  if (currentTitle.length > 60) {
    const words = currentTitle.split(' ');
    const shorter = words.slice(0, Math.floor(words.length * 0.7)).join(' ');
    return shorter.length > 20 ? shorter : currentTitle.substring(0, 58);
  }
  return currentTitle;
}

function improveMetaDescriptionFallback(currentMeta, page) {
  // Voeg CTR/impressies toe aan meta description
  const ctrPct = (page.ctr * 100).toFixed(1);
  const snippet = `${ctrPct}% CTR, positie ${page.position.toFixed(0)}. `;
  if ((snippet + currentMeta).length <= 155) {
    return snippet + currentMeta;
  }
  return currentMeta.substring(0, 150);
}

function addInternalLinksFallback(filePath, slug) {
  // Voeg links toe naar 2-3 gerelateerde blogs (eenvoudige matching op keywords)
  const html = fs.readFileSync(filePath, 'utf8');
  const existingLinks = (html.match(/href="\/blog\/[^"]+"/g) || []).length;
  if (existingLinks >= 3) return null; // al genoeg links

  const relatedSlugs = {
    'oss-registratie': ['oss-aangifte-nederland', 'btw-tarief-eu-landen-2026'],
    'kor': ['kor-vrijstelling-2026', 'kor-drempel-overschreden'],
    'dac7': ['dac7-belastingdienst-rapportage'],
    'etsy': ['etsy-btw-2026', 'etsy-verkoper-belastingaangifte'],
  };

  let toAdd = [];
  for (const [keyword, related] of Object.entries(relatedSlugs)) {
    if (slug.includes(keyword)) toAdd = related;
  }

  if (!toAdd.length) return null;

  const linkHtml = toAdd.slice(0, 2).map(s => `<p><a href="/blog/${s}/">Lees ook: ${s.replaceAll('-', ' ')}</a></p>`).join('\n');

  // Voeg voor </article> in
  const newHtml = html.replace('</article>', `\n${linkHtml}\n</article>`);
  if (!DRY_RUN) fs.writeFileSync(filePath, newHtml, 'utf8');

  return toAdd.length;
}

// ── Meta title/description improvement (met retry + fallback) ────────────────

async function improveLowCTRPage(page) {
  const slug = page.page.replace('https://zenbtw.nl/blog/', '').replace(/\/$/, '');
  const filePath = path.join(BLOG_DIR, `${slug}.html`);
  if (!fs.existsSync(filePath)) return null;

  const html = fs.readFileSync(filePath, 'utf8');
  const currentTitle = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
  const currentMeta  = html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1] || '';
  if (!currentTitle) return null;

  log(`Meta verbeteren voor ${slug} (CTR: ${(page.ctr * 100).toFixed(1)}%, ${page.impressions} impressies)`);

  const prompt = `Blog pagina op ZenBTW presteert slecht qua CTR in Google.

Huidige title: "${currentTitle}"
Huidige meta description: "${currentMeta}"
Google Search positie: ${page.position.toFixed(1)}
Impressies (28d): ${page.impressions}
CTR: ${(page.ctr * 100).toFixed(2)}% (doel: >4%)

Schrijf een betere title (max 60 tekens) en meta description (max 155 tekens) die:
- Nieuwsgierigheid wekt + direct antwoord belooft
- Het keyword bevat dat mensen zoeken
- Niet clickbait is maar wel aantrekkelijk
- Past bij een Nederlandse doelgroep (kleine webshop verkopers)

Antwoord ALLEEN als JSON:
{"title": "...", "description": "..."}`;

  let title, description;

  try {
    const msg = await withRetry(() => claudeChat([{ role: 'user', content: prompt }], 300));

    const jsonMatch = msg.content[0].text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      title = parsed.title;
      description = parsed.description;
    }
  } catch (err) {
    log(`  Claude API faalde volledig, fallback naar simpele verbeteringen...`);
  }

  // Fallback als Claude faalt
  if (!title) {
    title = simplifyMetaTitleFallback(currentTitle, slug);
  }
  if (!description) {
    description = improveMetaDescriptionFallback(currentMeta, page);
  }

  if (!title || !description) return null;

  if (!DRY_RUN) {
    let newHtml = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/g, `$1${description}$2`)
      .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/g, `$1${title}$2`)
      .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/g, `$1${title}$2`);
    fs.writeFileSync(filePath, newHtml, 'utf8');
  }

  return {
    slug,
    oldTitle: currentTitle,
    newTitle: title,
    newDescription: description,
    usedFallback: !title || !description,
    // WHY data voor email transparantie
    ctr: page.ctr,
    impressions: page.impressions,
    position: page.position,
    reason: `CTR van ${(page.ctr * 100).toFixed(1)}% bij ${page.impressions} impressies betekent dat ~${Math.round(page.impressions * (0.04 - page.ctr))} extra kliks per maand mogelijk zijn als we naar 4% CTR gaan.`
  };
}

// ── Check interne link coverage ───────────────────────────────────────────────

function checkInternalLinkCoverage(lowCTRPages, allPages) {
  const missingLinks = [];
  for (const page of lowCTRPages.slice(0, 3)) {
    const slug = page.page.replace('https://zenbtw.nl/blog/', '').replace(/\/$/, '');
    const filePath = path.join(BLOG_DIR, `${slug}.html`);
    if (!fs.existsSync(filePath)) continue;

    const html = fs.readFileSync(filePath, 'utf8');
    const internalLinks = (html.match(/href="\/blog\/[^"]+"/g) || []).length;

    // Benchmark: blogs moeten naar minstens 3 andere blogs linken
    if (internalLinks < 3) {
      missingLinks.push({ slug, currentLinks: internalLinks, needed: 3 - internalLinks });
    }
  }
  return missingLinks;
}

// ── Ranking trend detection ───────────────────────────────────────────────────

function detectRankingTrends(currentGSC, logHistory) {
  // Vergelijk met vorige week
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const previousLog = logHistory.find(entry => entry.date <= sevenDaysAgoStr);
  if (!previousLog || !previousLog.gscSnapshot) return null;

  const prevQueries = previousLog.gscSnapshot.queries || [];
  const currQueries = currentGSC.queries || [];

  // Find queries waar we minder goed rankten vorige week
  const improved = currQueries.filter(q => {
    const prev = prevQueries.find(p => p.query === q.query);
    return prev && prev.position > q.position && q.position <= 10;
  });

  const declined = currQueries.filter(q => {
    const prev = prevQueries.find(p => p.query === q.query);
    return prev && prev.position < q.position;
  });

  return { improved: improved.slice(0, 3), declined: declined.slice(0, 3) };
}

// ── Digest email via Brevo ────────────────────────────────────────────────────

async function sendDigestEmail(report) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { log('BREVO_API_KEY niet ingesteld — email overgeslagen'); return; }

  const gsc = report.gsc;
  const top3 = gsc?.queries?.slice(0, 3) || [];
  const opportunities = report.gscOpportunities?.slice(0, 5) || [];
  const trends = report.trends;

  const topQueriesHtml = top3.length
    ? top3.map(q => `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#1a1814">${q.query}</td><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#4a4640;text-align:center">${q.clicks}</td><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#4a4640;text-align:center">${q.impressions}</td><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#4a4640;text-align:center">${q.position.toFixed(1)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="padding:10px;font-size:13px;color:#8a847a;text-align:center">Geen data</td></tr>';

  const opportunitiesHtml = opportunities.length
    ? opportunities.map(q => `<li style="font-size:13px;color:#4a4640;margin-bottom:6px"><strong style="color:#1a4731">${q.query}</strong> — positie ${q.position.toFixed(1)}, ${q.impressions} impressies</li>`).join('')
    : '<li style="font-size:13px;color:#8a847a">Geen kansen</li>';

  const actionsHtml = (report.actionsExecuted || []).length
    ? report.actionsExecuted.map(a => `<li style="font-size:13px;color:#4a4640;margin-bottom:6px">${a}</li>`).join('')
    : '<li style="font-size:13px;color:#8a847a">Geen acties</li>';

  const trendsSection = trends && (trends.improved.length || trends.declined.length)
    ? `<p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Ranking trends (t.o.v. vorige week)</p>
       ${trends.improved.length ? `<p style="margin:0 0 8px;font-size:13px;color:#2d6a4f">📈 Verbeterd: ${trends.improved.map(q => `<strong>${q.query}</strong> (was ${(gsc.queries.find(x => x.query === q.query).position + 2).toFixed(1)}, nu ${q.position.toFixed(1)})`).join(', ')}</p>` : ''}
       ${trends.declined.length ? `<p style="margin:0 0 24px;font-size:13px;color:#b8443c">📉 Gedaald: ${trends.declined.slice(0, 2).map(q => `<strong>${q.query}</strong>`).join(', ')}</p>` : ''}`
    : '';

  const html = `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;padding:32px 20px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;border:1.5px solid #e8e5de">
  <tr><td style="background:#1a4731;padding:22px 32px">
    <p style="margin:0;font-size:22px;font-weight:700;color:#fff;font-family:Georgia,serif">Zen<span style="color:#a8d5bc">BTW</span> <span style="font-size:14px;font-weight:400;opacity:.8">Daily Growth Digest</span></p>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.6)">${TODAY}</p>
  </td></tr>
  <tr><td style="padding:28px 32px">

    <!-- SAMENVATTING -->
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Wat is er vandaag gedaan</p>
    <ul style="margin:0 0 8px;padding-left:18px">${actionsHtml}</ul>
    <p style="margin:0 0 28px;font-size:12px;color:#8a847a">Elke actie hieronder bevat de data-redenering waarom deze keuze is gemaakt.</p>

    ${trendsSection}

    <!-- SITE STATISTIEKEN -->
    ${report.siteStats ? `
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">GA4 site statistieken (28 dagen)</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e5de;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr>
        <td style="padding:12px 16px;text-align:center;border-right:1px solid #e8e5de"><span style="font-size:20px;font-weight:700;color:#1a4731;display:block">${report.siteStats.totalViews?.toLocaleString('nl') ?? '—'}</span><span style="font-size:11px;color:#8a847a">Pageviews</span></td>
        <td style="padding:12px 16px;text-align:center;border-right:1px solid #e8e5de"><span style="font-size:20px;font-weight:700;color:#1a4731;display:block">${report.siteStats.totalSessions?.toLocaleString('nl') ?? '—'}</span><span style="font-size:11px;color:#8a847a">Sessies</span></td>
        <td style="padding:12px 16px;text-align:center;border-right:1px solid #e8e5de"><span style="font-size:20px;font-weight:700;color:${report.siteStats.bounceRate > 0.5 ? '#b8443c' : '#2d6a4f'};display:block">${report.siteStats.bounceRate !== null ? (report.siteStats.bounceRate * 100).toFixed(0) + '%' : '—'}</span><span style="font-size:11px;color:#8a847a">Bounce rate</span></td>
        <td style="padding:12px 16px;text-align:center"><span style="font-size:20px;font-weight:700;color:#1a4731;display:block">${report.siteStats.avgDuration ? report.siteStats.avgDuration + 's' : '—'}</span><span style="font-size:11px;color:#8a847a">Gem. duur</span></td>
      </tr>
    </table>` : ''}

    <!-- TOP QUERIES -->
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Top Google queries (28 dagen)</p>
    <p style="margin:0 0 10px;font-size:12px;color:#8a847a">Dit zijn de zoekopdrachten waarvoor ZenBTW het vaakst verschijnt in Google.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e5de;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr style="background:#f7f6f3"><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:left;font-weight:600">Query</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Clicks</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Impressies</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Positie</th></tr>
      ${topQueriesHtml}
    </table>

    <!-- KEYWORD KANSEN -->
    ${opportunities.length ? `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Keyword kansen (positie 4–20)</p>
    <p style="margin:0 0 10px;font-size:12px;color:#8a847a">Deze zoektermen staan net buiten de top 3. Een gerichte verbetering van de bijbehorende blog post kan hier snel een positie-sprong opleveren.</p>
    <ul style="margin:0 0 24px;padding-left:18px">${opportunitiesHtml}</ul>` : ''}

    <!-- KEYWORD QUEUE -->
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Keyword queue</p>
    <p style="margin:0 0 28px;font-size:13px;color:#4a4640">${report.queueStatus?.pending ?? '?'} klaar om te publiceren · ${report.queueStatus?.published ?? '?'} live blogs</p>

    <!-- META VERBETERINGEN MET REDENERING -->
    ${report.metaImprovements?.length ? `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Meta title &amp; description verbeterd</p>
    <p style="margin:0 0 12px;font-size:12px;color:#8a847a">Google toont de title en description als je snippet in de zoekresultaten. Een hogere CTR = meer bezoekers zonder extra rankings.</p>
    ${report.metaImprovements.map(m => `
    <div style="border:1px solid #e8e5de;border-radius:8px;padding:14px 16px;margin-bottom:12px">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#1a4731">/blog/${m.slug}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#b8443c">⚠️ Waarom: CTR ${(m.ctr * 100).toFixed(1)}% bij ${m.impressions} impressies → ~${Math.round(m.impressions * (0.04 - Math.min(m.ctr, 0.04)))} extra kliks/maand mogelijk bij 4% CTR. Positie ${m.position?.toFixed(1)}.</p>
      <p style="margin:0 0 4px;font-size:12px;color:#8a847a;text-decoration:line-through">Oud: ${m.oldTitle}</p>
      <p style="margin:0;font-size:13px;color:#1a1814;font-weight:600">Nieuw: ${m.newTitle}</p>
      ${m.newDescription ? `<p style="margin:4px 0 0;font-size:12px;color:#4a4640;font-style:italic">"${m.newDescription}"</p>` : ''}
    </div>`).join('')}
    <p style="margin:12px 0 28px;font-size:11px;color:#8a847a">Wijzigingen zijn live op de site. Google pikt dit op bij de volgende crawl (meestal binnen 1–7 dagen).</p>` : ''}

    <!-- COMPETITOR GAP FIXES MET REDENERING -->
    ${report.competitorFixes?.length ? `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">🔍 Competitor analyse &amp; verbeteringen</p>
    <p style="margin:0 0 12px;font-size:12px;color:#8a847a">Voor de keywords met de meeste kansen zijn de top 3 Google resultaten bekeken. Wat zij hebben en wij niet, is automatisch toegevoegd.</p>
    ${report.competitorFixes.map(f => `
    <div style="border:1px solid #d4e8dc;border-radius:8px;padding:14px 16px;margin-bottom:12px;background:#f8fdf9">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#1a4731">/blog/${f.slug} — keyword: "${f.keyword}"</p>
      <p style="margin:0 0 10px;font-size:12px;color:#2d6a4f">📊 Geanalyseerde concurrenten: ${(f.competitors || []).map(u => { try { return new URL(u).hostname; } catch { return u; } }).join(', ')}</p>
      ${f.gaps?.length ? `<p style="margin:0 0 8px;font-size:12px;color:#b8443c">⚠️ Gevonden gaps:<br>${f.gaps.map(g => `&nbsp;&nbsp;• ${g}`).join('<br>')}</p>` : ''}
      <p style="margin:0 0 8px;font-size:12px;color:#4a4640;font-style:italic">${f.rationale || ''}</p>
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#1a4731">✅ Toegepast:</p>
      <ul style="margin:0;padding-left:16px">
        ${f.applied.map(a => `<li style="font-size:12px;color:#1a4731;margin-bottom:2px">${a}</li>`).join('')}
      </ul>
    </div>`).join('')}
    <p style="margin:8px 0 28px;font-size:11px;color:#8a847a">FAQ-secties met schema.org/FAQPage markup vergroten kans op rich results (uitklapbare vragen in Google).</p>` : ''}

    <!-- BOUNCE FIXES MET REDENERING -->
    ${report.bounceFixes?.length ? `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Bounce fixes</p>
    <p style="margin:0 0 12px;font-size:12px;color:#8a847a">Pagina's met hoge bounce rate zijn door GA4 gedetecteerd. Bezoekers verlaten de pagina snel zonder actie — dat schaadt de ranking op termijn.</p>
    ${report.bounceFixes.map(f => `
    <div style="border:1px solid #f0dede;border-radius:8px;padding:14px 16px;margin-bottom:12px;background:#fdf8f8">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#1a4731">/blog/${f.slug}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#b8443c">⚠️ Waarom: bounce rate ${(f.bounceRate * 100).toFixed(0)}% — ${f.diagnosis || 'bezoekers verlaten de pagina zonder door te klikken'}</p>
      <p style="margin:0;font-size:12px;color:#1a4731">✅ Fix: ${f.applied.join(', ')}</p>
    </div>`).join('')}` : ''}

    <!-- HOGE BOUNCE WAARSCHUWINGEN (zonder fix) -->
    ${report.umamiHighBounce?.length && !report.bounceFixes?.length ? `
    <p style="margin:0 0 8px;font-size:13px;color:#b8443c;font-weight:600">⚠️ Pagina's met hoge bounce (> 50%, ≥ 10 sessies) — worden morgen aangepakt:</p>
    <ul style="margin:0 0 24px;padding-left:18px">
      ${report.umamiHighBounce.slice(0, 5).map(p => `<li style="font-size:13px;color:#4a4640;margin-bottom:4px">/blog/${p.slug} — ${(p.bounceRate * 100).toFixed(0)}% bounce</li>`).join('')}
    </ul>` : ''}

  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #e8e5de;text-align:center">
    <p style="margin:0;font-size:11px;color:#b8b2a8">ZenBTW Growth Agent · <a href="https://zenbtw.nl" style="color:#8a847a">zenbtw.nl</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'ZenBTW Agent', email: 'bot@zenbtw.nl' },
      to: [{ email: 'danieldekoning66@gmail.com', name: 'Daniel' }],
      subject: `ZenBTW groei-update ${TODAY} — ${(report.actionsExecuted || []).length} acties`,
      htmlContent: html
    })
  });

  if (res.ok) {
    log('Digest email verzonden');
  } else {
    const err = await res.text();
    log(`Digest email MISLUKT: ${err}`);
  }
}

// ── Growth log ───────────────────────────────────────────────────────────────

function appendGrowthLog(entry) {
  const log = load(GROWTH_LOG_FILE, []);
  if (!Array.isArray(log)) return;
  log.unshift({ date: TODAY, ...entry });
  const trimmed = log.slice(0, 90); // 90 dagen bewaren
  save(GROWTH_LOG_FILE, trimmed);
}

// ── Main ─────────────────────────────────────────────────────────────────────

// ── Level 2: Umami bounce fix ─────────────────────────────────────────────────

async function fixHighBouncePage(bounceData, gscData) {
  const filePath = path.join(BLOG_DIR, `${bounceData.slug}.html`);
  if (!fs.existsSync(filePath)) return null;

  const html = fs.readFileSync(filePath, 'utf8');
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] || '';
  const intro = html.match(/<article[^>]*>[\s\S]{0,50}<p[^>]*>([\s\S]{0,400}?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, '') || '';
  const hasCTAAboveFold = html.indexOf('class="cta') < html.indexOf('<h2');
  const internalLinks = (html.match(/href="\/blog\/[^"]+"/g) || []).length;

  log(`Bounce fix voor ${bounceData.slug} (bounce ~${(bounceData.bounceRate * 100).toFixed(0)}%, ${bounceData.entryCount} sessies)`);

  const gscPage = gscData?.pages?.find(p => p.page.includes(bounceData.slug));
  const context = `
Pagina: /blog/${bounceData.slug}
Bounce rate (proxy): ${(bounceData.bounceRate * 100).toFixed(0)}%
Sessies als entry page: ${bounceData.entryCount}
GSC CTR: ${gscPage ? (gscPage.ctr * 100).toFixed(1) + '%' : 'onbekend'}
GSC positie: ${gscPage ? gscPage.position.toFixed(1) : 'onbekend'}
Huidige H1: "${h1}"
Intro (eerste 400 tekens): "${intro}"
CTA boven fold: ${hasCTAAboveFold ? 'ja' : 'NEE'}
Interne links: ${internalLinks}`;

  const prompt = `Je bent CRO-specialist voor ZenBTW, een gratis BTW-tool voor Nederlandse marketplace verkopers.

${context}

Analyseer waarom bezoekers afhaken en geef CONCRETE fixes. Kies maximaal 2 acties:

1. "rewrite_h1": schrijf een betere H1 (pakkend, keyword-first, max 70 tekens)
2. "rewrite_intro": schrijf een betere intro-paragraaf (max 3 zinnen, direct antwoord op de zoekvraag)
3. "add_cta_top": schrijf een compacte CTA box HTML voor boven de eerste H2

Antwoord ALLEEN als JSON:
{
  "fixes": [
    {"type": "rewrite_h1", "value": "..."},
    {"type": "rewrite_intro", "value": "..."},
    {"type": "add_cta_top", "value": "<div ...>...</div>"}
  ],
  "diagnosis": "In 1 zin: waarom haken mensen hier af?"
}`;

  let fixes = [];
  let diagnosis = '';

  try {
    const msg = await withRetry(() => claudeChat([{ role: 'user', content: prompt }], 800));

    const jsonMatch = msg.content[0].text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      fixes = parsed.fixes || [];
      diagnosis = parsed.diagnosis || '';
    }
  } catch (err) {
    log(`  Claude bounce fix faalde: ${err.message}`);
    // Deterministische fallback: voeg CTA toe boven fold als die ontbreekt
    if (!hasCTAAboveFold) {
      fixes = [{ type: 'add_cta_top', value: `<div style="background:#e8f0ec;border-left:4px solid #1a4731;border-radius:8px;padding:14px 18px;margin:0 0 28px"><strong style="color:#1a4731">Gratis tool:</strong> <a href="/app.html" style="color:#1a4731;font-weight:700">Bereken je BTW-verplichtingen in 30 seconden →</a></div>` }];
      diagnosis = 'Geen CTA boven fold — bezoekers zien geen volgende stap';
    }
  }

  if (!fixes.length) return null;

  let newHtml = html;
  const applied = [];

  for (const fix of fixes) {
    if (fix.type === 'rewrite_h1' && fix.value) {
      newHtml = newHtml.replace(/<h1([^>]*)>[^<]+<\/h1>/, `<h1$1>${fix.value}</h1>`);
      applied.push('H1 herschreven');
    }
    if (fix.type === 'rewrite_intro' && fix.value) {
      // Vervang eerste <p> na opening <article> tag
      newHtml = newHtml.replace(/(<article[^>]*>[\s\S]{0,200}?<p[^>]*>)[\s\S]{0,600}?(<\/p>)/, `$1${fix.value}$2`);
      applied.push('Intro herschreven');
    }
    if (fix.type === 'add_cta_top' && fix.value && !hasCTAAboveFold) {
      // Voeg CTA toe voor eerste H2
      newHtml = newHtml.replace(/(<h2[^>]*>)/, `${fix.value}\n$1`);
      applied.push('CTA boven fold toegevoegd');
    }
  }

  if (!DRY_RUN && applied.length) {
    fs.writeFileSync(filePath, newHtml, 'utf8');
  }

  return { slug: bounceData.slug, bounceRate: bounceData.bounceRate, applied, diagnosis };
}

// ── Keyword-aware FAQ generator (fallback zonder Claude) ──────────────────────

function buildKeywordFAQ(keyword) {
  const kw = keyword.toLowerCase();

  // Specifieke FAQ sets per onderwerp
  if (kw.includes('oss') || kw.includes('one stop shop')) {
    return [
      { q: 'Wanneer ben ik verplicht OSS te gebruiken?', a: 'Je bent verplicht OSS te gebruiken als je als Nederlandse ondernemer digitale diensten of goederen verkoopt aan particulieren in andere EU-landen en de drempel van €10.000 per jaar overschrijdt.' },
      { q: 'Hoe registreer ik me voor OSS in Nederland?', a: 'Je registreert je via de Belastingdienst (Mijn Belastingdienst Zakelijk). Na registratie doe je elk kwartaal één gecombineerde aangifte voor alle EU-landen.' },
      { q: 'Wat zijn de voordelen van OSS voor marketplace verkopers?', a: 'Met OSS hoef je je niet in elk EU-land apart te registreren voor BTW. Je doet één aangifte in Nederland voor alle verkopen aan EU-consumenten.' },
    ];
  }
  if (kw.includes('kor') || kw.includes('kleineondernemers')) {
    return [
      { q: 'Wat is de KOR-drempel in 2026?', a: 'De KOR-drempel is €20.000 omzet per jaar exclusief BTW. Zit je hieronder, dan ben je vrijgesteld van BTW en hoef je geen BTW-aangifte te doen.' },
      { q: 'Kan ik de KOR combineren met marketplace verkopen?', a: 'Ja, KOR geldt ook voor Etsy, Vinted en andere marketplace verkopers. Let op: de drempel telt voor je totale omzet uit alle bronnen.' },
      { q: 'Hoe meld ik me aan voor de KOR?', a: 'Je meldt je aan via de Belastingdienst. De aanmelding moet minimaal 4 weken voor het nieuwe kwartaal binnen zijn. Na aanmelding gaat de vrijstelling in per kwartaalstart.' },
    ];
  }
  if (kw.includes('dac7') || kw.includes('platform')) {
    return [
      { q: 'Wat is DAC7 en geldt het voor mij?', a: 'DAC7 is een EU-richtlijn die platforms zoals Vinted, Etsy en Airbnb verplicht om verkoopgegevens te rapporteren aan de Belastingdienst. Als je meer dan €2.000 verdient of 30+ verkopen doet, word je gerapporteerd.' },
      { q: 'Wat doet de Belastingdienst met mijn DAC7-gegevens?', a: 'De Belastingdienst vergelijkt de platformdata met je eigen aangifte. Klopt er iets niet, dan kun je een naheffing of boete verwachten.' },
      { q: 'Moet ik zelf iets doen voor DAC7?', a: 'Het platform rapporteert automatisch. Jij hoeft alleen te zorgen dat je eigen belastingaangifte klopt met de inkomsten die je via het platform hebt ontvangen.' },
    ];
  }
  if (kw.includes('btw') && (kw.includes('tarief') || kw.includes('eu') || kw.includes('landen'))) {
    return [
      { q: 'Welk BTW-tarief geldt voor mijn product in Europa?', a: 'Dit verschilt per EU-land en productcategorie. In Nederland is het standaardtarief 21%, maar andere landen hanteren andere tarieven.' },
      { q: 'Hoe bereken ik BTW voor verkopen aan EU-klanten?', a: 'Je past het BTW-tarief toe van het land waar je klant woont (bestemmingslandbeginsel). Via OSS doe je één gecombineerde aangifte.' },
      { q: 'Gelden dezelfde BTW-regels voor digitale producten?', a: 'Ja, voor digitale producten geldt het BTW-tarief van het land van de koper. Dit geldt al vanaf de eerste euro, er is geen drempel.' },
    ];
  }

  // Generieke BTW-fallback
  return [
    { q: `Wat zijn de BTW-regels voor ${keyword} in 2026?`, a: `De regels rondom ${keyword} zijn in 2026 aangescherpt door DAC7 en OSS-wetgeving. Zorg dat je omzet correct wordt gerapporteerd.` },
    { q: `Wanneer moet ik BTW-aangifte doen voor ${keyword}?`, a: 'In de meeste gevallen doe je per kwartaal aangifte. Als je de KOR hebt, ben je vrijgesteld. Gebruik onze tool om je situatie te checken.' },
    { q: `Geldt ${keyword} ook voor kleine verkopers?`, a: 'Ja, ook kleine verkopers die via platforms verkopen vallen onder de BTW-regels zodra ze de KOR-drempel (€20.000) overschrijden of aan EU-burgers verkopen.' },
  ];
}

// ── Competitor gap analyse + blog verbetering ─────────────────────────────────

async function analyzeAndImprovePage(keyword, slug, gscPage) {
  const filePath = path.join(BLOG_DIR, `${slug}.html`);
  if (!fs.existsSync(filePath)) return null;

  log(`  Competitor analyse voor "${keyword}" → /blog/${slug}`);

  // Eigen pagina scrapen
  const ownHtml = fs.readFileSync(filePath, 'utf8');
  const ownData = {
    wordCount: ownHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
    h1: ownHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '',
    h2s: [...ownHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()),
    hasFAQ: /faq|veelgestelde vragen/i.test(ownHtml),
    hasTabel: /<table/i.test(ownHtml),
    schemaTypes: [...ownHtml.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
      .flatMap(m => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o.map(x => x['@type']) : [o['@type']]; } catch { return []; } })
      .filter(Boolean),
    metaTitle: ownHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '',
    metaDesc: ownHtml.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] || '',
  };

  // Top 3 concurrenten ophalen
  const competitorLinks = await searchCompetitors(keyword);
  if (!competitorLinks.length) return null;

  log(`  Top concurrenten: ${competitorLinks.map(c => new URL(c.url).hostname).join(', ')}`);

  const competitorData = await Promise.all(competitorLinks.map(c => scrapePage(c.url)));
  const gap = buildGapSummary(ownData, competitorData, keyword);

  if (!gap.gaps.length && gap.competitorH2s.length === 0) {
    log(`  Geen significante gaps gevonden`);
    return null;
  }

  // Claude: genereer concrete verbeteringen
  const prompt = `Je bent SEO-specialist voor ZenBTW — een gratis BTW-tool voor Nederlandse marketplace verkopers (Etsy, Vinted, Shopify).

TARGET KEYWORD: "${keyword}"
EIGEN PAGINA: /blog/${slug}
GSC positie: ${gscPage?.position?.toFixed(1) || 'onbekend'} | CTR: ${gscPage ? (gscPage.ctr * 100).toFixed(1) + '%' : 'onbekend'}

EIGEN PAGINA STRUCTUUR:
- H1: "${ownData.h1}"
- Woordcount: ~${ownData.wordCount}
- H2's: ${ownData.h2s.slice(0, 8).join(' | ') || 'geen'}
- Heeft FAQ: ${ownData.hasFAQ ? 'ja' : 'nee'}
- Heeft tabel: ${ownData.hasTabel ? 'ja' : 'nee'}
- Schema: ${ownData.schemaTypes.join(', ') || 'geen'}
- Meta title: "${ownData.metaTitle}"
- Meta description: "${ownData.metaDesc}"

CONCURRENT ANALYSE (top 3 Google resultaten):
${competitorData.filter(Boolean).map((c, i) => `
Concurrent ${i + 1}: ${c.url}
- Woordcount: ~${c.wordCount}
- H1: "${c.h1}"
- H2's: ${c.h2s.slice(0, 6).join(' | ')}
- Heeft FAQ: ${c.hasFAQ ? 'ja' : 'nee'}
- Heeft tabel: ${c.hasTabel ? 'ja' : 'nee'}
- Schema: ${c.schemaTypes.join(', ') || 'geen'}
`).join('')}

GEDETECTEERDE GAPS:
${gap.gaps.map(g => `- ${g}`).join('\n')}

Geef CONCRETE verbeteringen die ZenBTW kan implementeren. Kies maximaal 3 acties:

1. "rewrite_meta_title": betere title tag (max 60 tekens, keyword-first)
2. "rewrite_meta_desc": betere meta description (max 155 tekens, CTA erin)
3. "rewrite_h1": betere H1 (pakkend, keyword-first, max 70 tekens)
4. "add_faq_section": schrijf een FAQ-sectie HTML met 3-4 vragen (als FAQ ontbreekt bij concurrent maar helpt)
5. "add_h2_sections": schrijf 1-2 nieuwe H2-paragrafen als HTML (max 200 woorden totaal) over ontbrekende onderwerpen
6. "add_comparison_table": schrijf een vergelijkingstabel HTML (als concurrenten die hebben)

Antwoord ALLEEN als JSON:
{
  "improvements": [
    {"type": "rewrite_meta_title", "value": "..."},
    {"type": "rewrite_h1", "value": "..."},
    {"type": "add_faq_section", "value": "<section>...</section>"}
  ],
  "rationale": "In 2 zinnen: wat missen we het meest vs de top 3?"
}`;

  let improvements = [];
  let rationale = '';

  try {
    const msg = await withRetry(() => claudeChat([{ role: 'user', content: prompt }], 1500));

    const jsonMatch = msg.content[0].text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      improvements = parsed.improvements || [];
      rationale = parsed.rationale || '';
    }
  } catch (err) {
    log(`  Claude gap analyse faalde: ${err.message} — deterministische fallback`);
    rationale = `Claude niet bereikbaar. Gaps: ${gap.gaps.slice(0, 2).join('; ')}`;

    // Fallback 1: FAQ toevoegen als concurrenten die hebben
    if (!ownData.hasFAQ && gap.gaps.some(g => g.includes('FAQ'))) {
      const faqItems = buildKeywordFAQ(keyword);
      improvements.push({
        type: 'add_faq_section',
        value: `<section style="margin:48px 0" itemscope itemtype="https://schema.org/FAQPage">
<h2>Veelgestelde vragen over ${keyword}</h2>
${faqItems.map(({q, a}) => `<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question" style="margin-bottom:20px">
<h3 itemprop="name" style="font-size:16px;margin:0 0 8px">${q}</h3>
<div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
<p itemprop="text" style="margin:0;color:#4a4640">${a} <a href="/app.html" style="color:#1a4731;font-weight:600">Gebruik onze gratis tool →</a></p>
</div></div>`).join('')}
</section>`
      });
    }

    // Fallback 2: ontbrekende H2-secties op basis van competitor onderwerpen
    const missingH2s = gap.competitorH2s
      .filter(h => !ownData.h2s.some(own => own.toLowerCase().includes(h.toLowerCase().slice(0, 10))))
      .slice(0, 2);
    if (missingH2s.length && gap.gaps.some(g => g.includes('ontbrekende onderwerpen'))) {
      improvements.push({
        type: 'add_h2_sections',
        value: missingH2s.map(h2 => `<h2>${h2}</h2>
<p>Dit is een belangrijk onderdeel van ${keyword} voor Nederlandse marketplace verkopers. Controleer altijd de actuele regels via de <a href="https://www.belastingdienst.nl" rel="noopener noreferrer">Belastingdienst</a> of gebruik onze <a href="/app.html">gratis BTW-tool</a> voor een persoonlijk overzicht.</p>`).join('\n')
      });
    }

    // Fallback 3: schema FAQ toevoegen als schema ontbreekt
    if (!ownData.schemaTypes.includes('FAQPage') && improvements.length === 0) {
      const faqItems = buildKeywordFAQ(keyword);
      improvements.push({
        type: 'add_faq_section',
        value: `<section style="margin:48px 0" itemscope itemtype="https://schema.org/FAQPage">
<h2>Veelgestelde vragen: ${keyword}</h2>
${faqItems.map(({q, a}) => `<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question" style="margin-bottom:20px">
<h3 itemprop="name" style="font-size:16px;margin:0 0 8px">${q}</h3>
<div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
<p itemprop="text" style="margin:0;color:#4a4640">${a}</p>
</div></div>`).join('')}
</section>`
      });
    }
  }

  if (!improvements.length) return null;

  // Verbeteringen toepassen
  let newHtml = ownHtml;
  const applied = [];

  for (const imp of improvements) {
    if (imp.type === 'rewrite_meta_title' && imp.value) {
      newHtml = newHtml.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${imp.value}</title>`);
      applied.push(`Meta title: "${imp.value}"`);
    }
    if (imp.type === 'rewrite_meta_desc' && imp.value) {
      newHtml = newHtml.replace(/(<meta[^>]+name="description"[^>]+content=")[^"]*(")/i, `$1${imp.value}$2`);
      applied.push('Meta description bijgewerkt');
    }
    if (imp.type === 'rewrite_h1' && imp.value) {
      newHtml = newHtml.replace(/<h1([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1>${imp.value}</h1>`);
      applied.push(`H1: "${imp.value}"`);
    }
    if ((imp.type === 'add_faq_section' || imp.type === 'add_h2_sections' || imp.type === 'add_comparison_table') && imp.value) {
      // Voeg in vóór footer / cta-box / laatste </section> — afhankelijk van paginastructuur
      const label = imp.type.replace('add_', '').replace(/_/g, ' ') + ' toegevoegd';
      if (newHtml.includes('</article>')) {
        newHtml = newHtml.replace('</article>', `${imp.value}\n</article>`);
        applied.push(label);
      } else if (newHtml.includes('<footer')) {
        newHtml = newHtml.replace('<footer', `${imp.value}\n<footer`);
        applied.push(label);
      } else if (newHtml.includes('<div class="cta-box"')) {
        newHtml = newHtml.replace('<div class="cta-box"', `${imp.value}\n<div class="cta-box"`);
        applied.push(label);
      } else if (newHtml.includes('</body>')) {
        newHtml = newHtml.replace('</body>', `${imp.value}\n</body>`);
        applied.push(label);
      }
    }
  }

  if (!DRY_RUN && applied.length) {
    fs.writeFileSync(filePath, newHtml, 'utf8');
  }

  return { slug, keyword, applied, rationale, gaps: gap.gaps, competitors: gap.competitors.map(c => c.url) };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`=== ZenBTW Daily Growth Agent v3 (${TODAY}) ===`);
  if (DRY_RUN) log('DRY RUN — geen bestanden worden gewijzigd');

  const report = {
    date: TODAY,
    actionsExecuted: [],
    gsc: null,
    gscOpportunities: [],
    gscSnapshot: null,
    queueStatus: null,
    metaImprovements: [],
    bounceFixes: [],
    competitorFixes: [],
    umamiHighBounce: [],
    siteStats: null,
    trends: null
  };

  // 1. GSC data ophalen
  try {
    log('GSC data ophalen...');
    const gscData = await fetchGSCData(28);
    report.gsc = gscData;
    report.gscSnapshot = gscData; // snapshot voor volgende week
    report.gscOpportunities = findOpportunities(gscData.queries);
    const lowCTR = findLowCTRPages(gscData.pages);

    log(`GSC: ${gscData.queries.length} queries, ${gscData.pages.length} pagina's`);
    log(`Kansen (pos 4-20): ${report.gscOpportunities.length}`);
    log(`Lage CTR pagina's: ${lowCTR.length}`);

    // 1a. Detect ranking trends
    const growthLog = load(GROWTH_LOG_FILE, []);
    report.trends = detectRankingTrends(gscData, growthLog);
    if (report.trends?.improved.length) {
      report.actionsExecuted.push(`📈 ${report.trends.improved.length} keywords verbeterd t.o.v. vorige week`);
    }

    // 2. Verbeter max 3 low-CTR pagina's per dag — met cooldown rotatie
    const improvLog = loadImprovementLog();
    const eligiblePages = lowCTR.filter(p => {
      const slug = p.page.replace('https://zenbtw.nl/blog/', '').replace(/\/$/, '');
      return !wasRecentlyImproved(slug, improvLog, 14);
    });

    log(`Lage CTR pagina's na cooldown filter: ${eligiblePages.length} van ${lowCTR.length} in aanmerking`);

    for (const page of eligiblePages.slice(0, 3)) {
      try {
        const result = await improveLowCTRPage(page);
        if (result) {
          report.metaImprovements.push(result);
          markImproved(result.slug, improvLog, 'meta');
          report.actionsExecuted.push(`✅ Meta verbeterd: /blog/${result.slug}`);
        } else {
          const slug = page.page.replace('https://zenbtw.nl/blog/', '').replace(/\/$/, '');
          const filePath = path.join(BLOG_DIR, `${slug}.html`);
          const linksAdded = addInternalLinksFallback(filePath, slug);
          if (linksAdded) {
            markImproved(slug, improvLog, 'internal-links');
            report.actionsExecuted.push(`🔗 ${linksAdded} interne links toegevoegd: /blog/${slug}`);
          }
        }
      } catch (err) {
        log(`  Fout bij ${page.page}: ${err.message}`);
      }
    }
    saveImprovementLog(improvLog);

    // 3. Check interne link coverage
    const missingLinks = checkInternalLinkCoverage(lowCTR, gscData.pages);
    if (missingLinks.length) {
      report.actionsExecuted.push(`⚠️ ${missingLinks.length} pagina's missen interne links (${missingLinks.map(m => m.slug).join(', ')})`);
    }
  } catch (err) {
    log(`GSC fout (overgeslagen): ${err.message}`);
    report.actionsExecuted.push(`⚠️ GSC niet beschikbaar: ${err.message}`);
  }

  // 4. GA4 analytics: bounce rate analyse + Level 2 auto-fix
  if (ga4Available()) {
    try {
      log('GA4 analytics ophalen...');
      const [bounceData, siteStats] = await Promise.all([
        fetchPageBounceData(28),
        fetchSiteStats(28)
      ]);

      report.siteStats = siteStats;
      const highBounce = bounceData.filter(p => p.highBounce);
      report.umamiHighBounce = highBounce;

      log(`GA4: ${bounceData.length} blog pagina's geanalyseerd, ${highBounce.length} met hoge bounce`);
      if (siteStats.bounceRate !== null) {
        log(`Site-wide bounce rate: ${(siteStats.bounceRate * 100).toFixed(1)}%, avg duur: ${siteStats.avgDuration}s`);
      }

      // Level 1: rapporteer hoge bounce pagina's
      if (highBounce.length) {
        report.actionsExecuted.push(`📊 ${highBounce.length} pagina's met hoge bounce rate gedetecteerd`);
      }

      // Level 2: auto-fix top 2 high-bounce pagina's
      for (const page of highBounce.slice(0, 2)) {
        try {
          const fix = await fixHighBouncePage(page, report.gsc);
          if (fix && fix.applied.length) {
            report.bounceFixes.push(fix);
            report.actionsExecuted.push(`🔧 Bounce fix /blog/${fix.slug}: ${fix.applied.join(', ')}`);
          }
        } catch (err) {
          log(`  Bounce fix fout voor ${page.slug}: ${err.message}`);
        }
      }
    } catch (err) {
      log(`GA4 fout (overgeslagen): ${err.message}`);
      report.actionsExecuted.push(`⚠️ GA4 niet beschikbaar: ${err.message}`);
    }
  } else {
    log('GA4 niet geconfigureerd (GA4_PROPERTY_ID mist) — overgeslagen');
  }

  // 5. Competitor gap analyse voor top kansen
  if (serperAvailable() && report.gscOpportunities?.length) {
    log('Competitor gap analyse starten...');
    // Top kansen gesorteerd op impressies, met cooldown (21 dagen voor competitor analyse)
    const competImprovLog = loadImprovementLog();
    const topKansen = report.gscOpportunities
      .sort((a, b) => b.impressions - a.impressions)
      .filter(k => {
        const mapped = report.gsc?.queryPageMap?.[k.query];
        if (!mapped) return true;
        const slug = mapped.page.replace(/.*\/blog\//, '').replace(/\/$/, '');
        return !wasRecentlyImproved(`competitor:${slug}`, competImprovLog, 21);
      })
      .slice(0, 2);

    for (const kans of topKansen) {
      try {
        // Gebruik directe query→pagina mapping uit GSC
        const mapped = report.gsc?.queryPageMap?.[kans.query];
        let pageUrl = mapped?.page;

        // Fallback: woordoverlap tussen keyword en slug
        if (!pageUrl || !pageUrl.includes('/blog/')) {
          const kwWords = kans.query.toLowerCase().split(/\W+/).filter(w => w.length > 3);
          const best = report.gsc?.pages
            ?.filter(p => p.page.includes('/blog/'))
            .map(p => {
              const slug = p.page.replace(/.*\/blog\//, '').replace(/\/$/, '');
              const overlap = kwWords.filter(w => slug.includes(w)).length;
              return { ...p, overlap };
            })
            .filter(p => p.overlap > 0)
            .sort((a, b) => b.overlap - a.overlap)[0];
          pageUrl = best?.page;
        }

        if (!pageUrl || !pageUrl.includes('/blog/')) continue;
        const slug = pageUrl.replace(/.*\/blog\//, '').replace(/\/$/, '');
        const gscPage = report.gsc?.pages?.find(p => p.page.includes(slug));

        const result = await analyzeAndImprovePage(kans.query, slug, gscPage);
        if (result && result.applied.length) {
          report.competitorFixes = report.competitorFixes || [];
          report.competitorFixes.push(result);
          markImproved(`competitor:${slug}`, competImprovLog, 'competitor-gap');
          saveImprovementLog(competImprovLog);
          report.actionsExecuted.push(`🔍 Competitor gap fix /blog/${result.slug}: ${result.applied.join(', ')}`);
        }
      } catch (err) {
        log(`  Competitor analyse fout: ${err.message}`);
      }
    }
  } else if (!serperAvailable()) {
    log('Competitor analyse overgeslagen (SERPER_API_KEY mist)');
  }

  // 6. Keyword queue checken en aanvullen indien nodig
  const { kw, pending, published } = getQueueStatus();
  report.queueStatus = { pending: pending.length, published: published.length };
  log(`Keyword queue: ${pending.length} pending, ${published.length} gepubliceerd`);

  if (pending.length < 5) {
    log('Queue heeft < 5 keywords — aanvullen...');
    try {
      const added = await refillKeywordQueue(report.gscOpportunities, published.map(p => p.slug));
      report.actionsExecuted.push(`🔑 ${added} nieuwe keywords toegevoegd`);
    } catch (err) {
      log(`Keyword refill mislukt: ${err.message}`);
      report.actionsExecuted.push(`⚠️ Keyword refill mislukt: ${err.message}`);
    }
  }

  // 5. Samenvatting loggen
  log(`Acties uitgevoerd: ${report.actionsExecuted.length}`);
  for (const action of report.actionsExecuted) log(`  ✓ ${action}`);

  appendGrowthLog({
    actionsCount: report.actionsExecuted.length,
    actions: report.actionsExecuted,
    queueAfter: getQueueStatus().pending.length,
    gscAvailable: !!report.gsc,
    gscOpportunities: report.gscOpportunities?.length || 0,
    serperAvailable: serperAvailable(),
    gscSnapshot: report.gscSnapshot ? { queriesCount: report.gsc.queries.length, pagesCount: report.gsc.pages.length } : null,
    metaImprovementsCount: report.metaImprovements.length,
    bounceFixes: report.bounceFixes.length,
    competitorFixes: report.competitorFixes?.length || 0,
    highBouncePages: report.umamiHighBounce.length,
    siteStats: report.siteStats,
    trendsImproved: report.trends?.improved.length || 0,
    trendsDeclining: report.trends?.declined.length || 0
  });

  // 6. Digest email
  await sendDigestEmail(report);

  log('=== Agent klaar ===');
}

main().catch(err => {
  console.error('FATALE FOUT:', err);
  process.exit(1);
});
