import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';
import { Game, GameError } from '../shared/game.js';
import type { ClientMessage, ServerMessage } from '../shared/views.js';
import { boardView, consoleView, playerView } from '../shared/views.js';
import type { BlockInfo, ContentPack, SessionState } from '../shared/types.js';
import { MempoolBlockSource, SimulatedBlockSource } from './blocks.js';
import { ContentLibrary } from './content.js';
import { Store } from './store.js';

const VERSION = '0.1.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  port: number;
  host?: string;
  dataDir: string;
  contentDir: string;
  consoleToken?: string;
  /** Base URL phones should open (e.g. http://192.168.1.20:5173). Computed from LAN IP when absent. */
  publicUrl?: string;
  /** 'real' connects to mempool.space at boot, 'off' leaves the feed off until the console enables it. */
  blockSource?: 'real' | 'off';
  mempoolBaseUrl?: string;
  /** Serve the built client from this directory when it exists. */
  clientDist?: string;
  /** Port phones should open (dev: the Vite port). Defaults to this server's port when the client is built, else 5173. */
  publicPort?: number;
  quiet?: boolean;
}

interface Conn {
  ws: WebSocket;
  role?: 'player' | 'board' | 'console';
  competitorId?: string;
}

export class App {
  readonly store: Store;
  readonly content: ContentLibrary;
  readonly consoleToken: string;
  readonly server: http.Server;
  readonly wss: WebSocketServer;
  game: Game | null = null;
  private conns = new Set<Conn>();
  private closeTimer?: NodeJS.Timeout;
  private mempool?: MempoolBlockSource;
  private sim?: SimulatedBlockSource;
  private blockMode: 'real' | 'simulated' | 'off' = 'off';
  private clientDist: string;

  constructor(public readonly opts: AppOptions) {
    this.store = new Store(opts.dataDir);
    this.content = new ContentLibrary(opts.contentDir);
    this.consoleToken = this.store.consoleToken(opts.consoleToken);
    this.clientDist = opts.clientDist ?? path.resolve(__dirname, '../../client');
    this.server = http.createServer((req, res) => void this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleWs(ws));
    this.restore();
  }

  log(...args: unknown[]): void {
    if (!this.opts.quiet) console.log('[quiz]', ...args);
  }

