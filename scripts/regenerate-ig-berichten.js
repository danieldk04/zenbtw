// Hergenereert Instagram DM-berichten voor bestaande leads met nieuwe intro-stijl
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'instagram-leads.json';

async function generateDMs(lead) {
  const prompt = `Je schrijft 3 Instagram DM's namens Daniel. Hij verkoopt vintage kleding via @revaleur (700+ reviews op Vinted, Etsy en Shopify). Hij stuurt dit naar iemand die hij niet kent.

PROFIEL:
@${lead.username} (${lead.displayName || lead.username})
Bio: ${lead.bio || '(geen bio)'}
Recente post: ${lead.snippet || '(geen post)'}

Schrijf 3 DM's die TOTAAL ANDERS zijn qua toon. Belangrijk: ZenBTW mag alleen in variant 3 voorkomen. Varianten 1 en 2 zijn puur menselijk, zonder enige verwijzing naar tools of software.

VARIANT 1 "Echte reactie": reageer puur als iemand die hun werk mooi vindt. Benoem iets heel specifieks uit hun post of bio (het materiaal, het product, de aanpak). Stel daarna één oprechte vraag over hun werk of verkoopervaring als collega-verkoper. Geen agenda. Sluit af met "Groetjes Daniel"

VARIANT 2 "Collega-herkenning": begin met hun naam, deel één herkenbaar moment vanuit je eigen ervaring als verkoper (iets concreets, geen BTW-gezeur). Stel dan een vraag die je echt zou willen weten als je hen tegenkwam. Voelt als een gesprek tussen twee ondernemers die elkaar net leren kennen. Sluit af met "Groetjes Daniel 👋"

VARIANT 3 "Zachte tip": begin met een compliment over iets specifieks. Vertel in één zin dat jij als verkoper lang hebt geworsteld met de KOR-administratie. Noem ZenBTW heel luchtig als "iets wat ik daarvoor heb gemaakt" zonder het aan te prijzen. Maak duidelijk dat er geen druk is. Sluit af met "Groetjes Daniel"

REGELS VOOR ALLE VARIANTEN:
Gebruik NOOIT een streepje (geen gedachtestreepje, geen opsommingsstreepje, nergens)
Geen "Hoi" aan het begin
Max 4 zinnen
Geen buzzwords, geen marketingtaal
Emojis spaarzaam (max 1 per bericht, alleen als het echt past)
Klinkt als iemand die echt geïnteresseerd is, niet als iemand die iets verkoopt

Geef ALLEEN JSON terug:
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
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  const text = data.content?.[0]?.text?.trim() || '{}';
  const match = text.match(/\{[\s\S]*\}/);
  try { return match ? JSON.parse(match[0]) : {}; }
  catch { return {}; }
}

async function main() {
  if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY ontbreekt'); process.exit(1); }

  const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  console.log(`${leads.length} leads herverwerken...`);

  for (const lead of leads) {
    console.log(`  @${lead.username}...`);
    lead.berichten = await generateDMs(lead);
    console.log(`    ✓ helper: ${(lead.berichten.helper || '').slice(0, 60)}...`);
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  console.log(`✓ Klaar — ${leads.length} leads bijgewerkt`);
}

main().catch(e => { console.error(e); process.exit(1); });
