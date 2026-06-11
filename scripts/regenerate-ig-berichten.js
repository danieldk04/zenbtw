// Hergenereert Instagram DM-berichten voor bestaande leads met nieuwe intro-stijl
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'instagram-leads.json';

async function generateDMs(lead) {
  const prompt = `Schrijf 3 korte Instagram DM's namens Daniel (@revaleur, vintage kleding, 700+ reviews op Vinted/Etsy/Shopify). Hij stuurt dit naar iemand die hij niet kent.

PROFIEL ONTVANGER:
@${lead.username} (${lead.displayName || lead.username})
Bio: ${lead.bio || '(geen bio)'}
Recente post: ${lead.snippet || '(geen post)'}

Schrijf de VOLLEDIGE TEKST van 3 DM's. Geef GEEN beschrijvingen of labels, alleen de echte berichttekst die Daniel kan kopiëren en plakken.

DM 1 (sleutel "helper"): reageer als iemand die hun werk oprecht mooi vindt. Benoem iets heel specifieks uit hun post of bio. Stel daarna één echte vraag over hun werk als collega-verkoper. Geen agenda. Eindig met "Groetjes Daniel"

DM 2 (sleutel "gesprek"): begin met hun naam, deel één herkenbaar eigen verkoopmoment (concreet, geen BTW). Stel een vraag die je echt zou willen weten. Twee ondernemers die elkaar leren kennen. Eindig met "Groetjes Daniel 👋"

DM 3 (sleutel "pitch"): begin met een concreet compliment. Noem in één zin dat jij als verkoper lang hebt geworsteld met de KOR-administratie. Noem ZenBTW luchtig als "iets wat ik daarvoor heb gemaakt" zonder aanprijzing. Geen druk. Eindig met "Groetjes Daniel"

REGELS:
Geen streepjes als leesteken (geen gedachtestreepje, nergens)
Geen "Hoi" aan het begin
Max 4 zinnen per DM
Geen buzzwords, geen marketingtaal
Emojis spaarzaam (max 1 per bericht)
ZenBTW alleen in DM 3

Geef UITSLUITEND dit JSON-object terug, niets anders, geen uitleg:
{"helper":"[volledige DM-tekst 1]","gesprek":"[volledige DM-tekst 2]","pitch":"[volledige DM-tekst 3]"}`;

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
  try {
    const parsed = match ? JSON.parse(match[0]) : {};
    const flat = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') flat[k] = v;
      else if (v && typeof v === 'object') flat[k] = Object.values(v).find(x => typeof x === 'string') || '';
      else flat[k] = '';
    }
    return flat;
  }
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