  // ------------------------------------------------------------- lifecycle
  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', resolve));
    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
    if ((this.opts.blockSource ?? 'real') === 'real') this.setBlockMode('real');
    return port;
  }

  async close(): Promise<void> {
    clearTimeout(this.closeTimer);
    this.mempool?.stop();
    for (const c of this.conns) c.ws.close();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    if (this.game) this.store.saveSnapshot(this.game.state, true);
  }

  private restore(): void {
    const code = this.store.getCurrent();
    if (!code) return;
    const state = this.store.loadSnapshot(code);
    if (!state) return;
    this.attachGame(new Game(state));
    for (const c of Object.values(state.competitors)) c.connected = false;
    this.log(`restored session ${code} (phase ${state.phase})`);
    this.rescheduleClose();
  }

  private attachGame(game: Game): void {
    this.game = game;
    game.onEvent((ev) => {
      this.store.appendEvent(game.state.code, ev);
      this.store.saveSnapshot(game.state);
      this.broadcastEvent(ev);
    });
    this.store.setCurrent(game.state.code);
    this.store.saveSnapshot(game.state, true);
  }

  newSession(pack: ContentPack | null, config: Partial<SessionState['config']> = {}): Game {
    const content = pack ?? this.content.defaultPack() ?? { name: 'vide', questions: [], rounds: [] };
    const code = randomCode();
    const game = Game.create(code, Date.now(), content, config);
    if (this.game) {
      this.store.saveSnapshot(this.game.state, true);
      // Keep block history and feed status across sessions.
      game.seedRecentBlocks(this.game.state.recentBlocks);
      game.setBlockFeed(this.game.state.blockFeed, Date.now());
    }
    // Detach all phones from the previous session.
    for (const c of this.conns) if (c.role === 'player') c.competitorId = undefined;
    this.attachGame(game);
    this.log(`new session ${code} with pack "${content.name}" (${content.questions.length} questions, ${content.rounds.length} rounds)`);
    this.broadcastState();
    return game;
  }

  // ---------------------------------------------------------------- blocks
  setBlockMode(mode: 'real' | 'simulated' | 'off'): void {
    if (mode === this.blockMode && (mode !== 'real' || this.mempool)) return;
    this.mempool?.stop();
    this.mempool = undefined;
    this.blockMode = mode;
    const now = Date.now();
    if (mode === 'real') {
      this.mempool = new MempoolBlockSource(
        {
          onBlock: (b) => this.onBlock(b),
          onHistory: (blocks) => {
            this.game?.seedRecentBlocks(blocks);
            this.broadcastState();
          },
          onStatus: (s) => {
            this.game?.setBlockFeed({ mode: 'real', endpoint: this.mempool?.endpoint, ...s }, Date.now());
            this.broadcastState();
          },
        },
        this.opts.mempoolBaseUrl,
      );
      this.game?.setBlockFeed({ mode: 'real', connected: false, endpoint: this.mempool.endpoint }, now, true);
      this.mempool.start();
    } else if (mode === 'simulated') {
      this.sim ??= new SimulatedBlockSource({ onBlock: (b) => this.onBlock(b) });
      this.game?.setBlockFeed({ mode: 'simulated', connected: true, lastError: undefined, endpoint: 'simulation locale' }, now, true);
    } else {
      this.game?.setBlockFeed({ mode: 'off', connected: false, endpoint: undefined }, now, true);
    }
    this.broadcastState();
  }

  simulateBlock(): BlockInfo {
    if (this.blockMode !== 'simulated') throw new GameError('not-simulated', 'switch the block feed to simulation first');
    this.sim ??= new SimulatedBlockSource({ onBlock: (b) => this.onBlock(b) });
    return this.sim.next();
  }

  private onBlock(b: BlockInfo): void {
    if (!this.game) return;
    // Real blocks are only accepted while the feed is in real mode (and vice versa).
    if ((b.origin === 'real') !== (this.blockMode === 'real')) return;
    const ev = this.game.onBlock(b, Date.now());
    if (ev) this.log(`block ${b.height} (${b.origin}) -> bonus to ${ev.winnerId ?? 'nobody'} ${ev.reason ?? ''}`);
    this.broadcastState();
  }

  // ---------------------------------------------------------------- timers
  private rescheduleClose(): void {
    clearTimeout(this.closeTimer);
    const g = this.game;
    if (!g || g.state.phase !== 'question-open') return;
    const run = g.currentRun;
    if (!run) return;
    const delay = Math.max(0, run.closesAt - Date.now());
    this.closeTimer = setTimeout(() => {
      try {
        if (g.state.phase === 'question-open') g.closeQuestion(Date.now());
      } catch (e) {
        console.error('[quiz] auto-close failed', e);
      }
      this.broadcastState();
    }, delay);
  }

  // ------------------------------------------------------------------- URLs
  lanUrls(): string[] {
    // Addresses on the local network always use this server's own port (a PUBLIC_URL tunnel has its own).
    const addr = this.server.address();
    const port = this.opts.publicPort ?? (typeof addr === 'object' && addr ? addr.port : this.opts.port);
    const out: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
    }
    return out;
  }

  private publicPort(): number {
    if (this.opts.publicUrl) return Number(new URL(this.opts.publicUrl).port || 80);
    if (this.opts.publicPort) return this.opts.publicPort;
    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
    return fs.existsSync(path.join(this.clientDist, 'index.html')) ? port : 5173;
  }

  joinUrl(): string | undefined {
    if (!this.game) return undefined;
    const base = this.opts.publicUrl ?? this.lanUrls()[0] ?? `http://localhost:${this.publicPort()}`;
    return `${base.replace(/\/$/, '')}/play?s=${this.game.state.code}`;
  }

  // ------------------------------------------------------------------- HTTP
  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/health') return json(res, { ok: true, version: VERSION, session: this.game?.state.code ?? null, phase: this.game?.state.phase ?? null });
      if (url.pathname === '/api/join-info') return json(res, { code: this.game?.state.code ?? null, joinUrl: this.joinUrl() ?? null, lanUrls: this.lanUrls() });
      if (url.pathname === '/api/qr.svg') {
        const text = url.searchParams.get('text') || this.joinUrl() || 'no-session';
        const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#ffffff', light: '#00000000' } });
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
        return void res.end(svg);
      }
      if (url.pathname === '/api/console/check' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { token?: string };
        return json(res, { ok: body.token === this.consoleToken });
      }
      if (url.pathname === '/api/export' && req.method === 'GET') {
        if (req.headers['x-console-token'] !== this.consoleToken) return json(res, { error: 'unauthorized' }, 401);
        const code = url.searchParams.get('code') ?? this.game?.state.code;
        if (!code) return json(res, { error: 'no session' }, 404);
        const snapshot = this.store.loadSnapshot(code);
        const eventsPath = this.store.eventsPath(code);
        const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        return json(res, { snapshot, events });
      }
      if (url.pathname.startsWith('/api/')) return json(res, { error: 'not found' }, 404);
      return this.serveStatic(url.pathname, res);
    } catch (e) {
      console.error('[quiz] http error', e);
      json(res, { error: (e as Error).message }, 500);
    }
  }

  private serveStatic(pathname: string, res: http.ServerResponse): void {
    const indexPath = path.join(this.clientDist, 'index.html');
    if (!fs.existsSync(indexPath)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>bonly-quiz</title><body style="font-family:system-ui;background:#11131f;color:#fff;padding:2rem">` +
          `<h1>bonly-quiz server</h1><p>Client not built. In development open the Vite server on port 5173 (<code>npm run dev</code>), ` +
          `or run <code>npm run build</code> then <code>npm start</code>.</p><p>Session: ${this.game?.state.code ?? 'none'}</p></body>`,
      );
      return;
    }
    let file = path.join(this.clientDist, decodeURIComponent(pathname));
    if (!file.startsWith(this.clientDist)) file = indexPath;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = indexPath;
    const ext = path.extname(file);
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
    res.writeHead(200, { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  }

  // -------------------------------------------------------------- WebSocket
  private handleWs(ws: WebSocket): void {
    const conn: Conn = { ws };
    this.conns.add(conn);
    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return this.send(conn, { type: 'error', code: 'bad-json', message: 'invalid JSON' });
      }
      try {
        this.handleMessage(conn, msg);
      } catch (e) {
        const err = e as GameError;
        this.send(conn, { type: 'error', code: err.code ?? 'error', message: err.message });
      }
    });
    ws.on('close', () => {
      this.conns.delete(conn);
      if (conn.competitorId && this.game) {
        const stillConnected = [...this.conns].some((c) => c.competitorId === conn.competitorId);
        if (!stillConnected) {
          this.game.setConnected(conn.competitorId, false, Date.now());
          this.broadcastState();
        }
      }
    });
  }

  private handleMessage(conn: Conn, msg: ClientMessage): void {
    const now = Date.now();
    if (msg.type === 'ping') return this.send(conn, { type: 'pong', t: msg.t, serverNow: now });
    if (msg.type === 'hello') {
      if (msg.role === 'console') {
        if (msg.consoleToken !== this.consoleToken) return this.send(conn, { type: 'error', code: 'unauthorized', message: 'invalid console token' });
        conn.role = 'console';
      } else if (msg.role === 'board') {
        conn.role = 'board';
      } else {
        conn.role = 'player';
        conn.competitorId = undefined;
        if (msg.token && this.game) {
          const c = this.game.findByToken(msg.token);
          if (c) {
            conn.competitorId = c.id;
            this.game.setConnected(c.id, true, now);
          }
        }
      }
      this.send(conn, {
        type: 'hello-ok',
        role: conn.role,
        serverNow: now,
        competitorId: conn.competitorId ?? null,
        tokenRecognized: msg.role === 'player' ? Boolean(msg.token && conn.competitorId) : false,
      });
      this.sendState(conn);
      if (conn.competitorId) this.broadcastState();
      return;
    }
    if (!conn.role) return this.send(conn, { type: 'error', code: 'no-hello', message: 'send hello first' });
    const g = this.game;

    if (conn.role === 'player') {
      if (!g) return this.send(conn, { type: 'error', code: 'no-session', message: 'no session open' });
      switch (msg.type) {
        case 'join-pool': {
          if (conn.competitorId) throw new GameError('already-joined', 'already joined');
          const c = g.joinPool({ name: clip(msg.name, 60), members: (msg.members ?? []).slice(0, 50).map((m) => clip(m, 40)) }, now);
          conn.competitorId = c.id;
          this.send(conn, { type: 'joined', competitorId: c.id, token: c.token });
          return this.broadcastState();
        }
        case 'join-bitaxe': {
          if (conn.competitorId) throw new GameError('already-joined', 'already joined');
          const c = g.joinBitaxe({ owner: msg.owner ? clip(msg.owner, 40) : undefined }, now);
          conn.competitorId = c.id;
          this.send(conn, { type: 'joined', competitorId: c.id, token: c.token });
          return this.broadcastState();
        }
        case 'update-me': {
          if (!conn.competitorId) throw new GameError('not-joined', 'join first');
          g.updateCompetitor(conn.competitorId, { name: msg.name !== undefined ? clip(msg.name, 60) : undefined, members: msg.members?.slice(0, 50).map((m) => clip(m, 40)) }, now);
          return this.broadcastState();
        }
        case 'answer': {
          if (!conn.competitorId) throw new GameError('not-joined', 'join first');
          const run = g.currentRun;
          if (!run || run.questionId !== msg.questionId) {
            return this.send(conn, { type: 'answer-ack', questionId: msg.questionId, accepted: false, reason: 'stale-question', optionIndex: msg.optionIndex, serverAt: now, clientId: msg.clientId });
          }
          const r = g.submitAnswer(conn.competitorId, msg.optionIndex, now);
          this.send(conn, { type: 'answer-ack', questionId: msg.questionId, accepted: r.accepted, reason: r.reason, optionIndex: msg.optionIndex, serverAt: now, clientId: msg.clientId });
          if (r.accepted) this.broadcastState();
          return;
        }
        default:
          throw new GameError('forbidden', `players cannot send ${(msg as { type: string }).type}`);
      }
    }

    if (conn.role === 'board') throw new GameError('forbidden', 'board is read-only');

    // console commands
    switch (msg.type) {
      case 'new-session': {
        const pack = msg.packName ? this.content.loadByName(msg.packName) : null;
        this.newSession(pack, msg.config);
        return;
      }
      default:
        break;
    }
    if (!g) throw new GameError('no-session', 'create a session first');
    switch (msg.type) {
      case 'set-config':
        g.setConfig(msg.patch, now);
        break;
      case 'set-content':
        g.setContent(this.content.loadByName(msg.packName), now);
        break;
      case 'update-question':
        g.updateQuestion(msg.id, { durationMs: msg.durationMs, difficulty: msg.difficulty }, now);
        break;
      case 'remove-competitor':
        g.removeCompetitor(msg.id, now);
        break;
      case 'update-competitor':
        g.updateCompetitor(msg.id, { name: msg.name, members: msg.members }, now);
        break;
      case 'start-round':
        g.startRound(msg.index, now, g.state.blockFeed.tipHeight);
        break;
      case 'open-question':
        g.openNextQuestion(now, msg.durationMs);
        this.rescheduleClose();
        break;
      case 'close-question':
        clearTimeout(this.closeTimer);
        g.closeQuestion(now);
        break;
      case 'cancel-question':
        clearTimeout(this.closeTimer);
        g.cancelQuestion(now);
        break;
      case 'end-round':
        g.endRound(now);
        break;
      case 'set-prizes':
        g.setPrizesDraft(msg.prizes.map((p, i) => ({ id: p.id ?? '', label: clip(p.label, 80), rank: p.rank ?? i + 1 })), now);
        break;
      case 'draw-prizes':
        g.drawPrizes({ roundIndexes: msg.roundIndexes, scope: msg.scope }, now);
        break;
      case 'set-block-mode':
        this.setBlockMode(msg.mode);
        break;
      case 'simulate-block':
        this.simulateBlock();
        break;
      default:
        throw new GameError('unknown', `unknown command ${(msg as { type: string }).type}`);
    }
    this.broadcastState();
  }

  private send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private viewFor(conn: Conn) {
    const g = this.game;
    if (!g) return null;
    const joinUrl = this.joinUrl();
    if (conn.role === 'console') {
      const addr = this.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
      return consoleView(g.state, { joinUrl, contentPacks: this.content.list(), serverInfo: { lanUrls: this.lanUrls(), port, dataDir: this.store.dataDir, version: VERSION } });
    }
    if (conn.role === 'player') return playerView(g.state, conn.competitorId, joinUrl);
    return boardView(g.state, joinUrl);
  }

  private sendState(conn: Conn): void {
    const view = this.viewFor(conn);
    if (!view) return this.send(conn, { type: 'error', code: 'no-session', message: 'no session open' });
    this.send(conn, { type: 'state', serverNow: Date.now(), view });
  }

  broadcastState(): void {
    for (const c of this.conns) if (c.role) this.sendState(c);
  }

  private broadcastEvent(ev: SessionState['recentEvents'][number]): void {
    const now = Date.now();
    for (const c of this.conns) if (c.role === 'console' || c.role === 'board') this.send(c, { type: 'event', serverNow: now, event: ev });
  }
}

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function clip(s: unknown, max: number): string {
  return String(s ?? '').slice(0, max);
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(4);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}
