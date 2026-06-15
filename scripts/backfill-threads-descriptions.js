#!/usr/bin/env node
/**
 * Backfill Threads descriptions for existing published slide sets.
 * Reads manifest.json, generates a ≤500-char Threads description for each
 * set that doesn't have one yet, saves description.txt and updates manifest.
 *
 * Usage: node scripts/backfill-threads-descriptions.js
 * Env:   ANTHROPIC_API_KEY (required)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.join(__dirname, '..');
const MANIFEST   = path.join(ROOT, 'slides', 'manifest.json');
const SLIDES_DIR = path.join(ROOT, 'slides');

function loadManifest()  { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
function saveManifest(d) { fs.writeFileSync(MANIFEST, JSON.stringify(d, null, 2), 'utf8'); }

async function generateThreadsDescription(topic, slideCount, client) {
  const prompt = `Schrijf een Threads-beschrijving voor een carousel-post van @zenbtw over: "${topic}"

De post bevat ${slideCount} slides.

Vereisten:
- MAXIMAAL 480 tekens inclusief alles (spaties, emoji, hashtags)
- Persoonlijk en concreet — geen marketing-taal
- 1-2 zinnen over de kern van de boodschap
- 1 zachte CTA (bijv. "Check zenbtw.nl" of "Link in bio")
- Sluit af met 3-4 hashtags (#BTW #KOR #marketplace etc.)
- Schrijf in het Nederlands

Tel zorgvuldig. Houd het STRIKT onder 480 tekens.
Geef ALLEEN de beschrijving terug — geen aanhalingstekens, geen uitleg.`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  let text = msg.content[0].text.trim();
  if (text.length > 500) text = text.slice(0, 497) + '…';
  return text;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }

  const manifest = loadManifest();
  const client   = new Anthropic();

  const toBackfill = manifest.sets.filter(s => !s.threadsDescription);
  console.log(`\n📝 Backfilling ${toBackfill.length} Threads descriptions...\n`);

  let updated = 0;
  for (const set of manifest.sets) {
    if (set.threadsDescription) continue;

    process.stdout.write(`  "${set.topic}" ... `);
    try {
      const desc = await generateThreadsDescription(set.topic, set.slides, client);
      set.threadsDescription = desc;

      // Save description.txt to the set directory
      const setDir = path.join(SLIDES_DIR, set.id);
      if (fs.existsSync(setDir)) {
        fs.writeFileSync(path.join(setDir, 'description.txt'), desc, 'utf8');
      }

      console.log(`${desc.length} tekens ✓`);
      updated++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  saveManifest(manifest);
  console.log(`\n✅ Done! ${updated} descriptions added.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
