import type { Nano } from './hashrate.js';

export interface WeightedCandidate {
  competitorId: string;
  weight: Nano;
}

export interface DrawAudit {
  total: string;
  /** Random integer in [0, total) that selected the winner. */
  roll: string;
  /** Cumulative upper bounds per candidate, in candidate order. */
  cumulative: { competitorId: string; weight: string; upTo: string }[];
}

export interface DrawResult {
  winnerId: string | null;
  reason?: 'no-candidates' | 'zero-total';
  audit: DrawAudit;
}

/** Random integer in [0, max). Default uses Web Crypto (available in Node >= 19 and browsers). */
export type Rng = (max: bigint) => bigint;

export const cryptoRng: Rng = (max) => {
  if (max <= 0n) throw new Error('max must be > 0');
  const bits = max.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const limit = 1n << BigInt(bytes * 8);
  const reject = limit - (limit % max); // rejection sampling, no modulo bias
  const buf = new Uint8Array(bytes);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    let v = 0n;
    for (const b of buf) v = (v << 8n) | BigInt(b);
    if (v < reject) return v % max;
  }
};

/** Weighted draw proportional to each candidate's weight (its share of the total). */
export function weightedDraw(candidates: WeightedCandidate[], rng: Rng = cryptoRng): DrawResult {
  const positive = candidates.filter((c) => c.weight > 0n);
  const total = positive.reduce((s, c) => s + c.weight, 0n);
  const cumulative: DrawAudit['cumulative'] = [];
  if (candidates.length === 0) {
    return { winnerId: null, reason: 'no-candidates', audit: { total: '0', roll: '0', cumulative } };
  }
  if (total === 0n) {
    return { winnerId: null, reason: 'zero-total', audit: { total: '0', roll: '0', cumulative } };
  }
  const roll = rng(total);
  let acc = 0n;
  let winnerId: string | null = null;
  for (const c of positive) {
    acc += c.weight;
    cumulative.push({ competitorId: c.competitorId, weight: c.weight.toString(), upTo: acc.toString() });
    if (winnerId === null && roll < acc) winnerId = c.competitorId;
  }
  return { winnerId, audit: { total: total.toString(), roll: roll.toString(), cumulative } };
}

export interface PrizeDef {
  id: string;
  label: string;
  /** Rank 1 = biggest prize, drawn first. */
  rank: number;
}

export interface PrizeAward {
  prizeId: string;
  winnerId: string | null;
  reason?: DrawResult['reason'];
  audit: DrawAudit;
}

/**
 * Successive weighted draws, biggest prize first. Each winner leaves the pool of
 * candidates for the following prizes (max 1 prize per competitor per series);
 * shares are renormalised among the remaining candidates by construction.
 */
export function drawPrizeSeries(prizes: PrizeDef[], candidates: WeightedCandidate[], rng: Rng = cryptoRng): PrizeAward[] {
  const ordered = [...prizes].sort((a, b) => a.rank - b.rank);
  let remaining = [...candidates];
  const awards: PrizeAward[] = [];
  for (const prize of ordered) {
    const res = weightedDraw(remaining, rng);
    awards.push({ prizeId: prize.id, winnerId: res.winnerId, reason: res.reason, audit: res.audit });
    if (res.winnerId) remaining = remaining.filter((c) => c.competitorId !== res.winnerId);
  }
  return awards;
}
