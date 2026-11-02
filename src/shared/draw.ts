/** Random integer in [0, max). */
export type Rng = (max: number) => number;

/** Web Crypto with rejection sampling, so every TH has exactly the same chance. */
export const cryptoRng: Rng = (max) => {
  if (!Number.isSafeInteger(max) || max <= 0) throw new Error('max must be a positive safe integer');
  const limit = 2 ** 48;
  const reject = limit - (limit % max);
  const buf = new Uint8Array(6);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    let v = 0;
    for (const b of buf) v = v * 256 + b;
    if (v < reject) return v % max;
  }
};

export interface Candidate {
  id: string;
  hashrate: number;
}

/**
 * Proof-of-work lottery: each candidate wins with probability hashrate / total,
 * exactly like a miner's chance of finding the next block. Hashrates are rounded
 * to whole TH, which is the unit of the draw.
 */
export function drawWinner(candidates: Candidate[], rng: Rng = cryptoRng): { winnerId: string | null; total: number; roll: number } {
  const positive = candidates.map((c) => ({ id: c.id, w: Math.max(0, Math.round(c.hashrate)) })).filter((c) => c.w > 0);
  const total = positive.reduce((s, c) => s + c.w, 0);
  if (total === 0) return { winnerId: null, total: 0, roll: 0 };
  const roll = rng(total);
  let acc = 0;
  for (const c of positive) {
    acc += c.w;
    if (roll < acc) return { winnerId: c.id, total, roll };
  }
  return { winnerId: positive[positive.length - 1].id, total, roll };
}

/** A block hash that looks like one: leading zeros, then random hex. */
export function fakeBlockHash(): string {
  const b = new Uint8Array(27);
  globalThis.crypto.getRandomValues(b);
  return '0000000000' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
