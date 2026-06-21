/**
 * Competitor Gap Analyzer
 * Voor een gegeven keyword: haalt top 3 Google resultaten op via Serper.dev,
 * scrapt die pagina's, en analyseert wat zij hebben wat ZenBTW niet heeft.
 *
 * Requires: SERPER_API_KEY env var
 */

const SERPER_KEY = process.env.SERPER_API_KEY;
const OWN_DOMAIN = 'zenbtw.nl';

export function available() {
  return !!SERPER_KEY;
}

/**
 * Zoek top 3 concurrenten voor een keyword (exclusief eigen domein).
 * Retourneert array van { url, title, snippet }
 */
export async function searchCompetitors(keyword) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: keyword, gl: 'nl', hl: 'nl', num: 10 })
  });

  if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const data = await res.json();

  return (data.organic || [])
    .filter(r => !r.link.includes(OWN_DOMAIN))
    .slice(0, 3)
    .map(r => ({ url: r.link, title: r.title, snippet: r.snippet }));
}

/**
 * Scrape een pagina en extraheer structuur: headings, woordcount, schema-types,
 * FAQ-secties, tabellen, interne links.
 */
export async function scrapePage(url) {
  let html;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZenBTW-research/1.0)' }
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Headings
  const headings = [];
  for (const [, tag, text] of html.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (clean) headings.push({ tag: tag.toLowerCase(), text: clean });
  }

  // Woordcount (stripped body)
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(' ').filter(Boolean).length;

  // Schema.org types
  const schemaTypes = [];
  for (const [, json] of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const obj = JSON.parse(json);
      const types = Array.isArray(obj) ? obj.map(o => o['@type']) : [obj['@type']];
      schemaTypes.push(...types.filter(Boolean));
    } catch { /* skip malformed */ }
  }

  // Heeft FAQ-sectie?
  const hasFAQ = /faq|veelgestelde vragen|frequently asked/i.test(html);

  // Heeft tabel?
  const hasTabel = /<table/i.test(html);

  // Heeft vergelijkingstabel / checklist?
  const hasChecklist = /checklist|✓|✔|☑/i.test(bodyText);

  // Interne links count (rough)
  const internalLinks = (html.match(/href="[^"]*"/g) || []).length;

  // Meta title + description
  const metaTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
  const metaDesc  = (html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) || [])[1] || '';

  return {
    url,
    wordCount,
    headings,
    schemaTypes,
    hasFAQ,
    hasTabel,
    hasChecklist,
    internalLinks,
    metaTitle,
    metaDesc,
    h1: headings.find(h => h.tag === 'h1')?.text || '',
    h2s: headings.filter(h => h.tag === 'h2').map(h => h.text),
  };
}

/**
 * Analyseer gap: wat hebben top 3 concurrenten wat de eigen pagina niet heeft?
 * Retourneert een gestructureerde vergelijking zonder Claude (pure data).
 */
export function buildGapSummary(ownData, competitorData, keyword) {
  const gaps = [];

  // Woordcount
  const avgCompWords = Math.round(
    competitorData.filter(c => c?.wordCount > 0).reduce((s, c) => s + c.wordCount, 0) /
    Math.max(competitorData.filter(c => c?.wordCount > 0).length, 1)
  );
  if (ownData.wordCount < avgCompWords * 0.7) {
    gaps.push(`Inhoud te kort: eigen pagina ~${ownData.wordCount} woorden, concurrenten gemiddeld ~${avgCompWords}`);
  }

  // FAQ
  const competsFAQ = competitorData.filter(c => c?.hasFAQ).length;
  if (!ownData.hasFAQ && competsFAQ >= 2) {
    gaps.push('FAQ-sectie ontbreekt (aanwezig bij ' + competsFAQ + ' van 3 concurrenten)');
  }

  // Tabel
  const competsTabel = competitorData.filter(c => c?.hasTabel).length;
  if (!ownData.hasTabel && competsTabel >= 2) {
    gaps.push('Tabel ontbreekt (aanwezig bij ' + competsTabel + ' van 3 concurrenten)');
  }

  // Schema types die concurrenten hebben maar wij niet
  const ownSchema = new Set(ownData.schemaTypes);
  const competSchema = new Set(competitorData.flatMap(c => c?.schemaTypes || []));
  for (const t of competSchema) {
    if (!ownSchema.has(t) && t !== 'undefined') {
      gaps.push(`Schema type "${t}" ontbreekt`);
    }
  }

  // H2 onderwerpen die concurrenten dekken maar wij niet
  const ownH2Words = new Set(ownData.h2s.flatMap(h => h.toLowerCase().split(/\W+/)));
  const competH2s = competitorData.flatMap(c => c?.h2s || []);
  const missingTopics = competH2s
    .filter(h => {
      const words = h.toLowerCase().split(/\W+/);
      const overlap = words.filter(w => w.length > 4 && ownH2Words.has(w)).length;
      return overlap < 2 && h.length > 10;
    })
    .slice(0, 5);

  if (missingTopics.length > 0) {
    gaps.push(`Mogelijk ontbrekende onderwerpen: ${missingTopics.join(' | ')}`);
  }

  return {
    keyword,
    ownWordCount: ownData.wordCount,
    avgCompWordCount: avgCompWords,
    gaps,
    competitorH2s: [...new Set(competH2s)].slice(0, 15),
    competitorSchemas: [...competSchema],
    competitors: competitorData.filter(Boolean).map(c => ({
      url: c.url,
      title: c.metaTitle,
      wordCount: c.wordCount,
      h2s: c.h2s,
      hasFAQ: c.hasFAQ,
      hasTabel: c.hasTabel,
    }))
  };
}
