/**
 * Gedeelde page-level utilities voor de daily growth agent.
 * Alle functies die terugkeren op meerdere plekken: dateModified, sitemap,
 * HowTo schema detectie, en semantische interne linking.
 */

import fs from 'fs';
import path from 'path';

// ── dateModified updaten in Article/BlogPosting LD+JSON ────────────────────────

export function updateDateModified(filePath, date) {
  if (!fs.existsSync(filePath)) return false;
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  html = html.replace(
    /(<script[^>]+type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi,
    (match, open, json, close) => {
      try {
        const obj = JSON.parse(json);
        const items = Array.isArray(obj) ? obj : [obj];
        let updated = false;
        for (const item of items) {
          if (['Article', 'BlogPosting', 'WebPage'].includes(item['@type'])) {
            item.dateModified = date;
            updated = true;
          }
        }
        if (updated) {
          changed = true;
          const out = Array.isArray(obj) ? JSON.stringify(items) : JSON.stringify(items[0]);
          return `${open}${out}${close}`;
        }
      } catch { /* malformed JSON — skip */ }
      return match;
    }
  );

  if (changed) fs.writeFileSync(filePath, html, 'utf8');
  return changed;
}

// ── sitemap.xml lastmod bijwerken ─────────────────────────────────────────────

export function updateSitemapLastmod(sitemapPath, urls, date) {
  if (!fs.existsSync(sitemapPath) || !urls.length) return 0;
  let xml = fs.readFileSync(sitemapPath, 'utf8');
  let count = 0;

  for (const url of urls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = xml;
    xml = xml.replace(
      new RegExp(`(<loc>${escaped}<\\/loc>[\\s\\S]*?)<lastmod>[^<]*<\\/lastmod>`, 'g'),
      `$1<lastmod>${date}</lastmod>`
    );
    if (xml !== before) count++;
  }

  if (count > 0) fs.writeFileSync(sitemapPath, xml, 'utf8');
  return count;
}

// ── HowTo schema injectie ─────────────────────────────────────────────────────

const HOWTO_H2_KEYWORDS = /stap|registr|aanmeld|instell|gebruik|start|hoe |doe |maak |verifi|bereken/i;

export function injectHowToSchema(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const html = fs.readFileSync(filePath, 'utf8');

  if (html.includes('"HowTo"')) return false; // al aanwezig

  const matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/gi)];
  const sections = [];

  for (const [, h2Raw, olRaw] of matches) {
    const h2Text = h2Raw.replace(/<[^>]+>/g, '').trim();
    if (!HOWTO_H2_KEYWORDS.test(h2Text)) continue;

    const steps = [...olRaw.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(([, li]) => li.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 10);

    if (steps.length >= 2) sections.push({ name: h2Text, steps });
  }

  if (!sections.length) return false;

  const best = sections.sort((a, b) => b.steps.length - a.steps.length)[0];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || best.name;
  const desc  = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] || '';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description: desc,
    step: best.steps.map((text, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: text.slice(0, 80),
      text,
    })),
  };

  const newHtml = html.replace(
    '</head>',
    `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`
  );
  fs.writeFileSync(filePath, newHtml, 'utf8');
  return true;
}

// ── Semantische interne link index ────────────────────────────────────────────

const STOP_WORDS = new Set([
  'voor', 'over', 'meer', 'naar', 'zijn', 'deze', 'worden', 'heeft', 'wordt',
  'kunnen', 'moet', 'ook', 'niet', 'maar', 'door', 'alle', 'geen', 'waar',
  'welke', 'vanuit', 'deze', 'toch', 'heel', 'heel', 'goed', 'heel', 'elke',
  'jaar', 'euro', 'plus', 'mijn', 'jouw', 'onze', 'meer', 'veel', 'zelf',
]);

export function buildInternalLinkIndex(blogDir) {
  const index = {};
  if (!fs.existsSync(blogDir)) return index;

  for (const file of fs.readdirSync(blogDir)) {
    if (!file.endsWith('.html')) continue;
    const slug = file.replace('.html', '');
    const html = fs.readFileSync(path.join(blogDir, file), 'utf8');

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s*[-|].*$/, '').trim() || slug;
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, '').trim() || '';
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').trim());

    const allText = [title, h1, ...h2s, ...slug.split('-')].join(' ').toLowerCase();
    const keywords = new Set(
      allText.split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
    );

    index[slug] = { title, keywords, filePath: path.join(blogDir, file) };
  }
  return index;
}

/**
 * Voeg semantische interne links toe op basis van keyword-overlap.
 * Geeft het aantal toegevoegde links terug (0 = niets gedaan).
 */
export function addSemanticInternalLinks(filePath, currentSlug, linkIndex, maxLinks = 3) {
  if (!fs.existsSync(filePath)) return 0;
  const html = fs.readFileSync(filePath, 'utf8');
  const current = linkIndex[currentSlug];
  if (!current) return 0;

  const alreadyLinked = new Set(
    [...html.matchAll(/href="\/blog\/([^/"]+)/g)].map(m => m[1])
  );

  const candidates = Object.entries(linkIndex)
    .filter(([slug]) => slug !== currentSlug && !alreadyLinked.has(slug))
    .map(([slug, entry]) => {
      const overlap = [...entry.keywords].filter(k => current.keywords.has(k)).length;
      return { slug, title: entry.title, overlap };
    })
    .filter(c => c.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, maxLinks);

  if (!candidates.length) return 0;

  const linkHtml = `<div class="related-links" style="margin-top:32px;padding-top:16px;border-top:1px solid #e8e5de">
<p style="font-size:13px;font-weight:700;color:#1a4731;margin:0 0 8px">Gerelateerde artikelen</p>
${candidates.map(c => `<p style="margin:0 0 6px"><a href="/blog/${c.slug}/" style="color:#1a4731">${c.title}</a></p>`).join('\n')}
</div>`;

  let newHtml = html;
  if (html.includes('</article>')) {
    newHtml = html.replace('</article>', `\n${linkHtml}\n</article>`);
  } else if (html.includes('<footer')) {
    newHtml = html.replace('<footer', `\n${linkHtml}\n<footer`);
  } else {
    return 0;
  }

  fs.writeFileSync(filePath, newHtml, 'utf8');
  return candidates.length;
}
