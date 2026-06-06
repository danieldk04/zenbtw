/**
 * AgentDbAdapter — Local persistence using localStorage as MVP backend.
 * Designed to be swapped for a real AgentDB HNSW store in production.
 */

import type { Transaction } from '../../domain/transactions/Transaction';

const STORAGE_KEY = 'kortax_transactions';

export class AgentDbAdapter {
  private memoryStore: Transaction[] = [];
  private isClient = typeof window !== 'undefined';

  private load(): Transaction[] {
    if (!this.isClient) return this.memoryStore;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Transaction[]) : [];
    } catch {
      return [];
    }
  }

  private save(transactions: Transaction[]): void {
    if (!this.isClient) {
      this.memoryStore = transactions;
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }

  getAll(): Transaction[] {
    return this.load();
  }

  upsert(transaction: Transaction): void {
    const all = this.load();
    const idx = all.findIndex((t) => t.id === transaction.id);
    if (idx >= 0) {
      all[idx] = transaction;
    } else {
      all.push(transaction);
    }
    this.save(all);
  }

  bulkInsert(transactions: Transaction[]): void {
    const existing = this.load();
    const merged = [...existing];
    for (const tx of transactions) {
      const idx = merged.findIndex((t) => t.id === tx.id);
      if (idx >= 0) {
        merged[idx] = tx;
      } else {
        merged.push(tx);
      }
    }
    this.save(merged);
  }

  delete(id: string): void {
    const all = this.load().filter((t) => t.id !== id);
    this.save(all);
  }

  clear(): void {
    this.save([]);
  }

  /** Simple text search over description field */
  search(query: string): Transaction[] {
    const q = query.toLowerCase();
    return this.load().filter((t) => t.description.toLowerCase().includes(q));
  }
}

// Singleton instance
export const agentDb = new AgentDbAdapter();
