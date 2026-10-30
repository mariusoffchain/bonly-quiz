import { pct, type Percent } from './hashrate.js';

export type Difficulty = 'easy' | 'intermediate' | 'hard';

/**
 * Session configuration. Every value marked "provisional" implements an open
 * point of the spec with an explicit default; change it from the console or in
 * `data/<session>.json` without touching the engine.
 */
export interface SessionConfig {
  /** Base gain in TH/s for a correct answer, by difficulty (validated provisionally: 10/50/100). */
  baseGainThs: Record<Difficulty, string>;
  /** Default countdown per question in ms (provisional 10 s). Each question may override. */
  defaultQuestionDurationMs: number;
  /** Starting hashrate allocated once at registration, in TH/s (open point, provisional 10). */
  initialHashrateThs: string;
  /**
   * Timestamp used for the speed ranking when an answer was modified (open point).
   * 'last' = server time of the last modification (provisional default), 'first' = first answer.
   */
  speedReference: 'last' | 'first';
  /** Bonus percentage per rank among correct answers; ranks beyond the list keep halving. */
  speedBonusHeadPercents: string[]; // provisional: ["3", "2", "1"], then 0.5, 0.25, ...
  /** Block bonus percentage (decided: 2.1). */
  blockBonusPercent: string;
  /**
   * Base of the block bonus (open point). 'own' = 2.1 % of the winner's current hashrate
   * (provisional default); 'total' = 2.1 % of the total game hashrate, credited to the winner.
   */
  blockBonusBase: 'own' | 'total';
  /**
   * Weights used for the final prize draws. 'round' = cumulative balance after a completed round; legacy 'sumOfRounds' requests use the latest selected snapshot.
   */
  prizeScope: 'round' | 'sumOfRounds';
  /** Exclude previous prize winners from later prize series (open point, provisional false). */
  excludePrizeWinnersAcrossSeries: boolean;
  /** Minimum members for a classic pool (decided: 3). */
  minPoolMembers: number;
  /** Duration of the personal result screen after a question closes (UI only). */
  revealHoldMs: number;
  /** Duration of the ranking screen shown after the result screen (UI only, 0 disables). */
  leaderboardHoldMs: number;
}

export const DEFAULT_CONFIG: SessionConfig = {
  baseGainThs: { easy: '10', intermediate: '50', hard: '100' },
  defaultQuestionDurationMs: 10_000,
  initialHashrateThs: '10',
  speedReference: 'last',
  speedBonusHeadPercents: ['3', '2', '1'],
  blockBonusPercent: '2.1',
  blockBonusBase: 'own',
  prizeScope: 'round',
  excludePrizeWinnersAcrossSeries: false,
  minPoolMembers: 3,
  revealHoldMs: 4000,
  leaderboardHoldMs: 15000,
};

/** Speed bonus for a 1-based rank, as an exact Percent. */
export function speedBonusForRank(rank: number, head: string[] = DEFAULT_CONFIG.speedBonusHeadPercents): Percent {
  if (rank < 1) throw new Error('rank must be >= 1');
  if (rank <= head.length) return parseHeadPercent(head[rank - 1]);
  // After the head: last head value halved once per extra rank.
  const last = parseHeadPercent(head[head.length - 1]);
  const extra = BigInt(rank - head.length);
  return { num: last.num, den: last.den * 2n ** extra };
}

function parseHeadPercent(text: string): Percent {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`Invalid percent ${text}`);
  const frac = m[2] ?? '';
  return pct(BigInt(m[1] + frac), 10n ** BigInt(frac.length));
}
