// Genereert 3 berichtopties per lead in leads.json
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'leads.json';

async function generateBerichten(lead) {
  const context = `Daniel runt zelf een vintage kledingwinkel (Revaleur) met 700+ reviews op Vinted/Etsy/Shopify en heeft ZenBTW gebouwd — een tool voor Nederlandse marketplace-verkopers die hun KOR-drempel en BTW bijhouden.

Reddit-bericht:
Auteur: ${lead.username}
Titel: ${lead.title}
Tekst: ${lead.snippet}`;

  const prompt = `${context}

Schrijf 3 verschillende korte Reddit-reacties namens Daniel op dit bericht. Elke reactie max 3 zinnen, informeel, geen buzzwords, geen "Hoi!", geen emoji. Schrijf alsof Daniel het zelf typt.

Variant A – HELPER: Geef een oprecht nuttig antwoord. Geen ZenBTW, geen linkjes. Puur helpen.

Variant B – GESPREK: Stel één gerichte vervolgvraag die een gesprek uitlokt. Geef ook iets van waarde mee, maar eindig met een vraag die hun situatie verder uitdiept (bijv. op welke platforms ze verkopen, hoe hoog hun omzet ongeveer is).

Variant C – SOFT PITCH: Help eerst, noem ZenBTW pas op het einde in één korte zin als logisch gevolg. Geen slogans, geen "gratis", gewoon: "...check zenbtw.nl"

Geef ALLEEN JSON terug in dit formaat:
{"helper":"...","gesprek":"...","pitch":"..."}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  const text = data.content?.[0]?.text?.trim() || '{}';
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch {
    return {};
  }
}

async function main() {
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  // Genereer voor leads zonder berichten of met oude string-formaat
  const zonder = leads.filter(l => !l.berichten || typeof l.berichten !== 'object');
  console.log(`${zonder.length} leads zonder berichten`);

  for (const lead of zonder) {
    console.log(`Genereer berichten voor ${lead.username}...`);
    const berichten = await generateBerichten(lead);
    lead.berichten = berichten;
    lead.bericht = ''; // leegmaken, admin gebruikt voortaan berichten object
    console.log(`  helper: ${(berichten.helper||'').slice(0,60)}...`);
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✓ ${zonder.length} leads bijgewerkt`);
}

main().catch(e => { console.error(e); process.exit(1); });
