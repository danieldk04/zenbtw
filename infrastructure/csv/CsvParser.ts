/**
 * CsvParser — Parses CSV transaction exports and maps them to Transaction domain objects.
 * Uses PapaParse for robust CSV handling.
 * Supports common export formats (bank, Stripe, PayPal).
 */

import Papa from 'papaparse';
import { createTransaction, validateTransaction } from '../../domain/transactions/Transaction';
import type { Transaction } from '../../domain/transactions/Transaction';
import { exchangeRateService } from '../exchange-rates/ExchangeRateService';

interface CsvRow {
  date?: string;
  datum?: string;
  description?: string;
  omschrijving?: string;
  amount?: string;
  bedrag?: string;
  currency?: string;
  valuta?: string;
  country?: string;
  land?: string;
  country_code?: string;
  [key: string]: string | undefined;
}

function normalizeDate(raw: string): string {
  // Try DD-MM-YYYY, YYYY-MM-DD, D/M/YYYY
  const patterns = [
    { re: /^(\d{2})-(\d{2})-(\d{4})$/, fn: (m: RegExpMatchArray) => `${m[3]}-${m[2]}-${m[1]}` },
    { re: /^(\d{4})-(\d{2})-(\d{2})$/, fn: (m: RegExpMatchArray) => m[0] },
    { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, fn: (m: RegExpMatchArray) => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` },
  ];
  for (const { re, fn } of patterns) {
    const m = raw.match(re);
    if (m) return fn(m);
  }
  return raw; // Return as-is, let validator catch it
}

function parseAmount(raw: string): number {
  // Handle European format: 1.234,56 → 1234.56
  const cleaned = raw.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function mapRow(row: CsvRow): Omit<Transaction, 'id' | 'status' | 'amountEur' | 'exchangeRate'> {
  const rawDate = row.date ?? row.datum ?? '';
  const description = row.description ?? row.omschrijving ?? '';
  const rawAmount = row.amount ?? row.bedrag ?? '0';
  const currency = (row.currency ?? row.valuta ?? 'EUR').toUpperCase().trim();
  const countryCode = (row.country_code ?? row.country ?? row.land ?? '').toUpperCase().trim() || undefined;

  return {
    date: normalizeDate(rawDate),
    description,
    amountOriginal: Math.abs(parseAmount(rawAmount)),
    currency,
    countryCode,
    type: parseAmount(rawAmount) < 0 ? 'refund' : 'sale',
    vatIncluded: false,
    source: 'csv',
  };
}

export interface ParseResult {
  transactions: Transaction[];
  errors: Array<{ row: number; message: string }>;
  skipped: number;
  vintedWarning?: boolean; // true when imported from Vinted HTML (no country data)
}

export async function parseCsvFile(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const transactions: Transaction[] = [];
        const errors: Array<{ row: number; message: string }> = [];
        let skipped = 0;

        for (let i = 0; i < results.data.length; i++) {
          const row = results.data[i];
          try {
            const base = mapRow(row);
            const { amountEur, rate } = await exchangeRateService.toEur(
              base.amountOriginal,
              base.currency
            );

            const tx = createTransaction({ ...base, amountEur, exchangeRate: rate });
            const validationErrors = validateTransaction(tx);

            if (validationErrors.length > 0) {
              errors.push({ row: i + 2, message: validationErrors.join('; ') });
              skipped++;
              continue;
            }

            tx.status = 'valid';
            transactions.push(tx);
          } catch (err) {
            errors.push({ row: i + 2, message: String(err) });
            skipped++;
          }
        }

        resolve({ transactions, errors, skipped });
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * parseVintedHtml — Parses a Vinted HTML orders export.
 * Vinted does not include destination country in its export;
 * all transactions default to NL. Users must update foreign orders manually.
 */
export async function parseVintedHtml(file: File): Promise<ParseResult> {
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('table tr'));

  if (rows.length < 2) {
    return {
      transactions: [],
      errors: [{ row: 0, message: 'Geen tabelrijen gevonden in Vinted HTML' }],
      skipped: 0,
      vintedWarning: false,
    };
  }

  const headers = Array.from(rows[0].querySelectorAll('th, td')).map(
    (el) => el.textContent?.trim().toLowerCase() ?? ''
  );

  const dateIdx = headers.findIndex((h) => h.includes('datum') || h.includes('date'));
  const descIdx = headers.findIndex(
    (h) =>
      h.includes('titel') ||
      h.includes('title') ||
      h.includes('item') ||
      h.includes('beschrijving') ||
      h.includes('description')
  );
  const amountIdx = headers.findIndex(
    (h) =>
      h.includes('prijs') ||
      h.includes('price') ||
      h.includes('bedrag') ||
      h.includes('totaal') ||
      h.includes('total')
  );

  const transactions: Transaction[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td')).map(
      (el) => el.textContent?.trim() ?? ''
    );
    if (cells.every((c) => !c)) continue;

    try {
      const rawDate = dateIdx >= 0 ? (cells[dateIdx] ?? '') : '';
      const description =
        (descIdx >= 0 ? cells[descIdx] : cells[1]) || `Vinted order rij ${i}`;
      const rawAmount = amountIdx >= 0 ? (cells[amountIdx] ?? '0') : '0';

      const base = {
        date: normalizeDate(rawDate),
        description,
        amountOriginal: Math.abs(parseAmount(rawAmount)),
        currency: 'EUR',
        countryCode: 'NL' as string | undefined,
        type: 'sale' as const,
        // Vinted-exportprijzen zijn consumentenprijzen (bruto incl. BTW)
        vatIncluded: true,
        source: 'csv' as const,
      };

      const { amountEur, rate } = await exchangeRateService.toEur(base.amountOriginal, 'EUR');
      const tx = createTransaction({ ...base, amountEur, exchangeRate: rate });
      const validationErrors = validateTransaction(tx);

      if (validationErrors.length > 0) {
        errors.push({ row: i + 1, message: validationErrors.join('; ') });
        skipped++;
        continue;
      }

      tx.status = 'valid';
      transactions.push(tx);
    } catch (err) {
      errors.push({ row: i + 1, message: String(err) });
      skipped++;
    }
  }

  return { transactions, errors, skipped, vintedWarning: transactions.length > 0 };
}

/** Dispatcher: routes to the correct parser based on file extension. */
export async function parseFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    return parseVintedHtml(file);
  }
  return parseCsvFile(file);
}
