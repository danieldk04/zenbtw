/**
 * Transaction — Aggregate root for the Transactions bounded context.
 */

export type TransactionStatus = 'valid' | 'pending' | 'cancelled' | 'flagged';
export type TransactionType = 'sale' | 'refund' | 'correction';

export interface Transaction {
  id: string;
  date: string;           // ISO 8601
  description: string;
  amountOriginal: number; // In original currency
  currency: string;       // ISO 4217, e.g. 'EUR', 'USD', 'GBP'
  amountEur: number;      // Converted to EUR
  exchangeRate: number;   // Rate used at time of conversion
  countryCode?: string;   // ISO 3166-1 alpha-2, e.g. 'DE', 'FR'
  type: TransactionType;
  status: TransactionStatus;
  vatIncluded: boolean;
  source: 'csv' | 'manual';
}

export function createTransaction(
  partial: Omit<Transaction, 'id' | 'status'>
): Transaction {
  return {
    id: crypto.randomUUID(),
    status: 'pending',
    ...partial,
  };
}

export function validateTransaction(tx: Transaction): string[] {
  const errors: string[] = [];

  if (!tx.date || isNaN(Date.parse(tx.date))) {
    errors.push('Ongeldige datum');
  }
  if (!tx.description?.trim()) {
    errors.push('Omschrijving ontbreekt');
  }
  if (tx.amountOriginal <= 0) {
    errors.push('Bedrag moet positief zijn');
  }
  if (tx.amountEur < 0) {
    errors.push('EUR bedrag mag niet negatief zijn');
  }
  if (!tx.currency || tx.currency.length !== 3) {
    errors.push('Ongeldige valutacode');
  }

  return errors;
}
