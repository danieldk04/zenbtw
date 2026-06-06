/**
 * ExchangeRateService — Real-time EUR conversion using the ECB API.
 * Falls back to cached rates when offline.
 */

const ECB_API_URL =
  'https://api.exchangerate-api.com/v4/latest/EUR';

const CACHE_KEY = 'kortax_exchange_rates';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface ExchangeRatesResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

export class ExchangeRateService {
  private inMemoryCache: CachedRates | null = null;

  private loadCache(): CachedRates | null {
    if (this.inMemoryCache) return this.inMemoryCache;
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as CachedRates) : null;
    } catch {
      return null;
    }
  }

  private saveCache(rates: Record<string, number>): void {
    const cache: CachedRates = { rates, fetchedAt: Date.now() };
    this.inMemoryCache = cache;
    if (typeof window !== 'undefined') {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    }
  }

  private isCacheValid(cache: CachedRates): boolean {
    return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  }

  async getRates(): Promise<Record<string, number>> {
    const cached = this.loadCache();
    if (cached && this.isCacheValid(cached)) {
      return cached.rates;
    }

    try {
      const res = await fetch(ECB_API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ExchangeRatesResponse = await res.json();
      this.saveCache(data.rates);
      return data.rates;
    } catch (err) {
      console.warn('ExchangeRateService: fetch failed, using cached rates.', err);
      if (cached) return cached.rates;
      // Hard fallback — rough 2024 averages
      return { USD: 1.08, GBP: 0.86, CHF: 0.96, SEK: 11.2, PLN: 4.3, DKK: 7.46 };
    }
  }

  /** Convert an amount from a given currency to EUR */
  async toEur(amount: number, fromCurrency: string): Promise<{ amountEur: number; rate: number }> {
    if (fromCurrency === 'EUR') return { amountEur: amount, rate: 1 };
    const rates = await this.getRates();
    const rate = rates[fromCurrency];
    if (!rate) throw new Error(`Unknown currency: ${fromCurrency}`);
    // rates are EUR-based (1 EUR = X foreign), so divide
    const amountEur = amount / rate;
    return { amountEur, rate };
  }
}

export const exchangeRateService = new ExchangeRateService();
