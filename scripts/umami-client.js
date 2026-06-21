/**
 * Umami Analytics API client.
 * Requires: UMAMI_URL, UMAMI_API_KEY, UMAMI_WEBSITE_ID env vars.
 *
 * Level 1: bounce rates, time on page, page views per URL
 * Level 2: user flow signals for auto-fix decisions
 */

const BASE_URL   = (process.env.UMAMI_URL || '').replace(/\/$/, '');
const API_KEY    = process.env.UMAMI_API_KEY;
const WEBSITE_ID = process.env.UMAMI_WEBSITE_ID;

function available() {
  return !!(BASE_URL && API_KEY && WEBSITE_ID);
}

async function umamiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { 'x-umami-api-key': API_KEY, 'Accept': 'application/json' }
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Umami ${path} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function dateRange(days) {
  const end   = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  return { startAt: start, endAt: end };
}

/**
 * Haal per-pagina metrics op: views, bounces, avg duration
 * Retourneert array van { url, views, bounces, bounceRate, avgDuration }
 */
export async function fetchPageMetrics(days = 28) {
  if (!available()) throw new Error('Umami niet geconfigureerd (UMAMI_URL/API_KEY/WEBSITE_ID mist)');

  const { startAt, endAt } = dateRange(days);

  // Haal URL metrics op
  const urlData = await umamiGet(`/api/websites/${WEBSITE_ID}/metrics`, {
    startAt, endAt, type: 'url', limit: 100
  });

  const rows = urlData.data || urlData || [];

  // Map naar duidelijke structuur
  return rows
    .filter(r => r.x && r.x.startsWith('/blog/'))
    .map(r => ({
      url:          r.x,
      slug:         r.x.replace('/blog/', '').replace(/\/$/, ''),
      views:        r.y || 0,
    }));
}

/**
 * Haal website-level stats op (bounce rate, avg duration, sessions)
 */
export async function fetchSiteStats(days = 28) {
  if (!available()) throw new Error('Umami niet geconfigureerd');

  const { startAt, endAt } = dateRange(days);
  const data = await umamiGet(`/api/websites/${WEBSITE_ID}/stats`, { startAt, endAt });

  return {
    totalViews:   data.pageviews?.value || 0,
    totalVisits:  data.visits?.value || 0,
    bounceRate:   data.bounces?.value ? (data.bounces.value / (data.visits?.value || 1)) : null,
    avgDuration:  data.totaltime?.value ? Math.round(data.totaltime.value / (data.visits?.value || 1)) : null,
  };
}

/**
 * Haal per-pagina bounce + duration op via session-level analyse.
 * Umami v2 biedt dit via /api/websites/{id}/metrics?type=event of via pageviews.
 * We vergelijken single-page sessions als proxy voor bounce.
 */
export async function fetchPageBounceData(days = 28) {
  if (!available()) throw new Error('Umami niet geconfigureerd');

  const { startAt, endAt } = dateRange(days);

  // Pageviews per URL (views = bezoeken op die URL)
  const viewsData = await umamiGet(`/api/websites/${WEBSITE_ID}/metrics`, {
    startAt, endAt, type: 'url', limit: 100
  });

  // Entry pages (hoe vaak was dit de EERSTE pagina)
  const entryData = await umamiGet(`/api/websites/${WEBSITE_ID}/metrics`, {
    startAt, endAt, type: 'entry-page', limit: 100
  }).catch(() => ({ data: [] }));

  // Exit pages (hoe vaak was dit de LAATSTE pagina)
  const exitData = await umamiGet(`/api/websites/${WEBSITE_ID}/metrics`, {
    startAt, endAt, type: 'exit-page', limit: 100
  }).catch(() => ({ data: [] }));

  const views   = viewsData.data || viewsData || [];
  const entries = entryData.data || entryData || [];
  const exits   = exitData.data || exitData || [];

  return views
    .filter(r => r.x && r.x.startsWith('/blog/'))
    .map(r => {
      const url         = r.x;
      const views       = r.y || 0;
      const entryCount  = (entries.find(e => e.x === url) || {}).y || 0;
      const exitCount   = (exits.find(e => e.x === url) || {}).y || 0;

      // Proxy bounce rate: als entry=exit, was het waarschijnlijk een bounce
      const estimatedBounces = Math.min(entryCount, exitCount);
      const bounceRate = entryCount > 0 ? estimatedBounces / entryCount : null;

      return {
        url,
        slug:        url.replace('/blog/', '').replace(/\/$/, ''),
        views,
        entryCount,
        exitCount,
        bounceRate,  // null als niet genoeg data
        highBounce:  bounceRate !== null && bounceRate > 0.5 && entryCount >= 10
      };
    })
    .sort((a, b) => (b.bounceRate ?? 0) - (a.bounceRate ?? 0));
}

export { available };
