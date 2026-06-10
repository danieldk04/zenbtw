// Instagram lead scraper: Apify hashtag scraper → Claude kwaliteitsfilter → instagram-leads.json
import fetch from 'node-fetch';
import fs from 'fs';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'instagram-leads.json';

// Strenge criteria voor kwaliteitsleads:
// ✓ Verkoopt fysieke producten op Vinted/Etsy/Shopify/Depop/marketplace
// ✓ Nederlandse verkoper (NL in bio, euro-prijzen, NL tekst)
// ✓ Minimaal 50 posts, actief (post afgelopen 30 dagen)
// ✓ Bio vermeldt verkopen, webshop, of marketplace
// ✗ Geen pure influencers/bloggers zonder eigen product
// ✗ Geen grote merken (>10k followers = te professioneel, al goed geregeld)
// ✗ Geen buitenlandse verkopers

const HASHTAGS = [
  'vintedverkoper',
  'tweedehandskleding',
  'etsyverkoper',
  'etsyshopnederland',
  'vintednederland',
  'tweedehandsnederland',
  'shopmijnkloset',
  'kledingverkopen',
  'vintagekleding',
  'resellernederland',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

async function scrapeInstagram() {
  console.log('Instagram scrapen via hashtags...');
  // apify/instagram-hashtag-scraper scrapet recente posts per hashtag
  return await runApifyActor('apify~instagram-hashtag-scraper', {
    hashtags: HASHTAGS,
    resultsLimit: 20, // per hashtag
    proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  });
}

function preFilter(posts) {
  // Hashtag-scraper geeft geen bio/followers in post-data — filter alleen op beschikbare velden
  const spamPatterns = [/crypto|nft|forex|trading|casino|bet|loan|affiliate|giveaway|follow.*back/i];

  return posts.filter(post => {
    // Probeer alle bekende veldnamen die Apify kan teruggeven
    const caption = (post.caption || post.text || post.accessibility_caption || '').toLowerCase();
    const username = (post.ownerUsername || post.username || post.owner?.username || '').toLowerCase();
    const fullname = (post.ownerFullName || post.fullName || post.owner?.full_name || '').toLowerCase();

    // Moet een username hebben
    if (!username) return false;

    // Filter spam
    if (spamPatterns.some(p => p.test(caption) || p.test(username))) return false;

    // Caption moet enige inhoud hebben (geen pure foto-zonder-tekst)
    if (caption.length < 10) return false;

    return true;
  });
}

async function scoreWithClaude(posts) {
  console.log(`Claude beoordeelt ${posts.length} Instagram-profielen...`);
  const scored = [];

  for (let i = 0; i < posts.length; i += 6) {
    const batch = posts.slice(i, i + 6);

    const prompt = `Je schrijft persoonlijke Instagram DM's namens Daniel — eigenaar van vintage kledingwinkel Revaleur (700+ reviews op Vinted, Etsy en Shopify) en oprichter van ZenBTW.

Daniel stuurt deze DM's vanuit @revaleur naar mensen die hij NIET kent. Hij benadert ze puur omdat hij zelf heeft geworsteld met KOR/BTW en denkt dat ze er wat aan hebben.

FILTER (score):
8-10: Verkoopt actief fysieke producten via Vinted/Etsy/Shopify/Depop/Marktplaats, Nederlandse kleine verkoper, omzet kan KOR-drempel (€20k/jaar) raken
5-7: Mogelijk relevant maar onduidelijk
1-4: Niet relevant

Voor score ≥7: schrijf 3 varianten van een persoonlijke intro-DM.

STRUCTUUR VAN ELKE DM (in deze volgorde):
1. Naam (voornaam of @username) — geen "Hoi"
2. Één oprecht compliment over iets specifieks: hun product, shopnaam, wat ze maken
3. Korte intro: "Ik ga er niet omheen draaien — ik heb zelf 700+ reviews op Vinted/Etsy/Shopify via mijn vintage shop Revaleur en heb hier zelf lang mee geworsteld."
4. Afhankelijk van variant (zie onder)
5. Altijd afsluiten met: "Groetjes, Daniel"

STIJL: Informeel, menselijk, geen buzzwords, geen emoji, max 5 zinnen. Klinkt als een vriend die toevallig expert is.

3 VARIANTEN:
- helper: na intro → één concreet nuttig feit over hun specifieke situatie (geen ZenBTW) → "Check gerust ook mijn profiel @revaleur of zenbtw.nl als je meer wil weten, maar geen druk. Groetjes, Daniel"
- gesprek: na intro → één gerichte vraag over hun situatie (bijv. hoe ze omzet bijhouden, hoeveel platforms) → "Groetjes, Daniel"
- pitch: na intro → probleem kort uitleggen → "Daarvoor heb ik zenbtw.nl gebouwd, puur om het simpel te houden. Als het niks voor je is ook geen hard feelings. Groetjes, Daniel"

Antwoord UITSLUITEND als JSON array:
[{"index":0,"score":8,"reden":"verkoopt vintage kleding op Etsy NL","username":"shopnaam","displayName":"Lisa","berichten":{"helper":"...","gesprek":"...","pitch":"..."}}]

Profielen:
${batch.map((p, idx) => {
  const username = p.ownerUsername || p.username || p.owner?.username || '?';
  const displayName = p.ownerFullName || p.fullName || p.owner?.full_name || '';
  const bio = p.ownerBio || p.biography || p.owner?.biography || '';
  const caption = (p.caption || p.text || p.accessibility_caption || '').slice(0, 400);
  const followers = p.ownerFollowersCount || p.followersCount || p.owner?.edge_followed_by?.count || '?';
  const posts = p.ownerPostsCount || p.postsCount || p.owner?.edge_owner_to_timeline_media?.count || '?';
  const hashtags = (p.hashtags || []).slice(0, 8).join(' ');
  return `[${idx}] @${username} (${displayName})
Bio: ${bio || '(geen bio beschikbaar)'}
Followers: ${followers} | Posts: ${posts}
Caption: ${caption}
Hashtags: ${hashtags}`;
}).join('\n\n---\n\n')}`;

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
          max_tokens: 3000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      const text = data.content?.[0]?.text || '[]';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const scores = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      for (const s of scores) {
        if (s.score >= 7 && batch[s.index]) {
          scored.push({
            ...batch[s.index],
            _score: s.score,
            _reden: s.reden,
            _berichten: s.berichten || {},
            _displayName: s.displayName || '',
          });
        }
      }
    } catch (e) {
      console.warn('Claude batch fout:', e.message);
    }
    await sleep(400);
  }
  return scored;
}

