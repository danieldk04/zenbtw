// Hergenereert Instagram DM-berichten voor bestaande leads met nieuwe intro-stijl
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'instagram-leads.json';

async function generateDMs(lead) {
  const prompt = `Je schrijft 3 Instagram DM's namens Daniel. Hij is eigenaar van vintage kledingwinkel Revaleur (700+ reviews op Vinted, Etsy en Shopify) en heeft ZenBTW gebouwd. Hij stuurt dit vanuit @revaleur naar iemand die hij niet kent.

PROFIEL:
@${lead.username} (${lead.displayName || lead.username})
Bio: ${lead.bio || '(geen bio)'}
Recente post: ${lead.snippet || '(geen post)'}

Schrijf 3 TOTAAL VERSCHILLENDE DM's. Elke variant heeft een andere toon en aanpak. Kies de 3 beste stijlen uit onderstaande opties:

WARME COLLEGA: begin met voornaam, complimenteer iets specifieks aan hun shop, vertel kort over je eigen ervaring als verkoper op Revaleur, zeg dat je hebt geworsteld met BTW/KOR, stel één persoonlijke vraag. Sluit af met "Groetjes Daniel 👋"

ENTHOUSIASTE FAN: begin met hun naam + iets dat je echt aanspreekt in hun content (wees specifiek), zeg dat je zelf ook verkoopt via Revaleur en je herkent het, maak het probleem urgent maar luchtig (bijv. "de Belastingdienst kijkt namelijk naar je omzet, niet je winst 😅"), verwijs naar zenbtw.nl. Sluit af met "Groetjes Daniel"

DIRECTE HELPER: geen omwegen, begin met compliment, zeg meteen "ik heb iets gebouwd dat jou waarschijnlijk tijd bespaart", leg in één zin uit wat ZenBTW doet, zeg dat hij het zelf ook gebruikt voor Revaleur. Sluit af met "Groetjes Daniel, @revaleur"

NIEUWSGIERIGE VRAGEN-STELLER: begin met naam + observatie over hun shop, stel twee korte vragen over hoe zij hun administratie doen (bijv. hoe ze bijhouden wanneer ze de KOR-drempel raken), vertel daarna pas dat je dit zelf ook hebt meegemaakt en iets hebt gemaakt. Sluit af met "Groetjes Daniel"

PERSOONLIJK VERHAAL: begin met hun naam, vertel een mini-verhaal van 2 zinnen over hoe jij (Daniel) dit probleem zelf tegenkwam bij Revaleur, trek de parallel naar hun situatie, bied hulp aan. Sluit af met "Groetjes Daniel 🙏"

Kies de 3 stijlen die het BESTE passen bij dit specifieke profiel en schrijf ze uit.

REGELS VOOR ALLE VARIANTEN:
Gebruik NOOIT een streepje (geen gedachtestreepje, geen koppelteken aan het begin van een zin, geen opsomming met streepjes)
Emojis zijn welkom maar gebruik ze spaarzaam (max 2 per bericht)
Max 5 zinnen per variant
Klinkt als een echt mens, niet als een template
Noem altijd iets specifieks over hun profiel of post

Geef ALLEEN JSON terug (geen uitleg):
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
