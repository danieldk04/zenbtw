// Genereert ontbrekende berichten voor bestaande leads in leads.json
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'leads.json';

async function generateBericht(lead) {
  const prompt = `Je schrijft een korte, menselijke Reddit-reactie namens Daniel voor ZenBTW — een gratis tool voor Nederlandse marketplace-verkopers (Vinted, Etsy, Shopify) die hun KOR-drempel en BTW-aangifte bijhouden.

Daniel runt zelf een vintage kledingwinkel (Revaleur) met 700+ reviews op Vinted/Etsy/Shopify. Hij weet dus uit eigen ervaring hoe het is.

Schrijf een reactie op dit Reddit-bericht:
Auteur: ${lead.username}
Titel: ${lead.title}
Tekst: ${lead.snippet}

Regels:
- Reageer direct op de vraag of situatie — geef een echt nuttig antwoord
- Schrijf alsof Daniel het zelf typt: informeel, deskundig, geen buzzwords, geen "Hoi!", geen emoji
- Maximaal 3 zinnen
- Nederlands, tenzij het bericht Engels is
- Noem ZenBTW ALLEEN als de persoon expliciet vraagt naar een tool, app of oplossing — anders NIET
- Als je ZenBTW noemt: één korte zin, geen "gratis", geen slogans, gewoon: "...check zenbtw.nl"
- Het bericht moet klinken als iemand die oprecht helpt, niet als iemand die zijn tool promoot

Geef ALLEEN de reactietekst terug, geen uitleg.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  return data.content?.[0]?.text?.trim() || '';
}

async function main() {
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  const zonder = leads.filter(l => !l.bericht || l.bericht.trim() === '');
  console.log(`${zonder.length} leads zonder bericht`);

  for (const lead of zonder) {
    console.log(`Genereer bericht voor ${lead.username}...`);
    lead.bericht = await generateBericht(lead);
    console.log(`  → ${lead.bericht.slice(0, 80)}...`);
    await new Promise(r => setTimeout(r, 300));
  }

  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✓ ${zonder.length} berichten gegenereerd`);
}

main().catch(e => { console.error(e); process.exit(1); });
