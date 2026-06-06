'use client';

import { useCallback, useEffect, useState } from 'react';
import { KorWidget } from '../components/dashboard/KorWidget';
import { TransactionTable } from '../components/dashboard/TransactionTable';
import { CsvUpload } from '../components/dashboard/CsvUpload';
import { PdfExport } from '../components/dashboard/PdfExport';
import { transactionAppService } from '../application/services/TransactionApplicationService';
import type { TaxSummary } from '../domain/tax/TaxCalculationService';
import type { Transaction, TransactionStatus } from '../domain/transactions/Transaction';

export default function DashboardPage() {
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const refresh = useCallback(() => {
    setTransactions(transactionAppService.getAll());
    setSummary(transactionAppService.getSummary());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleImport(file: File) {
    const result = await transactionAppService.importCsv(file);
    refresh();
    return result;
  }

  function handleUpdateStatus(id: string, status: TransactionStatus) {
    transactionAppService.updateStatus(id, status);
    refresh();
  }

  function handleUpdateCountry(id: string, countryCode: string) {
    transactionAppService.updateCountry(id, countryCode);
    refresh();
  }

  function handleDelete(id: string) {
    transactionAppService.delete(id);
    refresh();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ZenBTW Dashboard</h1>
            <p className="text-sm text-muted-foreground">Kleineondernemersregeling · BTW-monitor</p>
          </div>
          {summary && (
            <PdfExport summary={summary} transactions={transactions} />
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {summary ? (
          <KorWidget
            threshold={summary.threshold}
            transactionCount={summary.transactionCount}
            yearToDateTotal={summary.yearToDateTotal}
          />
        ) : (
          <div className="animate-pulse h-48 bg-white rounded-lg border" />
        )}

        {/* OSS-drempel status banner */}
        {summary && (
          <div className={`rounded-md border px-4 py-3 text-sm ${
            summary.ossQuarter.ossThresholdExceeded
              ? 'bg-amber-50 border-amber-300 text-amber-800'
              : 'bg-green-50 border-green-200 text-green-800'
          }`}>
            <span className="font-semibold">EU-afstandsverkopen:</span>{' '}
            €{summary.ossQuarter.euDistanceSalesTotal.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / €10.000
            {summary.ossQuarter.ossThresholdExceeded
              ? ' — OSS-drempel overschreden. Buitenlandse EU-omzet wordt via OSS aangegeven.'
              : ' — Onder de €10.000-drempel. Buitenlandse EU-omzet telt mee voor de Nederlandse KOR-teller.'}
          </div>
        )}

        {summary && Object.keys(summary.ossQuarter.vatByCountry).length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-2">OSS BTW per Land</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {Object.entries(summary.ossQuarter.vatByCountry).map(([code, data]) => (
                <div key={code} className="bg-white dark:bg-gray-900 rounded-lg border p-3 text-sm">
                  <p className="font-semibold">{code} — {data.country.name}</p>
                  <p className="text-muted-foreground text-xs">{data.country.digitalServicesRate}% BTW</p>
                  <p className="mt-1 font-medium">€{data.vat.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">BTW afdracht (uit bruto)</p>
                  <p className="text-xs text-muted-foreground">Netto: €{data.net.toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="text-lg font-semibold mb-2">Transacties importeren</h2>
          <CsvUpload onImport={handleImport} />
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Transacties</h2>
          <TransactionTable
            transactions={transactions}
            onUpdateStatus={handleUpdateStatus}
            onUpdateCountry={handleUpdateCountry}
            onDelete={handleDelete}
          />
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-4 text-center text-xs text-muted-foreground border-t mt-8">
        KORtax MVP · Data opgeslagen lokaal · Geen gegevens verstuurd
      </footer>
    </div>
  );
}
