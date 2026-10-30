import { describe, expect, it } from 'vitest';
import { Game } from '../src/shared/game.js';
import { nextStep } from '../src/shared/progression.js';
import { boardView, playerView } from '../src/shared/views.js';
import { thsToNano } from '../src/shared/hashrate.js';
import type { ContentPack } from '../src/shared/types.js';

const pack: ContentPack = {
  name: '5 rounds',
  questions: [{ id: 'q', type: 'single-choice', text: 'Test', options: ['Yes', 'No'], correctIndex: 0, difficulty: 'easy' }],
  rounds: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, title: `Manche ${i + 1}`, questionIds: ['q'] })),
};
function setup() {
  let id = 0;
  return Game.create('TEST', 0, structuredClone(pack), {}, { rng: () => 0n, newId: () => `id${++id}` });
}
function advance(g: Game, now: number) { g.advance(nextStep(g.state)!.key, now); }

describe('continuous game', () => {
  it('carries the exact balance through 5 rounds, pauses, reloads and final prize draw', () => {
    let g = setup();
    const a = g.joinBitaxe({ owner: 'Alice' }, 1);
    const avatar = { ...a.avatar };
    let balance = thsToNano(10);
    for (let i = 0; i < 5; i++) {
      const t = 1000 + i * 20000;
      const before = boardView(g.state).competitors[0].hashrate;
      advance(g, t); // Start round
      expect(g.state.phase).toBe('round-ready');
      expect(g.round!.hashrates[a.id]).toBe(balance.toString());
      expect(boardView(g.state).competitors[0].hashrate).toBe(before);
      advance(g, t + 1); // Open
      g.submitAnswer(a.id, 0, t + 2);
      advance(g, t + 3); // Reveal
      balance += thsToNano('10.3');
      const block = g.onBlock({ id: `b${i}`, height: i + 1, origin: 'simulated', timestamp: 0, receivedAt: t + 4 }, t + 4)!;
      balance += BigInt(block.bonus!);
      advance(g, t + 5); // Recap
      expect(g.state.phase).toBe(i === 4 ? 'finished' : 'round-ended');
      expect(boardView(g.state).competitors[0].hashrate).toBe(balance.toString());
      g = new Game(JSON.parse(JSON.stringify(g.state)), { rng: () => 0n });
      const phone = playerView(g.state, a.id);
      expect(phone.me?.hashrate).toBe(balance.toString());
      expect(phone.me?.avatar).toEqual(avatar);
      expect(g.findByToken(a.token)?.id).toBe(a.id);
    }
    expect(nextStep(g.state)).toBeUndefined();
    g.setPrizesDraft([{ id: 'p', label: 'Lot', rank: 1 }], 100000);
    const prize = g.drawPrizes({ scope: 'sumOfRounds', roundIndexes: [4, 0, 4, 2, 1, 3] }, 100001);
    expect(prize.weights[a.id]).toBe(balance.toString());
    expect(prize.roundIndexes).toEqual([4]);
    expect(prize.awards[0].winnerId).toBe(a.id);
  });

  it('credits a late entrant once during a pause, without changing the finished snapshot', () => {
    const g = setup();
    g.joinBitaxe({}, 1);
    advance(g, 10); advance(g, 11); advance(g, 12); advance(g, 13);
    const firstFinal = structuredClone(g.round!.finalHashrates);
    const late = g.joinBitaxe({}, 14);
    expect(playerView(g.state, late.id).me?.hashrate).toBe(thsToNano(10).toString());
    expect(g.round!.finalHashrates).toEqual(firstFinal);
    advance(g, 15);
    expect(g.round!.hashrates[late.id]).toBe(thsToNano(10).toString());
    advance(g, 16); advance(g, 17); advance(g, 18); advance(g, 19);
    expect(g.round!.hashrates[late.id]).toBe(thsToNano(10).toString());
  });

  it('rejects duplicated or obsolete steps, including a close arriving after the timer', () => {
    const g = setup();
    const old = nextStep(g.state)!.key;
    g.advance(old, 10);
    expect(() => g.advance(old, 11)).toThrow(/déjà changé/);
    advance(g, 12);
    const closeKey = nextStep(g.state)!.key;
    g.closeQuestion(10012);
    expect(() => g.advance(closeKey, 10013)).toThrow(/déjà changé/);
    expect(g.state.phase).toBe('question-closed');
    expect(g.round!.status).toBe('running');
  });

  it('migrates independent rounds once using actual allocations and credited bonuses, preserving old draws', () => {
    const g = setup();
    const a = g.joinBitaxe({}, 1);
    for (let i = 0; i < 2; i++) {
      const t = 100 + i * 20000;
      g.startRound(i, t, null);
      // Reproduce an old independently reset round with a changed initial config.
      g.round!.hashrates[a.id] = thsToNano(i === 0 ? 10 : 20).toString();
      g.openNextQuestion(t + 1); g.submitAnswer(a.id, 0, t + 2); g.closeQuestion(t + 3);
      g.onBlock({ id: `legacy${i}`, height: i, origin: 'simulated', timestamp: 0, receivedAt: t + 4 }, t + 4);
      g.endRound(t + 5);
    }
    g.setPrizesDraft([{ id: 'old', label: 'Old lot', rank: 1 }], 50000);
    g.drawPrizes({}, 50001);
    const oldSeries = structuredClone(g.state.prizeSeries);
    const oldBalances = g.state.roundStates.map((r) => structuredClone(r.hashrates));
    const expected = thsToNano(10) + g.state.roundStates.reduce((sum, r) => sum +
      r.questionRuns.reduce((s, q) => s + (q.results?.gains.reduce((n, x) => n + BigInt(x.gain), 0n) ?? 0n), 0n) +
      r.blockBonuses.reduce((s, b) => s + BigInt(b.bonus ?? '0'), 0n), 0n);
    const state = structuredClone(g.state);
    delete state.hashrateMode;
    state.config.initialHashrateThs = '999'; // must not rewrite past allocations
    const migrated = new Game(state);
    expect(migrated.state.hashrates[a.id]).toBe(expected.toString());
    expect(migrated.state.legacyRoundBalances!.map((r) => r.hashrates)).toEqual(oldBalances.slice(0, 2));
    expect(migrated.state.prizeSeries).toEqual(oldSeries);
    const snapshot = JSON.parse(JSON.stringify(migrated.state));
    expect(new Game(structuredClone(snapshot)).state).toEqual(snapshot);
    migrated.startRound(2, 60000, null);
    expect(migrated.round!.hashrates[a.id]).toBe(expected.toString());
  });
});
