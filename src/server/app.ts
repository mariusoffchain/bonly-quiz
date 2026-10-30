import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';
import { Game, GameError } from '../shared/game.js';
import type { ContentPack } from '../shared/types.js';
import { boardView, consoleView, playerView, type ClientMessage, type ServerMessage } from '../shared/views.js';
import { ContentLibrary } from './content.js';
import { Store } from './store.js';

const VERSION = '0.2.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  port: number;
  host?: string;
  dataDir: string;
  contentDir: string;
  consoleToken?: string;
  /** Base URL phones should open (e.g. http://192.168.1.20:8787). Computed from the LAN IP when absent. */
  publicUrl?: string;
  /** Port phones should open (dev: the Vite port). Defaults to this server's port. */
  publicPort?: number;
  /** Serve the built client from this directory when it exists. */
  clientDist?: string;
  quiet?: boolean;
}

interface Conn {
  ws: WebSocket;
  role?: 'player' | 'board' | 'console';
  playerId?: string;
}

export class App {
  readonly store: Store;
  readonly content: ContentLibrary;
  readonly consoleToken: string;
  readonly server: http.Server;
  readonly wss: WebSocketServer;
  game!: Game;
  private conns = new Set<Conn>();
  private closeTimer?: NodeJS.Timeout;
  private revealTimer?: NodeJS.Timeout;
  private broadcastTimer?: NodeJS.Timeout;
  private clientDist: string;

  constructor(public readonly opts: AppOptions) {
    this.store = new Store(opts.dataDir);
    this.content = new ContentLibrary(opts.contentDir);
    this.consoleToken = this.store.consoleToken(opts.consoleToken);
    this.clientDist = opts.clientDist ?? path.resolve(__dirname, '../../client');
    this.server = http.createServer((req, res) => void this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleWs(ws));
    if (!this.restore()) this.newSession();
  }

  log(...args: unknown[]): void {
    if (!this.opts.quiet) console.log('[quiz]', ...args);
  }

