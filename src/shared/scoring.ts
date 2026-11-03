import type { SessionConfig } from './config.js';
import type { Answer, Question, QuestionResult } from './types.js';

/** Gains are kept to a tenth of TH: +10 % of a 10 TH question is 1 TH, +5 % is 0,5 TH. */
export const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Gain of one player on one question.
 * - correct answer: base gain of the question's difficulty;
 * - speed: the 1st, 2nd, 3rd... correct answers received by the server get
 *   `speedBonusRanks[0]`, `[1]`, `[2]`... × base; the others nothing;
 * - streak: `streakBonusStep` × base per consecutive correct answer after the first, capped;
 * - reinvestment: `reinvestRate` × the hashrate held before this question.
 * A wrong or missing answer earns nothing and resets the streak. No penalty.
 *
 * `speedRank` is the 0-based rank of this answer among the question's correct answers.
 */
export function scoreAnswer(
  q: Pick<Question, 'difficulty' | 'correctIndex'>,
  answer: Answer | undefined,
  timing: { openedAt: number },
  streakBefore: number,
  config: Pick<SessionConfig, 'baseGainThs' | 'speedBonusRanks' | 'streakBonusStep' | 'streakBonusMax' | 'reinvestRate'>,
  speedRank = Infinity,
  hashrateBefore = 0,
): QuestionResult {
  const ms = answer ? Math.max(0, answer.at - timing.openedAt) : undefined;
  if (!answer || answer.option !== q.correctIndex) {
    return { option: answer?.option ?? null, correct: false, ms, base: 0, speedBonus: 0, streakBonus: 0, reinvest: 0, gain: 0, streak: 0 };
  }
  const base = config.baseGainThs[q.difficulty];
  const speedBonus = round1(base * (config.speedBonusRanks[speedRank] ?? 0));
  const streak = streakBefore + 1;
  const streakBonus = round1(base * Math.min(config.streakBonusMax, config.streakBonusStep * (streak - 1)));
  const reinvest = round1(hashrateBefore * config.reinvestRate);
  return {
    option: answer.option,
    correct: true,
    ms,
    base,
    speedBonus,
    speedRank: speedRank < config.speedBonusRanks.length ? speedRank + 1 : undefined,
    streakBonus,
    reinvest,
    gain: round1(base + speedBonus + streakBonus + reinvest),
    streak,
  };
}

/** 0-based rank of each correct answer by arrival time at the server. */
export function speedRanks(answers: Record<string, Answer>, correctIndex: number): Map<string, number> {
  const correct = Object.entries(answers)
    .filter(([, a]) => a.option === correctIndex)
    .sort(([, a], [, b]) => a.at - b.at);
  return new Map(correct.map(([id], i) => [id, i]));
}
