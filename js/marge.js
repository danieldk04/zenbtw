// ── ZenBTW · Marge Module ────────────────────────────────────────────────
// Inkoopprijzen bijhouden per SKU → brutowinst & margepercentage berekenen
// Afhankelijkheden: S.lineItems, S.costPrices, S.year, fmt(), saveS()
// ─────────────────────────────────────────────────────────────────────────

'use strict';

// Interne vendors die we overslaan (zelfde als products.js)
const MARGE_SKIP_VENDORS = new Set(['revaleur']);

/**
 * getMargeItems()
 * Unieke producten (per SKU) voor het geselecteerde jaar,
 * gefilterd op interne vendors.
 */
function getMargeItems() {
  if (!Array.isArray(S.lineItems)) return [];
  const items = S.lineItems.filter(i =>
    (i.quarter || '').endsWith(S.year) &&
    !MARGE_SKIP_VENDORS.has((i.vendor || '').toLowerCase())
  );
  // Aggregeer per SKU (zelfde logica als aggregateByItem in products.js)
  const map = {};
  for (const i of items) {
    const key = i.sku || i.title || '?';
    if (!map[key]) {
      map[key] = {
        sku: i.sku || key,
        title: i.title || key,
        vendor: i.vendor || '—',
        condition: i.condition || '',
        qty: 0,
        revenue: 0,
        prices: []
      };
    }
    map[key].qty      += i.qty || 1;
    map[key].revenue  += i.price || 0;
    if (i.price > 0) map[key].prices.push(i.price);
  }
  return Object.values(map)
    .map(p => ({
      ...p,
      avgPrice: p.prices.length
        ? p.prices.reduce((s, v) => s + v, 0) / p.prices.length : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * saveCostPrice(sku, value)
 * Sla inkoopprijs op in S.costPrices en persist naar storage.
 */
function saveCostPrice(sku, value) {
  if (!S.costPrices || typeof S.costPrices !== 'object') S.costPrices = {};
  const v = parseFloat(value);
  if (isNaN(v) || v < 0) {
    delete S.costPrices[sku];
  } else {
    S.costPrices[sku] = v;
  }
  saveS();
  renderMargeStats();
}

/**
 * handleMargeCSV(event)
 * Verwerkt een CSV met kolommen: sku, inkoopprijs (of cost)
 * Scheiding: komma of puntkomma.
 */
function handleMargeCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) return;
    // Detecteer scheiding
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const skuIdx  = headers.findIndex(h => h === 'sku' || h === 'artikelnummer' || h === 'article');
    const costIdx = headers.findIndex(h =>
      h === 'inkoopprijs' || h === 'cost' || h === 'inkoop' || h === 'purchase price'
    );
    if (skuIdx < 0 || costIdx < 0) {
      alert('CSV niet herkend. Gebruik kolommen: sku, inkoopprijs (of: cost, purchase price).');
      return;
    }
    if (!S.costPrices || typeof S.costPrices !== 'object') S.costPrices = {};
    let count = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim().replace(/"/g, ''));
      const sku  = cols[skuIdx];
      const cost = parseFloat((cols[costIdx] || '').replace(',', '.'));
      if (!sku || isNaN(cost) || cost < 0) continue;
      S.costPrices[sku] = cost;
      count++;
    }
    saveS();
    renderMarge();
    // Reset file input
    event.target.value = '';
    // Feedback
    const hint = document.getElementById('margeImportHint');
    if (hint) {
      hint.textContent = `✅ ${count} inkoopprijzen geïmporteerd uit CSV.`;
      hint.style.display = 'block';
      hint.style.background = 'var(--acl)';
      hint.style.color = 'var(--acm)';
      setTimeout(() => {
        hint.textContent = '💡 Bulk importeren: Upload een CSV met twee kolommen: sku en inkoopprijs.';
      }, 3000);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/**
 * renderMargeStats()
 * Herberekent alleen de stat-kaartjes, zonder de hele tabel opnieuw te bouwen.
 * Zo is elke keypress in een inkooprijs-input direct zichtbaar.
 */
function renderMargeStats() {
  const items = getMargeItems();
  if (!items.length) return;
  const cp = S.costPrices || {};
  let totalRev = 0, totalCost = 0, knownCount = 0;
  for (const p of items) {
    totalRev += p.revenue;
    const cost = cp[p.sku];
    if (cost !== undefined) {
      totalCost  += cost * p.qty;
      knownCount += 1;
    }
  }
  const bruto = totalRev - totalCost;
  const gem   = knownCount && totalRev > 0
    ? Math.round((bruto / (totalRev - (totalRev - totalCost - bruto || 0))) * 100) : 0;
  // Eenvoudigere berekening: gem marge% = bruto / totalRev * 100
  const margeGemPct = totalRev > 0 && totalCost > 0
    ? Math.round((totalRev - totalCost) / totalRev * 100) : null;

  const el = id => document.getElementById(id);
  if (el('margeRevTotal')) el('margeRevTotal').textContent = `€${fmt(Math.round(totalRev))}`;
  if (el('margeRevSub'))   el('margeRevSub').textContent   = `${items.length} producten · ${S.year}`;
  if (el('margeInkoopTotal')) el('margeInkoopTotal').textContent = totalCost > 0 ? `€${fmt(Math.round(totalCost))}` : '—';
  if (el('margeInkoopSub'))   el('margeInkoopSub').textContent   = `${knownCount} van ${items.length} ingevuld`;
  if (el('margeBruto'))    el('margeBruto').textContent    = totalCost > 0 ? `€${fmt(Math.round(bruto))}` : '—';
  if (el('margeBrutoSub')) el('margeBrutoSub').textContent = totalCost > 0 ? (bruto >= 0 ? 'Winst' : 'Verlies') : 'Vul inkoopprijzen in';
  if (el('margeGem'))      el('margeGem').textContent      = margeGemPct !== null ? `${margeGemPct}%` : '—';

  // Update marge-waarden in de bestaande rijen (zonder full re-render)
  document.querySelectorAll('.marge-row[data-sku]').forEach(row => {
    const sku  = row.getAttribute('data-sku');
    const rev  = parseFloat(row.getAttribute('data-rev') || '0');
    const qty  = parseInt(row.getAttribute('data-qty') || '1');
    const cost = cp[sku];
    const mv   = row.querySelector('.marge-marge-val');
    const pp   = row.querySelector('.marge-pct');
    if (!mv || !pp) return;
    if (cost !== undefined && cost >= 0) {
      const totalRowCost = cost * qty;
      const marge = rev - totalRowCost;
      const pct   = rev > 0 ? Math.round(marge / rev * 100) : 0;
      mv.textContent = `€${fmt(Math.round(marge))}`;
      mv.className   = `marge-marge-val ${marge >= 0 ? 'pos' : 'neg'}`;
      pp.textContent = `${pct}%`;
    } else {
      mv.textContent = '—';
      mv.className   = 'marge-marge-val';
      pp.textContent = '—';
    }
  });
}

/**
 * renderMarge()
 * Hoofdfunctie: vult de #vwmarge view volledig in.
 */
function renderMarge() {
  const body  = document.getElementById('margeBody');
  if (!body) return;

  const items = getMargeItems();
  const cp    = S.costPrices || {};

  // Lege staat
  if (!items.length) {
    body.innerHTML = `
      <div class="es">
        <div class="esi">💰</div>
        <div class="est">Geen producten voor ${S.year}</div>
        <div class="ess">Upload je Shopify CSV op het dashboard om inkoopprijzen in te voeren</div>
      </div>`;
    ['margeRevTotal','margeInkoopTotal','margeBruto','margeGem'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    return;
  }

  // Stats berekenen
  let totalRev = 0, totalCost = 0, knownCount = 0;
  for (const p of items) {
    totalRev += p.revenue;
    const cost = cp[p.sku];
    if (cost !== undefined) {
      totalCost  += cost * p.qty;
      knownCount += 1;
    }
  }
  const bruto        = totalRev - totalCost;
  const margeGemPct  = totalRev > 0 && totalCost > 0
    ? Math.round(bruto / totalRev * 100) : null;

  const el = id => document.getElementById(id);
  if (el('margeRevTotal'))    el('margeRevTotal').textContent    = `€${fmt(Math.round(totalRev))}`;
  if (el('margeRevSub'))      el('margeRevSub').textContent      = `${items.length} producten · ${S.year}`;
  if (el('margeInkoopTotal')) el('margeInkoopTotal').textContent = totalCost > 0 ? `€${fmt(Math.round(totalCost))}` : '—';
  if (el('margeInkoopSub'))   el('margeInkoopSub').textContent   = `${knownCount} van ${items.length} ingevuld`;
  if (el('margeBruto'))       el('margeBruto').textContent       = totalCost > 0 ? `€${fmt(Math.round(bruto))}` : '—';
  if (el('margeBrutoSub'))    el('margeBrutoSub').textContent    = totalCost > 0 ? (bruto >= 0 ? 'Winst' : 'Verlies') : 'Vul inkoopprijzen in';
  if (el('margeGem'))         el('margeGem').textContent         = margeGemPct !== null ? `${margeGemPct}%` : '—';

  // Tabel opbouwen
  body.innerHTML =
    `<div class="marge-hd">
      <span>Product</span>
      <span>Inkoopprijs (p/st)</span>
      <span class="mh4" style="text-align:right">Omzet</span>
      <span style="text-align:right">Brutowinst</span>
      <span style="text-align:right">Marge%</span>
    </div>` +
    items.map(p => {
      const cost     = cp[p.sku];
      const hasCost  = cost !== undefined && cost >= 0;
      const rowCost  = hasCost ? cost * p.qty : null;
      const marge    = hasCost ? p.revenue - rowCost : null;
      const pct      = hasCost && p.revenue > 0 ? Math.round(marge / p.revenue * 100) : null;
      const margeCls = marge !== null ? (marge >= 0 ? 'pos' : 'neg') : '';

      return `
        <div class="marge-row" data-sku="${escHtml(p.sku)}" data-rev="${p.revenue}" data-qty="${p.qty}">
          <div class="marge-title-cell">
            <div class="marge-title-txt" title="${escHtml(p.title)}">${escHtml(p.title)}</div>
            <div class="marge-title-sub">
              <span>${escHtml(p.vendor)}</span>
              <span style="color:var(--tx4)">· ${p.qty}×</span>
              ${p.condition ? `<span style="color:var(--tx4)">· ${escHtml(p.condition)}</span>` : ''}
            </div>
          </div>
          <div>
            <input
              class="marge-inkoop"
              type="number"
              min="0"
              step="0.01"
              placeholder="0,00"
              value="${hasCost ? cost : ''}"
              title="Inkoopprijs per stuk voor ${escHtml(p.title)}"
              onchange="saveCostPrice('${escHtml(p.sku)}', this.value)"
              oninput="saveCostPrice('${escHtml(p.sku)}', this.value)"
            >
          </div>
          <span class="marge-rev-cell mh4">€${fmt(Math.round(p.revenue))}</span>
          <span class="marge-marge-val ${margeCls}">
            ${marge !== null ? `€${fmt(Math.round(marge))}` : '—'}
          </span>
          <span class="marge-pct">
            ${pct !== null ? `${pct}%` : '—'}
          </span>
        </div>`;
    }).join('');

  // Zoekbalk tonen als er producten zijn
  const sw = document.getElementById('margeSearchWrap');
  if (sw) sw.style.display = items.length > 5 ? 'flex' : 'none';
  // Reset zoekbalk bij herladen
  const si = document.getElementById('margeSearch');
  if (si) { si.value = ''; }
}

/**
 * filterMargeRows(query)
 * Verbergt rijen die niet overeenkomen met de zoekterm.
 */
function filterMargeRows(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('.marge-row[data-sku]').forEach(row => {
    const sku   = (row.getAttribute('data-sku') || '').toLowerCase();
    const title = (row.querySelector('.marge-title-txt')?.textContent || '').toLowerCase();
    const brand = (row.querySelector('.marge-title-sub span')?.textContent || '').toLowerCase();
    row.style.display = (!q || sku.includes(q) || title.includes(q) || brand.includes(q)) ? '' : 'none';
  });
  // Update subtitel
  const visible = document.querySelectorAll('.marge-row[data-sku]:not([style*="none"])').length;
  const sub = document.getElementById('margeCardSub');
  if (sub && q) sub.textContent = `${visible} resultaten voor "${query}"`;
  else if (sub) sub.textContent = 'Vul inkoopprijzen in voor brutowinst-berekening';
}

/**
 * exportMargeCSV()
 * Exporteert de margetabel als CSV voor de boekhouder.
 * Kolommen: sku, titel, merk, conditie, stuks, gem. prijs, omzet, inkoopprijs, totale inkoop, brutowinst, marge%
 */
function exportMargeCSV() {
  const items = getMargeItems();
  if (!items.length) { alert('Geen producten om te exporteren.'); return; }
  const cp = S.costPrices || {};

  const sep = ';';
  const q   = v => `"${String(v).replace(/"/g, '""')}"`;
  const eur  = v => typeof v === 'number' ? v.toFixed(2).replace('.', ',') : '';

  const headers = ['SKU','Titel','Merk','Conditie','Stuks','Gem. prijs (€)','Omzet (€)','Inkoopprijs p/st (€)','Totale inkoop (€)','Brutowinst (€)','Marge%'];
  const rows = items.map(p => {
    const cost      = cp[p.sku];
    const hasCost   = cost !== undefined && cost >= 0;
    const totalCost = hasCost ? cost * p.qty : null;
    const bruto     = hasCost ? p.revenue - totalCost : null;
    const pct       = hasCost && p.revenue > 0 ? Math.round(bruto / p.revenue * 100) : null;
    return [
      q(p.sku),
      q(p.title),
      q(p.vendor),
      q(p.condition),
      p.qty,
      eur(p.avgPrice),
      eur(p.revenue),
      hasCost ? eur(cost) : '',
      hasCost ? eur(totalCost) : '',
      bruto !== null ? eur(bruto) : '',
      pct !== null ? pct + '%' : ''
    ].join(sep);
  });

  const bom  = '﻿'; // UTF-8 BOM voor Excel
  const csv  = bom + [headers.join(sep), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ZenBTW_marge_${S.year}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * escHtml(str)
 * Minimale HTML-escaping voor inline attributen.
 */
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
