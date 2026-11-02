const num = (n: number, digits: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits }).replace(/[\u202f\u00a0]/g, ' ');

/**
 * "10,5 TH" (gains are kept to a tenth of TH), then "1,25 PH" from 1 000 TH on.
 * PH always carries its unit, even where TH values are shown bare.
 */
export const ths = (n: number | undefined, unit = true) => {
  const v = n ?? 0;
  return Math.abs(v) >= 1000 ? `${num(v / 1000, 2)} PH` : `${num(v, 1)}${unit ? ' TH' : ''}`;
};

/** "+10 %, +5 %, +2 %" */
export const percents = (fractions: number[]) => fractions.map((f) => `+${pct(f, 0)}`).join(', ');

/** "12,4 %" */
export const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits).replace('.', ',')} %`;

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export const LETTERS = ['A', 'B', 'C', 'D'];

export const difficultyLabel = { easy: 'facile', intermediate: 'moyenne', hard: 'difficile', expert: 'expert' } as const;

export { placeLabel } from '../../shared/config';

/** Player colours, indexed by Player.color: the orange, mauve, gold and mountain tones of the B-Only site, then neutrals. */
const PALETTE = ['#f6751b', '#955c6b', '#c49b55', '#c2405a', '#3d5a80', '#e3a8b7', '#6b7d4f', '#7a4e9c', '#3a3a3a', '#d98b5f', '#4f8a8b', '#a8573f'];
export const playerColor = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
