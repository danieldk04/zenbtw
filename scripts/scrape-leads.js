// Lead scraper: Apify Reddit + forums → Claude kwaliteitsfilter → leads.json
import fetch from 'node-fetch';
import fs from 'fs';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'leads.json';

// Eigen accounts en bots uitsluiten
const EXCLUDED_USERS = new Set([
  'equivalent-goat2036',
  'kvk_nl',
  'automod',
  'automoderator',
]);

const KEYWORDS = [
  'KOR belasting',
  'BTW Vinted',
  'OSS drempel',
  'BTW drempel overschreden',
  'hoeveel mag ik verdienen Vinted',
  'belasting marketplace verkoper',
  'Etsy BTW Nederland',
  'KOR regeling ondernemer',
  'BTW vrijstelling kleine ondernemer',
  'Shopify BTW Nederland',
  'online verkopen belasting Nederland',
];

const FORUM_SEARCHES = [
  'site:reddit.com KOR belasting Vinted OR Etsy OR Shopify',
  'site:reddit.com BTW drempel online verkopen Nederland',
  'site:gathering.tweakers.net BTW KOR verkopen',
  'site:forum.fok.nl BTW KOR ondernemer',
  'site:moneytalk.nl KOR belasting',
];

// Posts van Equivalent-Goat2036 — reacties hierop zijn ook niet relevant
const OWN_POST_IDS = new Set();

async function runApifyActor(actorId, input) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`Apify start fout: ${res.status} ${await res.text()}`);
  const { data } = await res.json();
  const runId = data.id;
  console.log(`  Run gestart: ${runId}`);

  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const sr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const { data: rd } = await sr.json();
    console.log(`  Status: ${rd.status} (${(i + 1) * 5}s)`);
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(rd.status)) break;
  }

  const dr = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=200`
  );
  return await dr.json();
}

async function scrapeReddit() {
  console.log('Reddit scrapen...');
  return await runApifyActor('trudax~reddit-scraper-lite', {
    searches: KEYWORDS.slice(0, 8),
    searchPosts: true,
    searchComments: true,
    sort: 'new',
    time: 'week',
    maxItems: 100,
    maxPostCount: 100,
    proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  });
}

async function scrapeForums() {
  console.log('Forums scrapen via Google...');
  try {
    return await runApifyActor('apify~google-search-scraper', {
      queries: FORUM_SEARCHES,
      maxPagesPerQuery: 1,
      resultsPerPage: 10,
      proxy: { useApifyProxy: true },
    });
  } catch (e) {
    console.warn('Forum scrape mislukt (niet fataal):', e.message);
    return [];
  }
}

function preFilter(items) {
  return items.filter(item => {
    const author = (item.author || item.username || '').toLowerCase();
    const url = item.url || (item.permalink ? `https://reddit.com${item.permalink}` : '') || item.link || '';
    const text = ((item.title || '') + ' ' + (item.body || item.selftext || item.text || '')).toLowerCase();

    // Eigen account uitsluiten
    if (EXCLUDED_USERS.has(author)) return false;

    // Reacties op eigen posts uitsluiten (parent post is van Equivalent-Goat2036)
    if (item.parentId && OWN_POST_IDS.has(item.parentId)) return false;
    if (url.includes('1ttyffn') || url.includes('1u0ci64')) return false; // eigen post URLs

    // Minimale relevantie: moet over NL belasting/BTW/KOR gaan
    const relevantTerms = ['kor', 'btw', 'belasting', 'drempel', 'aangifte', 'oss', 'fiscus', 'omzet', 'ondernemer', 'kvk', 'vinted', 'etsy', 'shopify', 'marketplace'];
    const hasRelevant = relevantTerms.some(t => text.includes(t));
    if (!hasRelevant) return false;

    // Duidelijk irrelevante categorieën wegfilteren
    const spamPatterns = [
      /zoek.*jurk|looking for.*dress|t-shirt.*sell|selling.*shirt/i,
      /koopwoning|hypotheek|huis kopen|mortgage/i,
      /lol\b|😂|👍/i,
    ];
    if (spamPatterns.some(p => p.test(item.title || '') || p.test(item.body || ''))) return false;

    return true;
  });
}

// Identificeer eigen post-IDs zodat we reacties erop kunnen uitsluiten
function markOwnPosts(items) {
  for (const item of items) {
    const author = (item.author || item.username || '').toLowerCase();
    if (EXCLUDED_USERS.has(author) && item.id) {
      OWN_POST_IDS.add(item.id);
    }
  }
}

