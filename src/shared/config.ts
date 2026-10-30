export type Difficulty = 'easy' | 'intermediate' | 'hard';

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
  /** A player who already found a block cannot find another one. */
  excludeBlockWinners: boolean;
  /** Length of the mining animation before the winner is revealed. */
  miningDurationMs: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  questionCount: 21,
  questionDurationMs: 20_000,
  baseGainThs: { easy: 100, intermediate: 150, hard: 200 },
  speedBonusMax: 0.5,
  streakBonusStep: 0.1,
  streakBonusMax: 0.5,
  startHashrateThs: 0,
  closeWhenAllAnswered: true,
  excludeBlockWinners: true,
  miningDurationMs: 8_000,
};

export function validateConfig(c: SessionConfig): string | null {
  const nonNeg = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!Number.isInteger(c.questionCount) || c.questionCount < 1) return 'questionCount doit être un entier >= 1';
  if (!nonNeg(c.questionDurationMs) || c.questionDurationMs < 3000) return 'la durée doit être >= 3 s';
  for (const d of ['easy', 'intermediate', 'hard'] as const) if (!nonNeg(c.baseGainThs[d])) return `gain ${d} invalide`;
  for (const k of ['speedBonusMax', 'streakBonusStep', 'streakBonusMax', 'startHashrateThs'] as const) {
    if (!nonNeg(c[k])) return `${k} invalide`;
  }
  if (!nonNeg(c.miningDurationMs) || c.miningDurationMs > 60_000) return 'durée de minage invalide';
  return null;
}
