// Hergenereert Instagram DM-berichten voor bestaande leads
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'instagram-leads.json';

async function generateDM(lead) {
  const prompt = `Schrijf één persoonlijke Instagram DM namens Daniel (22) naar @${lead.username}.

OVER DANIEL:
Hij runt @revaleur (vintage kleding, eenmanszaak, actief op Etsy en Vinted) en heeft ZenBTW gebouwd: een gratis tool die bijhoudt of je als kleine verkoper de KOR-drempel van €20.000 nadert.

PROFIEL ONTVANGER:
@${lead.username} (${lead.displayName || lead.username})
Bio: ${lead.bio || '(geen bio)'}
Recente post: ${lead.snippet || '(geen post)'}

STRUCTUUR VAN HET BERICHT (in deze volgorde):
1. Persoonlijk compliment: noem iets heel specifieks uit hun post of bio dat je opviel
2. Korte intro: "Ik ben Daniel (22), ook eenmanszaak-ondernemer. Ik run zelf de vintage shop Revaleur, maar daarnaast heb ik ZenBTW gebouwd. Dat is een gratis tool die bijhoudt wanneer je als kleine verkoper de KOR-drempel nadert."
3. Geen harde pitch: "Geen druk hoor, als je administratie al lekker loopt is er niks te doen. Maar ik weet hoe snel dat een tijdvreter wordt."
4. Eén concrete, echte vraag over hoe ze hun administratie of btw momenteel regelen. Oprechte interesse, niet als verkoopvraag.
5. Succes wensen met iets specifieks over hun shop. Eindig met "Groetjes Daniel"

REGELS:
Geen streepjes als leesteken
Niet beginnen met "Hoi" of "Hey", begin direct met het compliment
Max 6 zinnen totaal
Geen buzzwords, geen marketingtaal
Schrijf alsof je het zelf typt op je telefoon

Geef UITSLUITEND de DM-tekst terug, niets anders.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  return data.content?.[0]?.text?.trim() || '';
}

async function main() {
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  console.log(`${leads.length} leads herverwerken...`);

  for (const lead of leads) {
    console.log(`  @${lead.username}...`);
    const dm = await generateDM(lead);
    lead.bericht = dm;
    lead.berichten = { helper: dm, gesprek: dm, pitch: dm };
    console.log(`    ✓ ${dm.slice(0, 80)}...`);
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✓ Klaar — ${leads.length} leads bijgewerkt`);
}

main().catch(e => { console.error(e); process.exit(1); });