  // ------------------------------------------------------------- lifecycle
  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', resolve));
    return this.port();
  }

  async close(): Promise<void> {
    clearTimeout(this.closeTimer);
    clearTimeout(this.revealTimer);
    clearTimeout(this.broadcastTimer);
    for (const c of this.conns) c.ws.close();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.store.saveSnapshot(this.game.state, true);
  }

  private restore(): boolean {
    const code = this.store.getCurrent();
    const state = code ? this.store.loadSnapshot(code) : null;
    if (!state) return false;
    for (const p of Object.values(state.players)) p.connected = false;
    this.attach(new Game(state));
    this.log(`restored session ${state.code} (${state.phase}, question ${state.current + 1})`);
    this.scheduleTimers();
    return true;
  }

  private attach(game: Game): void {
    this.game = game;
    game.onEvent((ev) => {
      this.store.appendEvent(game.state.code, ev);
      this.store.saveSnapshot(game.state);
    });
    this.store.setCurrent(game.state.code);
    this.store.saveSnapshot(game.state, true);
  }

  newSession(pack?: ContentPack): Game {
    const content = pack ?? this.content.defaultPack();
    if (!content) throw new Error(`no content pack found in ${this.opts.contentDir}`);
    const previous = this.game;
    if (previous) this.store.saveSnapshot(previous.state, true);
    clearTimeout(this.closeTimer);
    clearTimeout(this.revealTimer);
    const game = Game.create(randomCode(), Date.now(), content, previous ? { ...previous.state.config } : {});
    for (const c of this.conns) if (c.role === 'player') c.playerId = undefined;
    this.attach(game);
    this.log(`new session ${game.state.code} with "${content.name}" (${game.total} questions)`);
    this.broadcast();
    return game;
  }

  // ---------------------------------------------------------------- timers
  private scheduleTimers(): void {
    clearTimeout(this.closeTimer);
    clearTimeout(this.revealTimer);
    const g = this.game;
    const now = Date.now();
    if (g.phase === 'question' && g.run) {
      this.closeTimer = setTimeout(() => {
        if (g === this.game && g.phase === 'question') g.closeQuestion(Date.now());
        this.broadcast();
      }, Math.max(0, g.run.closesAt - now));
    }
    const mining = g.miningBlock(now);
    if (mining) {
      this.revealTimer = setTimeout(() => {
        this.log(`block ${mining.n} found by ${g.state.players[mining.winnerId ?? '']?.name ?? 'nobody'}`);
        this.broadcast();
      }, mining.revealAt - now + 20);
    }
  }

  /** Reveal the answer early once every connected player has answered. */
  private closeIfAllAnswered(): boolean {
    const g = this.game;
    if (!g.state.config.closeWhenAllAnswered || !g.allAnswered()) return false;
    g.closeQuestion(Date.now());
    this.scheduleTimers();
    this.broadcast();
    return true;
  }

  // ------------------------------------------------------------------- URLs
  private port(): number {
    const addr = this.server.address();
    return typeof addr === 'object' && addr ? addr.port : this.opts.port;
  }

  lanUrls(): string[] {
    const port = this.opts.publicPort ?? this.port();
    const out: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
    }
    return out;
  }

  joinUrl(): string {
    const base = this.opts.publicUrl ?? this.lanUrls()[0] ?? `http://localhost:${this.opts.publicPort ?? this.port()}`;
    return `${base.replace(/\/$/, '')}/play`;
  }

  // ------------------------------------------------------------------- HTTP
  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/health') return json(res, { ok: true, version: VERSION, session: this.game.state.code, phase: this.game.phase });
      if (url.pathname === '/api/qr.svg') {
        const text = url.searchParams.get('text') || this.joinUrl();
        const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#111110', light: '#ffffff' } });
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
        return void res.end(svg);
      }
      if (url.pathname === '/api/console/check' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}') as { token?: string };
        return json(res, { ok: body.token === this.consoleToken });
      }
      if (url.pathname === '/api/export') {
        if (req.headers['x-console-token'] !== this.consoleToken && url.searchParams.get('token') !== this.consoleToken) {
          return json(res, { error: 'unauthorized' }, 401);
        }
        const code = this.game.state.code;
        const eventsPath = this.store.eventsPath(code);
        const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
        res.setHeader('content-disposition', `attachment; filename="bonly-quiz-${code}.json"`);
        return json(res, { snapshot: this.game.state, events });
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
        `<!doctype html><meta charset="utf-8"><title>bonly-quiz</title><body style="font-family:system-ui;background:#0d0f17;color:#fff;padding:2rem">` +
          `<h1>bonly-quiz</h1><p>Client non compilé. En développement ouvrez le port 5173 (<code>npm run dev</code>), ` +
          `sinon lancez <code>npm run build</code> puis <code>npm start</code>.</p></body>`,
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
      const id = conn.playerId;
      if (id && ![...this.conns].some((c) => c.playerId === id)) {
        this.game.setConnected(id, false);
        if (!this.closeIfAllAnswered()) this.broadcastSoon();
      }
    });
  }

  private handleMessage(conn: Conn, msg: ClientMessage): void {
    const now = Date.now();
    const g = this.game;
    if (msg.type === 'ping') return this.send(conn, { type: 'pong', t: msg.t, serverNow: now });
    if (msg.type === 'hello') {
      if (msg.role === 'console') {
        if (msg.consoleToken !== this.consoleToken) return this.send(conn, { type: 'error', code: 'unauthorized', message: 'Jeton console invalide.' });
        conn.role = 'console';
      } else if (msg.role === 'board') {
        conn.role = 'board';
      } else {
        conn.role = 'player';
        const p = msg.token ? g.findByToken(msg.token) : undefined;
        conn.playerId = p?.id;
        if (p) g.setConnected(p.id, true);
      }
      this.send(conn, { type: 'hello-ok', role: conn.role, serverNow: now, playerId: conn.playerId ?? null, tokenRecognized: Boolean(conn.playerId) });
      this.sendState(conn);
      if (conn.playerId) this.broadcastSoon();
      return;
    }
    if (!conn.role) throw new GameError('no-hello', 'send hello first');

    if (conn.role === 'player') {
      if (msg.type === 'join') {
        if (conn.playerId) throw new GameError('already-joined', 'Déjà inscrit.');
        const p = g.join(String(msg.name ?? ''), now);
        conn.playerId = p.id;
        this.send(conn, { type: 'joined', playerId: p.id, token: p.token });
        return this.broadcast();
      }
      if (msg.type === 'answer') {
        if (!conn.playerId) throw new GameError('not-joined', 'Inscrivez-vous d’abord.');
        const r = g.answer(conn.playerId, msg.questionIndex, msg.option, now);
        this.send(conn, { type: 'answer-ack', questionIndex: msg.questionIndex, option: msg.option, ok: r.ok, reason: r.reason });
        if (r.ok && this.closeIfAllAnswered()) return;
        if (r.ok) this.sendState(conn);
        return this.broadcastSoon();
      }
      throw new GameError('forbidden', `players cannot send ${msg.type}`);
    }
    if (conn.role === 'board') throw new GameError('forbidden', 'board is read-only');

    switch (msg.type) {
      case 'next':
        g.advance(msg.key, now, { label: msg.label });
        break;
      case 'cancel-question':
        g.cancelQuestion(now);
        break;
      case 'remove-player':
        g.removePlayer(msg.id, now);
        for (const c of this.conns) if (c.playerId === msg.id) c.playerId = undefined;
        if (this.closeIfAllAnswered()) return;
        break;
      case 'rename-player':
        g.rename(msg.id, msg.name, now);
        break;
      case 'set-config':
        g.setConfig(msg.patch, now);
        break;
      case 'set-pack':
        g.setPack(this.content.load(msg.file), now);
        break;
      case 'new-session':
        this.newSession();
        return;
      default:
        throw new GameError('unknown', `unknown command ${(msg as { type: string }).type}`);
    }
    this.scheduleTimers();
    this.broadcast();
  }

  // -------------------------------------------------------------- broadcast
  private send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private sendState(conn: Conn): void {
    const now = Date.now();
    const g = this.game;
    const joinUrl = this.joinUrl();
    const view =
      conn.role === 'console'
        ? consoleView(g, now, joinUrl, { packs: this.content.list(), lanUrls: this.lanUrls() })
        : conn.role === 'player'
          ? playerView(g, now, joinUrl, conn.playerId)
          : boardView(g, now, joinUrl);
    this.send(conn, { type: 'state', serverNow: now, view });
  }

  broadcast(): void {
    clearTimeout(this.broadcastTimer);
    this.broadcastTimer = undefined;
    for (const c of this.conns) if (c.role) this.sendState(c);
  }

  /** Coalesce frequent updates (answers, reconnections) into one broadcast. */
  private broadcastSoon(): void {
    this.broadcastTimer ??= setTimeout(() => this.broadcast(), 150);
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

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(4);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
}
