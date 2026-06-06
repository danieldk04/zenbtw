'use client';

import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KOR_LIMIT, KOR_BUFFER_START, type ThresholdResult } from '../../domain/tax/KorThreshold';

interface KorWidgetProps {
  threshold: ThresholdResult;
  transactionCount: number;
  yearToDateTotal: number;
}

const STATUS_CONFIG = {
  safe: {
    label: 'KOR Actief',
    variant: 'default' as const,
    barColor: 'bg-green-500',
    cardBorder: 'border-green-200',
  },
  buffer: {
    label: 'Bufferzone',
    variant: 'secondary' as const,
    barColor: 'bg-yellow-500',
    cardBorder: 'border-yellow-400',
  },
  critical: {
    label: 'Kritiek',
    variant: 'destructive' as const,
    barColor: 'bg-orange-500',
    cardBorder: 'border-orange-500',
  },
  exceeded: {
    label: 'Grens Overschreden',
    variant: 'destructive' as const,
    barColor: 'bg-red-600',
    cardBorder: 'border-red-600',
  },
};

export function KorWidget({ threshold, transactionCount, yearToDateTotal }: KorWidgetProps) {
  const config = STATUS_CONFIG[threshold.status];
  const bufferPercent = (KOR_BUFFER_START / KOR_LIMIT) * 100;

  return (
    <Card className={`border-2 ${config.cardBorder} transition-all`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">KOR Omzetmonitor</CardTitle>
        <Badge variant={config.variant}>{config.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main amounts */}
        <div className="flex justify-between items-end">
          <div>
            <p className="text-3xl font-bold">
              €{threshold.totalTurnover.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-sm text-muted-foreground">NL omzet dit jaar <span className="font-medium">(KOR-basis)</span></p>
            {yearToDateTotal > threshold.totalTurnover && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Totale EU-omzet: €{yearToDateTotal.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold text-muted-foreground">
              / €{KOR_LIMIT.toLocaleString('nl-NL')}
            </p>
            <p className="text-sm text-muted-foreground">KOR-grens</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="relative">
            <Progress
              value={threshold.percentUsed}
              className="h-4"
            />
            {/* Buffer zone marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 opacity-70"
              style={{ left: `${bufferPercent}%` }}
              title="Bufferzone €18.000"
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>€0</span>
            <span className="text-yellow-600">€18.000 (buffer)</span>
            <span>€20.000</span>
          </div>
        </div>

        {/* Status message */}
        <div className={`rounded-md p-3 text-sm font-medium ${
          threshold.status === 'safe' ? 'bg-green-50 text-green-800' :
          threshold.status === 'buffer' ? 'bg-yellow-50 text-yellow-800' :
          'bg-red-50 text-red-800'
        }`}>
          {threshold.message}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="font-semibold">{threshold.percentUsed.toFixed(1)}%</p>
            <p className="text-muted-foreground text-xs">Gebruikt</p>
          </div>
          <div>
            <p className="font-semibold">
              €{threshold.remaining.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-muted-foreground text-xs">Resterend</p>
          </div>
          <div>
            <p className="font-semibold">{transactionCount}</p>
            <p className="text-muted-foreground text-xs">Transacties</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
