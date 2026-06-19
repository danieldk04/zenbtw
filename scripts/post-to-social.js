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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Config
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;
const BLUESKY_USER = process.env.BLUESKY_USERNAME;
const BLUESKY_PASS = process.env.BLUESKY_PASSWORD;
const ENABLE_SCREENSHOTS = process.env.SCREENSHOTS_ENABLED === 'true';

// State file to track what's been posted
const STATE_FILE = path.join(ROOT, '.social-post-state.json');

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

// ── Post to X (Twitter) API v2 ──────────────────────────────────────────────
async function postToX(text, mediaPath = null) {
  if (!TWITTER_BEARER) {
    console.warn('⚠️  TWITTER_BEARER_TOKEN missing, skipping X post');
    return false;
  }

  try {
    const body = {
      text: text.substring(0, 280)
    };

    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TWITTER_BEARER}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('X API error:', response.status, error);
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

    // 2. Create post record
    const now = new Date().toISOString();
    const postRecord = {
      $type: 'app.bsky.feed.post',
      text: text,
      createdAt: now
    };

    // 3. Post to repository
    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        repo: session.did,
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

  // Post to social media
  console.log('📤 Posting to social media...\n');

  const xPosted = await postToX(postText);
  const bskyPosted = await postToBluesky(postText);

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
