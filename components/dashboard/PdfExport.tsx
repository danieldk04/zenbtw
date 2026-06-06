'use client';

import { Button } from '@/components/ui/button';
import type { TaxSummary } from '../../domain/tax/TaxCalculationService';
import type { Transaction } from '../../domain/transactions/Transaction';

interface PdfExportProps {
  summary: TaxSummary;
  transactions: Transaction[];
}

export function PdfExport({ summary, transactions }: PdfExportProps) {
  async function handleExport() {
    // Dynamic import to avoid SSR issues
    const jspdf = await import('jspdf');
    const jsPDF = jspdf.jsPDF ?? (jspdf as unknown as { default: typeof jspdf.jsPDF }).default;
    const doc = new jsPDF();

    const now = new Date();
    const dateStr = now.toLocaleDateString('nl-NL');

    // Header
    doc.setFontSize(18);
    doc.text('KOR Omzetrapportage', 20, 20);
    doc.setFontSize(11);
    doc.text(`Gegenereerd op: ${dateStr}`, 20, 30);
    doc.text('Belastingdienst — Kleineondernemersregeling', 20, 37);

    // Horizontal line
    doc.setLineWidth(0.5);
    doc.line(20, 42, 190, 42);

    // KOR Summary
    doc.setFontSize(13);
    doc.text('KOR Samenvatting', 20, 52);
    doc.setFontSize(10);

    const { threshold, yearToDate, transactionCount } = summary;
    const rows = [
      ['Jaaromzet (ex. BTW)', `€${yearToDate.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`],
      ['KOR-grens', '€20.000,00'],
      ['Benutting', `${threshold.percentUsed.toFixed(1)}%`],
      ['Resterende ruimte', `€${threshold.remaining.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`],
      ['Status', threshold.status.toUpperCase()],
      ['Aantal transacties', String(transactionCount)],
    ];

    let y = 62;
    for (const [label, value] of rows) {
      doc.text(label + ':', 20, y);
      doc.text(value, 110, y);
      y += 8;
    }

    // OSS Summary
    y += 5;
    doc.setFontSize(13);
    doc.text('OSS BTW per Land (rollend jaar)', 20, y);
    y += 10;
    doc.setFontSize(9);
    doc.text('Land', 20, y);
    doc.text('Netto', 70, y);
    doc.text('BTW', 110, y);
    doc.text('Bruto', 150, y);
    y += 5;
    doc.line(20, y, 190, y);
    y += 5;

    for (const [code, data] of Object.entries(summary.ossQuarter.vatByCountry)) {
      doc.text(`${code} — ${data.country.name}`, 20, y);
      doc.text(`€${data.net.toFixed(2)}`, 70, y);
      doc.text(`€${data.vat.toFixed(2)} (${data.country.digitalServicesRate}%)`, 110, y);
      doc.text(`€${data.gross.toFixed(2)}`, 150, y);
      y += 7;
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    }

    // Transaction list
    doc.addPage();
    doc.setFontSize(13);
    doc.text('Transacties (dit kalenderjaar)', 20, 20);
    doc.setFontSize(8);
    y = 30;
    doc.text('Datum', 20, y);
    doc.text('Omschrijving', 50, y);
    doc.text('EUR', 140, y);
    doc.text('Status', 165, y);
    y += 4;
    doc.line(20, y, 190, y);
    y += 5;

    const yearStart = new Date(now.getFullYear(), 0, 1);
    const ytdTx = transactions
      .filter((t) => new Date(t.date) >= yearStart && t.status !== 'cancelled')
      .slice(0, 100); // Cap at 100 for PDF size

    for (const tx of ytdTx) {
      const dateStr2 = new Date(tx.date).toLocaleDateString('nl-NL');
      const desc = tx.description.slice(0, 40);
      const amount = `€${tx.amountEur.toFixed(2)}`;
      doc.text(dateStr2, 20, y);
      doc.text(desc, 50, y);
      doc.text(amount, 140, y);
      doc.text(tx.status, 165, y);
      y += 6;
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
    }

    doc.save(`KOR-rapport-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.pdf`);
  }

  return (
    <Button onClick={handleExport} variant="outline" className="gap-2">
      <span>📄</span> Export naar PDF (Belastingdienst)
    </Button>
  );
}
