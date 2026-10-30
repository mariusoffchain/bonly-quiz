import { describe, expect, it } from 'vitest';
import { Game } from '../src/shared/game.js';
import { speedBonusForRank } from '../src/shared/config.js';
import { applyPercent, formatThs, percentToString, thsToNano, parsePercent } from '../src/shared/hashrate.js';
import { drawPrizeSeries, weightedDraw } from '../src/shared/draw.js';
import { rankCorrectAnswers } from '../src/shared/scoring.js';
import type { BlockInfo, ContentPack } from '../src/shared/types.js';

const T = 1_000_000_000n; // 1 TH/s in nano

const content: ContentPack = {
  name: 'test',
  questions: [
    { id: 'q1', type: 'single-choice', text: 'E', options: ['a', 'b', 'c', 'd'], correctIndex: 1, difficulty: 'easy' },
    { id: 'q2', type: 'single-choice', text: 'I', options: ['a', 'b', 'c', 'd'], correctIndex: 2, difficulty: 'intermediate' },
    { id: 'q3', type: 'single-choice', text: 'H', options: ['a', 'b', 'c', 'd'], correctIndex: 0, difficulty: 'hard' },
    { id: 'q4', type: 'single-choice', text: 'E2', options: ['a', 'b'], correctIndex: 0, difficulty: 'easy' },
  ],
  rounds: [
    { id: 'r1', title: 'Manche 1', questionIds: ['q1', 'q2', 'q3'] },
    { id: 'r2', title: 'Manche 2', questionIds: ['q4'] },
  ],
};

let counter = 0;
const deps = { newId: () => `id${++counter}`, newToken: () => `tok${counter}` };

function setup(initial = '0') {
  counter = 0;
  const g = Game.create('TEST', 0, content, { initialHashrateThs: initial }, { ...deps, rng: () => 0n });
  const a = g.joinPool({ name: 'Alpha', members: ['a', 'b', 'c'] }, 1);
  const b = g.joinPool({ name: 'Bravo', members: ['d', 'e', 'f'] }, 2);
  const x = g.joinBitaxe({}, 3);
  const y = g.joinBitaxe({}, 4);
  return { g, a, b, x, y };
}

describe('hashrate math', () => {
  it('speed bonus schedule halves after rank 3 without stopping', () => {
    const p = (r: number) => percentToString(speedBonusForRank(r));
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(p)).toEqual(['3', '2', '1', '0.5', '0.25', '0.125', '0.0625', '0.03125']);
    expect(p(20)).toBe('0.000007629394'); // 1/2^17 %, truncated display of an exact fraction
  });
  it('applies +3 % to a 100 TH/s base: 103 TH/s', () => {
    const base = thsToNano(100);
    expect(base + applyPercent(base, speedBonusForRank(1))).toBe(103n * T);
    expect(formatThs(103n * T)).toBe('103.0 TH/s');
  });
  it('keeps tiny bonuses exact in nano TH/s (rank 10 on 10 TH/s)', () => {
    const base = thsToNano(10);
    const bonus = applyPercent(base, speedBonusForRank(10)); // 1/128 % of 10 TH/s = 0.00078125 TH/s
    expect(bonus).toBe(781_250n);
  });
  it('parses the 2.1 % block bonus exactly', () => {
    expect(applyPercent(1000n * T, parsePercent('2.1'))).toBe(21n * T);
  });
});

describe('speed ranking', () => {
  it('ranks by reference time with competition ranking on ties', () => {
    const base = thsToNano(100);
    const out = rankCorrectAnswers(
      [
        { competitorId: 'c', referenceAt: 300 },
        { competitorId: 'a', referenceAt: 100 },
        { competitorId: 'b', referenceAt: 100 },
        { competitorId: 'd', referenceAt: 400 },
      ],
      base,
      { speedBonusHeadPercents: ['3', '2', '1'] },
    );
    expect(out.map((g) => [g.competitorId, g.rank, g.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false],
      ['d', 4, false],
    ]);
    expect(out.map((g) => g.gain)).toEqual([103n * T, 103n * T, 101n * T, 1005n * T / 10n]);
  });
});

