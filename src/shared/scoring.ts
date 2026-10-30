import type { SessionConfig } from './config.js';
import type { Answer, Question, QuestionResult } from './types.js';

/**
 * Gain of one player on one question.
 * - correct answer: base gain of the question's difficulty;
 * - speed: up to `speedBonusMax` × base for an instant answer, 0 at the buzzer;
 * - streak: `streakBonusStep` × base per consecutive correct answer after the first, capped.
 * A wrong or missing answer earns nothing and resets the streak. No penalty.
 */
export function scoreAnswer(
  q: Pick<Question, 'difficulty' | 'correctIndex'>,
  answer: Answer | undefined,
  timing: { openedAt: number; durationMs: number },
  streakBefore: number,
  config: Pick<SessionConfig, 'baseGainThs' | 'speedBonusMax' | 'streakBonusStep' | 'streakBonusMax'>,
): QuestionResult {
  const ms = answer ? Math.max(0, answer.at - timing.openedAt) : undefined;
  if (!answer || answer.option !== q.correctIndex) {
    return { option: answer?.option ?? null, correct: false, ms, base: 0, speedBonus: 0, streakBonus: 0, gain: 0, streak: 0 };
  }
  const base = config.baseGainThs[q.difficulty];
  const remaining = Math.min(1, Math.max(0, 1 - (ms ?? 0) / timing.durationMs));
  const speedBonus = Math.round(base * config.speedBonusMax * remaining);
  const streak = streakBefore + 1;
  const streakBonus = Math.round(base * Math.min(config.streakBonusMax, config.streakBonusStep * (streak - 1)));
  return { option: answer.option, correct: true, ms, base, speedBonus, streakBonus, gain: base + speedBonus + streakBonus, streak };
}

/** Streak bonus percentage a player would get on their next correct answer. */
export function nextStreakPercent(streak: number, config: Pick<SessionConfig, 'streakBonusStep' | 'streakBonusMax'>): number {
  return Math.round(100 * Math.min(config.streakBonusMax, config.streakBonusStep * streak));
}
