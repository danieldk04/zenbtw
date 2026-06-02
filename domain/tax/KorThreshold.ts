/**
 * KOR (Kleineondernemersregeling) threshold value object.
 * Encapsulates all threshold-related business rules.
 */

export const KOR_LIMIT = 20_000;       // €20,000 — KOR eligibility ceiling
export const KOR_BUFFER_START = 18_000; // €18,000 — buffer zone warning trigger
export const KOR_CRITICAL_START = 19_500; // €19,500 — critical alert trigger

export type ThresholdStatus = 'safe' | 'buffer' | 'critical' | 'exceeded';

export interface ThresholdResult {
  status: ThresholdStatus;
  totalTurnover: number;
  remaining: number;
  percentUsed: number;
  message: string;
}

export function evaluateKorThreshold(totalTurnoverEur: number): ThresholdResult {
  const remaining = Math.max(0, KOR_LIMIT - totalTurnoverEur);
  const percentUsed = Math.min(100, (totalTurnoverEur / KOR_LIMIT) * 100);

  if (totalTurnoverEur >= KOR_LIMIT) {
    return {
      status: 'exceeded',
      totalTurnover: totalTurnoverEur,
      remaining: 0,
      percentUsed: 100,
      message: 'KOR-grens overschreden! BTW-plicht actief vanaf overschrijding.',
    };
  }

  if (totalTurnoverEur >= KOR_CRITICAL_START) {
    return {
      status: 'critical',
      totalTurnover: totalTurnoverEur,
      remaining,
      percentUsed,
      message: `Kritiek: nog €${remaining.toFixed(2)} ruimte. Overweeg nieuwe verkopen te pauzeren.`,
    };
  }

  if (totalTurnoverEur >= KOR_BUFFER_START) {
    return {
      status: 'buffer',
      totalTurnover: totalTurnoverEur,
      remaining,
      percentUsed,
      message: `Let op: bufferzone bereikt. Nog €${remaining.toFixed(2)} tot KOR-grens.`,
    };
  }

  return {
    status: 'safe',
    totalTurnover: totalTurnoverEur,
    remaining,
    percentUsed,
    message: `KOR actief. Nog €${remaining.toFixed(2)} beschikbaar.`,
  };
}
