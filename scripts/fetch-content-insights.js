// Haalt Instagram + TikTok metrics op en slaat op in content-memory.json
import fetch from 'node-fetch';
import fs from 'fs';

const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MEMORY_FILE = 'content-memory.json';
const IG_USER = process.env.IG_USER_ID; // Instagram Business account ID

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadMemory() {
  if (fs.existsSync(MEMORY_FILE)) {
    try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch {}
  }
  return { posts: [], patterns: {}, learnings: [], lastUpdated: null, recommendations: [] };
}

// ── Instagram Graph API ───────────────────────────────────────────

async function fetchInstagramPosts() {
  if (!IG_TOKEN || !IG_USER) {
    console.log('IG_ACCESS_TOKEN of IG_USER_ID ontbreekt — Instagram overgeslagen');
    return [];
  }
  console.log('Instagram posts ophalen...');

  // Haal recente media op
  const mediaRes = await fetch(
    `https://graph.instagram.com/v21.0/${IG_USER}/media?fields=id,caption,media_type,timestamp,permalink,thumbnail_url,media_url&limit=50&access_token=${IG_TOKEN}`
  );
  const mediaData = await mediaRes.json();
  if (!mediaData.data) {
    console.warn('Instagram API fout:', JSON.stringify(mediaData));
    return [];
  }

  const posts = [];
  for (const post of mediaData.data) {
    // Insights per post ophalen
    const insightFields = post.media_type === 'VIDEO' || post.media_type === 'REELS'
      ? 'reach,impressions,likes,comments,shares,saved,video_views,ig_reels_avg_watch_time,ig_reels_video_view_total_time,total_interactions'
      : 'reach,impressions,likes,comments,shares,saved,total_interactions';

    try {
      const insRes = await fetch(
        `https://graph.instagram.com/v21.0/${post.id}/insights?metric=${insightFields}&access_token=${IG_TOKEN}`
      );
      const insData = await insRes.json();
      const metrics = {};
      if (insData.data) {
        for (const m of insData.data) metrics[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
      }

      posts.push({
        id: post.id,
        platform: 'instagram',
        type: post.media_type?.toLowerCase() || 'unknown',
        caption: (post.caption || '').slice(0, 500),
        date: post.timestamp?.split('T')[0] || '',
        url: post.permalink || '',
        metrics: {
          reach: metrics.reach || 0,
          impressions: metrics.impressions || 0,
          likes: metrics.likes || 0,
          comments: metrics.comments || 0,
          shares: metrics.shares || 0,
          saves: metrics.saved || 0,
          views: metrics.video_views || 0,
          avgWatchTime: metrics.ig_reels_avg_watch_time || 0,
          totalWatchTime: metrics.ig_reels_video_view_total_time || 0,
          totalInteractions: metrics.total_interactions || 0,
        }
      });
      await sleep(200);
    } catch (e) {
      console.warn(`Insights fout voor post ${post.id}:`, e.message);
    }
  }
  console.log(`Instagram: ${posts.length} posts opgehaald met metrics`);
  return posts;
}

// ── TikTok via Apify ─────────────────────────────────────────────

async function fetchTikTokPosts(username) {
  if (!APIFY_TOKEN || !username) {
    console.log('TikTok overgeslagen (geen APIFY_TOKEN of username)');
    return [];
  }
  console.log(`TikTok posts ophalen voor @${username}...`);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/clockworks~free-tiktok-scraper/runs?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: [username],
          resultsPerPage: 30,
          proxy: { useApifyProxy: true },
        }),
      }
    );
    if (!res.ok) throw new Error(`Apify TikTok fout: ${res.status}`);
    const { data } = await res.json();
    const runId = data.id;

    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const sr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
      const { data: rd } = await sr.json();
      if (['SUCCEEDED', 'FAILED', 'ABORTED'].includes(rd.status)) break;
    }

    const dr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=50`);
    const items = await dr.json();

    return items.map(v => ({
      id: v.id || v.videoId || v.webVideoUrl,
      platform: 'tiktok',
      type: 'video',
      caption: (v.text || v.description || '').slice(0, 500),
      date: v.createTime ? new Date(v.createTime * 1000).toISOString().split('T')[0] : '',
      url: v.webVideoUrl || '',
      metrics: {
        views: v.playCount || v.stats?.playCount || 0,
        likes: v.diggCount || v.stats?.diggCount || 0,
        comments: v.commentCount || v.stats?.commentCount || 0,
        shares: v.shareCount || v.stats?.shareCount || 0,
        avgWatchTime: 0,
        reach: v.playCount || 0,
      }
    }));
  } catch (e) {
    console.warn('TikTok scrape mislukt:', e.message);
    return [];
  }
}

// ── Claude multi-agent analyse ────────────────────────────────────

async function analyzeWithClaude(allPosts, existingMemory) {
  if (allPosts.length === 0) return existingMemory;
  console.log(`Claude analyseert ${allPosts.length} posts...`);

  // Sorteer op prestatie voor context
  const ranked = [...allPosts].sort((a, b) => (b.metrics.reach || b.metrics.views) - (a.metrics.reach || a.metrics.views));
  const top5 = ranked.slice(0, 5);
  const bottom5 = ranked.slice(-5);

  const existingLearnings = (existingMemory.learnings || []).slice(-10).map(l => `- ${l}`).join('\n');

  const prompt = `Je bent een social media intelligence agent voor Daniel, die ZenBTW runt — een tool voor Nederlandse marketplace-verkopers (Vinted/Etsy/Shopify) met KOR/BTW-administratie. Hij post content over ondernemen, belasting, marketplace-verkopen, zijn eigen vintage shop Revaleur.

