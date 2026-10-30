import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/server/app.js';
import type { ServerMessage } from '../src/shared/views.js';
import type { PlayerView, ConsoleView } from '../src/shared/views.js';

/**
 * End-to-end test over a real WebSocket server: several phones (pools + Bitaxe),
 * a console and a board, with SIMULATED blocks (clearly tagged). The live
 * mempool.space feed is exercised separately in blocks-real.test.ts.
 */

class Client {
  ws!: WebSocket;
  messages: ServerMessage[] = [];
  cursor = 0;
  state: PlayerView | ConsoleView | null = null;
  constructor(private url: string) {}
  setUrl(u: string): void {
    this.url = u;
  }
  async open(hello: object): Promise<void> {
    this.cursor = this.messages.length;
    this.ws = new WebSocket(this.url);
    await new Promise<void>((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.type === 'state') this.state = m.view as PlayerView;
    });
    this.send(hello);
    await this.waitFor((m) => m.type === 'hello-ok');
    await this.waitFor((m) => m.type === 'state');
  }
  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }
  /** Waits for a message matching pred, considering only messages not yet consumed. */
  async waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => boolean, timeout = 5000): Promise<T> {
    const idx = this.messages.findIndex((m, i) => i >= this.cursor && pred(m));
    if (idx >= 0) {
      this.cursor = idx + 1;
      return this.messages[idx] as T;
    }
    this.cursor = this.messages.length;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for message; last=' + JSON.stringify(this.messages.slice(-2)))), timeout);
      const h = (d: WebSocket.RawData) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        if (pred(m)) {
          clearTimeout(t);
          this.ws.off('message', h);
          this.cursor = this.messages.length;
          res(m as T);
        }
      };
      this.ws.on('message', h);
    });
  }
  async waitState(pred: (v: PlayerView) => boolean, timeout = 5000): Promise<PlayerView> {
    if (this.state && pred(this.state as PlayerView)) return this.state as PlayerView;
    const m = await this.waitFor<{ type: 'state'; view: PlayerView }>((m) => m.type === 'state' && pred(m.view as PlayerView), timeout);
    return m.view;
  }
  close(): Promise<void> {
    return new Promise((res) => {
      this.ws.once('close', () => res());
      this.ws.close();
    });
  }
}

let app: App;
let port: number;
let url: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonly-quiz-test-'));
  app = new App({ host: '127.0.0.1', port: 0, dataDir, contentDir: path.resolve('content/questions'), consoleToken: 'test-token', blockSource: 'off', quiet: true, clientDist: '/nonexistent' });
  port = await app.listen();
  url = `ws://127.0.0.1:${port}/ws`;
  app.newSession(app.content.loadByName('Démo (questions fictives)'), { initialHashrateThs: '0', defaultQuestionDurationMs: 3000 });
});

afterAll(async () => {
  await app.close();
});

