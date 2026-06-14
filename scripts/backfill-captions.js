#!/usr/bin/env node
/**
 * Backfill Instagram captions for all slide sets in manifest.json
 * Also de-duplicates the manifest by ID.
 * Usage: ANTHROPIC_API_KEY=... node scripts/backfill-captions.js
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'slides', 'manifest.json');

async function generateCaption(topic, client) {
  const prompt = `Je schrijft een Instagram caption voor een carousel-post van @zenbtw over: "${topic}"

Schrijf de caption in deze stijl (persoonlijk, menselijk, concreet — geen marketing-taal):
- Begin direct met een herkenbaar inzicht of feit voor marketplace verkopers
- Schrijf vanuit eigen perspectief ("ik zie dat...", "veel verkopers vertellen me...")
- Gebruik echte bedragen: KOR-grens €20.000, OSS €10.000, DAC7: 30 transacties + €2.000 (alleen als relevant)
- Korte alinea's — soms maar 1 zin
- Sluit af met een zachte CTA naar zenbtw.nl
- Daarna 8-12 hashtags: mix van breed (#btw #belasting) en niche (#vintedverkoper #etsyshop #korregeling)
- Schrijf in het Nederlands

Geef ALLEEN de caption terug (geen aanhalingstekens, geen uitleg).`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0].text.trim();
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const client = new Anthropic();

  // De-duplicate by ID (keep first occurrence, which is the most recent)
  const seen = new Set();
  const unique = data.sets.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const removed = data.sets.length - unique.length;
  if (removed > 0) console.log(`🧹 Removed ${removed} duplicate entries`);

  // Generate captions for sets that don't have one
  const needsCaption = unique.filter(s => !s.caption && s.id !== 'preview-dac7');
  console.log(`\n✍️  Generating captions for ${needsCaption.length} sets...\n`);

  for (const s of needsCaption) {
    process.stdout.write(`  "${s.topic.slice(0, 60)}..."  `);
    try {
      s.caption = await generateCaption(s.topic, client);
      console.log('✓');
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  data.sets = unique;
  fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2), 'utf8');
  console.log(`\n✅ manifest.json updated (${unique.length} sets, all with captions)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
