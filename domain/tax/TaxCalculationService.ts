/**
 * TaxCalculationService — Core domain service.
 * Handles KOR threshold monitoring, OSS rolling-quarter calculations,
 * and VAT splitting for EU Top 10 countries.
 */

import { evaluateKorThreshold, ThresholdResult } from './KorThreshold';
import { splitVatByCountry } from './VatRates';
import type { Transaction } from '../transactions/Transaction';

export interface OssQuarterSummary {
  periodStart: Date;
  periodEnd: Date;
  vatByCountry: Record<string, { net: number; vat: number; gross: number; country: { code: string; name: string; standardRate: number; digitalServicesRate: number } }>;
  totalNet: number;
  totalVat: number;
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

    // Dutch KOR: only Dutch (NL) turnover counts toward the €20k threshold.
    // Foreign EU sales do NOT count for the Dutch KOR (confirmed Belastingdienst).
    // They count toward the EU-KOR threshold (€100k) instead.
    const yearToDate = ytdTransactions
      .filter((tx) => !tx.countryCode || tx.countryCode === 'NL')
      .reduce((sum, tx) => sum + tx.amountEur, 0);

    const yearToDateTotal = ytdTransactions.reduce((sum, tx) => sum + tx.amountEur, 0);

    const threshold = evaluateKorThreshold(yearToDate);

    // OSS: rolling 12-month window for EU transactions
    const rollingStart = new Date(now);
    rollingStart.setFullYear(rollingStart.getFullYear() - 1);

    const ossTransactions = transactions.filter(
      (tx) =>
        tx.countryCode &&
        tx.countryCode !== 'NL' && // OSS excludes domestic NL sales
        new Date(tx.date) >= rollingStart &&
        tx.status !== 'cancelled'
    );

    const vatBreakdown = splitVatByCountry(
      ossTransactions.map((tx) => ({
        amountEur: tx.amountEur,
        countryCode: tx.countryCode ?? 'NL',
      }))
    );

    const totalNet = Object.values(vatBreakdown).reduce((s, v) => s + v.net, 0);
    const totalVat = Object.values(vatBreakdown).reduce((s, v) => s + v.vat, 0);

    const ossQuarter: OssQuarterSummary = {
      periodStart: rollingStart,
      periodEnd: now,
      vatByCountry: vatBreakdown,
      totalNet,
      totalVat,
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
