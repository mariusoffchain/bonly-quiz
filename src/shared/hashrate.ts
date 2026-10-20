// Hashrate arithmetic. All game hashrates are fictitious and expressed in TH/s,
// stored as BigInt nano-TH/s (1 TH/s = 1e9 nano) so that the halving speed bonuses
// (1 % / 2^n) stay exact and rounding is explicit.

export type Nano = bigint;
export const NANO_PER_THS = 1_000_000_000n;

/** A percentage expressed as an exact fraction num/den (e.g. 2.1 % = 21/10). */
export interface Percent {
  num: bigint;
  den: bigint;
}

export const pct = (num: number | bigint, den: number | bigint = 1n): Percent => ({
  num: BigInt(num),
  den: BigInt(den),
});

/** Parse a decimal string such as "2.1" or "0.125" into an exact Percent. */
export function parsePercent(text: string): Percent {
  const m = /^\s*(-?)(\d+)(?:\.(\d+))?\s*$/.exec(text);
  if (!m) throw new Error(`Invalid percent: ${text}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const frac = m[3] ?? '';
  const den = 10n ** BigInt(frac.length);
  return { num: sign * BigInt(m[2] + frac), den };
}

export function percentToString(p: Percent): string {
  // exact when den is a power of 2 or 10 within reason; fall back to decimal approx.
  const scaled = (p.num * 10n ** 12n) / p.den;
  const s = scaled.toString().padStart(13, '0');
  const int = s.slice(0, -12);
  const frac = s.slice(-12).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** Integer division rounded half up (towards +infinity on .5). */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('division by zero');
  if (b < 0n) {
    a = -a;
    b = -b;
  }
  const twice = 2n * a + b;
  // floor division for possibly negative numerator
  const q = twice / (2n * b);
  const r = twice % (2n * b);
  return r < 0n ? q - 1n : q;
}

export function thsToNano(ths: number | string): Nano {
  const text = typeof ths === 'number' ? ths.toString() : ths;
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(text);
  if (!m) throw new Error(`Invalid TH/s value: ${text}`);
  const frac = (m[2] ?? '').padEnd(9, '0').slice(0, 9);
  return BigInt(m[1]) * NANO_PER_THS + BigInt(frac || '0');
}

/** Apply a percentage to an amount: amount * p / 100, rounded half up to the nano. */
export function applyPercent(amount: Nano, p: Percent): Nano {
  return divRoundHalfUp(amount * p.num, 100n * p.den);
}

/** Human formatting of a nano amount: "103.00 TH/s", "0.0078 TH/s". */
export function formatThs(n: Nano, opts: { unit?: boolean; maxFrac?: number } = {}): string {
  const unit = opts.unit ?? true;
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / NANO_PER_THS;
  const frac = abs % NANO_PER_THS;
  let fracStr = frac.toString().padStart(9, '0');
  const maxFrac = opts.maxFrac ?? (int >= 1000n ? 0 : int >= 100n ? 1 : 2);
  // Round the displayed fraction to maxFrac digits using the exact value.
  const scale = 10n ** BigInt(9 - maxFrac);
  const roundedTotal = divRoundHalfUp(abs, scale); // in units of 10^-maxFrac
  const unitDiv = 10n ** BigInt(maxFrac);
  const rInt = roundedTotal / unitDiv;
  const rFrac = roundedTotal % unitDiv;
  fracStr = maxFrac > 0 ? '.' + rFrac.toString().padStart(maxFrac, '0') : '';
  const intStr = rInt.toLocaleString('fr-FR').replace(/ | /g, ' ');
  return `${neg ? '-' : ''}${intStr}${fracStr}${unit ? ' TH/s' : ''}`;
}

/** Share of total as a number in [0,1] for display purposes only. */
export function shareOf(part: Nano, total: Nano): number {
  if (total <= 0n) return 0;
  return Number((part * 1_000_000n) / total) / 1_000_000;
}

export const nanoToJSON = (n: Nano): string => n.toString();
export const nanoFromJSON = (s: string | number | bigint): Nano => BigInt(s);
