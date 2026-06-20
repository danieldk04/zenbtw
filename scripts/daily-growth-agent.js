#!/usr/bin/env node
/**
 * ZenBTW Daily Growth Agent
 *
 * Runs every morning via GitHub Actions. Without any human input it:
 *   1. Haalt GSC data op (rankings, CTR, kansen)
 *   2. Analyseert social content performance (content-memory.json)
 *   3. Vraagt Claude wat de beste 1-3 acties zijn voor vandaag
 *   4. Voert die acties uit (keyword toevoegen, meta verbeteren, etc.)
 *   5. Stuurt een digest email naar danieldekoning66@gmail.com
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

  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

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

// ── Meta title/description improvement ───────────────────────────────────────

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

  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  const jsonMatch = msg.content[0].text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const { title, description } = JSON.parse(jsonMatch[0]);
  if (!title || !description) return null;

  if (!DRY_RUN) {
    let newHtml = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/g, `$1${description}$2`)
      .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/g, `$1${title}$2`)
      .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/g, `$1${title}$2`);
    fs.writeFileSync(filePath, newHtml, 'utf8');
  }

  return { slug, oldTitle: currentTitle, newTitle: title, newDescription: description };
}

// ── Digest email via Brevo ────────────────────────────────────────────────────

async function sendDigestEmail(report) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { log('BREVO_API_KEY niet ingesteld — email overgeslagen'); return; }

  const gsc = report.gsc;
  const top3 = gsc?.queries?.slice(0, 3) || [];
  const opportunities = report.gscOpportunities?.slice(0, 5) || [];

  const topQueriesHtml = top3.length
    ? top3.map(q => `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#1a1814">${q.query}</td><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#4a4640;text-align:center">${q.clicks}</td><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#4a4640;text-align:center">${q.impressions}</td><td style="padding:6px 10px;border-bottom:1px solid #f0ede8;font-size:13px;color:#4a4640;text-align:center">${q.position.toFixed(1)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="padding:10px;font-size:13px;color:#8a847a;text-align:center">GSC data niet beschikbaar</td></tr>';

  const opportunitiesHtml = opportunities.length
    ? opportunities.map(q => `<li style="font-size:13px;color:#4a4640;margin-bottom:6px"><strong style="color:#1a1814">${q.query}</strong> — positie ${q.position.toFixed(1)}, ${q.impressions} impressies</li>`).join('')
    : '<li style="font-size:13px;color:#8a847a">Geen kansen gevonden</li>';

  const actionsHtml = (report.actionsExecuted || []).length
    ? report.actionsExecuted.map(a => `<li style="font-size:13px;color:#4a4640;margin-bottom:6px">${a}</li>`).join('')
    : '<li style="font-size:13px;color:#8a847a">Geen acties uitgevoerd</li>';

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

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Acties van vandaag</p>
    <ul style="margin:0 0 24px;padding-left:18px">${actionsHtml}</ul>

    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Top Google queries (28d)</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e5de;border-radius:8px;overflow:hidden;margin-bottom:24px">
      <tr style="background:#f7f6f3"><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:left;font-weight:600">Query</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Clicks</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Impressies</th><th style="padding:8px 10px;font-size:11px;color:#8a847a;text-align:center;font-weight:600">Positie</th></tr>
      ${topQueriesHtml}
    </table>

    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Keyword kansen (positie 4–20)</p>
    <ul style="margin:0 0 24px;padding-left:18px">${opportunitiesHtml}</ul>

    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a4731;text-transform:uppercase;letter-spacing:.5px">Keyword queue</p>
    <p style="margin:0 0 24px;font-size:13px;color:#4a4640">${report.queueStatus?.pending ?? '?'} keywords pending · ${report.queueStatus?.published ?? '?'} blogs gepubliceerd</p>

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
      subject: `ZenBTW groei-update ${TODAY} — ${(report.actionsExecuted || []).length} acties uitgevoerd`,
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
  log(`=== ZenBTW Daily Growth Agent (${TODAY}) ===`);
  if (DRY_RUN) log('DRY RUN — geen bestanden worden gewijzigd');

  const report = {
    date: TODAY,
    actionsExecuted: [],
    gsc: null,
    gscOpportunities: [],
    queueStatus: null,
    metaImprovements: []
  };

  // 1. GSC data ophalen
  try {
    log('GSC data ophalen...');
    const gscData = await fetchGSCData(28);
    report.gsc = gscData;
    report.gscOpportunities = findOpportunities(gscData.queries);
    const lowCTR = findLowCTRPages(gscData.pages);

    log(`GSC: ${gscData.queries.length} queries, ${gscData.pages.length} pagina's`);
    log(`Kansen (pos 4-20): ${report.gscOpportunities.length}`);
    log(`Lage CTR pagina's: ${lowCTR.length}`);

    // 2. Verbeter max 2 low-CTR pagina's per dag
    for (const page of lowCTR.slice(0, 2)) {
      const result = await improveLowCTRPage(page);
      if (result) {
        report.metaImprovements.push(result);
        report.actionsExecuted.push(`Meta verbeterd: /blog/${result.slug} → "${result.newTitle}"`);
      }
    }
  } catch (err) {
    log(`GSC fout (overgeslagen): ${err.message}`);
    report.actionsExecuted.push(`⚠️ GSC niet beschikbaar: ${err.message}`);
  }

  // 3. Keyword queue checken en aanvullen indien nodig
  const { kw, pending, published } = getQueueStatus();
  report.queueStatus = { pending: pending.length, published: published.length };
  log(`Keyword queue: ${pending.length} pending, ${published.length} gepubliceerd`);

  if (pending.length < 5) {
    log('Queue heeft < 5 keywords — aanvullen...');
    try {
      const added = await refillKeywordQueue(report.gscOpportunities, published.map(p => p.slug));
      report.actionsExecuted.push(`${added} nieuwe keywords toegevoegd aan queue`);
    } catch (err) {
      log(`Keyword refill mislukt: ${err.message}`);
      report.actionsExecuted.push(`⚠️ Keyword refill mislukt: ${err.message}`);
    }
  } else {
    log('Queue voldoende gevuld — geen refill nodig');
  }

  // 4. Samenvatting loggen
  log(`Acties uitgevoerd: ${report.actionsExecuted.length}`);
  for (const action of report.actionsExecuted) log(`  ✓ ${action}`);

  appendGrowthLog({
    actionsCount: report.actionsExecuted.length,
    actions: report.actionsExecuted,
    queueAfter: getQueueStatus().pending.length,
    gscAvailable: !!report.gsc
  });

  // 5. Digest email
  await sendDigestEmail(report);

  log('=== Agent klaar ===');
}

main().catch(err => {
  console.error('FATALE FOUT:', err);
  process.exit(1);
});
