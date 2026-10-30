/**
 * Load test: a real server process, N simulated phones, one board, one console,
 * a full game of 21 questions and the podium draw.
 *
 *   npm run build
 *   npm run loadtest              50 phones
 *   npm run loadtest -- 150       150 phones
 *   npm run loadtest -- 50 https://quiz.example.org TOKEN
 *                                 against a server already running (e.g. behind the tunnel);
 *                                 it starts a new session there, so not during a real game
 *
 * Phones answer at random times (a burst in the first seconds), 5 % miss each
 * question, and 5 phones drop and reconnect with their token in the middle of
 * the game. Prints latencies, traffic per phone, server CPU and memory.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { ClientMessage, ConsoleView, PlayerView, ServerMessage } from '../src/shared/views.js';

const N = Number(process.argv[2] ?? 50);
const REMOTE = process.argv[3];
const TOKEN = process.argv[4] ?? 'loadtest';
const PORT = 8791;
const QUESTION_MS = 12_000;
const BASE = REMOTE ? REMOTE.replace(/\/$/, '') : `http://127.0.0.1:${PORT}`;
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const fmt = (xs: number[]) => `médiane ${quantile(xs, 0.5).toFixed(0)} ms · p95 ${quantile(xs, 0.95).toFixed(0)} ms · max ${Math.max(...xs).toFixed(0)} ms (${xs.length} mesures)`;

class Client {
  ws!: WebSocket;
  view: any = null;
  /** Bytes on the wire (compressed), carried over across reconnections. */
  wireBefore = 0;
  messages = 0;
  maxMessage = 0;
  errors: string[] = [];
  /** Reconnection token, from the 'joined' message. */
  token?: string;
  private listeners = new Set<(m: ServerMessage, at: number) => void>();

  connect(): Promise<void> {
    // NO_DEFLATE=1 measures the traffic if a proxy strips the compression.
    this.ws = new WebSocket(WS_URL, { perMessageDeflate: !process.env.NO_DEFLATE });
    this.ws.on('message', (d: Buffer) => {
      const at = performance.now();
      this.messages++;
      this.maxMessage = Math.max(this.maxMessage, d.length);
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.type === 'state') this.view = m.view;
      if (m.type === 'error') this.errors.push(m.message);
      if (m.type === 'joined') this.token = m.token;
      for (const l of this.listeners) l(m, at);
    });
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }
  get bytes(): number {
    return this.wireBefore + ((this.ws as any)._socket?.bytesRead ?? this.lastRead);
  }
  private lastRead = 0;
  send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  /** Resolves with the arrival time of the first message matching pred. */
  next(pred: (m: ServerMessage) => boolean, ms = 30_000): Promise<number> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => (this.listeners.delete(l), reject(new Error('timeout'))), ms);
      const l = (m: ServerMessage, at: number) => {
        if (!pred(m)) return;
        clearTimeout(t);
        this.listeners.delete(l);
        resolve(at);
      };
      this.listeners.add(l);
    });
  }
  waitView<V>(pred: (v: V) => boolean, ms = 30_000): Promise<V> {
    if (this.view && pred(this.view)) return Promise.resolve(this.view);
    return this.next((m) => m.type === 'state' && pred(m.view as V), ms).then(() => this.view as V);
  }
  close() {
    this.lastRead = (this.ws as any)._socket?.bytesRead ?? this.lastRead;
    this.ws.close();
  }
}

// ---------------------------------------------------------------- server
let server: ChildProcess | undefined;
const rss: number[] = [];
let cpuStart = 0;

function cpuTicks(pid: number): number {
  const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
  return Number(f[11]) + Number(f[12]);
}

