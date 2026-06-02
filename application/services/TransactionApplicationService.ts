/**
 * TransactionApplicationService — Orchestrates domain logic with infrastructure.
 * This is the entry point for all transaction-related use cases.
 */

'use client';

import { agentDb } from '../../infrastructure/agentdb/AgentDbAdapter';
import { parseFile, type ParseResult } from '../../infrastructure/csv/CsvParser';
import { TaxCalculationService } from '../../domain/tax/TaxCalculationService';
import { validateTransaction } from '../../domain/transactions/Transaction';
import type { Transaction } from '../../domain/transactions/Transaction';
import type { TaxSummary } from '../../domain/tax/TaxCalculationService';

const taxService = new TaxCalculationService();

export const transactionAppService = {
  /** Import transactions from a CSV or Vinted HTML file */
  async importCsv(file: File): Promise<ParseResult> {
    const result = await parseFile(file);
    if (result.transactions.length > 0) {
      agentDb.bulkInsert(result.transactions);
    }
    return result;
  },

  /** Get current tax summary */
  getSummary(): TaxSummary {
    const transactions = agentDb.getAll();
    return taxService.calculateSummary(transactions);
  },

  /** Get all transactions */
  getAll(): Transaction[] {
    return agentDb.getAll().sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  },

  /** Update a transaction's status */
  updateStatus(id: string, status: Transaction['status']): void {
    const all = agentDb.getAll();
    const tx = all.find((t) => t.id === id);
    if (tx) {
      agentDb.upsert({ ...tx, status });
    }
  },

  /** Validate a transaction and update its status */
  validate(id: string): string[] {
    const all = agentDb.getAll();
    const tx = all.find((t) => t.id === id);
    if (!tx) return ['Transactie niet gevonden'];
    const errors = validateTransaction(tx);
    agentDb.upsert({ ...tx, status: errors.length === 0 ? 'valid' : 'flagged' });
    return errors;
  },

  /** Update a transaction's country code */
  updateCountry(id: string, countryCode: string): void {
    const all = agentDb.getAll();
    const tx = all.find((t) => t.id === id);
    if (tx) {
      agentDb.upsert({ ...tx, countryCode: countryCode.toUpperCase().trim() || undefined });
    }
  },

  /** Delete a transaction */
  delete(id: string): void {
    agentDb.delete(id);
  },

  /** Clear all transactions (for testing) */
  clear(): void {
    agentDb.clear();
  },
};
