import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/shared/config';
import { drawWinner } from '../src/shared/draw';
import { Game } from '../src/shared/game';
import { scoreAnswer, speedRanks } from '../src/shared/scoring';
import type { ContentPack, Question } from '../src/shared/types';
import { boardView, playerView } from '../src/shared/views';

const q = (id: string, difficulty: Question['difficulty'] = 'easy', correctIndex = 0): Question => ({
  id,
  type: 'single-choice',
  text: `Question ${id}`,
  options: ['A', 'B', 'C', 'D'],
  correctIndex,
  difficulty,
});

const pack = (n: number): ContentPack => ({ name: 'test', questions: Array.from({ length: n }, (_, i) => q(`q${i + 1}`)) });

let seq = 0;
const deps = (rng?: (max: number) => number) => ({ newId: () => String(++seq), newToken: () => 't' + ++seq, rng });

const T0 = 1_000_000;

describe('scoreAnswer', () => {
  const timing = { openedAt: 0, durationMs: 20_000 };

  it('pays the base gain plus a speed bonus for the first 3 correct answers: +10 / +5 / +2 %', () => {
    const at = { option: 0, at: 4_000 };
    expect(scoreAnswer(q('a'), at, timing, 0, DEFAULT_CONFIG, 0)).toMatchObject({ correct: true, base: 10, speedBonus: 1, speedRank: 1, streakBonus: 0, gain: 11, streak: 1 });
    expect(scoreAnswer(q('a'), at, timing, 0, DEFAULT_CONFIG, 1)).toMatchObject({ speedBonus: 0.5, speedRank: 2, gain: 10.5 });
    expect(scoreAnswer(q('a', 'hard'), at, timing, 0, DEFAULT_CONFIG, 2)).toMatchObject({ speedBonus: 0.6, speedRank: 3, gain: 30.6 });
    const fourth = scoreAnswer(q('a'), at, timing, 0, DEFAULT_CONFIG, 3);
    expect(fourth).toMatchObject({ speedBonus: 0, gain: 10 });
    expect(fourth.speedRank).toBeUndefined();
  });

  it('ranks correct answers by arrival time, wrong answers excluded', () => {
    const ranks = speedRanks({ a: { option: 1, at: 50 }, b: { option: 0, at: 300 }, c: { option: 0, at: 100 }, d: { option: 0, at: 200 } }, 0);
    expect([...ranks]).toEqual([['c', 0], ['d', 1], ['b', 2]]);
  });

  it('scales with difficulty', () => {
    expect(scoreAnswer(q('a', 'intermediate'), { option: 0, at: 20_000 }, timing, 0, DEFAULT_CONFIG).gain).toBe(20);
    expect(scoreAnswer(q('a', 'hard'), { option: 0, at: 20_000 }, timing, 0, DEFAULT_CONFIG).gain).toBe(30);
    expect(scoreAnswer(q('a', 'expert'), { option: 0, at: 20_000 }, timing, 0, DEFAULT_CONFIG).gain).toBe(50);
  });

  it('adds 10 % per consecutive correct answer, capped at 50 %', () => {
    const at = { option: 0, at: 20_000 };
    expect(scoreAnswer(q('a'), at, timing, 1, DEFAULT_CONFIG)).toMatchObject({ streak: 2, streakBonus: 1 });
    expect(scoreAnswer(q('a'), at, timing, 3, DEFAULT_CONFIG)).toMatchObject({ streak: 4, streakBonus: 3 });
    expect(scoreAnswer(q('a'), at, timing, 10, DEFAULT_CONFIG)).toMatchObject({ streak: 11, streakBonus: 5 });
  });

  it('reinvests 21 % of the hashrate already held on each correct answer, nothing on a wrong one', () => {
    const at = { option: 0, at: 20_000 };
    expect(scoreAnswer(q('a'), at, timing, 0, DEFAULT_CONFIG, Infinity, 200)).toMatchObject({ base: 10, reinvest: 42, gain: 52 });
    expect(scoreAnswer(q('a'), { option: 1, at: 0 }, timing, 0, DEFAULT_CONFIG, Infinity, 200)).toMatchObject({ reinvest: 0, gain: 0 });
  });

  it('wrong or missing answer: nothing, streak reset', () => {
    expect(scoreAnswer(q('a'), { option: 2, at: 0 }, timing, 5, DEFAULT_CONFIG)).toMatchObject({ correct: false, gain: 0, streak: 0, option: 2 });
    expect(scoreAnswer(q('a'), undefined, timing, 5, DEFAULT_CONFIG)).toMatchObject({ correct: false, gain: 0, streak: 0, option: null });
  });
});

