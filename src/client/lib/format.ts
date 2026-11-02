/** "1 250 TH" (terahashes) */
export const ths = (n: number | undefined, unit = true) => `${Math.round(n ?? 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')}${unit ? ' TH' : ''}`;

/** "12,4 %" */
export const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits).replace('.', ',')} %`;

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export const LETTERS = ['A', 'B', 'C', 'D'];

export const difficultyLabel = { easy: 'facile', intermediate: 'moyenne', hard: 'difficile', expert: 'expert' } as const;

export { placeLabel } from '../../shared/config';

/** Player colours, indexed by Player.color: the orange, mauve, gold and mountain tones of the B-Only site, then neutrals. */
const PALETTE = ['#f6751b', '#955c6b', '#c49b55', '#c2405a', '#3d5a80', '#e3a8b7', '#6b7d4f', '#7a4e9c', '#3a3a3a', '#d98b5f', '#4f8a8b', '#a8573f'];
export const playerColor = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
