// ── ZenBTW · Products Module ─────────────────────────────────────────────
// Bouwdag #2: Best-verkopende producten per merk & per artikel (Shopify)
// Afhankelijkheden: S.lineItems, S.quarter, fmt() — allen globaal in app.html
// ─────────────────────────────────────────────────────────────────────────

'use strict';

let _prodTab = 'brand'; // actieve tab: 'brand' | 'item'

// Interne Revaleur-artikelen die we NIET in de productenlijst willen
const INTERNAL_VENDORS = new Set(['revaleur']);

/**
 * getFilteredItems()
 * Geeft line items terug voor het geselecteerde kwartaal + optionele vendor-filter.
 */
function getFilteredItems() {
  if (!window.S || !Array.isArray(S.lineItems)) return [];
  const items = S.lineItems.filter(i => i.quarter === S.quarter);
  const vendorSel = document.getElementById('prodVendorFilter');
  const selected = vendorSel ? vendorSel.value : 'all';
  if (selected && selected !== 'all') {
    return items.filter(i => i.vendor === selected);
  }
  return items;
}

/**
 * aggregateByBrand(items)
 * Groepeert op merk (Vendor), sorteert op omzet.
 */
function aggregateByBrand(items) {
  const map = {};
  for (const i of items) {
    const v = i.vendor || '—';
    if (INTERNAL_VENDORS.has(v.toLowerCase())) continue;
    if (!map[v]) map[v] = { vendor: v, qty: 0, revenue: 0 };
    map[v].qty += i.qty || 1;
    map[v].revenue += i.price || 0;
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

/**
 * aggregateByItem(items)
 * Groepeert op SKU, sorteert op omzet.
 * Vintage-items zijn uniek (1 SKU = 1 stuk), maar we groeperen toch
 * zodat herlaad van hetzelfde bestand geen duplicaten oplevert.
 */
function aggregateByItem(items) {
  const map = {};
  for (const i of items) {
    if (INTERNAL_VENDORS.has((i.vendor || '').toLowerCase())) continue;
    const key = i.sku || i.title;
    if (!map[key]) {
      map[key] = {
        sku: i.sku,
        title: i.title,
        vendor: i.vendor || '—',
        condition: i.condition || '',
        qty: 0,
        revenue: 0,
        prices: [],
        compareAts: []
      };
    }
    map[key].qty += i.qty || 1;
    map[key].revenue += i.price || 0;
    if (i.price > 0) map[key].prices.push(i.price);
    if (i.compareAt > 0) map[key].compareAts.push(i.compareAt);
  }
  // Gemiddelde prijs en RRP berekenen
  return Object.values(map)
    .map(p => ({
      ...p,
      avgPrice: p.prices.length ? p.prices.reduce((s, v) => s + v, 0) / p.prices.length : 0,
      avgRRP: p.compareAts.length ? p.compareAts.reduce((s, v) => s + v, 0) / p.compareAts.length : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * conditionBadge(condition)
 * Geeft de CSS-klasse terug voor de conditie-badge.
 */
function conditionBadge(condition) {
  const c = (condition || '').toLowerCase();
  if (c.includes('new'))       return 'new';
  if (c.includes('very good')) return 'very-good';
  if (c.includes('good'))      return 'good';
  return '';
}

/**
 * updateProdFilter(items)
 * Vult de merk-dropdown bij met unieke vendors uit de huidige dataset.
 */
function updateProdFilter(items) {
  const sel = document.getElementById('prodVendorFilter');
  if (!sel) return;
  const vendors = [...new Set(
    items
      .filter(i => !INTERNAL_VENDORS.has((i.vendor || '').toLowerCase()) && i.vendor)
      .map(i => i.vendor)
  )].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="all">Alle merken</option>' +
    vendors.map(v => `<option value="${v}"${v === current ? ' selected' : ''}>${v}</option>`).join('');
}

/**
 * setProdTab(tab)
 * Wisselt tussen 'brand' en 'item' tab.
 */
function setProdTab(tab) {
  _prodTab = tab;
  document.getElementById('ptBrand')?.classList.toggle('on', tab === 'brand');
  document.getElementById('ptItem')?.classList.toggle('on', tab === 'item');
  renderProducts();
}

/**
 * renderProducts()
 * Hoofdfunctie: vult de #vwproducten view volledig in.
 */
function renderProducts() {
  const body = document.getElementById('productenBody');
  const tag  = document.getElementById('prodTag');
  if (!body) return;

  // Kwartaal-tag bijwerken
  if (tag && window.S) tag.textContent = S.quarter;

  // Alle items voor dit kwartaal (zonder vendor-filter voor stats)
  const allItems = (window.S && Array.isArray(S.lineItems))
    ? S.lineItems.filter(i => i.quarter === S.quarter && !INTERNAL_VENDORS.has((i.vendor || '').toLowerCase()))
    : [];

  // Lege staat
  if (!allItems.length) {
    body.innerHTML = `<div class="es"><div class="esi">📦</div><div class="est">Geen productdata voor ${window.S ? S.quarter : '—'}</div><div class="ess">Upload je Shopify CSV om productverkopen te zien</div></div>`;
    document.getElementById('prodCount').textContent     = '—';
    document.getElementById('prodTopBrand').textContent  = '—';
    document.getElementById('prodAvgPrice').textContent  = '—';
    document.getElementById('prodRevTotal').textContent  = '—';
    updateProdFilter([]);
    return;
  }

  // Vendor-filter bijwerken op basis van alle items
  updateProdFilter(allItems);

  // Gefilterde items (vendor-dropdown)
  const items = getFilteredItems().filter(i => !INTERNAL_VENDORS.has((i.vendor || '').toLowerCase()));

  // ── Stats bovenaan ──
  const totalItems   = allItems.length;
  const totalRev     = items.reduce((s, i) => s + (i.price || 0), 0);
  const avgPrice     = items.length ? totalRev / items.length : 0;
  const brands       = aggregateByBrand(allItems);
  const topBrand     = brands[0];

  document.getElementById('prodCount').textContent    = totalItems;
  document.getElementById('prodCountSub').textContent = `${totalItems} items · ${S.quarter}`;
  document.getElementById('prodTopBrand').textContent = topBrand ? topBrand.vendor : '—';
  document.getElementById('prodTopBrandSub').textContent = topBrand ? `€${fmt(Math.round(topBrand.revenue))} · ${topBrand.qty}×` : '—';
  document.getElementById('prodAvgPrice').textContent = items.length ? `€${fmt(Math.round(avgPrice))}` : '—';
  document.getElementById('prodRevTotal').textContent = `€${fmt(Math.round(totalRev))}`;
  document.getElementById('prodRevSub').textContent   = `${items.length} items · Shopify`;

  // ── Tab: Per merk ──
  if (_prodTab === 'brand') {
    document.getElementById('prodCardTitle').textContent = 'Omzet per merk';
    document.getElementById('prodCardSub').textContent   = 'Gerangschikt op omzet';
    const bData  = aggregateByBrand(items);
    const maxRev = bData[0]?.revenue || 1;
    body.innerHTML =
      `<div class="brand-bar" style="background:var(--s2)">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx4)">Merk</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx4)">Aandeel</span>
        <span class="bh4" style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx4);text-align:right">Stuks</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx4);text-align:right">Omzet</span>
      </div>` +
      bData.map(b => `
        <div class="brand-bar">
          <span class="brand-name">${b.vendor}</span>
          <div class="brand-track"><div class="brand-fill" style="width:${Math.round(b.revenue / maxRev * 100)}%"></div></div>
          <span class="bh4 brand-qty">${b.qty}×</span>
          <span class="brand-rev">€${fmt(Math.round(b.revenue))}</span>
        </div>`).join('');
  }

  // ── Tab: Per product ──
  else {
    document.getElementById('prodCardTitle').textContent = 'Verkopen per product';
    document.getElementById('prodCardSub').textContent   = 'Gerangschikt op omzet · top 50';
    const pData = aggregateByItem(items).slice(0, 50);
    body.innerHTML =
      `<div class="prod-header">
        <span>#</span>
        <span>Product</span>
        <span class="ph4" style="text-align:right">Gem. prijs</span>
        <span style="text-align:center">Stuks</span>
        <span style="text-align:right">Omzet</span>
      </div>` +
      pData.map((p, i) => {
        const badge = conditionBadge(p.condition);
        const discPct = p.avgRRP > 0 ? Math.round((1 - p.avgPrice / p.avgRRP) * 100) : 0;
        return `
          <div class="prod-row${i === 0 ? ' prod-top-1' : ''}">
            <span class="prod-rank">${i + 1}</span>
            <div class="prod-name-wrap">
              <div class="prod-title" title="${p.title}">${p.title}</div>
              <div class="prod-sub">
                <span>${p.vendor}</span>
                ${badge ? `<span class="prod-badge ${badge}">${p.condition}</span>` : ''}
                ${discPct > 0 ? `<span style="color:var(--dn);font-size:10.5px;font-weight:600">−${discPct}% v/RRP</span>` : ''}
              </div>
            </div>
            <span class="prod-avgprice ph4">€${fmt(Math.round(p.avgPrice))}</span>
            <span class="prod-qty">${p.qty}×</span>
            <span class="prod-rev">€${fmt(Math.round(p.revenue))}</span>
          </div>`;
      }).join('');
  }
}
