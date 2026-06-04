#!/usr/bin/env python3
"""
ZENbtw Content Agent
Haalt real-time trending Google-zoekopdrachten op voor BTW/marketplace keywords
en genereert automatisch SEO-blogs met Claude.
"""

import os
import re
import json
import time
import datetime
from pathlib import Path
from pytrends.request import TrendReq
import anthropic

# ── Configuratie ──────────────────────────────────────────────────────────────

SEED_KEYWORDS = [
    "btw aangifte",
    "kleine ondernemersregeling",
    "vinted verkopen",
    "etsy btw",
    "omzetbelasting ondernemer",
    "kor regeling",
    "marketplace belasting",
    "shopify btw nederland",
]

# Gebruik 3-maanden window: niche NL keywords hebben te weinig volume voor 7 dagen
TRENDS_TIMEFRAME = "today 3-m"

BLOG_OUTPUT_DIR = Path(__file__).parent.parent / "app" / "blog"
SITE_URL = "https://zenbtw.nl"
SITE_NAME = "ZENbtw"

# ── Trending queries ophalen ──────────────────────────────────────────────────

def get_trending_queries(keywords: list[str]) -> list[dict]:
    """
    Haalt rising (trending) en top queries op via pytrends.
    Geeft een gesorteerde lijst van vragen terug op basis van trending score.
    """
    pytrends = TrendReq(hl="nl-NL", tz=60, geo="NL")
    results = []

    # Splits in batches van max 5 (pytrends limiet)
    batches = [keywords[i:i+5] for i in range(0, len(keywords), 5)]

    for batch in batches:
        try:
            pytrends.build_payload(batch, timeframe=TRENDS_TIMEFRAME, geo="NL")
            related = pytrends.related_queries()

            for kw in batch:
                if kw not in related:
                    continue

                rising_df = related[kw].get("rising")
                top_df = related[kw].get("top")

                if rising_df is not None and not rising_df.empty:
                    for _, row in rising_df.head(5).iterrows():
                        results.append({
                            "query": row["query"],
                            "score": int(row["value"]) if row["value"] != "Breakout" else 5000,
                            "type": "rising",
                            "seed": kw,
                        })

                if top_df is not None and not top_df.empty:
                    for _, row in top_df.head(3).iterrows():
                        results.append({
                            "query": row["query"],
                            "score": int(row["value"]),
                            "type": "top",
                            "seed": kw,
                        })

            time.sleep(2)  # Rate limit respecteren

        except Exception as e:
            print(f"[pytrends] Fout voor batch {batch}: {e}")
            continue

    # Dedupliceren en sorteren op score
    seen = set()
    unique = []
    for r in sorted(results, key=lambda x: x["score"], reverse=True):
        q = r["query"].lower().strip()
        if q not in seen:
            seen.add(q)
            unique.append(r)

    return unique


def filter_relevant(queries: list[dict]) -> list[dict]:
    """
    Filtert op BTW/belasting/marketplace relevantie.
    """
    relevant_terms = [
        "btw", "belasting", "kor", "omzetbelasting", "aangifte",
        "vinted", "etsy", "shopify", "marketplace", "verkopen",
        "factuur", "oss", "drempel", "vrijstelling", "ondernemer",
    ]
    filtered = []
    for r in queries:
        q = r["query"].lower()
        if any(t in q for t in relevant_terms):
            filtered.append(r)
    return filtered


# ── Blog genereren met Claude ─────────────────────────────────────────────────

BLOG_SYSTEM_PROMPT = """Je bent een Nederlandse BTW-expert die blogs schrijft voor ZENbtw.nl.
ZENbtw is een gratis BTW-calculator voor marketplace verkopers (Vinted, Etsy, Shopify, etc.).

Schrijfstijl:
- Duidelijk, praktisch, geen jargon tenzij uitgelegd
- Schrijf in het Nederlands
- Geen juridisch advies, wel concrete uitleg
- Gebruik H2/H3 headers in de tekst (schrijf ze als ## en ###)
- Eindig altijd met een CTA naar ZENbtw

Technische kennis die je hebt:
- BTW-berekening: marktplaatsprijzen zijn BRUTO. Formule: bruto × (tarief / (100 + tarief))
- KOR-grens: €20.000 (NL), OSS-drempel: €10.000 (EU-breed), EU-KOR: €100.000
- EU-afstandsverkopen ≤ €10.000 tellen mee voor NL KOR; daarboven OSS-regime
- Belastingjaar 2025/2026 regels zijn van toepassing"""


