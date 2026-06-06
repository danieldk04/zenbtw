/**
 * TaxCalculationService — Core domain service.
 * Handles KOR threshold monitoring, OSS rolling-quarter calculations,
 * and VAT splitting for EU Top 10 countries.
 */

import { evaluateKorThreshold, ThresholdResult, OSS_EU_THRESHOLD } from './KorThreshold';
import { splitVatByCountry } from './VatRates';
import type { Transaction } from '../transactions/Transaction';

export interface OssQuarterSummary {
  periodStart: Date;
  periodEnd: Date;
  vatByCountry: Record<string, { net: number; vat: number; gross: number; country: { code: string; name: string; standardRate: number; digitalServicesRate: number } }>;
  totalNet: number;
  totalVat: number;
  euDistanceSalesTotal: number; // Cumulatieve EU-afstandsverkopen (basis voor €10k-drempel)
  ossThresholdExceeded: boolean; // true zodra EU-afstandsverkopen > €10.000
}

export interface TaxSummary {
  threshold: ThresholdResult;
  ossQuarter: OssQuarterSummary;
  yearToDate: number;      // NL-only turnover — basis voor Nederlandse KOR-drempel
  yearToDateTotal: number; // Totale EU-omzet (informatief, basis voor EU-KOR €100k)
  transactionCount: number;
}

export class TaxCalculationService {
  /**
   * Calculate full tax summary from a list of transactions.
   * All amounts must already be converted to EUR.
   */
  calculateSummary(transactions: Transaction[]): TaxSummary {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Year-to-date transactions for KOR monitoring
    const ytdTransactions = transactions.filter(
      (tx) => new Date(tx.date) >= yearStart && tx.status !== 'cancelled'
    );

    // Splits NL-transacties en EU-afstandsverkopen
    const nlTransactions = ytdTransactions.filter(
      (tx) => !tx.countryCode || tx.countryCode === 'NL'
    );
    const euDistanceTransactions = ytdTransactions
      .filter((tx) => tx.countryCode && tx.countryCode !== 'NL')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const nlTurnover = nlTransactions.reduce((sum, tx) => sum + tx.amountEur, 0);

    /**
     * OSS €10.000 splitsingslogica (Artikel 33 EU Btw-richtlijn):
     *
     * Zolang de cumulatieve EU-afstandsverkopen ≤ €10.000 zijn, worden deze
     * behandeld als binnenlandse omzet (NL-regime) en tellen ze mee voor de
     * Nederlandse KOR-teller van €20.000.
     *
     * Zodra de €10.000-grens wordt overschreden, geldt voor het overschrijdende deel
     * het bestemmingslandprincipe (OSS). De transactie die de grens passeert wordt
     * gesplitst: het deel tot €10.000 telt mee voor de KOR, de rest gaat naar OSS.
     */
    let cumulativeEuSales = 0;
    let euAmountForKor = 0;
    const ossItems: Array<{ amountEur: number; countryCode: string }> = [];

    for (const tx of euDistanceTransactions) {
      const before = cumulativeEuSales;
      cumulativeEuSales += tx.amountEur;

      if (before >= OSS_EU_THRESHOLD) {
        // Al voorbij de grens — volledig naar OSS
        ossItems.push({ amountEur: tx.amountEur, countryCode: tx.countryCode! });
      } else if (cumulativeEuSales <= OSS_EU_THRESHOLD) {
        // Volledig onder de grens — telt mee voor NL KOR
        euAmountForKor += tx.amountEur;
      } else {
        // Splitsingstransactie: deel tot €10.000 → KOR, overschot → OSS
        const korPart = OSS_EU_THRESHOLD - before;
        const ossPart = tx.amountEur - korPart;
        euAmountForKor += korPart;
        ossItems.push({ amountEur: ossPart, countryCode: tx.countryCode! });
      }
    }

    // NL KOR-basis = NL-omzet + EU-afstandsverkopen onder €10.000-drempel
    const yearToDate = nlTurnover + euAmountForKor;
    const yearToDateTotal = ytdTransactions.reduce((sum, tx) => sum + tx.amountEur, 0);
    const ossThresholdExceeded = cumulativeEuSales > OSS_EU_THRESHOLD;

    const threshold = evaluateKorThreshold(yearToDate);

    // OSS BTW-uitsplitsing op basis van de OSS-items (bruto consumentenprijzen)
    const rollingStart = new Date(now);
    rollingStart.setFullYear(rollingStart.getFullYear() - 1);

    const vatBreakdown = splitVatByCountry(ossItems);

    const totalNet = Object.values(vatBreakdown).reduce((s, v) => s + v.net, 0);
    const totalVat = Object.values(vatBreakdown).reduce((s, v) => s + v.vat, 0);

    const ossQuarter: OssQuarterSummary = {
      periodStart: rollingStart,
      periodEnd: now,
      vatByCountry: vatBreakdown,
      totalNet,
      totalVat,
      euDistanceSalesTotal: cumulativeEuSales,
      ossThresholdExceeded,
    };

    return {
      threshold,
      ossQuarter,
      yearToDate,
      yearToDateTotal,
      transactionCount: ytdTransactions.length,
    };
  }

  /**
   * Determine if a new transaction would push the user into the buffer or exceed the limit.
   * Used for real-time UI warnings before saving a transaction.
   */
  previewTransaction(
    currentTurnover: number,
    newAmountEur: number
  ): ThresholdResult {
    return evaluateKorThreshold(currentTurnover + newAmountEur);
  }
}