describe('drawWinner', () => {
  it('picks by cumulative hashrate', () => {
    const c = [
      { id: 'a', hashrate: 100 },
      { id: 'b', hashrate: 300 },
      { id: 'zero', hashrate: 0 },
    ];
    // The draw counts tenths of TH: a = 1000 tickets, b = 3000.
    expect(drawWinner(c, () => 0).winnerId).toBe('a');
    expect(drawWinner(c, () => 999).winnerId).toBe('a');
    expect(drawWinner(c, () => 1000).winnerId).toBe('b');
    expect(drawWinner(c, () => 3999)).toEqual({ winnerId: 'b', total: 4000, roll: 3999 });
    expect(drawWinner([{ id: 'x', hashrate: 0.5 }], () => 4)).toEqual({ winnerId: 'x', total: 5, roll: 4 });
    expect(drawWinner([{ id: 'x', hashrate: 0 }]).winnerId).toBeNull();
  });

  it('follows the hashrate shares with the crypto RNG', () => {
    const wins = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) wins[drawWinner([{ id: 'a', hashrate: 250 }, { id: 'b', hashrate: 750 }]).winnerId as 'a' | 'b']++;
    expect(wins.a / 20_000).toBeGreaterThan(0.23);
    expect(wins.a / 20_000).toBeLessThan(0.27);
  });
});

