'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Transaction, TransactionStatus } from '../../domain/transactions/Transaction';

interface TransactionTableProps {
  transactions: Transaction[];
  onUpdateStatus: (id: string, status: TransactionStatus) => void;
  onUpdateCountry?: (id: string, countryCode: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_BADGE: Record<TransactionStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  valid: { label: 'Geldig', variant: 'default' },
  pending: { label: 'In behandeling', variant: 'secondary' },
  cancelled: { label: 'Geannuleerd', variant: 'outline' },
  flagged: { label: 'Gemarkeerd', variant: 'destructive' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('nl-NL');
  } catch {
    return iso;
  }
}

function formatEur(amount: number): string {
  return `€${amount.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function TransactionTable({ transactions, onUpdateStatus, onUpdateCountry, onDelete }: TransactionTableProps) {
  const [editingCountryId, setEditingCountryId] = useState<string | null>(null);
  const [editingCountryValue, setEditingCountryValue] = useState('');
  if (transactions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Geen transacties gevonden. Upload een CSV-bestand om te beginnen.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transacties ({transactions.length})</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Omschrijving</TableHead>
              <TableHead className="text-right">Bedrag (orig.)</TableHead>
              <TableHead className="text-right">Bedrag (EUR)</TableHead>
              <TableHead>Land</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Acties</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((tx) => {
              const statusConfig = STATUS_BADGE[tx.status];
              return (
                <TableRow key={tx.id} className={tx.status === 'flagged' ? 'bg-red-50' : ''}>
                  <TableCell className="whitespace-nowrap">{formatDate(tx.date)}</TableCell>
                  <TableCell className="max-w-xs truncate" title={tx.description}>
                    {tx.description}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {tx.currency !== 'EUR' ? (
                      <>
                        <span>{tx.amountOriginal.toFixed(2)} {tx.currency}</span>
                        <span className="text-xs text-muted-foreground ml-1">@ {tx.exchangeRate.toFixed(4)}</span>
                      </>
                    ) : (
                      formatEur(tx.amountOriginal)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">
                    {tx.type === 'refund' ? (
                      <span className="text-red-600">-{formatEur(tx.amountEur)}</span>
                    ) : (
                      formatEur(tx.amountEur)
                    )}
                  </TableCell>
                  <TableCell>
                    {onUpdateCountry && editingCountryId === tx.id ? (
                      <input
                        autoFocus
                        className="w-14 rounded border px-1 py-0.5 text-xs uppercase"
                        maxLength={2}
                        value={editingCountryValue}
                        onChange={(e) => setEditingCountryValue(e.target.value.toUpperCase())}
                        onBlur={() => {
                          if (editingCountryValue.length === 2) {
                            onUpdateCountry(tx.id, editingCountryValue);
                          }
                          setEditingCountryId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editingCountryValue.length === 2) {
                            onUpdateCountry(tx.id, editingCountryValue);
                            setEditingCountryId(null);
                          } else if (e.key === 'Escape') {
                            setEditingCountryId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className={onUpdateCountry ? 'cursor-pointer hover:underline' : ''}
                        title={onUpdateCountry ? 'Klik om land te bewerken' : undefined}
                        onClick={() => {
                          if (onUpdateCountry) {
                            setEditingCountryId(tx.id);
                            setEditingCountryValue(tx.countryCode ?? '');
                          }
                        }}
                      >
                        {tx.countryCode ?? '—'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {tx.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onUpdateStatus(tx.id, 'valid')}
                          className="text-xs"
                        >
                          Valideer
                        </Button>
                      )}
                      {tx.status === 'flagged' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onUpdateStatus(tx.id, 'valid')}
                          className="text-xs"
                        >
                          Herstel
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(tx.id)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        ✕
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
