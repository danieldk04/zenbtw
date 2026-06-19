#!/usr/bin/env node
/**
 * ZenBTW Social Media Poster
 * Posts daily teasers from blog content to X (Twitter) and Bluesky
 * Generates 3 posts per day with engaging copy + optional dashboard screenshots
 *
 * Env vars required:
 * - ANTHROPIC_API_KEY: Claude API key (for generating teasing copy)
 * - TWITTER_BEARER_TOKEN: X API v2 Bearer token
 * - BLUESKY_USERNAME: Bluesky account identifier (usually email)
 * - BLUESKY_PASSWORD: Bluesky app password
 * - SCREENSHOTS_ENABLED: true/false (default: false for faster posts)
 */

import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Config
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const BLUESKY_USER = process.env.BLUESKY_USERNAME;
const BLUESKY_PASS = process.env.BLUESKY_PASSWORD;
const ENABLE_SCREENSHOTS = process.env.SCREENSHOTS_ENABLED === 'true';

// State file to track what's been posted
const STATE_FILE = path.join(ROOT, '.social-post-state.json');

// ── OAuth 1.0a Helper ──────────────────────────────────────────────────────
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function generateTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function generateSignature(method, url, params, consumerSecret, tokenSecret) {
  const keys = Object.keys(params).sort();
  const paramStr = keys.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const baseStr = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseStr).digest('base64');
}

function buildAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
  const signature = generateSignature(method, url, params, consumerSecret, tokenSecret);
  const authParams = {
    oauth_consumer_key: consumerKey,
    oauth_token: accessToken,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_signature_version: '1.0',
    oauth_nonce: generateNonce(),
    oauth_timestamp: generateTimestamp(),
    oauth_signature: signature
  };

  const authHeader = Object.entries(authParams)
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(', ');

  return `OAuth ${authHeader}`;
}

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

function isNewDay(lastDate) {
  if (!lastDate) return true;
  const last = new Date(lastDate);
  const now = new Date();
  return last.toDateString() !== now.toDateString();
}

// ── Fetch blog posts from filesystem ────────────────────────────────────────
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
    .slice(0, 50); // Limit to 50 most recent
}

