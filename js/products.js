// ── ZenBTW · Products Module ─────────────────────────────────────────────
// Bouwdag #2: Best-verkopende producten per artikelnummer
// Afhankelijkheden: S.rawOrders (state), EU (eu-rates), fmt() (render)
// ─────────────────────────────────────────────────────────────────────────

'use strict';

/**
 * aggregateProducts(orders)
 * Groepeert orders op SKU/artikelnummer en berekent:
 *   - qty           : aantal verkopen
 *   - revenue       : totale omzet (incl. alle platforms)
 *   - platforms     : Set van platforms waarop verkocht
 *   - countries     : Set van koperlanden
 *
 * @param {Array} orders - S.rawOrders entries
 * @returns {Array} Gesorteerd op revenue (hoog → laag)
 */
function aggregateProducts(orders) {
  // TODO bouwdag #2
  const map = {};

  orders.forEach(o => {
    const key = o.sku || o.title || '—';
    if (!map[key]) {
      map[key] = { sku: key, title: o.title || key, qty: 0, revenue: 0, platforms: new Set(), countries: new Set() };
    }
    map[key].qty++;
    map[key].revenue += o.amount || 0;
    if (o.platform) map[key].platforms.add(o.platform);
    if (o.country)  map[key].countries.add(o.country);
  });

  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

/**
 * renderProducts()
 * Vult de #vwproducten view in.
 * Wordt aangeroepen vanuit render() zodra de view actief is.
 */
function renderProducts() {
  const container = document.getElementById('productenBody');
  if (!container) return;

  const products = aggregateProducts(window.S?.rawOrders || []);

  if (!products.length) {
    container.innerHTML = `
      <div class="es">
        <div class="esi">📦</div>
        <div class="est">Geen productdata</div>
        <div class="ess">Upload een Etsy of Shopify CSV met artikelnummers</div>
      </div>`;
    return;
  }

  // Top 10 tabel — wordt uitgebouwd in bouwdag #2
  container.innerHTML = products.slice(0, 10).map((p, i) => `
    <div class="prod-row ${i === 0 ? 'prod-top' : ''}">
      <span class="prod-rank">#${i + 1}</span>
      <span class="prod-title">${p.title}</span>
      <span class="prod-qty">${p.qty}×</span>
      <span class="prod-rev">€${typeof fmt === 'function' ? fmt(Math.round(p.revenue)) : p.revenue}</span>
    </div>`).join('');
}
