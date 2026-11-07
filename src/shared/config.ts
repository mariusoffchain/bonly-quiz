export type Difficulty = 'easy' | 'intermediate' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'intermediate', 'hard', 'expert'];

/** Session settings. Every value can be changed from the console while the game is in the lobby. */
export interface SessionConfig {
  /** Number of questions played from the pack (the first N, in order). */
  questionCount: number;
  /** Countdown per question, unless the question sets its own durationMs. */
  questionDurationMs: number;
  /** TH earned for a correct answer, by difficulty. */
  baseGainThs: Record<Difficulty, number>;
  /** Speed bonus of the 1st, 2nd, 3rd... correct answers received, as fractions of the base gain. */
  speedBonusRanks: number[];
  /** Streak bonus per consecutive correct answer after the first, as a fraction of the base gain. */
  streakBonusStep: number;
  /** Cap of the streak bonus, as a fraction of the base gain. */
  streakBonusMax: number;
  /**
   * Reinvestment: each correct answer also adds this fraction of the hashrate the player
   * already has, like a miner buying machines with past rewards. Compounds, so it widens
   * the gap between strong and weak players; a wrong answer loses nothing.
   */
  reinvestRate: number;
  /** Hashrate given to every player when joining. */
  startHashrateThs: number;
  /** Winners drawn at the end (1 by default; more = 1st, 2nd... place). A player can win only once. */
  podiumSize: number;
  /** Length of the mining animation before the winner is revealed. */
  miningDurationMs: number;
}

export type ScoringSettings = Pick<
  SessionConfig,
  'baseGainThs' | 'speedBonusRanks' | 'streakBonusStep' | 'streakBonusMax' | 'reinvestRate' | 'startHashrateThs'
>;

export interface Preset {
  id: string;
  name: string;
  description: string;
  scoring: ScoringSettings;
}

/**
 * Scoring profiles, compared in docs/reglages.md (npm run simulate). Gains are
 * x3 from easy to hard and x5 for expert, on a base of 10 TH; the base (10 or
 * 100) does not change anyone's chances, only the numbers shown.
 */
export const PRESETS: Preset[] = [
  {
    id: 'equilibre',
    name: 'Équilibré',
    description: 'Rapidité +10 / +5 / +2 % pour les 3 premières bonnes réponses, série +10 % par réponse (max +50 %), réinvestissement +21 %.',
    scoring: {
      baseGainThs: { easy: 10, intermediate: 20, hard: 30, expert: 50 },
      speedBonusRanks: [0.1, 0.05, 0.02],
      streakBonusStep: 0.1,
      streakBonusMax: 0.5,
      reinvestRate: 0.21,
      startHashrateThs: 0,
    },
  },
  {
    id: 'ouvert',
    name: 'Ouvert',
    description: 'Tout le monde part avec 100 TH, bonus divisés par deux, pas de réinvestissement : plus de hasard.',
    scoring: {
      baseGainThs: { easy: 10, intermediate: 20, hard: 30, expert: 50 },
      speedBonusRanks: [0.05, 0.03, 0.01],
      streakBonusStep: 0.05,
      streakBonusMax: 0.25,
      reinvestRate: 0,
      startHashrateThs: 100,
    },
  },
  {
    id: 'competitif',
    name: 'Compétitif',
    description: 'Rapidité de +10 % à +1 % pour les 10 premières bonnes réponses, série +25 % par réponse (max +200 %), réinvestissement +25 % : les meilleurs prennent beaucoup d’avance.',
    scoring: {
      baseGainThs: { easy: 10, intermediate: 20, hard: 30, expert: 50 },
      speedBonusRanks: [0.1, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01],
      streakBonusStep: 0.25,
      streakBonusMax: 2,
      reinvestRate: 0.25,
      startHashrateThs: 0,
    },
  },
];

export const DEFAULT_CONFIG: SessionConfig = {
  questionCount: 21,
  questionDurationMs: 21_000,
  ...PRESETS[0].scoring,
  podiumSize: 1,
  miningDurationMs: 8_000,
};

/** "1re", "2e", ... */
export const placeLabel = (n: number) => (n === 1 ? '1re' : `${n}e`);

export function validateConfig(c: SessionConfig): string | null {
  const nonNeg = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!Number.isInteger(c.questionCount) || c.questionCount < 1) return 'questionCount doit être un entier >= 1';
  if (!nonNeg(c.questionDurationMs) || c.questionDurationMs < 3000) return 'la durée doit être >= 3 s';
  for (const d of DIFFICULTIES) if (!nonNeg(c.baseGainThs[d])) return `gain ${d} invalide`;
  if (!Array.isArray(c.speedBonusRanks) || c.speedBonusRanks.length > 50 || !c.speedBonusRanks.every(nonNeg)) return 'bonus de rapidité invalide';
  for (const k of ['streakBonusStep', 'streakBonusMax', 'startHashrateThs'] as const) {
    if (!nonNeg(c[k])) return `${k} invalide`;
  }
  if (!nonNeg(c.reinvestRate) || c.reinvestRate > 1) return 'le réinvestissement doit être entre 0 et 100 %';
  if (!Number.isInteger(c.podiumSize) || c.podiumSize < 1 || c.podiumSize > 20) return 'le podium doit compter de 1 à 20 places';
  if (!nonNeg(c.miningDurationMs) || c.miningDurationMs > 60_000) return 'durée de minage invalide';
  return null;
}