describe('game flow', () => {
  it('credits 10/50/100 with speed bonuses, 0 for wrong answers, no penalty, keeps gains between rounds', () => {
    const { g, a, b, x, y } = setup('0');
    g.startRound(0, 10, 100);
    // Q1 easy: a first, b second, x wrong, y silent
    g.openNextQuestion(100);
    expect(g.submitAnswer(a.id, 1, 101).accepted).toBe(true);
    expect(g.submitAnswer(b.id, 1, 102).accepted).toBe(true);
    expect(g.submitAnswer(x.id, 0, 103).accepted).toBe(true);
    const run1 = g.closeQuestion(10_100);
    expect(run1.results?.gains.map((x) => [x.competitorId, x.rank, BigInt(x.gain)])).toEqual([
      [a.id, 1, (103n * T) / 10n], // 10.3
      [b.id, 2, (102n * T) / 10n], // 10.2
    ]);
    expect(run1.results?.wrong).toEqual([x.id]);
    expect(run1.results?.silent).toEqual([y.id]);
    const r = g.round!;
    expect(r.hashrates[a.id]).toBe(((103n * T) / 10n).toString());
    expect(r.hashrates[x.id]).toBe('0');
    // Q2 intermediate: x alone correct, rank 1 => 51.5
    g.openNextQuestion(20_000);
    g.submitAnswer(x.id, 2, 20_500);
    g.submitAnswer(a.id, 0, 20_600); // wrong: no penalty
    g.closeQuestion(30_000);
    expect(r.hashrates[x.id]).toBe((515n * T / 10n).toString());
    expect(r.hashrates[a.id]).toBe(((103n * T) / 10n).toString());
    // Q3 hard: y rank 1 => 103, b rank 2 => 102
    g.openNextQuestion(40_000);
    g.submitAnswer(b.id, 0, 40_900);
    g.submitAnswer(y.id, 0, 40_100);
    g.closeQuestion(50_000);
    expect(r.hashrates[y.id]).toBe((103n * T).toString());
    expect(r.hashrates[b.id]).toBe(((102n * T) + (102n * T) / 10n).toString());
    expect(() => g.openNextQuestion(60_000)).toThrow(/no more questions/);
    g.endRound(60_000);
    expect(g.state.phase).toBe('round-ended');
    expect(r.finalHashrates).toEqual(r.hashrates);
    // Round 2 retains all earned hashrate
    g.startRound(1, 70_000, 101);
    expect(g.round!.hashrates[y.id]).toBe((103n * T).toString());
    expect(g.round!.hashrates[b.id]).toBe(r.finalHashrates![b.id]);
    expect(g.state.roundStates[0].finalHashrates![y.id]).toBe((103n * T).toString());
  });

  it('rejects answers after the server deadline and allows modification before', () => {
    const { g, a } = setup('0');
    g.startRound(0, 0, null);
    g.openNextQuestion(1000); // closes at 11000
    expect(g.submitAnswer(a.id, 0, 2000).accepted).toBe(true);
    const mod = g.submitAnswer(a.id, 1, 9000);
    expect(mod.accepted).toBe(true);
    expect(mod.record).toMatchObject({ optionIndex: 1, firstAt: 2000, lastAt: 9000, changes: 1 });
    expect(g.submitAnswer(a.id, 2, 11_000)).toEqual({ accepted: false, reason: 'closed' });
    expect(g.submitAnswer(a.id, 9, 10_000)).toEqual({ accepted: false, reason: 'bad-option' });
    g.closeQuestion(11_000);
    expect(g.submitAnswer(a.id, 1, 11_500).reason).toBe('no-open-question');
  });

  it('uses the last modification time for speed by default and the first with speedReference=first', () => {
    const { g, a, b } = setup('0');
    g.startRound(0, 0, null);
    g.openNextQuestion(1000);
    g.submitAnswer(a.id, 0, 1100); // wrong first
    g.submitAnswer(b.id, 1, 1500); // correct
    g.submitAnswer(a.id, 1, 1900); // a fixes to correct: last=1900 => rank 2
    let run = g.closeQuestion(11_000);
    expect(run.results?.gains.map((x) => [x.competitorId, x.rank])).toEqual([[b.id, 1], [a.id, 2]]);
    g.setConfig({ speedReference: 'first' }, 11_001);
    g.openNextQuestion(12_000);
    g.submitAnswer(a.id, 0, 12_100);
    g.submitAnswer(b.id, 2, 12_500);
    g.submitAnswer(a.id, 2, 12_900);
    run = g.closeQuestion(22_000);
    expect(run.results?.gains.map((x) => [x.competitorId, x.rank])).toEqual([[a.id, 1], [b.id, 2]]);
  });

  it('late joiners during a round start at the initial hashrate', () => {
    const { g } = setup('10');
    g.startRound(0, 0, null);
    const late = g.joinBitaxe({}, 5);
    expect(late.name).toBe('Bitaxe 3');
    expect(g.round!.hashrates[late.id]).toBe((10n * T).toString());
  });
});

