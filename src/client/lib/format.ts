import { formatThs, nanoFromJSON } from '../../shared/hashrate';

export const ths = (nano: string | undefined, opts?: { unit?: boolean; maxFrac?: number }) => formatThs(nanoFromJSON(nano ?? '0'), opts);
export const pctText = (share: number, digits = 1) => `${(share * 100).toFixed(digits).replace('.', ',')} %`;

import type { Avatar } from '../../shared/types';

/** Colour palette inspired by the pool colours of mining dashboards; index assigned by the server. */
const PALETTE = ['#007cfa', '#eba814', '#0aab2f', '#e83e8c', '#00ddff', '#ff9f00', '#9339f4', '#83fd00', '#ff3d00', '#fff000', '#2055e3', '#6225b2', '#d5a90a', '#1d486f', '#6f1d5d', '#116761'];
const SHAPES = ['◆', '●', '■', '▲', '★', '⬢', '♦', '✦', '⬟', '▼'];
export function colorFor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
export function avatarColor(a: Avatar | undefined): string {
  return colorFor(a?.color ?? 0);
}
export function avatarShape(a: Avatar | undefined): string {
  return SHAPES[((a?.shape ?? 0) % SHAPES.length + SHAPES.length) % SHAPES.length];
}
export const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank));

export const difficultyLabel: Record<string, string> = { easy: 'Facile', intermediate: 'Intermédiaire', hard: 'Difficile' };

export function timeAgo(unixSeconds: number, nowMs: number): string {
  const s = Math.max(0, Math.floor(nowMs / 1000 - unixSeconds));
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h ${m % 60} min`;
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
