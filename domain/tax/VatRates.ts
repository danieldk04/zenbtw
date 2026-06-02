/**
 * EU Top 10 VAT rates registry for OSS (One Stop Shop) compliance.
 * Standard rates for B2C digital services.
 */

export interface CountryVatRate {
  code: string;
  name: string;
  standardRate: number;   // percentage, e.g. 21 = 21%
  digitalServicesRate: number; // typically same as standard for digital
}

export const EU_TOP_10_VAT_RATES: Record<string, CountryVatRate> = {
  DE: { code: 'DE', name: 'Duitsland', standardRate: 19, digitalServicesRate: 19 },
  FR: { code: 'FR', name: 'Frankrijk', standardRate: 20, digitalServicesRate: 20 },
  NL: { code: 'NL', name: 'Nederland', standardRate: 21, digitalServicesRate: 21 },
  BE: { code: 'BE', name: 'België', standardRate: 21, digitalServicesRate: 21 },
  IT: { code: 'IT', name: 'Italië', standardRate: 22, digitalServicesRate: 22 },
  ES: { code: 'ES', name: 'Spanje', standardRate: 21, digitalServicesRate: 21 },
  PL: { code: 'PL', name: 'Polen', standardRate: 23, digitalServicesRate: 23 },
  SE: { code: 'SE', name: 'Zweden', standardRate: 25, digitalServicesRate: 25 },
  AT: { code: 'AT', name: 'Oostenrijk', standardRate: 20, digitalServicesRate: 20 },
  DK: { code: 'DK', name: 'Denemarken', standardRate: 25, digitalServicesRate: 25 },
};

export function getVatRate(countryCode: string): CountryVatRate | null {
  return EU_TOP_10_VAT_RATES[countryCode.toUpperCase()] ?? null;
}

export function calculateVatAmount(amountExclVat: number, countryCode: string): number {
  const country = getVatRate(countryCode);
  if (!country) return 0;
  return amountExclVat * (country.digitalServicesRate / 100);
}

export function splitVatByCountry(
  transactions: Array<{ amountEur: number; countryCode: string }>
): Record<string, { net: number; vat: number; gross: number; country: CountryVatRate }> {
  const result: Record<string, { net: number; vat: number; gross: number; country: CountryVatRate }> = {};

  for (const tx of transactions) {
    const country = getVatRate(tx.countryCode);
    if (!country) continue;

    if (!result[tx.countryCode]) {
      result[tx.countryCode] = { net: 0, vat: 0, gross: 0, country };
    }

    const vatAmount = calculateVatAmount(tx.amountEur, tx.countryCode);
    result[tx.countryCode].net += tx.amountEur;
    result[tx.countryCode].vat += vatAmount;
    result[tx.countryCode].gross += tx.amountEur + vatAmount;
  }

  return result;
}