def generate_blog(query: dict) -> dict:
    """
    Genereert een volledig blog op basis van de trending zoekopdracht.
    Geeft title, slug, html_content en meta_description terug.
    """
    client = anthropic.Anthropic()

    user_prompt = f"""Schrijf een SEO-blog van 700-900 woorden die de volgende zoekopdracht beantwoordt:

Zoekopdracht: "{query['query']}"
Trending score: {query['score']} ({"breakout trend" if query['score'] >= 5000 else "stijgende trend"})
Gerelateerd aan: {query['seed']}

Geef je antwoord als JSON met deze structuur:
{{
  "title": "Blog titel (SEO-geoptimaliseerd, max 65 tekens)",
  "meta_description": "Meta beschrijving (max 155 tekens)",
  "slug": "url-vriendelijke-slug",
  "content": "Volledige blog in markdown (met ## H2 en ### H3 headers)"
}}

De blog moet:
1. De zoekopdracht direct en volledig beantwoorden in de intro
2. Praktische stappen of voorbeelden bevatten
3. KOR/OSS vermelden als relevant
4. Eindigen met: "Bereken je BTW automatisch op [ZENbtw.nl]({SITE_URL}) — gratis voor marketplace verkopers."
"""

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2500,
        system=BLOG_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text.strip()

    # Haal JSON op uit de response
    json_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not json_match:
        raise ValueError(f"Geen JSON gevonden in Claude-response:\n{raw[:200]}")

    data = json.loads(json_match.group())
    return data


# ── HTML pagina bouwen ────────────────────────────────────────────────────────

def markdown_to_html(md: str) -> str:
    """Minimale markdown → HTML conversie (geen extra deps)."""
    html = md
    # Headers
    html = re.sub(r'^### (.+)$', r'<h3>\1</h3>', html, flags=re.MULTILINE)
    html = re.sub(r'^## (.+)$', r'<h2>\1</h2>', html, flags=re.MULTILINE)
    html = re.sub(r'^# (.+)$', r'<h1>\1</h1>', html, flags=re.MULTILINE)
    # Bold
    html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html)
    # Links
    html = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', html)
    # Paragrafen (dubbele newline)
    paragraphs = re.split(r'\n\n+', html)
    result = []
    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if p.startswith('<h') or p.startswith('<ul') or p.startswith('<ol'):
            result.append(p)
        else:
            # Enkele newlines binnen paragraaf → <br>
            p = p.replace('\n', '<br>\n')
            result.append(f'<p>{p}</p>')
    return '\n'.join(result)


def build_html_page(blog: dict, query: dict) -> str:
    today = datetime.date.today().strftime("%-d %B %Y")
    content_html = markdown_to_html(blog["content"])

    return f"""<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{blog['title']} | {SITE_NAME}</title>
  <meta name="description" content="{blog['meta_description']}">
  <meta property="og:title" content="{blog['title']}">
  <meta property="og:description" content="{blog['meta_description']}">
  <meta property="og:type" content="article">
  <link rel="canonical" href="{SITE_URL}/blog/{blog['slug']}">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 740px; margin: 0 auto; padding: 2rem 1.5rem; color: #1a1a2e; line-height: 1.7; }}
    h1 {{ font-size: 2rem; line-height: 1.3; margin-bottom: 0.5rem; }}
    h2 {{ font-size: 1.4rem; margin-top: 2.5rem; color: #2d2d44; }}
    h3 {{ font-size: 1.1rem; margin-top: 1.8rem; color: #2d2d44; }}
    .meta {{ color: #888; font-size: 0.9rem; margin-bottom: 2rem; }}
    .cta {{ background: #4f46e5; color: white; padding: 1.2rem 1.5rem; border-radius: 10px; margin-top: 2.5rem; }}
    .cta a {{ color: white; font-weight: 600; }}
    .tag {{ background: #eef2ff; color: #4f46e5; padding: 2px 10px; border-radius: 99px; font-size: 0.8rem; }}
    nav {{ margin-bottom: 2rem; font-size: 0.9rem; }}
    nav a {{ color: #4f46e5; text-decoration: none; }}
  </style>
</head>
<body>
  <nav><a href="{SITE_URL}">&larr; Terug naar {SITE_NAME}</a></nav>

  <span class="tag">BTW-gids</span>
  <h1>{blog['title']}</h1>
  <p class="meta">Gepubliceerd op {today} &middot; Trending zoekopdracht: <em>{query['query']}</em></p>

  <article>
    {content_html}
  </article>

  <div class="cta">
    Bereken je BTW automatisch &rarr; <a href="{SITE_URL}">Open {SITE_NAME} gratis</a>
  </div>
</body>
</html>
"""


