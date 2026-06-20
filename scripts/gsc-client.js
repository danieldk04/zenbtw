/**
 * Google Search Console API client.
 * Reuses the same service account JWT pattern as generate-blog.js.
 * Requires: GOOGLE_SERVICE_ACCOUNT_JSON env var (same SA, needs Search Console permission)
 */

import { createSign } from 'crypto';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GSC_BASE  = 'https://www.googleapis.com/webmasters/v3';

function b64url(obj) {
  return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: key.client_email, scope: GSC_SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(key.private_key, 'base64url')}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`GSC token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function searchAnalytics(token, siteUrl, body) {
  const res = await fetch(
    `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  return res.json();
}

/**
 * Fetches GSC data for the past `days` days.
 * Returns { queries, pages, siteUrl }
 */
export async function fetchGSCData(days = 28) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');

  const key     = JSON.parse(keyJson);
  const token   = await getAccessToken(key);
  const siteUrl = 'https://zenbtw.nl/';

  const endDate   = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const fmt = d => d.toISOString().split('T')[0];

  const dateRange = { startDate: fmt(startDate), endDate: fmt(endDate) };

  // Top 100 queries by impressions
  const queryData = await searchAnalytics(token, siteUrl, {
    ...dateRange,
    dimensions: ['query'],
    rowLimit: 100,
    orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }]
  });

  // Top 50 pages by impressions
  const pageData = await searchAnalytics(token, siteUrl, {
    ...dateRange,
    dimensions: ['page'],
    rowLimit: 50,
    orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }]
  });

  const queries = (queryData.rows || []).map(r => ({
    query:       r.keys[0],
    clicks:      r.clicks,
    impressions: r.impressions,
    ctr:         r.ctr,
    position:    r.position
  }));

  const pages = (pageData.rows || []).map(r => ({
    page:        r.keys[0],
    clicks:      r.clicks,
    impressions: r.impressions,
    ctr:         r.ctr,
    position:    r.position
  }));

  return { queries, pages, siteUrl, period: { startDate: fmt(startDate), endDate: fmt(endDate) } };
}

/**
 * Identifies low-hanging fruit keywords: positions 4-20, > 50 impressions.
 * These are queries where we almost rank well — a new or improved blog could push us to top 3.
 */
export function findOpportunities(queries) {
  return queries
    .filter(q => q.position >= 4 && q.position <= 20 && q.impressions >= 50)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);
}

/**
 * Pages with many impressions but low CTR — title/meta improvement will help.
 */
export function findLowCTRPages(pages) {
  return pages
    .filter(p => p.impressions >= 200 && p.ctr < 0.03)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
}
