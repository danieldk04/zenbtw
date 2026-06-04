/**
 * EU VAT rates registry for OSS (One Stop Shop) compliance.
 * Alle 27 EU-lidstaten — standaardtarieven voor B2C-leveringen.
 * Bijgewerkt 2025.
 */

export interface CountryVatRate {
  code: string;
  name: string;
  standardRate: number;   // percentage, e.g. 21 = 21%
  digitalServicesRate: number; // typically same as standard for digital
}

export const EU_VAT_RATES: Record<string, CountryVatRate> = {
  // Grote markten
  DE: { code: 'DE', name: 'Duitsland',    standardRate: 19,   digitalServicesRate: 19   },
  FR: { code: 'FR', name: 'Frankrijk',    standardRate: 20,   digitalServicesRate: 20   },
  NL: { code: 'NL', name: 'Nederland',    standardRate: 21,   digitalServicesRate: 21   },
  BE: { code: 'BE', name: 'België',       standardRate: 21,   digitalServicesRate: 21   },
  IT: { code: 'IT', name: 'Italië',       standardRate: 22,   digitalServicesRate: 22   },
  ES: { code: 'ES', name: 'Spanje',       standardRate: 21,   digitalServicesRate: 21   },
  PL: { code: 'PL', name: 'Polen',        standardRate: 23,   digitalServicesRate: 23   },
  SE: { code: 'SE', name: 'Zweden',       standardRate: 25,   digitalServicesRate: 25   },
  AT: { code: 'AT', name: 'Oostenrijk',   standardRate: 20,   digitalServicesRate: 20   },
  DK: { code: 'DK', name: 'Denemarken',   standardRate: 25,   digitalServicesRate: 25   },
  // Overige lidstaten
  FI: { code: 'FI', name: 'Finland',      standardRate: 25.5, digitalServicesRate: 25.5 }, // verhoogd sep 2024
  IE: { code: 'IE', name: 'Ierland',      standardRate: 23,   digitalServicesRate: 23   },
  PT: { code: 'PT', name: 'Portugal',     standardRate: 23,   digitalServicesRate: 23   },
  CZ: { code: 'CZ', name: 'Tsjechië',    standardRate: 21,   digitalServicesRate: 21   },
  HU: { code: 'HU', name: 'Hongarije',   standardRate: 27,   digitalServicesRate: 27   },
  RO: { code: 'RO', name: 'Roemenië',    standardRate: 19,   digitalServicesRate: 19   },
  SK: { code: 'SK', name: 'Slowakije',   standardRate: 23,   digitalServicesRate: 23   },
  BG: { code: 'BG', name: 'Bulgarije',   standardRate: 20,   digitalServicesRate: 20   },
  HR: { code: 'HR', name: 'Kroatië',     standardRate: 25,   digitalServicesRate: 25   },
  SI: { code: 'SI', name: 'Slovenië',    standardRate: 22,   digitalServicesRate: 22   },
  LT: { code: 'LT', name: 'Litouwen',    standardRate: 21,   digitalServicesRate: 21   },
  LV: { code: 'LV', name: 'Letland',     standardRate: 23,   digitalServicesRate: 23   },
  EE: { code: 'EE', name: 'Estland',     standardRate: 24,   digitalServicesRate: 24   },
  LU: { code: 'LU', name: 'Luxemburg',   standardRate: 17,   digitalServicesRate: 17   },
  MT: { code: 'MT', name: 'Malta',       standardRate: 18,   digitalServicesRate: 18   },
  CY: { code: 'CY', name: 'Cyprus',      standardRate: 19,   digitalServicesRate: 19   },
  EL: { code: 'EL', name: 'Griekenland', standardRate: 24,   digitalServicesRate: 24   }, // EU-code
  GR: { code: 'GR', name: 'Griekenland', standardRate: 24,   digitalServicesRate: 24   }, // ISO-code (Etsy)
};

/** @deprecated Gebruik EU_VAT_RATES — dekt alle 27 EU-lidstaten. */
export const EU_TOP_10_VAT_RATES = EU_VAT_RATES;

export function getVatRate(countryCode: string): CountryVatRate | null {
  return EU_VAT_RATES[countryCode.toUpperCase()] ?? null;
}

/**
 * Extraheer BTW uit een BRUTO consumentenprijs (incl. BTW).
 * Formule conform deep research: bruto × (tarief / (100 + tarief))
 * Marktplaatsprijzen (Vinted, eBay, Shopify) zijn altijd consumentenprijzen = bruto.
 */
export function extractVatFromGross(grossAmountEur: number, countryCode: string): number {
  const country = getVatRate(countryCode);
  if (!country) return 0;
  const rate = country.digitalServicesRate;
  return grossAmountEur * (rate / (100 + rate));
}

/**
 * Splits bruto transactiebedragen per land in net/BTW/bruto.
 * amountEur wordt behandeld als BRUTO (consumentenprijs incl. BTW),
 * conform de werkelijkheid van marktplaats-exports.
 */
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

    const vat = extractVatFromGross(tx.amountEur, tx.countryCode);
    const net = tx.amountEur - vat;

    result[tx.countryCode].gross += tx.amountEur;
    result[tx.countryCode].vat += vat;
    result[tx.countryCode].net += net;
  }

  return result;
}