describe('Game', () => {
  it('plays a full game: questions, streaks, final ranking, podium draw', () => {
    const g = Game.create('TEST', T0, pack(3), { podiumSize: 3 }, deps(() => 0));
    const alice = g.join('Alice', T0);
    const bob = g.join('  Bob  ', T0);
    expect(bob.name).toBe('Bob');
    expect(g.join('alice', T0).name).toBe('alice 2');

    let step = g.nextStep(T0)!;
    expect(step).toMatchObject({ action: 'open', label: 'Lancer la question 1' });
    g.advance(step.key, T0);
    expect(g.phase).toBe('question');
    expect(() => g.advance(step.key, T0)).toThrow(/déjà changé/);

    // Q1: Alice first right answer (+10 %), Bob second (+5 %). Alice changes her mind:
    // the last choice counts, timed when it was made.
    expect(g.answer(alice.id, 0, 1, T0)).toEqual({ ok: true });
    expect(g.answer(alice.id, 0, 0, T0 + 10)).toEqual({ ok: true });
    g.answer(bob.id, 0, 0, T0 + 10_000);
    g.closeQuestion(T0 + 12_000);
    expect(alice.hashrate).toBe(11);
    expect(bob.hashrate).toBe(10.5);

    // Q2: Alice right again (streak 2, and the only right answer), Bob wrong.
    g.advance(g.nextStep(T0)!.key, T0 + 20_000);
    g.answer(alice.id, 1, 0, T0 + 39_999);
    g.answer(bob.id, 1, 3, T0 + 21_000);
    expect(g.answer(bob.id, 1, 0, g.run!.closesAt)).toEqual({ ok: false, reason: 'too-late' });
    g.closeQuestion(T0 + 40_000);
    expect(g.state.runs[1].results![alice.id]).toMatchObject({ streak: 2, streakBonus: 1, speedBonus: 1, reinvest: 2.3, gain: 14.3 }); // reinvest: 21 % of 11
    expect(alice.hashrate).toBe(25.3);
    expect(bob.streak).toBe(0);

    // Q3 too late for everyone (21 s timer).
    g.advance(g.nextStep(T0)!.key, T0 + 50_000);
    expect(g.answer(alice.id, 2, 0, T0 + 71_000)).toEqual({ ok: false, reason: 'too-late' });
    g.closeQuestion(T0 + 71_000);
    expect(alice.streak).toBe(0);

    step = g.nextStep(T0 + 71_000)!;
    expect(step).toMatchObject({ action: 'finish' });
    g.advance(step.key, T0 + 72_000);
    expect(g.phase).toBe('final');

    const now = T0 + 80_000;
    step = g.nextStep(now)!;
    expect(step).toMatchObject({ action: 'mine', label: 'Tirer la 1re place' });
    g.advance(step.key, now);
    const block = g.state.blocks[0];
    expect(block).toMatchObject({ n: 1, winnerId: alice.id, total: 358, roll: 0 });
    expect(block.hash).toMatch(/^0{10}[0-9a-f]{54}$/);
    // Nothing else while mining; winner hidden from views until revealAt.
    expect(g.nextStep(now + 1)).toBeNull();
    expect(boardView(g, now + 1, 'u').blocks[0]).toMatchObject({ found: false });
    expect(boardView(g, now + 1, 'u').blocks[0].winnerId).toBeUndefined();
    expect(boardView(g, block.revealAt, 'u').blocks[0]).toMatchObject({ found: true, winnerId: alice.id });

    // 2nd place excludes the 1st: Bob is the only one left with hashrate, then nobody.
    step = g.nextStep(block.revealAt)!;
    expect(step.label).toBe('Tirer la 2e place');
    g.advance(step.key, block.revealAt);
    expect(g.state.blocks[1].winnerId).toBe(bob.id);
    expect(g.nextStep(g.state.blocks[1].revealAt)).toBeNull();
    expect(() => g.mineBlock(g.state.blocks[1].revealAt)).toThrow(/Aucun mineur/);
  });

  it('draws podiumSize places, each player at most once', () => {
    const g = Game.create('TEST', T0, pack(1), { startHashrateThs: 100, podiumSize: 3 }, deps());
    const ids = ['A', 'B', 'C', 'D', 'E'].map((n) => g.join(n, T0).id);
    g.openQuestion(T0);
    g.closeQuestion(T0 + 1);
    g.finish(T0 + 2);
    let now = T0 + 10;
    for (let i = 0; i < 3; i++) {
      g.advance(g.nextStep(now)!.key, now);
      now = g.state.blocks[i].revealAt;
    }
    const winners = g.state.blocks.map((b) => b.winnerId);
    expect(new Set(winners).size).toBe(3);
    expect(winners.every((w) => ids.includes(w!))).toBe(true);
    expect(g.state.blocks[2].weights).toHaveLength(3);
    expect(g.nextStep(now)).toBeNull();
    expect(() => g.mineBlock(now)).toThrow(/complet/);
  });

  it('draws a single winner by default', () => {
    const g = Game.create('TEST', T0, pack(1), { startHashrateThs: 100 }, deps());
    g.join('A', T0);
    g.join('B', T0);
    g.openQuestion(T0);
    g.closeQuestion(T0 + 1);
    g.finish(T0 + 2);
    const step = g.nextStep(T0 + 3)!;
    expect(step.label).toBe('Tirer le gagnant');
    g.advance(step.key, T0 + 3);
    expect(g.nextStep(g.state.blocks[0].revealAt)).toBeNull();
  });

  it('gives a seat back by its exact name, only while offline, to one phone at a time', () => {
    const g = Game.create('TEST', T0, pack(1), {}, deps());
    const a = g.join('Alice B', T0);
    const oldToken = a.token;
    expect(() => g.reclaim('Alice B', T0)).toThrow(/connecté/); // still on its phone
    g.setConnected(a.id, false);
    expect(() => g.reclaim('Alicia', T0)).toThrow(/Aucun joueur/);
    expect(g.reclaim('  alice   b ', T0)).toBe(a);
    expect(a.token).not.toBe(oldToken);
    expect(g.findByToken(oldToken)).toBeUndefined(); // the old phone cannot come back
    g.removePlayer(a.id, T0);
    expect(() => g.reclaim('Alice B', T0)).toThrow(/Aucun joueur/);
  });

  it('hides the answer from boards and phones until the question closes', () => {
    const g = Game.create('TEST', T0, pack(2), {}, deps());
    const p = g.join('P', T0);
    g.openQuestion(T0);
    g.answer(p.id, 0, 1, T0 + 500);
    const open = playerView(g, T0 + 600, 'u', p.id);
    expect(open.question?.correctIndex).toBeUndefined();
    expect(open.myAnswer).toEqual({ option: 1, ms: 500 });
    expect(open.myResult).toBeUndefined();
    g.closeQuestion(T0 + 1000);
    const closed = playerView(g, T0 + 1000, 'u', p.id);
    expect(closed.question?.correctIndex).toBe(0);
    expect(closed.question?.optionCounts).toEqual([0, 1, 0, 0]);
    expect(closed.myResult).toMatchObject({ correct: false, option: 1 });
  });

  it('cancelled question awards nothing and keeps streaks', () => {
    const g = Game.create('TEST', T0, pack(3), {}, deps());
    const p = g.join('P', T0);
    g.openQuestion(T0);
    g.answer(p.id, 0, 0, T0);
    g.closeQuestion(T0 + 1);
    g.openQuestion(T0 + 2);
    g.answer(p.id, 1, 0, T0 + 3);
    g.cancelQuestion(T0 + 4);
    expect(p).toMatchObject({ hashrate: 11, streak: 1 });
    expect(g.phase).toBe('reveal');
  });

  it('plays only questionCount questions', () => {
    const g = Game.create('TEST', T0, pack(30), {}, deps());
    expect(g.total).toBe(21);
  });

  it('lets a player change the answer until the countdown ends', () => {
    const g = Game.create('TEST', T0, pack(2), {}, deps());
    const a = g.join('A', T0);
    const b = g.join('B', T0);
    g.openQuestion(T0);
    g.answer(a.id, 0, 0, T0 + 1_000); // right, fast
    g.answer(b.id, 0, 0, T0 + 2_000); // right
    g.answer(a.id, 0, 0, T0 + 3_000); // same answer again: keeps the 1st time
    g.answer(b.id, 0, 2, T0 + 4_000); // b switches to a wrong answer
    g.answer(b.id, 0, 0, T0 + 5_000); // ...and back: timed at 5 s now
    expect(g.run!.answers[a.id]).toEqual({ option: 0, at: T0 + 1_000 });
    expect(g.run!.answers[b.id]).toEqual({ option: 0, at: T0 + 5_000 });
    expect(g.phase).toBe('question'); // everyone answered, still open
    expect(g.answer(a.id, 0, 1, T0 + 21_000)).toEqual({ ok: false, reason: 'too-late' });
    g.closeQuestion(T0 + 21_000);
    expect(g.run!.results![a.id]).toMatchObject({ correct: true, speedRank: 1 });
    expect(g.run!.results![b.id]).toMatchObject({ correct: true, speedRank: 2 });
  });

  it('settings are locked once the game started', () => {
    const g = Game.create('TEST', T0, pack(2), {}, deps());
    const p = g.join('P', T0);
    g.setConfig({ startHashrateThs: 10, baseGainThs: { easy: 1, intermediate: 2, hard: 3, expert: 5 } }, T0);
    expect(p.hashrate).toBe(10);
    expect(() => g.setConfig({ questionDurationMs: 100 }, T0)).toThrow(/durée/);
    g.openQuestion(T0);
    expect(() => g.setConfig({ questionCount: 5 }, T0)).toThrow(/avant la 1re question/);
  });
  it('announces each part before its first question, with labels on the console button', () => {
    const parts = { name: 'parts', parts: [{ title: 'Les bases', questions: 2 }, { title: 'Experts', subtitle: 'ça pique', questions: 1 }], questions: [q('a'), q('b'), q('c', 'hard')] };
    const g = Game.create('TEST', T0, parts, {}, deps());
    const p = g.join('P', T0);
    const step = () => g.nextStep(T0)!;
    const go = () => g.advance(step().key, T0);
    expect(step()).toMatchObject({ action: 'announce', label: 'Annoncer la partie 1' });
    go();
    expect(g.phase).toBe('intermission');
    let view = playerView(g, T0, 'http://x', p.id);
    expect(view.part).toBe(0);
    expect(view.question).toBeUndefined();
    expect(view.parts).toEqual([
      { n: 1, title: 'Les bases', subtitle: undefined, from: 0, count: 2, gains: [10] },
      { n: 2, title: 'Experts', subtitle: 'ça pique', from: 2, count: 1, gains: [30] },
    ]);
    expect(step()).toMatchObject({ action: 'open', label: 'Lancer la partie 1' });
    go();
    expect(boardView(g, T0, 'http://x').part).toBe(0);
    go(); // close q1
    expect(step()).toMatchObject({ action: 'open', label: 'Question 2 / 3' });
    go();
    go(); // close q2
    expect(step()).toMatchObject({ action: 'announce', label: 'Fin de la partie 1 : classement' });
    go();
    view = playerView(g, T0, 'http://x', p.id);
    expect(view).toMatchObject({ phase: 'intermission', part: 1 });
    expect(step()).toMatchObject({ action: 'open', label: 'Lancer la partie 2' });
    go();
    expect(g.run?.index).toBe(2);
    go(); // close q3
    expect(step()).toMatchObject({ action: 'finish' });
  });

  it('cuts the parts when fewer questions are played, and has no announce step without parts', () => {
    const parts = { name: 'parts', parts: [{ title: 'A', questions: 2 }, { title: 'B', questions: 2 }], questions: [q('a'), q('b'), q('c'), q('d')] };
    const g = Game.create('TEST', T0, parts, { questionCount: 2 }, deps());
    expect(g.parts().map((x) => [x.from, x.to])).toEqual([[0, 2]]);
    expect(Game.create('TEST', T0, pack(2), {}, deps()).nextStep(T0)).toMatchObject({ action: 'open', label: 'Lancer la question 1' });
  });
});
