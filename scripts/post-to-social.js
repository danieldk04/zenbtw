#!/usr/bin/env node
/**
 * ZenBTW Social Media Poster
 * Posts daily teasers from blog content to X (Twitter) and Bluesky
 * Generates 3 posts per day with engaging copy + optional dashboard screenshots
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import OAuth from 'oauth-1.0a';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Config
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const BLUESKY_USER = process.env.BLUESKY_USERNAME;
const BLUESKY_PASS = process.env.BLUESKY_PASSWORD;
const ENABLE_SCREENSHOTS = process.env.SCREENSHOTS_ENABLED === 'true';

// State files
const STATE_FILE = path.join(ROOT, '.social-post-state.json');
const KEYWORDS_FILE = path.join(ROOT, 'keywords-queue.json');

// ── OAuth 1.0a Setup ───────────────────────────────────────────────────────
const oauth = new OAuth({
  consumer: { key: TWITTER_API_KEY, secret: TWITTER_API_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { postedToday: [], lastPostDate: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function loadKeywordsQueue() {
  if (fs.existsSync(KEYWORDS_FILE)) {
    return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
  }
  return { queue: [], published: [] };
}

function saveKeywordsQueue(queue) {
  fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

function isNewDay(lastDate) {
  if (!lastDate) return true;
  const last = new Date(lastDate);
  const now = new Date();
  return last.toDateString() !== now.toDateString();
}

// ── Blog helpers ─────────────────────────────────────────────────────────────
function getAvailableBlogs() {
  const blogDir = path.join(ROOT, 'blog');
  if (!fs.existsSync(blogDir)) return [];

  return fs.readdirSync(blogDir)
    .filter(f => f.endsWith('.html'))
    .map(f => ({
      filename: f,
      slug: f.replace('.html', ''),
      path: path.join(blogDir, f)
    }))
    .slice(0, 50);
}

function findBlogByKeyword(keyword, blogs) {
  if (!keyword) return null;
  const keywordLower = keyword.toLowerCase();
  return blogs.find(blog =>
    blog.slug.toLowerCase().includes(keywordLower) ||
    blog.filename.toLowerCase().includes(keywordLower)
  );
}

function extractBlogMetadata(htmlContent) {
  let title = '';
  const h1Match = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const ogMatch = htmlContent.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i);
  title = h1Match?.[1] || ogMatch?.[1] || 'Blog Post';

  let desc = '';
  const ogDescMatch = htmlContent.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i);
  const pMatch = htmlContent.match(/<p[^>]*>([^<]{50,150}[^<]*)<\/p>/i);
  desc = ogDescMatch?.[1] || pMatch?.[1] || '';

  return {
    title: title.substring(0, 100),
    description: desc.substring(0, 200),
    cleanDesc: desc.replace(/<[^>]*>/g, '').trim()
  };
}

// ── Generate teasing copy with Claude ───────────────────────────────────────
async function generateTeasingCopy(blog, title, description) {
  if (!ANTHROPIC_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY missing, using generic teaser');
    return `📚 Nieuwe blog: ${title.substring(0, 80)}\n\nLees het volledige artikel op zenbtw.nl →`;
  }

  const client = new Anthropic();

  const prompt = `Je bent Daniel, founder van ZenBTW. Je schrijft korte, punchy teasers voor blog posts.

Blog titel: "${title}"
Blog snippet: "${description}"

Schrijf 1 teasing tekst (max 200 tekens) die:
- Begint met een provocerende vraag of statement
- Hints naar concrete waarde in het artikel
- Eindigt met "Lees →"
- GEEN hashtags, max 1 emoji
- GEEN URL - die voegen we zelf toe
- Geschreven in Nederlands

ALLEEN de tekst teruggeven, GEEN URL, niks anders.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }]
    });

    let text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : null;
    if (!text) return null;

    // Strip any URL Claude sneaks in anyway
    text = text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();

    return text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return null;
  }
}

// ── X OAuth 1.0a upload + post ────────────────────────────────────────────
async function uploadMediaToX(mediaPath) {
  if (!TWITTER_API_KEY || !TWITTER_ACCESS_TOKEN || !mediaPath) return null;

  try {
    const mediaData = fs.readFileSync(mediaPath);
    const base64 = mediaData.toString('base64');

    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    const token = { key: TWITTER_ACCESS_TOKEN, secret: TWITTER_ACCESS_SECRET };

    // Include media_data in signature for form-encoded upload
    const authHeader = oauth.toHeader(
      oauth.authorize({ url, method: 'POST', data: { media_data: base64 } }, token)
    );

    const uploadRes = await fetch(url, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `media_data=${encodeURIComponent(base64)}`
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.warn(`⚠️  X media upload failed (${uploadRes.status}):`, err.substring(0, 100));
      return null;
    }

    const media = await uploadRes.json();
    console.log(`✓ Media uploaded to X: ${media.media_id_string}`);
    return media.media_id_string;
  } catch (err) {
    console.warn('X media upload error:', err.message);
    return null;
  }
}

async function postToX(text, mediaPath = null) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    console.warn('⚠️  X OAuth 1.0a credentials missing');
    return false;
  }

  try {
    let mediaId = null;
    if (mediaPath && fs.existsSync(mediaPath)) {
      mediaId = await uploadMediaToX(mediaPath);
    }

    // v2 tweets endpoint — sign only URL, not JSON body
    const postUrl = 'https://api.twitter.com/2/tweets';
    const token = { key: TWITTER_ACCESS_TOKEN, secret: TWITTER_ACCESS_SECRET };
    const authHeader = oauth.toHeader(oauth.authorize({ url: postUrl, method: 'POST' }, token));

    const tweetBody = { text: text.substring(0, 280) };
    if (mediaId) tweetBody.media = { media_ids: [mediaId] };

    const response = await fetch(postUrl, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(tweetBody)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ X API error:', response.status, error.substring(0, 300));
      return false;
    }

    const data = await response.json();
    console.log(`✓ Posted to X: ${data.data?.id}`);
    return true;
  } catch (err) {
    console.error('X posting error:', err.message);
    return false;
  }
}

// ── Bluesky post with correct facets + grapheme limit ───────────────────────
async function uploadMediaToBluesky(mediaPath, token) {
  if (!mediaPath || !fs.existsSync(mediaPath)) return null;

  try {
    const mediaData = fs.readFileSync(mediaPath);
    const blobRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: mediaData
    });

    if (!blobRes.ok) {
      console.warn('⚠️  Bluesky blob upload failed');
      return null;
    }

    const blob = await blobRes.json();
    return blob.blob;
  } catch (err) {
    console.warn('Bluesky media upload error:', err.message);
    return null;
  }
}

async function postToBluesky(teaserText, blogUrl, mediaPath = null) {
  if (!BLUESKY_USER || !BLUESKY_PASS) {
    console.warn('⚠️  BLUESKY credentials missing, skipping Bluesky post');
    return false;
  }

  try {
    // 1. Login
    const loginRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: BLUESKY_USER, password: BLUESKY_PASS })
    });

    if (!loginRes.ok) {
      const error = await loginRes.text();
      console.error('Bluesky login error:', loginRes.status, error);
      return false;
    }

    const session = await loginRes.json();
    const token = session.accessJwt;
    const did = session.did;

    // 2. Build text respecting 300 grapheme limit
    // Leave room for "\n\n" (2) + URL length
    const urlGraphemes = [...blogUrl].length;
    const maxTeaserGraphemes = 300 - 2 - urlGraphemes; // 2 for \n\n separator

    let teaser = teaserText;
    if ([...teaser].length > maxTeaserGraphemes) {
      teaser = [...teaser].slice(0, maxTeaserGraphemes - 1).join('') + '…';
    }

    const fullText = `${teaser}\n\n${blogUrl}`;

    // Verify total grapheme count
    const totalGraphemes = [...fullText].length;
    console.log(`📏 Bluesky text: ${totalGraphemes} graphemes (max 300)`);
    if (totalGraphemes > 300) {
      console.error('❌ Text still exceeds 300 graphemes after truncation');
      return false;
    }

    // 3. Build facet for clickable URL (UTF-8 byte offsets)
    const beforeUrl = `${teaser}\n\n`;
    const byteStart = Buffer.from(beforeUrl, 'utf8').length;
    const byteEnd = byteStart + Buffer.from(blogUrl, 'utf8').length;

    const postRecord = {
      $type: 'app.bsky.feed.post',
      text: fullText,
      createdAt: new Date().toISOString(),
      facets: [{
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: blogUrl }]
      }]
    };

    // 4. Upload media if available
    if (mediaPath) {
      const blob = await uploadMediaToBluesky(mediaPath, token);
      if (blob) {
        postRecord.embed = {
          $type: 'app.bsky.embed.images',
          images: [{ image: blob, alt: 'ZenBTW Dashboard Screenshot' }]
        };
      }
    }

    // 5. Post
    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record: postRecord })
    });

    if (!postRes.ok) {
      const error = await postRes.text();
      console.error('Bluesky post error:', postRes.status, error);
      return false;
    }

    const post = await postRes.json();
    console.log(`✓ Posted to Bluesky: ${post.uri}`);
    return true;
  } catch (err) {
    console.error('Bluesky posting error:', err.message);
    return false;
  }
}

// ── Screenshot ───────────────────────────────────────────────────────────────
async function captureRelevantScreenshot(blog, description) {
  if (!ENABLE_SCREENSHOTS) return null;

  try {
    const { default: puppeteer } = await import('puppeteer');

    const keywordMap = {
      'kor': 'https://zenbtw.nl/hulpmiddelen/kor-calculator',
      'kor-calculator': 'https://zenbtw.nl/hulpmiddelen/kor-calculator',
      'calculator': 'https://zenbtw.nl/hulpmiddelen/kor-calculator',
      'vinted': 'https://zenbtw.nl',
      'etsy': 'https://zenbtw.nl',
      'shopify': 'https://zenbtw.nl',
      'btw': 'https://zenbtw.nl',
      'dac7': 'https://zenbtw.nl',
      'amazon': 'https://zenbtw.nl',
      'marketplace': 'https://zenbtw.nl'
    };

    const descLower = (description + blog.slug).toLowerCase();
    let targetUrl = 'https://zenbtw.nl';

    for (const [keyword, url] of Object.entries(keywordMap)) {
      if (descLower.includes(keyword)) {
        targetUrl = url;
        break;
      }
    }

    console.log(`📸 Capturing screenshot from: ${targetUrl}`);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 675 });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      .catch(err => console.warn('Page load warning:', err.message));

    const screenshotPath = path.join(ROOT, `.screenshots/${blog.slug}-${Date.now()}.png`);
    await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, type: 'png' });
    await browser.close();

    const stats = fs.statSync(screenshotPath);
    console.log(`✓ Screenshot saved: ${screenshotPath} (${stats.size} bytes)`);
    return screenshotPath;
  } catch (err) {
    console.warn('⚠️  Screenshot capture failed:', err.message);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Starting social media posting...\n');

  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    console.warn('⚠️  X OAuth 1.0a credentials missing — check TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET');
  }
  if (!BLUESKY_USER || !BLUESKY_PASS) console.warn('⚠️  No Bluesky credentials');

  // Load state
  const state = loadState();
  if (isNewDay(state.lastPostDate)) {
    state.postedToday = [];
    state.lastPostDate = new Date().toISOString();
  }

  // Get available blogs
  const blogs = getAvailableBlogs();
  if (blogs.length === 0) {
    console.error('❌ No blog posts found in /blog directory');
    process.exit(1);
  }

  // Select blog using keyword queue
  const keywordQueue = loadKeywordsQueue();
  let selectedBlog = null;
  let selectedKeyword = null;

  if (keywordQueue.queue && keywordQueue.queue.length > 0) {
    const pendingKeywords = keywordQueue.queue
      .filter(item => item.status === 'pending')
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));

    for (const keywordItem of pendingKeywords) {
      const blog = findBlogByKeyword(keywordItem.keyword, blogs);
      if (blog && !state.postedToday.includes(blog.slug)) {
        selectedBlog = blog;
        selectedKeyword = keywordItem;
        break;
      }
    }
  }

  // Fallback to first unposted blog
  if (!selectedBlog) {
    const unposted = blogs.filter(b => !state.postedToday.includes(b.slug));
    selectedBlog = unposted.length > 0 ? unposted[0] : blogs[0];
  }

  console.log(`📰 Selected blog: ${selectedBlog.slug}${selectedKeyword ? ` (keyword: ${selectedKeyword.keyword})` : ''}\n`);

  // Extract metadata
  const htmlContent = fs.readFileSync(selectedBlog.path, 'utf8');
  const meta = extractBlogMetadata(htmlContent);
  console.log(`Title: ${meta.title}`);
  console.log(`Desc: ${meta.cleanDesc.substring(0, 100)}...\n`);

  // Generate teasing copy (no URL, max 200 chars)
  console.log('✍️  Generating teasing copy...');
  const teasingText = await generateTeasingCopy(selectedBlog, meta.title, meta.cleanDesc);

  if (!teasingText) {
    console.error('❌ Failed to generate teasing copy');
    process.exit(1);
  }

  console.log(`\n📝 Generated teaser:\n"${teasingText}"\n`);

  // Blog URL without trailing slash (avoids 404)
  const blogUrl = `https://zenbtw.nl/blog/${selectedBlog.slug}`;

  // X post: teaser + URL on separate line (280 char limit)
  const xPostText = `${teasingText}\n\n${blogUrl}`.substring(0, 280);

  // Screenshot
  let screenshotPath = null;
  if (ENABLE_SCREENSHOTS) {
    screenshotPath = await captureRelevantScreenshot(selectedBlog, meta.cleanDesc);
  } else {
    console.log('ℹ️  Screenshots disabled');
  }

  console.log('\n📤 Posting to social media...\n');

  const xPosted = await postToX(xPostText, screenshotPath);
  // Bluesky gets teaser + URL separately so we control grapheme limit
  const bskyPosted = await postToBluesky(teasingText, blogUrl, screenshotPath);

  if (xPosted || bskyPosted) {
    state.postedToday.push(selectedBlog.slug);
    saveState(state);

    if (selectedKeyword) {
      const updatedQueue = loadKeywordsQueue();
      const idx = updatedQueue.queue.findIndex(k => k.keyword === selectedKeyword.keyword);
      if (idx !== -1) {
        const kw = updatedQueue.queue[idx];
        kw.status = 'published';
        kw.publishedDate = new Date().toISOString().split('T')[0];
        updatedQueue.queue.splice(idx, 1);
        updatedQueue.published.push(kw);
        saveKeywordsQueue(updatedQueue);
      }
    }

    console.log(`\n✅ Daily post #${state.postedToday.length} posted successfully!`);
  } else {
    console.error('\n❌ Failed to post to any platform');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
