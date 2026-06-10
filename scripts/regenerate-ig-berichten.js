// Hergenereert Instagram DM-berichten voor bestaande leads met nieuwe intro-stijl
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'instagram-leads.json';

async function generateDMs(lead) {
  const prompt = `Je schrijft persoonlijke Instagram DM's namens Daniel — eigenaar van vintage kledingwinkel Revaleur (700+ reviews op Vinted, Etsy en Shopify) en oprichter van ZenBTW.

Daniel stuurt deze DM's vanuit @revaleur naar iemand die hij NIET kent.

Profiel:
@${lead.username} (${lead.displayName || lead.username})
Bio: ${lead.bio || '(geen bio)'}
Recente post: ${lead.snippet || '(geen post)'}
Reden dat dit een goede lead is: ${lead.reden || ''}

Schrijf 3 varianten van een persoonlijke intro-DM.

STRUCTUUR (in deze volgorde):
1. Naam (voornaam of @${lead.username}) — geen "Hoi"
2. Één oprecht compliment over iets specifieks dat je ziet in hun profiel/post
3. "Ik ga er niet omheen draaien — ik heb zelf 700+ reviews op Vinted/Etsy/Shopify via mijn vintage shop Revaleur en heb hier zelf lang mee geworsteld."
4. Afhankelijk van variant (zie onder)
5. Afsluiten met: "Groetjes, Daniel"

STIJL: Informeel, menselijk, geen buzzwords, geen emoji, max 5 zinnen. Klinkt als een vriend die toevallig expert is — niet als een pitch.

3 VARIANTEN:
- helper: na intro → één concreet nuttig feit over hun specifieke situatie (GEEN ZenBTW noemen) → "Check gerust ook mijn profiel @revaleur of zenbtw.nl als je meer wil weten, maar geen druk. Groetjes, Daniel"
- gesprek: na intro → één gerichte vraag die hun situatie uitdiept (bijv. hoe bijhouden ze omzet, op hoeveel platforms zitten ze) → "Groetjes, Daniel"
- pitch: na intro → probleem kort uitleggen (KOR-drempel, Belastingdienst kijkt naar omzet niet winst) → "Daarvoor heb ik zenbtw.nl gebouwd, puur om het simpel te houden. Als het niks voor je is ook geen hard feelings. Groetjes, Daniel"

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
