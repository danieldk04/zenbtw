/**
 * Google Analytics 4 Data API client.
 * Reuses same service account JWT pattern as gsc-client.js.
 * Requires: GOOGLE_SERVICE_ACCOUNT_JSON, GA4_PROPERTY_ID env vars.
 */

import { createSign } from 'crypto';

const GA4_SCOPE    = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GA4_BASE     = 'https://analyticsdata.googleapis.com/v1beta';
const PROPERTY_ID  = process.env.GA4_PROPERTY_ID;

function b64url(obj) {
  return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: key.client_email, scope: GA4_SCOPE, aud: TOKEN_URL, exp: now + 3600, iat: now };
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
  if (!data.access_token) throw new Error(`GA4 token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function runReport(token, body) {
  const res = await fetch(`${GA4_BASE}/properties/${PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GA4 runReport → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

export function available() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && PROPERTY_ID);
}

/**
 * Haal per-pagina bounce rate + sessies op voor /blog/ pagina's.
 * Retourneert array van { url, slug, sessions, bounceRate, avgDuration, highBounce }
 */
export async function fetchPageBounceData(days = 28) {
  if (!available()) throw new Error('GA4 niet geconfigureerd (GOOGLE_SERVICE_ACCOUNT_JSON of GA4_PROPERTY_ID mist)');

  const key   = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const token = await getAccessToken(key);

  const endDate   = new Date();
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);

  const data = await runReport(token, {
    dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'sessions' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
    ],
    dimensionFilter: {
      filter: {
        fieldName: 'pagePath',
        stringFilter: { matchType: 'BEGINS_WITH', value: '/blog/' }
      }
    },
    limit: 200,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
  });

  const rows = data.rows || [];
  return rows.map(row => {
    const url         = row.dimensionValues[0].value;
    const sessions    = parseInt(row.metricValues[0].value, 10) || 0;
    const bounceRate  = parseFloat(row.metricValues[1].value) || 0;  // 0–1
    const avgDuration = parseFloat(row.metricValues[2].value) || 0;  // seconds

    return {
      url,
      slug:        url.replace('/blog/', '').replace(/\/$/, ''),
      sessions,
      bounceRate,
      avgDuration: Math.round(avgDuration),
      highBounce:  bounceRate > 0.5 && sessions >= 10
    };
  }).sort((a, b) => b.bounceRate - a.bounceRate);
}

/**
 * Haal site-wide stats op.
 */
export async function fetchSiteStats(days = 28) {
  if (!available()) throw new Error('GA4 niet geconfigureerd');

  const key   = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const token = await getAccessToken(key);

  const endDate   = new Date();
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);

  const data = await runReport(token, {
    dateRanges: [{ startDate: fmt(startDate), endDate: fmt(endDate) }],
    metrics: [
      { name: 'sessions' },
      { name: 'screenPageViews' },
      { name: 'bounceRate' },
      { name: 'averageSessionDuration' },
    ]
  });

  const m = data.rows?.[0]?.metricValues || [];
  return {
    totalSessions:  parseInt(m[0]?.value, 10) || 0,
    totalViews:     parseInt(m[1]?.value, 10) || 0,
    bounceRate:     parseFloat(m[2]?.value) || null,
    avgDuration:    Math.round(parseFloat(m[3]?.value) || 0),
  };
}