describe('block bonuses', () => {
  const block = (height: number, origin: 'real' | 'simulated' = 'real'): BlockInfo => ({
    id: `${origin}-${height}`,
    height,
    timestamp: 0,
    origin,
    receivedAt: 0,
  });

  it('draws proportionally to the hashrate share, applies 2.1 % of own hashrate, never twice for one block', () => {
    const { g, a, b } = setup('0');
    g.startRound(0, 0, 100);
    g.round!.hashrates[a.id] = (500n * T).toString();
    g.round!.hashrates[b.id] = (500n * T).toString();
    // rng returns 0 => first positive candidate (a)
    const ev = g.onBlock(block(101), 10)!;
    expect(ev.winnerId).toBe(a.id);
    expect(ev.bonus).toBe((105n * T / 10n).toString()); // 2.1 % of 500 = 10.5
    expect(g.round!.hashrates[a.id]).toBe((5105n * T / 10n).toString());
    expect(g.onBlock(block(101), 11)).toBeNull(); // duplicate delivery
    expect(g.round!.hashrates[a.id]).toBe((5105n * T / 10n).toString());
    expect(ev.audit.total).toBe((1000n * T).toString());
  });

  it('ignores historical blocks and blocks outside a running round', () => {
    const { g } = setup('10');
    expect(g.onBlock(block(50), 0)).toBeNull(); // lobby
    g.startRound(0, 0, 100);
    expect(g.onBlock(block(100), 1)).toBeNull(); // <= tip at start
    expect(g.onBlock(block(101), 2)).not.toBeNull();
    const types = g.state.recentEvents.filter((e) => e.type.startsWith('block.')).map((e) => e.type);
    expect(types).toEqual(['block.ignored', 'block.ignored', 'block.bonus']);
  });

  it('handles a zero total weight without crashing and logs it', () => {
    const { g } = setup('0');
    g.startRound(0, 0, 100);
    const ev = g.onBlock(block(101), 1)!;
    expect(ev.winnerId).toBeNull();
    expect(ev.reason).toBe('zero-total');
  });

  it('supports the alternative base: 2.1 % of the total game hashrate', () => {
    const { g, a, b } = setup('0');
    g.setConfig({ blockBonusBase: 'total' }, 0);
    g.startRound(0, 0, 100);
    g.round!.hashrates[a.id] = (100n * T).toString();
    g.round!.hashrates[b.id] = (900n * T).toString();
    const ev = g.onBlock(block(101), 1)!;
    expect(ev.winnerId).toBe(a.id);
    expect(ev.bonus).toBe((21n * T).toString());
  });

  it('the same competitor can win consecutive bonuses', () => {
    const { g, a } = setup('0');
    g.startRound(0, 0, 100);
    g.round!.hashrates[a.id] = (100n * T).toString();
    for (let h = 101; h <= 105; h++) expect(g.onBlock(block(h), h)!.winnerId).toBe(a.id);
    expect(g.round!.blockBonuses.length).toBe(5);
  });
});

