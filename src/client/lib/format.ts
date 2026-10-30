/** "1 250 TH/s" */
export const ths = (n: number | undefined, unit = true) => `${Math.round(n ?? 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')}${unit ? ' TH/s' : ''}`;

/** "12,4 %" */
export const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits).replace('.', ',')} %`;

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export const LETTERS = ['A', 'B', 'C', 'D'];

export const difficultyLabel = { easy: 'Facile', intermediate: 'Moyenne', hard: 'Difficile' } as const;

/** Player colours, indexed by Player.color. */
const PALETTE = ['#f7931a', '#4c7dff', '#2fd27a', '#ff5ca8', '#19c3b1', '#b062ff', '#ffd166', '#ff6b3d', '#5ad1ff', '#9be15d', '#e86bff', '#c9a26b'];
export const playerColor = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('') || '?';
