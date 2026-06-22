/**
 * Core Web Vitals monitoring via Google PageSpeed Insights API.
 * Gratis, geen API key vereist. Rate limit: 25.000 req/dag.
 * We checken max 3 pagina's per run.
 */

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Haal Core Web Vitals op voor een URL.
 * Retourneert { url, lcp, cls, inp, performance, needsAttention } of null bij fout.
 *
 * Drempelwaarden (Google "Good"):
 *   LCP  < 2.5s
 *   CLS  < 0.1
 *   INP  < 200ms
 *   Performance score >= 90
 */
export async function checkCoreWebVitals(url) {
  try {
    const params = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' });
    const res = await fetch(`${PSI_BASE}?${params}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const m = data.loadingExperience?.metrics || {};
    const lcp  = m.LARGEST_CONTENTFUL_PAINT_MS?.percentile != null ? m.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000 : null;
    const cls  = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null;
    const inp  = m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null;
    const score = data.lighthouseResult?.categories?.performance?.score ?? null;

    const needsAttention = (lcp != null && lcp > 2.5) ||
                           (cls != null && cls > 0.1) ||
                           (inp != null && inp > 200) ||
                           (score != null && score < 0.9);

    return {
      url,
      lcp:         lcp != null ? +lcp.toFixed(2) : null,
      cls:         cls != null ? +cls.toFixed(3) : null,
      inp,
      performance: score != null ? Math.round(score * 100) : null,
      needsAttention,
    };
  } catch {
    return null;
  }
}