# ── Index pagina bijwerken ────────────────────────────────────────────────────

def update_blog_index(blogs: list[dict]):
    """Schrijft/bijwerkt een eenvoudige blog-indexpagina."""
    index_path = BLOG_OUTPUT_DIR / "index.html"
    today = datetime.date.today().strftime("%-d %B %Y")

    items = "\n".join([
        f'<li><a href="{SITE_URL}/blog/{b["slug"]}">{b["title"]}</a> <span class="date">{today}</span></li>'
        for b in blogs
    ])

    # Bestaande items inlezen als de index al bestaat
    existing_items = ""
    if index_path.exists():
        existing_html = index_path.read_text()
        match = re.search(r'<ul id="posts">(.*?)</ul>', existing_html, re.DOTALL)
        if match:
            existing_items = match.group(1).strip()

    html = f"""<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <title>BTW Blog voor Marketplace Verkopers | {SITE_NAME}</title>
  <meta name="description" content="Praktische BTW-gidsen voor Vinted, Etsy en Shopify verkopers in Nederland.">
  <style>
    body {{ font-family: -apple-system, sans-serif; max-width: 740px; margin: 0 auto; padding: 2rem 1.5rem; }}
    h1 {{ font-size: 1.8rem; }}
    ul {{ list-style: none; padding: 0; }}
    li {{ padding: 0.8rem 0; border-bottom: 1px solid #eee; }}
    a {{ color: #4f46e5; text-decoration: none; font-weight: 500; }}
    .date {{ color: #888; font-size: 0.85rem; margin-left: 1rem; }}
  </style>
</head>
<body>
  <a href="{SITE_URL}">&larr; {SITE_NAME}</a>
  <h1>BTW-gidsen voor marketplace verkopers</h1>
  <p>Automatisch gegenereerd op basis van actuele Google-zoekopdrachten.</p>
  <ul id="posts">
    {items}
    {existing_items}
  </ul>
</body>
</html>"""

    index_path.write_text(html)
    print(f"[index] Blog-index bijgewerkt: {index_path}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== ZENbtw Content Agent ===")
    print(f"Datum: {datetime.date.today()}\n")

    # 1. Trending queries ophalen
    print("[1/4] Trending queries ophalen van Google Trends...")
    all_queries = get_trending_queries(SEED_KEYWORDS)
    relevant = filter_relevant(all_queries)

    if not relevant:
        print("Geen relevante trending queries gevonden. Probeer later opnieuw.")
        return

    print(f"      {len(relevant)} relevante trending queries gevonden:")
    for i, q in enumerate(relevant[:5], 1):
        print(f"      {i}. \"{q['query']}\" (score: {q['score']}, type: {q['type']})")

    # 2. Top query kiezen (hoogste trending score)
    top_query = relevant[0]
    print(f"\n[2/4] Top trending query: \"{top_query['query']}\"")

    # 3. Blog genereren
    print("[3/4] Blog genereren met Claude...")
    blog = generate_blog(top_query)
    print(f"      Titel: {blog['title']}")
    print(f"      Slug:  {blog['slug']}")

    # 4. HTML opslaan
    print("[4/4] HTML pagina opslaan...")
    BLOG_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    page_path = BLOG_OUTPUT_DIR / f"{blog['slug']}.html"
    page_path.write_text(build_html_page(blog, top_query))
    print(f"      Opgeslagen: {page_path}")

    update_blog_index([blog])

    print(f"\nKlaar! Blog gepubliceerd: {SITE_URL}/blog/{blog['slug']}")
    print("\nVolgende stap: git add app/blog/ && git commit -m 'blog: {blog['slug']}' && git push")


if __name__ == "__main__":
    main()
