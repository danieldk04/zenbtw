// Lead scraper: Apify Reddit + forums → Claude kwaliteitsfilter → leads.json
import fetch from 'node-fetch';
import fs from 'fs';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'leads.json';

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

// Dutch forums en Reddit te doorzoeken via Google
const FORUM_SEARCHES = [
  'site:reddit.com KOR belasting Vinted',
  'site:reddit.com BTW drempel online verkopen',
  'site:gathering.tweakers.net BTW KOR verkopen',
  'site:forum.fok.nl BTW KOR ondernemer',
  'site:moneytalk.nl KOR belasting',
];

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
  console.log(`Run gestart: ${runId}`);

  // Poll tot klaar (max 3 minuten)
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const sr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    const { data: rd } = await sr.json();
    console.log(`  Status: ${rd.status} (${(i + 1) * 5}s)`);
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(rd.status)) break;
  }

  // Haal dataset op
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
    maxItems: 80,
    maxPostCount: 80,
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

async function scoreWithClaude(posts) {
  console.log(`Claude beoordeelt ${posts.length} posts...`);
  const scored = [];

  // Batch per 10 om API calls te beperken
  for (let i = 0; i < posts.length; i += 10) {
    const batch = posts.slice(i, i + 10);
    const prompt = `Je beoordeelt Reddit/forum berichten voor een tool genaamd ZenBTW. ZenBTW helpt Nederlandse marketplace-verkopers (Vinted, Etsy, Shopify) met hun KOR-drempel en BTW-administratie.

Voor elk bericht hieronder, geef een urgentiescore van 1-10:
- 8-10: Persoon heeft nu actief een BTW/KOR probleem of vraag, is waarschijnlijk Nederlandse verkoper
- 5-7: Relevant maar minder urgent of indirect
- 1-4: Niet relevant, spam, of geen Nederlandse context

Antwoord ALLEEN met een JSON array: [{"index":0,"score":7,"reden":"korte reden"}, ...]

Berichten:
${batch.map((p, idx) => `[${idx}] ${p.title || ''}\n${(p.body || p.snippet || p.text || '').slice(0, 300)}`).join('\n\n---\n\n')}`;

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
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const scores = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      for (const s of scores) {
        if (s.score >= 7) {
          scored.push({ ...batch[s.index], _score: s.score, _reden: s.reden });
        }
      }
    } catch (e) {
      console.warn('Claude batch fout:', e.message);
      // Bij fout: voeg batch toe zonder score
      scored.push(...batch.map(p => ({ ...p, _score: 7, _reden: 'onbeoordeeld' })));
    }
    await sleep(500);
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
    title: item.title || item.body?.slice(0, 80) || item.snippet?.slice(0, 80) || '',
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

  // Laad bestaande leads
  let existing = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch {}
  }
  const existingUrls = new Set(existing.map(l => l.url).filter(Boolean));
  console.log(`Bestaande leads: ${existing.length}`);

  // Scrape
  const [redditItems, forumItems] = await Promise.all([scrapeReddit(), scrapeForums()]);
  console.log(`Reddit: ${redditItems.length} items, Forums: ${forumItems.length} items`);

  // Dedup op URL
  const allNew = [
    ...redditItems.map(i => ({ ...i, _platform: 'Reddit' })),
    ...forumItems.map(i => ({ ...i, _platform: 'Forum' })),
  ].filter(i => {
    const url = i.url || (i.permalink ? `https://reddit.com${i.permalink}` : '') || i.link || '';
    return url && !existingUrls.has(url);
  });
  console.log(`Nieuwe unieke posts: ${allNew.length}`);

  if (allNew.length === 0) {
    console.log('Geen nieuwe posts gevonden.');
    fs.writeFileSync(LEADS_FILE, JSON.stringify(existing, null, 2));
    return;
  }

  // Claude kwaliteitsfilter
  const scored = await scoreWithClaude(allNew);
  console.log(`Na Claude filter: ${scored.length} kwaliteitsleads (score ≥7)`);

  // Normaliseer en merge
  const nieuweLeads = scored.map(i => normalizePost(i, i._platform || 'Reddit'));
  const allLeads = [...nieuweLeads, ...existing];

  fs.writeFileSync(LEADS_FILE, JSON.stringify(allLeads, null, 2));
  console.log(`✓ leads.json bijgewerkt: ${allLeads.length} totaal (${nieuweLeads.length} nieuw)`);
}

main().catch(e => { console.error(e); process.exit(1); });
