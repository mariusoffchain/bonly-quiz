/** "1 250 TH/s" */
export const ths = (n: number | undefined, unit = true) => `${Math.round(n ?? 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')}${unit ? ' TH/s' : ''}`;

/** "12,4 %" */
export const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits).replace('.', ',')} %`;

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export const LETTERS = ['A', 'B', 'C', 'D'];

export const difficultyLabel = { easy: 'facile', intermediate: 'moyenne', hard: 'difficile' } as const;

/** Player colours, indexed by Player.color. Distinct but muted, so the accent stays the accent. */
const PALETTE = ['#d9a25f', '#7d9fc9', '#8fb87a', '#c98aa6', '#6fb3ad', '#a593c9', '#cfc26b', '#c97f6b', '#8ab7cf', '#b5b08f', '#c7a0d6', '#9aa3a8'];
export const playerColor = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
