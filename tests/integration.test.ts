import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { App } from '../src/server/app';
import type { ClientMessage, ConsoleView, PlayerView, ServerMessage } from '../src/shared/views';

let app: App;
let port: number;
let dir: string;

class Client {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  view: any = null;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  private opened: Promise<void>;
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.opened = new Promise<void>((r) => this.ws.once('open', () => r()));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.type === 'state') this.view = m.view;
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }
  open() {
    return this.opened;
  }
  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }
  wait<T extends ServerMessage>(pred: (m: ServerMessage) => boolean, ms = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m as T)) });
    });
  }
  waitView<V>(pred: (v: V) => boolean, ms = 3000): Promise<V> {
    if (this.view && pred(this.view)) return Promise.resolve(this.view);
    return this.wait((m) => m.type === 'state' && pred(m.view as V), ms).then(() => this.view as V);
  }
  close() {
    this.ws.close();
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-'));
  const content = path.join(dir, 'content');
  fs.mkdirSync(content);
  fs.writeFileSync(
    path.join(content, 'bonly-test.json'),
    JSON.stringify({
      name: 'Test',
      questions: [1, 2].map((i) => ({ id: `q${i}`, type: 'single-choice', text: `Q${i}`, options: ['a', 'b'], correctIndex: 1, difficulty: 'easy' })),
    }),
  );
  app = new App({ port: 0, dataDir: path.join(dir, 'data'), contentDir: content, consoleToken: 'secret', quiet: true, clientDist: path.join(dir, 'none') });
  app.game.setConfig({ miningDurationMs: 200 }, Date.now());
  port = await app.listen();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('server', () => {
  it('runs a game end to end with phones, board and console', async () => {
    const consoleC = new Client();
    await consoleC.open();
    consoleC.send({ type: 'hello', role: 'console', consoleToken: 'wrong' });
    await consoleC.wait((m) => m.type === 'error' && m.code === 'unauthorized');
    consoleC.send({ type: 'hello', role: 'console', consoleToken: 'secret' });
    let cv = await consoleC.waitView<ConsoleView>((v) => v.kind === 'console');
    expect(cv.questionTotal).toBe(2);
    expect(cv.joinUrl).toMatch(/\/play$/);

    const board = new Client();
    await board.open();
    board.send({ type: 'hello', role: 'board' });
    await board.waitView((v: any) => v.kind === 'board');

    const phones = [new Client(), new Client()];
    const tokens: string[] = [];
    for (const [i, p] of phones.entries()) {
      await p.open();
      p.send({ type: 'hello', role: 'player' });
      await p.wait((m) => m.type === 'hello-ok');
      p.send({ type: 'join', name: `Équipe ${i + 1}` });
      const j = await p.wait<Extract<ServerMessage, { type: 'joined' }>>((m) => m.type === 'joined');
      tokens.push(j.token);
    }
    cv = await consoleC.waitView<ConsoleView>((v) => v.players.length === 2);

    // Q1: both answer, the question closes early.
    consoleC.send({ type: 'next', key: cv.next!.key });
    await phones[0].waitView<PlayerView>((v) => v.phase === 'question');
    phones[0].send({ type: 'answer', questionIndex: 0, option: 1 });
    expect(await phones[0].wait((m) => m.type === 'answer-ack')).toMatchObject({ ok: true });
    phones[1].send({ type: 'answer', questionIndex: 0, option: 0 });
    const v0 = await phones[0].waitView<PlayerView>((v) => v.phase === 'reveal');
    expect(v0.myResult).toMatchObject({ correct: true, streak: 1 });
    expect(v0.me!.hashrate).toBeGreaterThan(100);
    const v1 = await phones[1].waitView<PlayerView>((v) => v.phase === 'reveal');
    expect(v1.myResult).toMatchObject({ correct: false, gain: 0 });

    // A phone reconnecting with its token gets its player back.
    phones[1].close();
    const again = new Client();
    await again.open();
    again.send({ type: 'hello', role: 'player', token: tokens[1] });
    expect(await again.wait((m) => m.type === 'hello-ok')).toMatchObject({ tokenRecognized: true });

    // Q2 then final.
    cv = await consoleC.waitView<ConsoleView>((v) => v.next?.action === 'open');
    consoleC.send({ type: 'next', key: cv.next!.key });
    await again.waitView<PlayerView>((v) => v.phase === 'question' && v.question?.index === 1);
    again.send({ type: 'answer', questionIndex: 1, option: 1 });
    phones[0].send({ type: 'answer', questionIndex: 1, option: 1 });
    cv = await consoleC.waitView<ConsoleView>((v) => v.next?.action === 'finish');
    consoleC.send({ type: 'next', key: cv.next!.key });
    cv = await consoleC.waitView<ConsoleView>((v) => v.next?.action === 'mine');

    // Stale key is refused.
    consoleC.send({ type: 'next', key: 'old' });
    await consoleC.wait((m) => m.type === 'error' && m.code === 'stale-step');

    consoleC.send({ type: 'next', key: cv.next!.key, label: 'Bitaxe Gamma' });
    const mining = await board.waitView<any>((v) => v.blocks.length === 1);
    expect(mining.blocks[0]).toMatchObject({ found: false, label: 'Bitaxe Gamma' });
    expect(mining.blocks[0].winnerId).toBeUndefined();
    const found = await board.waitView<any>((v) => v.blocks[0]?.found === true, 2000);
    expect(found.players.map((p: any) => p.id)).toContain(found.blocks[0].winnerId);

    for (const c of [consoleC, board, phones[0], again]) c.close();
  });

  it('restores the session after a restart', async () => {
    const code = app.game.state.code;
    const players = Object.keys(app.game.state.players).length;
    app.store.saveSnapshot(app.game.state, true);
    const app2 = new App({ port: 0, dataDir: path.join(dir, 'data'), contentDir: path.join(dir, 'content'), consoleToken: 'secret', quiet: true });
    expect(app2.game.state.code).toBe(code);
    expect(Object.keys(app2.game.state.players)).toHaveLength(players);
    expect(app2.game.phase).toBe('final');
    await app2.close();
  });
});