function extractBlogMetadata(htmlContent) {
  // Extract title from <h1> or og:title
  let title = '';
  const h1Match = htmlContent.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const ogMatch = htmlContent.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i);
  title = h1Match?.[1] || ogMatch?.[1] || 'Blog Post';

  // Extract description from og:description or first paragraph
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

  const prompt = `Je bent Daniel, founder van ZenBTW. Je schrijft korte, punchy teasers voor blog posts die mensen echt moeten lezen. Geen buzzwords, geen emoji's (behalve misschien 1 relevant icon), directe toon.

Blog titel: "${title}"
Blog snippet: "${description}"
Blog URL: https://zenbtw.nl/blog/${blog.slug}/

Schrijf 1 teasing tweet (max 250 char) die:
- Begint met een provocerende vraag of statement
- Hints naar concrete waarde in het artikel
- Eindigt met duidelijke CTA ("Lees →" of link)
- GEEN hashtags, GEEN emoji's (tenzij 1 ter illustratie)
- Geschreven in Nederlands

ALLEEN de tweet-tekst teruggeven, niks anders.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-1',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    return msg.content[0].type === 'text' ? msg.content[0].text.trim() : null;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return null;
  }
}

// ── Upload media to X via OAuth 1.0a (v1.1 API) ────────────────────────────
async function uploadMediaToXOAuth(mediaPath) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    console.warn('⚠️  X OAuth 1.0a credentials missing');
    return null;
  }

  try {
    const mediaData = fs.readFileSync(mediaPath);
    const base64Data = mediaData.toString('base64');
    const mediaType = 'image/png';

    // POST form data with OAuth 1.0a signature
    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    const params = {
      media_data: base64Data
    };

    const authHeader = buildAuthHeader(
      'POST',
      url,
      params,
      TWITTER_API_KEY,
      TWITTER_API_SECRET,
      TWITTER_ACCESS_TOKEN,
      TWITTER_ACCESS_SECRET
    );

    // Use form-encoded body for media upload
    const formData = new URLSearchParams();
    formData.append('media_data', base64Data);

    const uploadRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });

    if (!uploadRes.ok) {
      const error = await uploadRes.text();
      console.warn(`⚠️  X media upload failed (${uploadRes.status}):`, error);
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

// ── Post to X (Twitter) API v2 with optional media ─────────────────────────
async function postToX(text, mediaPath = null) {
  if (!TWITTER_BEARER) {
    console.warn('⚠️  TWITTER_BEARER_TOKEN missing, skipping X post');
    return false;
  }

  try {
    const body = {
      text: text.substring(0, 280)
    };

    // Upload and attach media if available
    if (mediaPath) {
      const mediaId = await uploadMediaToXOAuth(mediaPath);
      if (mediaId) {
        body.media = { media_ids: [mediaId] };
        console.log('Attaching media to post...');
      }
    }

    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TWITTER_BEARER}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('X API error:', response.status);
      console.error('Response:', errorText);
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

// ── Upload media to Bluesky ────────────────────────────────────────────────
async function uploadMediaToBluesky(mediaPath, token, did) {
  if (!mediaPath) return null;

  try {
    const mediaData = fs.readFileSync(mediaPath);

    // Upload blob
    const blobRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'image/png'
      },
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

// ── Post to Bluesky ─────────────────────────────────────────────────────────
async function postToBluesky(text, mediaPath = null) {
  if (!BLUESKY_USER || !BLUESKY_PASS) {
    console.warn('⚠️  BLUESKY credentials missing, skipping Bluesky post');
    return false;
  }

  try {
    // 1. Login to get session token
    const loginRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: BLUESKY_USER,
        password: BLUESKY_PASS
      })
    });

    if (!loginRes.ok) {
      const error = await loginRes.text();
      console.error('Bluesky login error:', loginRes.status, error);
      return false;
    }

    const session = await loginRes.json();
    const token = session.accessJwt;
    const did = session.did;

    // 2. Create post record
    const now = new Date().toISOString();
    const postRecord = {
      $type: 'app.bsky.feed.post',
      text: text,
      createdAt: now
    };

    // 3. Upload media if available
    if (mediaPath) {
      const blob = await uploadMediaToBluesky(mediaPath, token, did);
      if (blob) {
        postRecord.embed = {
          $type: 'app.bsky.embed.images',
          images: [{
            image: blob,
            alt: 'ZenBTW Dashboard Screenshot'
          }]
        };
      }
    }

    // 4. Post to repository
    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        repo: did,
        collection: 'app.bsky.feed.post',
        record: postRecord
      })
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

// ── Take screenshot of dashboard segment ───────────────────────────────────
async function captureRelevantScreenshot(blog, description) {
  if (!ENABLE_SCREENSHOTS) return null;

  try {
    // Map keywords to dashboard URLs
    const keywordMap = {
      'kor': 'https://zenbtw.nl/hulpmiddelen/kor-calculator/',
      'kor-calculator': 'https://zenbtw.nl/hulpmiddelen/kor-calculator/',
      'vinted': 'https://zenbtw.nl/app?tab=dashboard',
      'etsy': 'https://zenbtw.nl/app?tab=dashboard',
      'shopify': 'https://zenbtw.nl/app?tab=dashboard',
      'btw': 'https://zenbtw.nl/app?tab=dashboard',
      'belastingdienst': 'https://zenbtw.nl/app?tab=dashboard',
      'marketplace': 'https://zenbtw.nl/app?tab=dashboard',
      'amazon': 'https://zenbtw.nl/app?tab=dashboard',
      'calculator': 'https://zenbtw.nl/hulpmiddelen/kor-calculator/'
    };

    // Find best matching URL
    const descLower = (description + blog.slug).toLowerCase();
    let targetUrl = 'https://zenbtw.nl/app?tab=dashboard'; // default

    for (const [keyword, url] of Object.entries(keywordMap)) {
      if (descLower.includes(keyword)) {
        targetUrl = url;
        break;
      }
    }

    console.log(`📸 Capturing screenshot from: ${targetUrl}`);

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 675 });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const screenshotPath = path.join(ROOT, `.screenshots/${blog.slug}-${Date.now()}.png`);
    await fs.promises.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, type: 'png' });

    await browser.close();

    console.log(`✓ Screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  } catch (err) {
    console.warn('⚠️  Screenshot capture failed:', err.message);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Starting social media posting...\n');

  // Validate credentials
  if (!ANTHROPIC_KEY) console.warn('⚠️  No ANTHROPIC_API_KEY');
  if (!TWITTER_BEARER) console.warn('⚠️  No TWITTER_BEARER_TOKEN');
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

  // Select blog (prefer unposted ones)
  const unposted = blogs.filter(b => !state.postedToday.includes(b.slug));
  const selectedBlog = unposted.length > 0 ? unposted[0] : blogs[0];

  if (state.postedToday.includes(selectedBlog.slug)) {
    console.log('⚠️  Already posted this blog today, selecting random instead');
  }

  console.log(`📰 Selected blog: ${selectedBlog.slug}\n`);

  // Extract metadata
  const htmlContent = fs.readFileSync(selectedBlog.path, 'utf8');
  const meta = extractBlogMetadata(htmlContent);

  console.log(`Title: ${meta.title}`);
  console.log(`Desc: ${meta.cleanDesc.substring(0, 100)}...\n`);

  // Generate teasing copy
  console.log('✍️  Generating teasing copy...');
  const teasingText = await generateTeasingCopy(selectedBlog, meta.title, meta.cleanDesc);

  if (!teasingText) {
    console.error('❌ Failed to generate teasing copy');
    process.exit(1);
  }

  console.log(`\n📝 Generated teaser:\n"${teasingText}"\n`);

  // Add blog link
  const postText = `${teasingText}\n\nhttps://zenbtw.nl/blog/${selectedBlog.slug}/`;

  // Capture dashboard screenshot if enabled
  console.log('');
  let screenshotPath = null;
  if (ENABLE_SCREENSHOTS) {
    screenshotPath = await captureRelevantScreenshot(selectedBlog, meta.cleanDesc);
  } else {
    console.log('ℹ️  Screenshots disabled (set SCREENSHOTS_ENABLED=true to enable)');
  }

  // Post to social media
  console.log('\n📤 Posting to social media...\n');

  // Post to X (with screenshot via OAuth 1.0a media upload)
  const xPosted = await postToX(postText, screenshotPath);

  // Post to Bluesky (with screenshot if available)
  const bskyPosted = await postToBluesky(postText, screenshotPath);

  if (xPosted || bskyPosted) {
    state.postedToday.push(selectedBlog.slug);
    saveState(state);
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
