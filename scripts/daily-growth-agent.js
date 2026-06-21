#!/usr/bin/env node
/**
 * ZenBTW Daily Growth Agent (v2)
 *
 * Runs every morning via GitHub Actions. Without any human input it:
 *   1. Haalt GSC data op (rankings, CTR, kansen)
 *   2. Verbetert lage CTR pagina's met retry logic
 *   3. Vult keyword queue aan als nodig
 *   4. Check interne link coverage
 *   5. Track ranking trends vs vorige week
 *   6. Stuurt digest email naar danieldekoning66@gmail.com
 *
 * Env vars required:
 *   ANTHROPIC_API_KEY          — Claude API
 *   GOOGLE_SERVICE_ACCOUNT_JSON — Google SA met Search Console + Indexing rechten
 *   BREVO_API_KEY              — Brevo transactional email
 *
 * Env vars optional:
 *   DRY_RUN=true               — log acties maar schrijf niks weg
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchGSCData, findOpportunities, findLowCTRPages } from './gsc-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DRY_RUN = process.env.DRY_RUN === 'true';

const KEYWORDS_FILE    = path.join(ROOT, 'keywords.json');
const MEMORY_FILE      = path.join(ROOT, 'content-memory.json');
const GROWTH_LOG_FILE  = path.join(ROOT, 'growth-log.json');
const BLOG_DIR         = path.join(ROOT, 'blog');
const TODAY            = new Date().toISOString().split('T')[0];

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

async function withRetry(fn, maxRetries = 5, backoffMs = 2000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      log(`  Retry ${attempt + 1}/${maxRetries - 1} after ${backoffMs}ms... (${err.message})`);
      await sleep(backoffMs);
      backoffMs *= 2; // exponential backoff: 2s → 4s → 8s → 16s → 32s
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

  const msg = await withRetry(() => claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  }));

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
    const msg = await withRetry(() => claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }));

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

  return { slug, oldTitle: currentTitle, newTitle: title, newDescription: description, usedFallback: !title || !description };
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

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Acties vandaag</p>
    <ul style="margin:0 0 24px;padding-left:18px">${actionsHtml}</ul>

    ${trendsSection}

    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Top Google queries (28d)</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e5de;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr style="background:#f7f6f3"><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:left;font-weight:600">Query</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Clicks</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Impressies</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Positie</th></tr>
      ${topQueriesHtml}
    </table>

    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Keyword kansen (positie 4–20)</p>
    <ul style="margin:0 0 24px;padding-left:18px">${opportunitiesHtml}</ul>

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Keyword queue</p>
    <p style="margin:0 0 24px;font-size:13px;color:#4a4640">${report.queueStatus?.pending ?? '?'} pending · ${report.queueStatus?.published ?? '?'} live</p>

    ${report.metaImprovements?.length ? `
    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Meta verbeteringen</p>
    <ul style="margin:0 0 24px;padding-left:18px">
      ${report.metaImprovements.map(m => `<li style="font-size:13px;color:#4a4640;margin-bottom:6px">/blog/${m.slug}: "${m.newTitle}"</li>`).join('')}
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

async function main() {
  log(`=== ZenBTW Daily Growth Agent v2 (${TODAY}) ===`);
  if (DRY_RUN) log('DRY RUN — geen bestanden worden gewijzigd');

  const report = {
    date: TODAY,
    actionsExecuted: [],
    gsc: null,
    gscOpportunities: [],
    gscSnapshot: null,
    queueStatus: null,
    metaImprovements: [],
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

    // 2. Verbeter max 3 low-CTR pagina's per dag (met retry + fallback)
    for (const page of lowCTR.slice(0, 3)) {
      try {
        const result = await improveLowCTRPage(page);
        if (result) {
          report.metaImprovements.push(result);
          const method = result.usedFallback ? '(fallback)' : '✅';
          report.actionsExecuted.push(`${method} Meta verbeterd: /blog/${result.slug}`);
        } else {
          // Meta mislukt, probeer interne links toe te voegen
          const slug = page.page.replace('https://zenbtw.nl/blog/', '').replace(/\/$/, '');
          const filePath = path.join(BLOG_DIR, `${slug}.html`);
          const linksAdded = addInternalLinksFallback(filePath, slug);
          if (linksAdded) {
            report.actionsExecuted.push(`🔗 ${linksAdded} interne links toegevoegd: /blog/${slug}`);
          }
        }
      } catch (err) {
        log(`  Fout bij ${page.page}: ${err.message}`);
      }
    }

    // 3. Check interne link coverage
    const missingLinks = checkInternalLinkCoverage(lowCTR, gscData.pages);
    if (missingLinks.length) {
      report.actionsExecuted.push(`⚠️ ${missingLinks.length} pagina's missen interne links (checker: ${missingLinks.map(m => m.slug).join(', ')})`);
    }
  } catch (err) {
    log(`GSC fout (overgeslagen): ${err.message}`);
    report.actionsExecuted.push(`⚠️ GSC niet beschikbaar: ${err.message}`);
  }

  // 4. Keyword queue checken en aanvullen indien nodig
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
    gscSnapshot: report.gscSnapshot ? { queriesCount: report.gsc.queries.length, pagesCount: report.gsc.pages.length } : null,
    metaImprovementsCount: report.metaImprovements.length,
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
