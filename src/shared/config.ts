export type Difficulty = 'easy' | 'intermediate' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'intermediate', 'hard', 'expert'];

/** Session settings. Every value can be changed from the console while the game is in the lobby. */
export interface SessionConfig {
  /** Number of questions played from the pack (the first N, in order). */
  questionCount: number;
  /** Countdown per question, unless the question sets its own durationMs. */
  questionDurationMs: number;
  /** TH/s earned for a correct answer, by difficulty. */
  baseGainThs: Record<Difficulty, number>;
  /** Speed bonus for an instant answer, as a fraction of the base gain; decreases linearly to 0 at the buzzer. */
  speedBonusMax: number;
  /** Streak bonus per consecutive correct answer after the first, as a fraction of the base gain. */
  streakBonusStep: number;
  /** Cap of the streak bonus, as a fraction of the base gain. */
  streakBonusMax: number;
  /** Hashrate given to every player when joining. */
  startHashrateThs: number;
  /** Reveal the answer as soon as every connected player has answered. */
  closeWhenAllAnswered: boolean;
  /** Places drawn at the end (1st, 2nd, ...). A player can win only one place. */
  podiumSize: number;
  /** Length of the mining animation before the winner is revealed. */
  miningDurationMs: number;
}

export type ScoringSettings = Pick<SessionConfig, 'baseGainThs' | 'speedBonusMax' | 'streakBonusStep' | 'streakBonusMax' | 'startHashrateThs'>;

export interface Preset {
  id: string;
  name: string;
  description: string;
  scoring: ScoringSettings;
}

/**
 * Scoring profiles, compared in docs/reglages.md (npm run simulate). Gains are
 * x3 from easy to hard and x5 for expert; the base (10 or 100) does not change
 * anyone's chances, only the numbers shown.
 */
export const PRESETS: Preset[] = [
  {
    id: 'equilibre',
    name: 'Équilibré',
    description: 'Rapidité jusqu’à +50 %, série +10 % par réponse (max +50 %).',
    scoring: { baseGainThs: { easy: 100, intermediate: 200, hard: 300, expert: 500 }, speedBonusMax: 0.5, streakBonusStep: 0.1, streakBonusMax: 0.5, startHashrateThs: 0 },
  },
  {
    id: 'ouvert',
    name: 'Ouvert',
    description: 'Tout le monde part avec 1 000 TH/s, bonus divisés par deux : plus de hasard.',
    scoring: { baseGainThs: { easy: 100, intermediate: 200, hard: 300, expert: 500 }, speedBonusMax: 0.25, streakBonusStep: 0.05, streakBonusMax: 0.25, startHashrateThs: 1000 },
  },
  {
    id: 'competitif',
    name: 'Compétitif',
    description: 'Rapidité jusqu’à +100 %, série +25 % par réponse (max +200 %) : les meilleurs prennent plus d’avance.',
    scoring: { baseGainThs: { easy: 100, intermediate: 200, hard: 300, expert: 500 }, speedBonusMax: 1, streakBonusStep: 0.25, streakBonusMax: 2, startHashrateThs: 0 },
  },
];

export const DEFAULT_CONFIG: SessionConfig = {
  questionCount: 21,
  questionDurationMs: 20_000,
  ...PRESETS[0].scoring,
  closeWhenAllAnswered: true,
  podiumSize: 3,
  miningDurationMs: 8_000,
};

/** "1re", "2e", ... */
export const placeLabel = (n: number) => (n === 1 ? '1re' : `${n}e`);

export function validateConfig(c: SessionConfig): string | null {
  const nonNeg = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!Number.isInteger(c.questionCount) || c.questionCount < 1) return 'questionCount doit être un entier >= 1';
  if (!nonNeg(c.questionDurationMs) || c.questionDurationMs < 3000) return 'la durée doit être >= 3 s';
  for (const d of DIFFICULTIES) if (!nonNeg(c.baseGainThs[d])) return `gain ${d} invalide`;
  for (const k of ['speedBonusMax', 'streakBonusStep', 'streakBonusMax', 'startHashrateThs'] as const) {
    if (!nonNeg(c[k])) return `${k} invalide`;
  }
  if (!Number.isInteger(c.podiumSize) || c.podiumSize < 1 || c.podiumSize > 20) return 'le podium doit compter de 1 à 20 places';
  if (!nonNeg(c.miningDurationMs) || c.miningDurationMs > 60_000) return 'durée de minage invalide';
  return null;
}
