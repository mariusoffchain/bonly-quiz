import WebSocket from 'ws';
import type { BlockInfo } from '../shared/types.js';

export interface BlockSourceEvents {
  onBlock: (block: BlockInfo) => void;
  onHistory: (blocks: BlockInfo[]) => void;
  onStatus: (s: { connected: boolean; lastError?: string; tipHeight?: number | null; lastMessageAt?: number }) => void;
}

interface MempoolBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count?: number;
  extras?: { pool?: { name?: string } };
}

const toInfo = (b: MempoolBlock, origin: BlockInfo['origin'] = 'real'): BlockInfo => ({
  id: b.id,
  height: b.height,
  timestamp: b.timestamp,
  txCount: b.tx_count,
  pool: b.extras?.pool?.name,
  origin,
  receivedAt: Date.now(),
});

/**
 * Live Bitcoin blocks from the public mempool.space API: WebSocket push for
 * immediacy, REST baseline at (re)connection, and a REST poll as a safety net.
 * This never mines anything; it only observes the chain tip.
 */
export class MempoolBlockSource {
  private ws?: WebSocket;
  private stopped = false;
  private reconnectDelay = 1000;
  private pollTimer?: NodeJS.Timeout;
  private pingTimer?: NodeJS.Timeout;
  private lastMessageAt = 0;
  readonly endpoint: string;

  constructor(private events: BlockSourceEvents, private baseUrl = 'https://mempool.space') {
    this.endpoint = baseUrl.replace(/^http/, 'ws') + '/api/v1/ws';
  }

  start(): void {
    this.stopped = false;
    void this.fetchBaseline();
    this.connect();
    this.pollTimer = setInterval(() => void this.poll(), 20_000);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = undefined;
    this.events.onStatus({ connected: false });
  }

  private async fetchBaseline(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/blocks`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blocks = (await res.json()) as MempoolBlock[];
      this.events.onHistory(blocks.map((b) => toInfo(b)));
    } catch (e) {
      this.events.onStatus({ connected: this.ws?.readyState === WebSocket.OPEN, lastError: `baseline: ${(e as Error).message}` });
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/blocks`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blocks = (await res.json()) as MempoolBlock[];
      // Newest last so the game sees them in chain order; dedup happens in the game.
      for (const b of [...blocks].sort((a, b) => a.height - b.height)) this.events.onBlock(toInfo(b));
      this.lastMessageAt = Date.now();
      this.events.onStatus({ connected: this.ws?.readyState === WebSocket.OPEN, lastMessageAt: this.lastMessageAt });
    } catch (e) {
      this.events.onStatus({ connected: this.ws?.readyState === WebSocket.OPEN, lastError: `poll: ${(e as Error).message}` });
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.endpoint);
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectDelay = 1000;
      ws.send(JSON.stringify({ action: 'want', data: ['blocks'] }));
      this.events.onStatus({ connected: true, lastError: undefined });
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }));
      }, 30_000);
    });
    ws.on('message', (data) => {
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(data.toString()) as { block?: MempoolBlock; blocks?: MempoolBlock[] };
        if (Array.isArray(msg.blocks)) this.events.onHistory(msg.blocks.map((b) => toInfo(b)));
        if (msg.block && msg.block.id) this.events.onBlock(toInfo(msg.block));
        this.events.onStatus({ connected: true, lastMessageAt: this.lastMessageAt });
      } catch (e) {
        this.events.onStatus({ connected: true, lastError: `parse: ${(e as Error).message}` });
      }
    });
    const onDown = (why: string) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.events.onStatus({ connected: false, lastError: why });
      if (this.stopped) return;
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    };
    ws.on('close', (code) => onDown(`ws closed (${code})`));
    ws.on('error', (err) => onDown(`ws error: ${err.message}`));
  }
}

/** Simulated blocks for tests and rehearsals. Clearly tagged, never mixed with real ones. */
export class SimulatedBlockSource {
  private height: number;
  constructor(private events: Pick<BlockSourceEvents, 'onBlock'>, startHeight = 900_000) {
    this.height = startHeight;
  }
  next(pool = 'Simulation'): BlockInfo {
    this.height += 1;
    const b: BlockInfo = {
      id: `sim-${this.height}-${Date.now().toString(36)}`,
      height: this.height,
      timestamp: Math.floor(Date.now() / 1000),
      pool,
      origin: 'simulated',
      receivedAt: Date.now(),
    };
    this.events.onBlock(b);
    return b;
  }
}