describe('weighted draws and prizes', () => {
  it('weightedDraw selects according to cumulative weights', () => {
    const cands = [
      { competitorId: 'a', weight: 50n },
      { competitorId: 'b', weight: 30n },
      { competitorId: 'c', weight: 20n },
    ];
    expect(weightedDraw(cands, () => 0n).winnerId).toBe('a');
    expect(weightedDraw(cands, () => 49n).winnerId).toBe('a');
    expect(weightedDraw(cands, () => 50n).winnerId).toBe('b');
    expect(weightedDraw(cands, () => 79n).winnerId).toBe('b');
    expect(weightedDraw(cands, () => 99n).winnerId).toBe('c');
  });

  it('statistically respects shares (50 % pool wins about half the time)', () => {
    const cands = [
      { competitorId: 'half', weight: 500n },
      { competitorId: 'q1', weight: 250n },
      { competitorId: 'q2', weight: 250n },
    ];
    let wins = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (weightedDraw(cands).winnerId === 'half') wins++;
    expect(wins / N).toBeGreaterThan(0.47);
    expect(wins / N).toBeLessThan(0.53);
  });

  it('prize series removes each winner and renormalises; extra prizes stay unassigned', () => {
    const prizes = [
      { id: 'p1', label: 'Gros lot', rank: 1 },
      { id: 'p2', label: 'Moyen', rank: 2 },
      { id: 'p3', label: 'Petit', rank: 3 },
      { id: 'p4', label: 'Surplus', rank: 4 },
    ];
    const cands = [
      { competitorId: 'a', weight: 50n },
      { competitorId: 'b', weight: 30n },
      { competitorId: 'c', weight: 20n },
    ];
    const rolls = [0n, 0n, 0n];
    const awards = drawPrizeSeries(prizes, cands, () => rolls.shift() ?? 0n);
    expect(awards.map((a) => a.winnerId)).toEqual(['a', 'b', 'c', null]);
    expect(awards[1].audit.total).toBe('50'); // b + c after a left
    expect(awards[3].reason).toBe('no-candidates');
  });

  it('draws prizes from cumulative snapshots and never sums overlapping balances', () => {
    const { g, a, b } = setup('0');
    g.startRound(0, 0, null);
    g.round!.hashrates[a.id] = (10n * T).toString();
    g.round!.hashrates[b.id] = (90n * T).toString();
    g.endRound(1);
    g.startRound(1, 2, null);
    g.round!.hashrates[a.id] = (100n * T).toString();
    g.endRound(3);
    g.setPrizesDraft([{ id: 'p1', label: 'Lot', rank: 1 }], 4);
    const s1 = g.drawPrizes({}, 5); // last ended round only (round 2)
    expect(s1.roundIndexes).toEqual([1]);
    expect(s1.weights[a.id]).toBe((100n * T).toString());
    expect(s1.weights[b.id]).toBe((90n * T).toString());
    const s2 = g.drawPrizes({ scope: 'sumOfRounds' }, 6);
    expect(s2.roundIndexes).toEqual([1]);
    expect(s2.weights[a.id]).toBe((100n * T).toString());
    expect(s2.weights[b.id]).toBe((90n * T).toString());
    // Round hashrates are untouched by the prize computation.
    expect(g.state.roundStates[1].finalHashrates![b.id]).toBe((90n * T).toString());
  });
});