describe('multi-client game over WebSocket', () => {
  const consoleC = new Client('');
  const poolA = new Client('');
  const poolB = new Client('');
  const solo1 = new Client('');
  const solo2 = new Client('');
  const board = new Client('');
  let tokenA = '';

  it('authenticates the console and rejects a bad token', async () => {
    const bad = new Client(url);
    bad.ws = new WebSocket(url);
    await new Promise<void>((res) => bad.ws.once('open', () => res()));
    bad.ws.on('message', (d) => bad.messages.push(JSON.parse(d.toString())));
    bad.send({ type: 'hello', role: 'console', consoleToken: 'wrong' });
    const err = await bad.waitFor((m) => m.type === 'error');
    expect(err).toMatchObject({ type: 'error', code: 'unauthorized' });
    await bad.close();
    consoleC.setUrl(url);
    await consoleC.open({ type: 'hello', role: 'console', consoleToken: 'test-token' });
    expect((consoleC.state as ConsoleView).kind).toBe('console');
  });

  it('registers 2 pools and 2 Bitaxe, refuses a pool with fewer than 3 members, keeps Bitaxe separate', async () => {
    for (const c of [poolA, poolB, solo1, solo2, board]) c.setUrl(url);
    await poolA.open({ type: 'hello', role: 'player' });
    poolA.send({ type: 'join-pool', name: 'Tiny', members: ['x', 'y'] });
    const err = await poolA.waitFor((m) => m.type === 'error');
    expect(err).toMatchObject({ code: 'too-few-members' });
    poolA.send({ type: 'join-pool', name: 'Alpha Pool', members: ['Ana', 'Bob', 'Cid'] });
    const joined = await poolA.waitFor<{ type: 'joined'; token: string }>((m) => m.type === 'joined');
    tokenA = joined.token;

    await poolB.open({ type: 'hello', role: 'player' });
    poolB.send({ type: 'join-pool', name: 'Bravo', members: ['D', 'E', 'F', 'G'] });
    await poolB.waitFor((m) => m.type === 'joined');
    await solo1.open({ type: 'hello', role: 'player' });
    solo1.send({ type: 'join-bitaxe', owner: 'Solo Un' });
    await solo1.waitFor((m) => m.type === 'joined');
    await solo2.open({ type: 'hello', role: 'player' });
    solo2.send({ type: 'join-bitaxe' });
    await solo2.waitFor((m) => m.type === 'joined');
    await board.open({ type: 'hello', role: 'board' });

    const v = await board.waitState((v) => v.competitors.length === 4);
    expect(v.competitors.map((c) => c.name).sort()).toEqual(['Alpha Pool', 'Bitaxe 1', 'Bitaxe 2', 'Bravo']);
    expect(v.competitors.filter((c) => c.kind === 'bitaxe').length).toBe(2);
    // The board never sees tokens.
    expect(JSON.stringify(v)).not.toContain(tokenA);
  });

  it('players cannot run console commands and the board is read-only', async () => {
    poolA.send({ type: 'start-round', index: 0 });
    expect(await poolA.waitFor((m) => m.type === 'error')).toMatchObject({ code: 'forbidden' });
    board.send({ type: 'open-question' });
    expect(await board.waitFor((m) => m.type === 'error')).toMatchObject({ code: 'forbidden' });
  });

  it('runs a question: answers modifiable until the server deadline, correct answer hidden until close, gains 10 TH/s with speed bonuses', async () => {
    consoleC.send({ type: 'start-round', index: 0 });
    await board.waitState((v) => v.phase === 'round-ready');
    consoleC.send({ type: 'open-question' });
    const pv = await poolA.waitState((v) => v.phase === 'question-open');
    const q = pv.question!;
    expect(q.question.correctIndex).toBeUndefined(); // hidden from phones
    expect((await board.waitState((v) => v.phase === 'question-open')).question!.question.correctIndex).toBeUndefined();
    // demo-1: correct = 0
    poolA.send({ type: 'answer', questionId: q.question.id, optionIndex: 2, clientId: 'a1' });
    const ack1 = await poolA.waitFor<{ type: 'answer-ack'; accepted: boolean }>((m) => m.type === 'answer-ack');
    expect(ack1.accepted).toBe(true);
    solo1.send({ type: 'answer', questionId: q.question.id, optionIndex: 0, clientId: 's1' }); // correct first
    await solo1.waitFor((m) => m.type === 'answer-ack');
    poolA.send({ type: 'answer', questionId: q.question.id, optionIndex: 0, clientId: 'a2' }); // modified to correct, later
    await poolA.waitFor((m) => m.type === 'answer-ack' && (m as { clientId?: string }).clientId === 'a2');
    poolB.send({ type: 'answer', questionId: q.question.id, optionIndex: 3, clientId: 'b1' }); // wrong
    await poolB.waitFor((m) => m.type === 'answer-ack');
    const mine = await poolA.waitState((v) => v.myAnswer?.optionIndex === 0);
    expect(mine.myAnswer?.changes).toBe(1);

    const closed = await board.waitState((v) => v.phase === 'question-closed', 5000);
    expect(closed.question!.question.correctIndex).toBe(0);
    const gains = closed.question!.results!.gains;
    expect(gains.map((g) => [g.rank, g.bonusPercent, g.gain])).toEqual([
      [1, '3', '10300000000'],
      [2, '2', '10200000000'],
    ]);
    const nameOf = (id: string) => closed.competitors.find((c) => c.id === id)?.name;
    expect(gains.map((g) => nameOf(g.competitorId))).toEqual(['Bitaxe 1', 'Alpha Pool']);
    expect(closed.question!.results!.wrong.map(nameOf)).toEqual(['Bravo']);
    expect(closed.question!.results!.silent.map(nameOf)).toEqual(['Bitaxe 2']);

    // Late answer is rejected by the server clock.
    solo2.send({ type: 'answer', questionId: q.question.id, optionIndex: 0, clientId: 'late' });
    const late = await solo2.waitFor<{ type: 'answer-ack'; accepted: boolean; reason?: string }>((m) => m.type === 'answer-ack');
    expect(late.accepted).toBe(false);
    expect(['closed', 'no-open-question', 'stale-question']).toContain(late.reason);
  });

  it('a phone reconnects with its token and finds its competitor again; wrong answers never cost hashrate', async () => {
    await poolA.close();
    await poolA.open({ type: 'hello', role: 'player', token: tokenA });
    const v = poolA.state as PlayerView;
    expect(v.me?.name).toBe('Alpha Pool');
    expect(v.me?.hashrate).toBe('10200000000'); // rank 2 on Q1 (10 + 2 %)
    // Q2 (intermediate, correct = 1): Alpha answers wrong
    consoleC.send({ type: 'open-question' });
    const pv = await poolA.waitState((v) => v.phase === 'question-open' && v.question?.questionIndex === 1);
    poolA.send({ type: 'answer', questionId: pv.question!.question.id, optionIndex: 3, clientId: 'w' });
    poolB.send({ type: 'answer', questionId: pv.question!.question.id, optionIndex: 1, clientId: 'ok' });
    const closed = await poolA.waitState((v) => v.phase === 'question-closed' && v.question?.questionIndex === 1, 5000);
    expect(closed.me?.hashrate).toBe('10200000000'); // unchanged, no penalty
    const bravo = closed.competitors.find((c) => c.name === 'Bravo')!;
    expect(bravo.hashrate).toBe('51500000000'); // 50 + 3 %
  });

  it('simulated blocks trigger exactly one weighted draw each, tagged as simulation, and never double-reward', async () => {
    consoleC.send({ type: 'set-block-mode', mode: 'simulated' });
    await board.waitState((v) => v.blockFeed.mode === 'simulated');
    const before = (board.state as PlayerView).competitors.map((c) => ({ name: c.name, hr: BigInt(c.hashrate) }));
    const total = before.reduce((s, c) => s + c.hr, 0n);
    consoleC.send({ type: 'simulate-block' });
    const v = await board.waitState((v) => v.blockBonuses.length === 1);
    const ev = v.blockBonuses[0];
    expect(ev.origin).toBe('simulated');
    expect(ev.audit.total).toBe(total.toString());
    expect(ev.winnerId).toBeTruthy();
    const winner = v.competitors.find((c) => c.id === ev.winnerId)!;
    const prev = before.find((c) => c.name === winner.name)!;
    // 2.1 % of own hashrate, rounded half up to the nano
    const expected = prev.hr + (prev.hr * 21n + 500n) / 1000n;
    expect(BigInt(winner.hashrate)).toBe(expected);
    // Re-delivering the same block to the engine does nothing.
    const again = app.game!.onBlock({ id: ev.blockId, height: ev.height, timestamp: 0, origin: 'simulated', receivedAt: 0 }, Date.now());
    expect(again).toBeNull();
    expect(app.game!.round!.blockBonuses.length).toBe(1);
    // A real block is ignored while in simulation mode.
    const realIgnored = app.game!.state.processedBlockIds.length;
    (app as unknown as { onBlock: (b: unknown) => void }).onBlock({ id: 'real-x', height: 999999, timestamp: 0, origin: 'real', receivedAt: 0 });
    expect(app.game!.state.processedBlockIds.length).toBe(realIgnored);
  });

  it('ends the round, preserves hashrate for the next one, draws prizes with exclusion, survives a restart', async () => {
    consoleC.send({ type: 'open-question' });
    await board.waitState((v) => v.phase === 'question-closed' && v.question?.questionIndex === 2, 5000);
    await consoleC.waitState((v) => v.phase === 'question-closed' && v.question?.questionIndex === 2);
    const recapKey = (consoleC.state as ConsoleView).nextStep!.key;
    consoleC.send({ type: 'next-step', expectedKey: recapKey });
    consoleC.send({ type: 'next-step', expectedKey: recapKey });
    expect(await consoleC.waitFor((m) => m.type === 'error')).toMatchObject({ code: 'stale-step' });
    const ended = await board.waitState((v) => v.phase === 'round-ended');
    const finals = Object.fromEntries(ended.competitors.map((c) => [c.name, c.hashrate]));
    expect(BigInt(finals['Bravo'])).toBeGreaterThan(0n);

    consoleC.send({ type: 'set-prizes', prizes: [{ label: 'Gros lot' }, { label: 'Lot 2' }, { label: 'Lot 3' }, { label: 'Lot 4' }, { label: 'Lot 5' }] });
    consoleC.send({ type: 'draw-prizes' });
    const withPrizes = await board.waitState((v) => v.prizeSeries.length === 1);
    const s = withPrizes.prizeSeries[0];
    expect(s.roundIndexes).toEqual([0]);
    const winners = s.awards.map((a) => a.winnerId).filter(Boolean);
    expect(new Set(winners).size).toBe(winners.length); // max 1 prize per competitor
    // Competitors with 0 hashrate (Bitaxe 2) cannot win; prizes beyond eligible stay unassigned.
    const zero = withPrizes.competitors.filter((c) => c.hashrate === '0').map((c) => c.id);
    for (const z of zero) expect(winners).not.toContain(z);
    expect(s.awards.filter((a) => a.winnerId === null).length).toBeGreaterThanOrEqual(5 - (4 - zero.length));

    await consoleC.waitState((v) => v.phase === 'round-ended');
    consoleC.send({ type: 'next-step', expectedKey: (consoleC.state as ConsoleView).nextStep!.key });
    const r2 = await board.waitState((v) => v.currentRoundIndex === 1);
    expect(Object.fromEntries(r2.competitors.map((c) => [c.name, c.hashrate]))).toEqual(finals);
    const phoneR2 = await poolA.waitState((v) => v.currentRoundIndex === 1);
    expect(phoneR2.me?.hashrate).toBe(finals['Alpha Pool']);
    expect(r2.rounds[0].status).toBe('ended');

    // Restart the server process state from disk: snapshot (debounced write) + event log exist and reload the same state.
    await new Promise((r) => setTimeout(r, 500));
    const snap = JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions', `${r2.code}.json`), 'utf8'));
    expect(snap.roundStates[0].finalHashrates).toBeTruthy();
    const log = fs.readFileSync(path.join(dataDir, 'sessions', `${r2.code}.events.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log.some((e) => e.type === 'block.bonus')).toBe(true);
    expect(log.some((e) => e.type === 'prizes.drawn')).toBe(true);
    const app2 = new App({ host: '127.0.0.1', port: 0, dataDir, contentDir: path.resolve('content/questions'), consoleToken: 'test-token', blockSource: 'off', quiet: true, clientDist: '/nonexistent' });
    expect(app2.game?.state.code).toBe(r2.code);
    expect(app2.game?.state.currentRoundIndex).toBe(1);
    expect(app2.game?.state.hashrates).toEqual(app.game!.state.hashrates);
    expect(app2.game?.findByToken(tokenA)?.name).toBe('Alpha Pool');
    await app2.close();
  });
});