async function startServer(): Promise<void> {
  const entry = path.resolve('dist/server/server/index.js');
  if (!fs.existsSync(entry)) throw new Error('lancez d’abord npm run build');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-load-'));
  server = spawn(process.execPath, [entry], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, CONSOLE_TOKEN: TOKEN, PUBLIC_URL: BASE }, stdio: ['ignore', 'pipe', 'inherit'] });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  cpuStart = cpuTicks(server.pid!);
  const timer = setInterval(() => {
    try {
      const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${server!.pid}/status`, 'utf8'));
      if (m) rss.push(Number(m[1]) / 1024);
    } catch {
      clearInterval(timer);
    }
  }, 250);
  timer.unref();
}

// ------------------------------------------------------------------ game
async function main() {
  const t0 = performance.now();
  if (!REMOTE) await startServer();
  console.log(`${N} téléphones contre ${BASE}`);

  const consoleC = new Client();
  await consoleC.connect();
  consoleC.send({ type: 'hello', role: 'console', consoleToken: TOKEN });
  await consoleC.waitView<ConsoleView>((v) => v.kind === 'console');
  if (REMOTE) {
    consoleC.send({ type: 'new-session' });
    await sleep(500);
  }
  consoleC.send({ type: 'set-config', patch: { questionDurationMs: QUESTION_MS, miningDurationMs: 2000 } });
  await consoleC.waitView<ConsoleView>((v) => v.fullConfig.questionDurationMs === QUESTION_MS);

  const board = new Client();
  await board.connect();
  board.send({ type: 'hello', role: 'board' });

  // Join, staggered over ~2 s as if people scanned the QR code.
  const phones: Client[] = [];
  const joinLat: number[] = [];
  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      await sleep(Math.random() * 2000);
      const c = new Client();
      await c.connect();
      c.send({ type: 'hello', role: 'player' });
      await c.next((m) => m.type === 'hello-ok');
      const sent = performance.now();
      const joined = c.next((m) => m.type === 'joined');
      c.send({ type: 'join', name: `Joueur ${i + 1}` });
      joinLat.push((await joined) - sent);
      await c.waitView<PlayerView>((v) => !!v.me);
      phones[i] = c;
    }),
  );
  const cv0 = await consoleC.waitView<ConsoleView>((v) => v.players.length === N);
  console.log(`inscrits : ${cv0.players.length}`);

  const openLat: number[] = [];
  const ackLat: number[] = [];
  const revealLat: number[] = [];
  const answered = new Map<number, number>();
  let refused = 0;

  for (let q = 0; q < 21; q++) {
    const cv = await consoleC.waitView<ConsoleView>((v) => v.next?.action === 'open');
    const openArrivals = phones.map((c) => c.next((m) => m.type === 'state' && (m.view as PlayerView).phase === 'question' && (m.view as PlayerView).question?.index === q));
    const sent = performance.now();
    consoleC.send({ type: 'next', key: cv.next!.key });
    const arrivals = await Promise.all(openArrivals);
    for (const a of arrivals) openLat.push(a - sent);

    // Middle of the game: 5 phones lose the connection and come back with their token.
    if (q === 10) {
      await Promise.all(
        phones.slice(0, 5).map(async (c, i) => {
          const token = c.token!;
          c.close();
          await sleep(300 + Math.random() * 700);
          const fresh = new Client();
          await fresh.connect();
          fresh.send({ type: 'hello', role: 'player', token });
          const v = await fresh.waitView<PlayerView>((x) => !!x.me);
          if (v.me?.name !== `Joueur ${i + 1}`) throw new Error('reconnexion : mauvais joueur');
          fresh.wireBefore = c.bytes;
          phones[i] = fresh;
        }),
      );
    }

    const closed = Promise.all(phones.map((c) => c.next((m) => m.type === 'state' && (m.view as PlayerView).phase === 'reveal' && (m.view as PlayerView).question?.index === q, QUESTION_MS + 10_000)));
    await Promise.all(
      phones.map(async (c) => {
        if (Math.random() < 0.05) return; // missed this one
        // A third answers in the first 2 s (the burst), the rest within ~10 s.
        const delay = Math.random() < 0.33 ? Math.random() * 2000 : 2000 + Math.random() * (QUESTION_MS - 3000);
        await sleep(delay);
        const option = Math.floor(Math.random() * (c.view.question?.options.length ?? 4));
        const s = performance.now();
        const ack = c.next((m) => m.type === 'answer-ack');
        c.send({ type: 'answer', questionIndex: q, option });
        await ack;
        ackLat.push(performance.now() - s);
        answered.set(q, (answered.get(q) ?? 0) + 1);
      }),
    );
    const reveals = await closed;
    const closeRef = Math.min(...reveals);
    for (const r of reveals) revealLat.push(r - closeRef);
    refused += phones.reduce((s, c) => s + c.errors.length, 0);
    process.stdout.write(`\rquestion ${q + 1}/21 · ${answered.get(q) ?? 0} réponses`);
    await sleep(500);
  }
  console.log();

  // Final ranking and podium.
  let cv = await consoleC.waitView<ConsoleView>((v) => v.next?.action === 'finish');
  consoleC.send({ type: 'next', key: cv.next!.key });
  for (let place = 1; place <= 3; place++) {
    cv = await consoleC.waitView<ConsoleView>((v) => v.next?.action === 'mine');
    consoleC.send({ type: 'next', key: cv.next!.key });
    await consoleC.waitView<ConsoleView>((v) => v.blocks.length === place && v.blocks[place - 1].found);
  }
  const final = await consoleC.waitView<ConsoleView>((v) => v.blocks.length === 3 && v.blocks.every((b) => b.found));
  const winners = final.blocks.map((b) => final.players.find((p) => p.id === b.winnerId)?.name);

  // Every phone must agree with the console on its own hashrate.
  await sleep(500);
  let mismatched = 0;
  for (const c of phones) {
    const me = (c.view as PlayerView).me!;
    const truth = final.players.find((p) => p.id === me.id);
    if (!truth || truth.hashrate !== me.hashrate) mismatched++;
  }

  const kb = phones.map((c) => c.bytes / 1024);
  const cpuSeconds = server ? (cpuTicks(server.pid!) - cpuStart) / 100 : NaN; // /proc ticks are 1/100 s
  const wall = (performance.now() - t0) / 1000;

  console.log(`\nRésultats (${N} téléphones, 21 questions, ${wall.toFixed(0)} s)`);
  console.log(`- inscription (join → confirmation) : ${fmt(joinLat)}`);
  console.log(`- question affichée sur les téléphones après le clic console : ${fmt(openLat)}`);
  console.log(`- réponse → accusé de réception : ${fmt(ackLat)}`);
  console.log(`- écart entre le 1er et le dernier téléphone qui voit la réponse : ${fmt(revealLat)}`);
  console.log(`- trafic reçu par téléphone sur la partie : médiane ${quantile(kb, 0.5).toFixed(0)} Ko, max ${Math.max(...kb).toFixed(0)} Ko ; plus gros message ${(Math.max(...phones.map((c) => c.maxMessage)) / 1024).toFixed(1)} Ko avant compression`);
  console.log(`- écran (board) : ${(board.bytes / 1024).toFixed(0)} Ko reçus, console : ${(consoleC.bytes / 1024).toFixed(0)} Ko`);
  if (server) {
    console.log(`- serveur : ${cpuSeconds.toFixed(1)} s de CPU sur ${wall.toFixed(0)} s (${((100 * cpuSeconds) / wall).toFixed(1)} % d’un cœur), mémoire max ${Math.max(...rss).toFixed(0)} Mo`);
  }
  console.log(`- erreurs reçues par les téléphones : ${refused}, hashrates incohérents : ${mismatched}`);
  console.log(`- podium : ${winners.join(', ')}`);

  for (const c of [...phones, board, consoleC]) c.close();
  server?.kill('SIGTERM');
  if (mismatched > 0 || refused > 0 || winners.length !== 3 || new Set(winners).size !== 3) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  server?.kill('SIGTERM');
  process.exit(1);
});