BESTAANDE LEARNINGS (wat je al weet):
${existingLearnings || 'Nog geen learnings — eerste analyse.'}

NIEUWE DATA — TOP POSTS (beste bereik/views):
${top5.map(p => `[${p.platform.toUpperCase()} ${p.type}] ${p.date}
Caption: ${p.caption.slice(0, 200)}
Metrics: ${JSON.stringify(p.metrics)}`).join('\n\n')}

SLECHTST PRESTERENDE POSTS:
${bottom5.map(p => `[${p.platform.toUpperCase()} ${p.type}] ${p.date}
Caption: ${p.caption.slice(0, 150)}
Metrics: ${JSON.stringify(p.metrics)}`).join('\n\n')}

Doe 4 analyses:

1. HOOK_PATTERNS: Wat kenmerkt de hooks/openingszinnen van de top posts vs de slechte posts?
2. TOPIC_PATTERNS: Welke onderwerpen/thema's scoren consistent goed?
3. FORMAT_PATTERNS: Wat werkt qua format (lengte, structuur, hashtags, stijl)?
4. TIMING_PATTERNS: Patronen in dag/tijd van posten bij succesvolle posts?

Plus:
5. TOP_LEARNINGS: 5 concrete, actionable learnings op basis van ALLE data (inclusief bestaande learnings)
6. NEXT_RECOMMENDATIONS: 3 concrete content-ideeën voor de komende week, elk met: titel, hook, format, beste postmoment
7. WAAROM_13K: Als er een post is met extreem hoog bereik (>5000 views/reach), analyseer specifiek waarom die scoorde

Antwoord als JSON:
{
  "hookPatterns": ["..."],
  "topicPatterns": ["..."],
  "formatPatterns": ["..."],
  "timingPatterns": ["..."],
  "topLearnings": ["..."],
  "recommendations": [
    {"titel": "...", "hook": "...", "format": "...", "postMoment": "...", "rationale": "..."}
  ],
  "waarom13k": "..."
}`;

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
    const text = data.content?.[0]?.text || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch (e) {
    console.warn('Claude analyse fout:', e.message);
    return {};
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  const memory = loadMemory();
  const existingIds = new Set(memory.posts.map(p => p.id));

  // Fetch nieuwe data
  const igPosts = await fetchInstagramPosts();
  const tiktokUsername = process.env.TIKTOK_USERNAME || '';
  const ttPosts = await fetchTikTokPosts(tiktokUsername);

  const allNew = [...igPosts, ...ttPosts].filter(p => !existingIds.has(p.id));
  console.log(`Nieuwe posts: ${allNew.length}`);

  // Update bestaande posts met nieuwe metrics (kunnen gewijzigd zijn)
  const allPosts = [...allNew, ...memory.posts.filter(p => !igPosts.find(n => n.id === p.id))];

  // Claude analyse
  const analysis = await analyzeWithClaude(allPosts.slice(0, 50), memory);

  // Update memory
  const updatedMemory = {
    posts: allPosts.slice(0, 100), // Bewaar laatste 100 posts
    patterns: {
      hooks: analysis.hookPatterns || memory.patterns?.hooks || [],
      topics: analysis.topicPatterns || memory.patterns?.topics || [],
      format: analysis.formatPatterns || memory.patterns?.format || [],
      timing: analysis.timingPatterns || memory.patterns?.timing || [],
    },
    learnings: [
      ...(analysis.topLearnings || []),
      ...(memory.learnings || []).filter(l => !(analysis.topLearnings || []).includes(l)),
    ].slice(0, 20), // Bewaar max 20 learnings
    recommendations: analysis.recommendations || [],
    waarom13k: analysis.waarom13k || memory.waarom13k || '',
    lastUpdated: new Date().toISOString(),
    totalPostsAnalyzed: allPosts.length,
  };

  fs.writeFileSync(MEMORY_FILE, JSON.stringify(updatedMemory, null, 2));
  console.log(`✓ content-memory.json bijgewerkt`);
  console.log(`  Posts: ${allPosts.length} | Learnings: ${updatedMemory.learnings.length} | Aanbevelingen: ${updatedMemory.recommendations.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