function normalizePost(item) {
  const username = item.ownerUsername || item.username || item.owner?.username || '?';
  const displayName = item._displayName || item.ownerFullName || item.fullName || item.owner?.full_name || username;
  const followers = item.ownerFollowersCount || item.followersCount || item.owner?.edge_followed_by?.count || 0;
  const shortCode = item.shortCode || item.shortcode || '';
  const postUrl = shortCode ? `https://www.instagram.com/p/${shortCode}/` : '';
  const profileUrl = `https://www.instagram.com/${username}/`;

  return {
    id: item.id || item.shortCode || username,
    url: profileUrl,
    postUrl,
    platform: 'Instagram',
    username,
    displayName,
    bio: (item.ownerBio || item.biography || item.owner?.biography || '').slice(0, 200),
    snippet: (item.caption || item.text || item.accessibility_caption || '').slice(0, 300),
    followers,
    date: new Date().toISOString().split('T')[0],
    score: item._score || 7,
    reden: item._reden || '',
    berichten: item._berichten || {},
    status: 'nieuw',
    note: '',
  };
}

async function main() {
  if (!APIFY_TOKEN) { console.error('APIFY_TOKEN ontbreekt'); process.exit(1); }
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  let existing = [];
  if (fs.existsSync(LEADS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch {}
  }
  const existingUsernames = new Set(existing.map(l => l.username).filter(Boolean));
  console.log(`Bestaande Instagram-leads: ${existing.length}`);

  const rawPosts = await scrapeInstagram();
  console.log(`Instagram: ${rawPosts.length} posts opgehaald`);

  const filtered = preFilter(rawPosts).filter(p => {
    const username = p.ownerUsername || p.username || '';
    return username && !existingUsernames.has(username);
  });
  console.log(`Na pre-filter: ${filtered.length} unieke kandidaten`);

  // Deduplicate op username (meerdere posts van zelfde account)
  const seen = new Set();
  const unique = filtered.filter(p => {
    const u = p.ownerUsername || p.username || '';
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  console.log(`Na deduplicatie: ${unique.length} unieke accounts`);

  if (unique.length === 0) {
    console.log('Geen nieuwe kandidaten.');
    fs.writeFileSync(LEADS_FILE, JSON.stringify(existing, null, 2));
    return;
  }

  const scored = await scoreWithClaude(unique);
  console.log(`Na Claude filter: ${scored.length} kwaliteitsleads (score ≥7)`);

  const nieuweLeads = scored.map(normalizePost);
  const allLeads = [...nieuweLeads, ...existing];

  fs.writeFileSync(LEADS_FILE, JSON.stringify(allLeads, null, 2));
  console.log(`✓ instagram-leads.json: ${allLeads.length} totaal (${nieuweLeads.length} nieuw)`);
}

main().catch(e => { console.error(e); process.exit(1); });