async function scoreWithClaude(posts) {
  console.log(`Claude beoordeelt ${posts.length} posts...`);
  const scored = [];

  for (let i = 0; i < posts.length; i += 8) {
    const batch = posts.slice(i, i + 8);
    const prompt = `Je bent een strenge filter voor ZenBTW — een tool voor Nederlandse marketplace-verkopers (Vinted, Etsy, Shopify) die hun KOR-drempel en BTW-aangifte willen bijhouden.

Beoordeel elk bericht: is de auteur een potentiële gebruiker van ZenBTW?

Score 8-10: Ja, duidelijk. Persoon verkoopt actief op Vinted/Etsy/Shopify/marketplace EN worstelt met KOR, BTW, belasting, of drempel. Is waarschijnlijk Nederlander. Kan direct baat hebben bij ZenBTW.
Score 5-7: Mogelijk. Vraag over belasting maar niet duidelijk marketplace-verkoper, of context onduidelijk.
Score 1-4: Nee. Iemand die slechts commentaar geeft zonder eigen probleem, iemand die alleen hobby-inkomsten heeft zonder serieuze verkoop, niet-relevant onderwerp, of geen Nederlandse context.

Geef ALLEEN score ≥7 als je echt zeker bent dat dit iemand is die ZenBTW kan helpen.

Antwoord UITSLUITEND als JSON array: [{"index":0,"score":8,"reden":"verkoopt op Etsy, vraagt over KOR drempel"}]

Berichten:
${batch.map((p, idx) => `[${idx}] Auteur: ${p.author || p.username || '?'}\nTitel: ${p.title || '(reactie)'}\nTekst: ${(p.body || p.selftext || p.text || p.snippet || '').slice(0, 400)}`).join('\n\n---\n\n')}`;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      const text = data.content?.[0]?.text || '[]';
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      const scores = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      for (const s of scores) {
        if (s.score >= 7 && batch[s.index]) {
          scored.push({ ...batch[s.index], _score: s.score, _reden: s.reden });
        }
      }
    } catch (e) {
      console.warn('Claude batch fout:', e.message);
    }
    await sleep(300);
  }
  return scored;
}

function normalizePost(item, platform = 'Reddit') {
  const url = item.url || (item.permalink ? `https://reddit.com${item.permalink}` : null) || item.link || '';
  return {
    id: item.id || url,
    url,
    platform,
    subreddit: item.subreddit || item.community || '',
    username: item.author || item.username || '?',
    title: item.title || item.body?.slice(0, 80) || item.snippet?.slice(0, 80) || '(reactie)',
    snippet: (item.body || item.selftext || item.text || item.snippet || '').slice(0, 300),
    date: item.created_utc
      ? new Date(item.created_utc * 1000).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    score: item._score || 7,
    reden: item._reden || '',
    status: 'nieuw',
    note: '',
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  if (!APIFY_TOKEN) { console.error('APIFY_TOKEN ontbreekt'); process.exit(1); }
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  let existing = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch {}
  }
  const existingUrls = new Set(existing.map(l => l.url).filter(Boolean));
  console.log(`Bestaande leads: ${existing.length}`);

  const [redditItems, forumItems] = await Promise.all([scrapeReddit(), scrapeForums()]);
  console.log(`Reddit: ${redditItems.length} items, Forums: ${forumItems.length} items`);

  // Markeer eigen posts zodat reacties erop gefilterd worden
  markOwnPosts(redditItems);

  const allRaw = [
    ...redditItems.map(i => ({ ...i, _platform: 'Reddit' })),
    ...forumItems.map(i => ({ ...i, _platform: 'Forum' })),
  ];

  // Stap 1: goedkoop pre-filter (geen API calls)
  const preFiltered = preFilter(allRaw).filter(i => {
    const url = i.url || (i.permalink ? `https://reddit.com${i.permalink}` : '') || i.link || '';
    return url && !existingUrls.has(url);
  });
  console.log(`Na pre-filter: ${preFiltered.length} kandidaten`);

  if (preFiltered.length === 0) {
    console.log('Geen nieuwe kandidaten.');
    fs.writeFileSync(LEADS_FILE, JSON.stringify(existing, null, 2));
    return;
  }

  // Stap 2: Claude kwaliteitsfilter
  const scored = await scoreWithClaude(preFiltered);
  console.log(`Na Claude filter: ${scored.length} kwaliteitsleads (score ≥7)`);

  const nieuweLeads = scored.map(i => normalizePost(i, i._platform || 'Reddit'));
  const allLeads = [...nieuweLeads, ...existing];

  fs.writeFileSync(LEADS_FILE, JSON.stringify(allLeads, null, 2));
  console.log(`✓ leads.json: ${allLeads.length} totaal (${nieuweLeads.length} nieuw)`);
}

main().catch(e => { console.error(e); process.exit(1); });
