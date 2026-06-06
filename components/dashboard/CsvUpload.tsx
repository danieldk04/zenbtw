'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ParseResult } from '../../infrastructure/csv/CsvParser';

interface CsvUploadProps {
  onImport: (file: File) => Promise<ParseResult>;
}

export function CsvUpload({ onImport }: CsvUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastResult, setLastResult] = useState<ParseResult | null>(null);

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.html') && !name.endsWith('.htm')) {
      alert('Alleen CSV- of Vinted HTML-bestanden zijn toegestaan.');
      return;
    }
    setIsLoading(true);
    setLastResult(null);
    try {
      const result = await onImport(file);
      setLastResult(result);
    } finally {
      setIsLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-2">
      <Card
        className={`border-2 border-dashed transition-colors cursor-pointer ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <div className="text-3xl mb-2">📂</div>
          <p className="text-sm font-medium">Sleep CSV of Vinted HTML hier of klik om te uploaden</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ondersteunt bank-, Stripe-, PayPal- en Vinted-exports
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={isLoading}
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          >
            {isLoading ? 'Verwerken...' : 'Selecteer bestand'}
          </Button>
        </CardContent>
      </Card>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.html,.htm"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      {lastResult && (
        <div className="flex gap-2 flex-wrap text-sm">
          <Badge variant="default">
            ✓ {lastResult.transactions.length} geïmporteerd
          </Badge>
          {lastResult.skipped > 0 && (
            <Badge variant="destructive">
              ✕ {lastResult.skipped} overgeslagen
            </Badge>
          )}
          {lastResult.errors.slice(0, 3).map((err) => (
            <span key={err.row} className="text-xs text-red-600">
              Rij {err.row}: {err.message}
            </span>
          ))}
        </div>
      )}
      {lastResult?.vintedWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ <strong>Vinted:</strong> De HTML-export bevat geen landgegevens. Alle orders zijn standaard op{' '}
          <strong>Nederland (NL)</strong> gezet. Controleer de Transacties-tab en pas de landen aan voor
          verkopen naar het buitenland.
        </div>
      )}
    </div>
  );
}
