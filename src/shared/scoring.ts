import { applyPercent, type Nano, type Percent } from './hashrate.js';
import { speedBonusForRank, type SessionConfig } from './config.js';

export interface CorrectAnswerInput {
  competitorId: string;
  /** Reference time (ms) used for speed ranking, chosen per config.speedReference. */
  referenceAt: number;
}

export interface RankedGain {
  competitorId: string;
  rank: number; // standard competition ranking (ties share the best rank, next rank skipped)
  tied: boolean;
  bonus: Percent;
  base: Nano;
  gain: Nano;
}

/**
 * Rank correct answers by reference time and apply the degressive speed bonus to
 * the base gain only. Provisional tie rule: identical reference times share the
 * rank; the following rank is skipped (1, 1, 3, ...).
 */
export function rankCorrectAnswers(
  answers: CorrectAnswerInput[],
  base: Nano,
  config: Pick<SessionConfig, 'speedBonusHeadPercents'>,
): RankedGain[] {
  const sorted = [...answers].sort((a, b) => a.referenceAt - b.referenceAt || a.competitorId.localeCompare(b.competitorId));
  const out: RankedGain[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i].referenceAt !== sorted[i - 1].referenceAt) rank = i + 1;
    const bonus = speedBonusForRank(rank, config.speedBonusHeadPercents);
    const tied =
      (i > 0 && sorted[i - 1].referenceAt === sorted[i].referenceAt) ||
      (i + 1 < sorted.length && sorted[i + 1].referenceAt === sorted[i].referenceAt);
    out.push({ competitorId: sorted[i].competitorId, rank, tied, bonus, base, gain: base + applyPercent(base, bonus) });
  }
  return out;
}
