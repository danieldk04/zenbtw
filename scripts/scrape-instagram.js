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
  const nlTerms = ['vinted', 'etsy', 'shopify', 'depop', 'marktplaats', 'verkoop', 'webshop',
    'btw', 'kor', 'belasting', 'ondernemer', 'kvk', 'shop', 'winkel', 'tweedehands',
    'vintage', 'resell', 'kledingverkoop', 'handmade'];

  return posts.filter(post => {
    const bio = (post.ownerBio || post.biography || '').toLowerCase();
    const caption = (post.caption || post.text || '').toLowerCase();
    const username = (post.ownerUsername || post.username || '').toLowerCase();
    const fullname = (post.ownerFullName || post.fullName || '').toLowerCase();
    const followers = post.ownerFollowersCount || post.followersCount || 0;
    const postCount = post.ownerPostsCount || post.postsCount || 0;

    // Minimale activiteit
    if (followers < 30) return false;
    if (followers > 15000) return false; // te groot = al professioneel geregeld
    if (postCount < 5) return false;

    // Moet NL-gerelateerd zijn: NL tekst in bio of caption of NL-specifieke termen
    const allText = bio + ' ' + caption + ' ' + fullname;
    const hasNlTerms = nlTerms.some(t => allText.includes(t));
    if (!hasNlTerms) return false;

    // Filter duidelijk irrelevante accounts
    const spamPatterns = [/crypto|nft|forex|trading|casino|bet|loan|affiliate/i];
    if (spamPatterns.some(p => p.test(bio) || p.test(caption))) return false;

    return true;
  });
}

async function scoreWithClaude(posts) {
  console.log(`Claude beoordeelt ${posts.length} Instagram-profielen...`);
  const scored = [];

  for (let i = 0; i < posts.length; i += 6) {
    const batch = posts.slice(i, i + 6);

    const prompt = `Je bent een filter én outreach-schrijver voor ZenBTW — een gratis tool voor Nederlandse marketplace-verkopers (Vinted, Etsy, Shopify) die hun KOR-drempel en BTW-aangifte bijhouden.

ZenBTW is gebouwd door Daniel. Hij runt zelf vintage kledingwinkel Revaleur met 700+ reviews op Vinted, Etsy en Shopify. Hij weet dus exact hoe het is om als kleine verkoper met belastingzaken te worstelen.

STRIKTE VOORWAARDEN voor een goede lead (score 8-10):
- Verkoopt actief fysieke producten op Vinted, Etsy, Shopify, Depop, Marktplaats of eigen webshop
- Is een Nederlandse kleine verkoper (niet een groot merk)
- Heeft omzet die de KOR-drempel (€20k/jaar) zou kunnen raken
- Is GEEN puur influencer/blogger zonder eigen producten
- Is GEEN service-bedrijf (fotograaf, coach, etc.) — alleen productverkopers

Score 5-7: verkoopt mogelijk producten maar onduidelijk of NL of klein genoeg
Score 1-4: niet relevant (influencer zonder shop, groot merk, buitenlands, service)

Voor score ≥7: schrijf een persoonlijk Instagram DM namens Daniel.

DM-regels:
- Begin met hun voornaam of @username als naam onbekend is
- Noem iets SPECIFIEKS uit hun bio of post (shop naam, product type, wat ze verkopen)
- Schrijf vanuit Daniels eigen ervaring: hij verkoopt ook vintage kleding via Revaleur, 700+ reviews op Vinted/Etsy/Shopify
- Maak het probleem concreet en herkenbaar: veel verkopers ontdekken de KOR-drempel te laat, Belastingdienst kijkt naar omzet niet winst, platforms als Etsy dragen zelf geen BTW af aan de NL fiscus
- Kort: max 4 zinnen
- Informeel, geen emoji, geen "Hoi!", geen buzzwords
- Klinkt als een berichtje van een echte collega-verkoper, niet een pitch

3 varianten per lead:
- helper: deel één concreet nuttig feit over hun situatie — geen ZenBTW
- gesprek: stel één gerichte vraag die hun situatie uitdiept (bijv. hoeveel platforms, hoe ze nu bijhouden)
- pitch: help eerst, dan in de laatste zin: "...ik heb zenbtw.nl gebouwd hiervoor"

Antwoord UITSLUITEND als JSON array:
[{"index":0,"score":8,"reden":"verkoopt vintage kleding op Etsy NL, ~500 followers, actieve shop","username":"shopnaam","displayName":"Lisa","berichten":{"helper":"...","gesprek":"...","pitch":"..."}}]

Profielen:
${batch.map((p, idx) => {
  const username = p.ownerUsername || p.username || '?';
  const displayName = p.ownerFullName || p.fullName || '';
  const bio = p.ownerBio || p.biography || '';
  const caption = (p.caption || p.text || '').slice(0, 300);
  const followers = p.ownerFollowersCount || p.followersCount || 0;
  const posts = p.ownerPostsCount || p.postsCount || 0;
  return `[${idx}] @${username} (${displayName})
Bio: ${bio}
Followers: ${followers} | Posts: ${posts}
Recente post: ${caption}`;
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
  const username = item.ownerUsername || item.username || '?';
  const displayName = item._displayName || item.ownerFullName || item.fullName || username;
  const followers = item.ownerFollowersCount || item.followersCount || 0;
  const url = item.url || item.shortCode
    ? `https://www.instagram.com/p/${item.shortCode}/`
    : `https://www.instagram.com/${username}/`;
  const profileUrl = `https://www.instagram.com/${username}/`;

  return {
    id: item.id || username,
    url: profileUrl,
    postUrl: url,
    platform: 'Instagram',
    username,
    displayName,
    bio: (item.ownerBio || item.biography || '').slice(0, 200),
    snippet: (item.caption || item.text || '').slice(0, 300),
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
