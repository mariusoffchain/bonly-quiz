import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnyView, ClientHello, ClientMessage, ServerMessage } from '../../shared/views';
import type { GameEvent } from '../../shared/types';

export type ConnState = 'connecting' | 'open' | 'closed';

export interface Socket<V extends AnyView> {
  view: V | null;
  conn: ConnState;
  /** Estimated server clock: Date.now() + offset. */
  serverNow: () => number;
  send: (msg: ClientMessage) => void;
  lastError: { code: string; message: string } | null;
  clearError: () => void;
  onMessage: (fn: (m: ServerMessage) => void) => () => void;
  events: GameEvent[];
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Resilient WebSocket hook. Reconnects with backoff, re-sends the hello (which
 * carries the reconnection token), and keeps a server clock offset so countdowns
 * follow the server's authoritative time rather than the phone's.
 */
export function useQuizSocket<V extends AnyView>(makeHello: () => ClientHello): Socket<V> {
  const [view, setView] = useState<V | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [lastError, setLastError] = useState<Socket<V>['lastError']>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const listeners = useRef(new Set<(m: ServerMessage) => void>());
  const makeHelloRef = useRef(makeHello);
  makeHelloRef.current = makeHello;

  useEffect(() => {
    let alive = true;
    let delay = 500;
    let pingTimer: number | undefined;
    const connect = () => {
      if (!alive) return;
      setConn('connecting');
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        delay = 500;
        setConn('open');
        ws.send(JSON.stringify(makeHelloRef.current()));
        pingTimer = window.setInterval(() => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        }, 15_000);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if ('serverNow' in msg && typeof msg.serverNow === 'number') {
          // Smooth the estimate a little; one-way latency on a LAN is small.
          const sample = msg.serverNow - Date.now();
          offsetRef.current = offsetRef.current === 0 ? sample : offsetRef.current * 0.7 + sample * 0.3;
        }
        if (msg.type === 'pong') {
          const rtt = Date.now() - msg.t;
          offsetRef.current = msg.serverNow + rtt / 2 - Date.now();
        }
        if (msg.type === 'state') setView(msg.view as V);
        if (msg.type === 'error') setLastError({ code: msg.code, message: msg.message });
        if (msg.type === 'event') setEvents((prev) => [...prev.slice(-49), msg.event]);
        for (const l of listeners.current) l(msg);
      };
      ws.onclose = () => {
        window.clearInterval(pingTimer);
        setConn('closed');
        if (!alive) return;
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, 5000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      alive = false;
      window.clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    else setLastError({ code: 'offline', message: 'Connexion au serveur perdue, nouvel essai en cours' });
  }, []);

  const onMessage = useCallback((fn: (m: ServerMessage) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  return {
    view,
    conn,
    serverNow: () => Date.now() + offsetRef.current,
    send,
    lastError,
    clearError: () => setLastError(null),
    onMessage,
    events,
  };
}

/** Re-render every `ms` so countdowns tick. */
export function useTicker(ms = 100): number {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return Date.now();
}
