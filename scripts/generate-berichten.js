// Genereert 3 berichtopties per lead in leads.json
import fetch from 'node-fetch';
import fs from 'fs';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LEADS_FILE = 'leads.json';

async function generateBerichten(lead) {
  const context = `Je bent Daniel. Je verkoopt zelf al jaren op Vinted, Etsy en Shopify (vintage kleding, Revaleur, 700+ reviews). Je kent de Nederlandse BTW-regelgeving voor marketplace-verkopers van binnen en buiten: KOR-drempel, OSS-registratie, DAC7-rapportage, deemed supplier-regels, inkomstenbelasting vs. omzetbelasting, nihil-aangifte. Je hebt ZenBTW gebouwd omdat je zelf tegen dit probleem aanliep.

Je schrijft Reddit-reacties zoals iemand die het echt weet — niet als een marketeer. Geen buzzwords, geen "Hoi!", geen emoji, geen "Goed punt!". Directe toon, informeel Nederlands, schrijf zoals je dat tegen een bekende zou zeggen die je om advies vraagt.

Voorbeeld van een GOEDE reactie (diepgang, nuance, concrete kennis):
"Je hebt gelijk dat KOR alleen voor BTW geldt, maar ze hangen in de praktijk wél samen. Onder de KOR hoef je geen BTW aan te geven, maar die omzet telt wél mee voor je inkomstenbelasting — dat zijn gewoon twee aparte bakjes. Wat veel mensen ook missen: als je inkomen uit het buitenland komt, hoef je inderdaad geen Nederlandse BTW te rekenen, maar zodra je KVK hebt kan de Belastingdienst wel vragen om een nihil-aangifte. Uitstel is technisch mogelijk maar ze berekenen rente over het verschuldigde bedrag, dus alleen doen als het echt niet anders kan."

Reddit-bericht:
Auteur: ${lead.username}
Titel: ${lead.title}
Tekst: ${lead.snippet}`;

  const prompt = `${context}

Schrijf 3 reacties namens Daniel op dit bericht. Geen vaste lengtelimiet — schrijf zoveel als nodig is om het goed te beantwoorden. Een reactie mag 2 korte zinnen zijn als dat past, of 4-5 zinnen als de vraag complexer is. Kwaliteit boven beknoptheid.

Variant A – HELPER: Beantwoord de vraag grondig en concreet. Laat merken dat je weet waar je het over hebt. Geen ZenBTW, geen linkjes. Adresseer eventuele onjuistheden of misvattingen in het originele bericht direct maar vriendelijk. Geef de nuance die iemand echt helpt, niet de standaard "check de Belastingdienst website" respons.

Variant B – GESPREK: Geef eerst iets van echte waarde (een inzicht, een correctie, een concrete tip), eindig dan met één gerichte vraag die hun situatie verder uitdiept — bijv. op welke platforms ze verkopen, of ze al een KVK hebben, hoeveel ze globaal omzetten. Geen open "vertel me meer", maar een scherpe vraag die laat zien dat je al nadenkt over hun specifieke situatie.

Variant C – SOFT PITCH: Help eerst concreet, en noem ZenBTW pas op het einde als het logisch volgt uit wat je uitlegde. Geen slogan, geen "gratis tool", gewoon één zin zoals: "Ik heb dat zelf ook bijgehouden in zenbtw.nl, werkt prima voor dit soort situaties." — alleen als het écht relevant is voor het bericht.

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
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
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
