import fs from 'node:fs';
import path from 'node:path';
import type { GameEvent, SessionState } from '../shared/types.js';

/**
 * Disk persistence: one JSON snapshot per session (atomic write, debounced) and an
 * append-only JSONL audit log of every game event, so calculations and winners
 * can be reconstructed after the fact.
 */
export class Store {
  constructor(public readonly dataDir: string) {
    fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
  }

  snapshotPath(code: string): string {
    return path.join(this.dataDir, 'sessions', `${code}.json`);
  }
  eventsPath(code: string): string {
    return path.join(this.dataDir, 'sessions', `${code}.events.jsonl`);
  }

  private timers = new Map<string, NodeJS.Timeout>();

  saveSnapshot(state: SessionState, immediate = false): void {
    const write = () => {
      const p = this.snapshotPath(state.code);
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, p);
    };
    if (immediate) {
      clearTimeout(this.timers.get(state.code));
      this.timers.delete(state.code);
      write();
      return;
    }
    if (this.timers.has(state.code)) return;
    this.timers.set(
      state.code,
      setTimeout(() => {
        this.timers.delete(state.code);
        try {
          write();
        } catch (e) {
          console.error('[store] snapshot failed', e);
        }
      }, 150),
    );
  }

  appendEvent(code: string, ev: GameEvent): void {
    fs.appendFileSync(this.eventsPath(code), JSON.stringify(ev) + '\n');
  }

  /** Snapshots from the earlier round-based format (no version 2) are not restored. */
  loadSnapshot(code: string): SessionState | null {
    const p = this.snapshotPath(code);
    if (!fs.existsSync(p)) return null;
    const state = JSON.parse(fs.readFileSync(p, 'utf8')) as SessionState;
    return state.version === 2 ? state : null;
  }

  setCurrent(code: string | null): void {
    const p = path.join(this.dataDir, 'current.json');
    if (code === null) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    fs.writeFileSync(p, JSON.stringify({ code, updatedAt: Date.now() }));
  }

  getCurrent(): string | null {
    const p = path.join(this.dataDir, 'current.json');
    if (!fs.existsSync(p)) return null;
    try {
      return (JSON.parse(fs.readFileSync(p, 'utf8')) as { code: string }).code;
    } catch {
      return null;
    }
  }

  /** Console token: from env, else generated once and kept in data/console-token.txt. */
  consoleToken(envValue?: string): string {
    if (envValue && envValue.trim()) return envValue.trim();
    const p = path.join(this.dataDir, 'console-token.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    const b = new Uint8Array(12);
    globalThis.crypto.getRandomValues(b);
    const token = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    fs.writeFileSync(p, token + '\n', { mode: 0o600 });
    return token;
  }
}
