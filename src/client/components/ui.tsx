import { useEffect, useMemo, useState } from 'react';
import type { BlockPublic, PlayerPublic, PublicConfig } from '../../shared/views';
import { initials, pct, playerColor, ths } from '../lib/format';
import { remaining, useTicker } from '../lib/ws';

export function Avatar({ name, color, size = 32 }: { name: string; color: number; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: playerColor(color) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function TimerRing({ closesAt, durationMs, serverNow, size = 120 }: { closesAt: number; durationMs: number; serverNow: () => number; size?: number }) {
  useTicker(100);
  const { ms, frac } = remaining(closesAt, durationMs, serverNow());
  const r = 45;
  const c = 2 * Math.PI * r;
  const urgent = ms < 5000;
  return (
    <div className={'timer-ring' + (urgent ? ' urgent' : '')} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="track" />
        <circle cx="50" cy="50" r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span style={{ fontSize: size * 0.34 }}>{Math.ceil(ms / 1000)}</span>
    </div>
  );
}

export function TimerBar({ closesAt, durationMs, serverNow }: { closesAt: number; durationMs: number; serverNow: () => number }) {
  useTicker(100);
  const { ms, frac } = remaining(closesAt, durationMs, serverNow());
  return (
    <div className={'timer-bar' + (ms < 5000 ? ' urgent' : '')}>
      <div style={{ width: `${frac * 100}%` }} />
      <span>{Math.ceil(ms / 1000)} s</span>
    </div>
  );
}

/** The whole network as one bar: each player's slice is their chance of finding the block. */
export function NetworkBar({ players, highlightId }: { players: PlayerPublic[]; highlightId?: string }) {
  const visible = players.filter((p) => p.share > 0);
  if (visible.length === 0) return <div className="network-bar empty">Pas encore de hashrate</div>;
  return (
    <div className="network-bar">
      {visible.map((p) => (
        <div
          key={p.id}
          title={`${p.name} · ${pct(p.share)}`}
          className={p.id === highlightId ? 'me' : ''}
          style={{ flexGrow: p.share, background: playerColor(p.color) }}
        />
      ))}
    </div>
  );
}

export function Leaderboard({
  players,
  limit = 10,
  highlightId,
  showGain = false,
  winners = [],
}: {
  players: PlayerPublic[];
  limit?: number;
  highlightId?: string;
  showGain?: boolean;
  winners?: string[];
}) {
  const top = players.slice(0, limit);
  const me = highlightId ? players.find((p) => p.id === highlightId) : undefined;
  const rows = me && !top.includes(me) ? [...top, me] : top;
  const max = Math.max(1, ...players.map((p) => p.hashrate));
  if (players.length === 0) return <div className="muted">Personne pour l’instant.</div>;
  return (
    <ol className="leaderboard">
      {rows.map((p) => (
        <li key={p.id} className={(p.id === highlightId ? 'me ' : '') + (p.connected ? '' : 'offline')}>
          <span className="rank">{p.rank}</span>
          <Avatar name={p.name} color={p.color} size={30} />
          <span className="name">
            <span className="nm">{p.name}</span>
            {winners.includes(p.id) ? <span className="tag-block" title="A trouvé un bloc">⛏</span> : null}
            {p.streak >= 2 ? <span className="streak">🔥{p.streak}</span> : null}
          </span>
          <span className="bar">
            <span style={{ width: `${(p.hashrate / max) * 100}%`, background: playerColor(p.color) }} />
          </span>
          {showGain ? <span className={'gain' + (p.lastGain ? '' : ' zero')}>{p.lastGain ? `+${ths(p.lastGain, false)}` : '+0'}</span> : null}
          <span className="hr">{ths(p.hashrate)}</span>
          <span className="share">{pct(p.share)}</span>
        </li>
      ))}
    </ol>
  );
}

export function Rules({ config }: { config: PublicConfig }) {
  const g = config.baseGainThs;
  return (
    <ul className="rules">
      <li>
        <b>✅ Bonne réponse</b>
        <span>
          {g.easy} à {g.hard} TH/s selon la difficulté
        </span>
      </li>
      <li>
        <b>⚡ Rapidité</b>
        <span>jusqu’à +{Math.round(config.speedBonusMax * 100)} % si vous répondez vite</span>
      </li>
      <li>
        <b>🔥 Série</b>
        <span>
          +{Math.round(config.streakBonusStep * 100)} % par bonne réponse d’affilée, jusqu’à +{Math.round(config.streakBonusMax * 100)} %
        </span>
      </li>
      <li>
        <b>⛏️ Le bloc final</b>
        <span>plus vous avez de hashrate, plus vous avez de chances de le trouver. Rien n’est garanti.</span>
      </li>
    </ul>
  );
}

export function ConnBadge({ conn }: { conn: 'connecting' | 'open' | 'closed' }) {
  if (conn === 'open') return null;
  return <div className="conn-badge">{conn === 'connecting' ? 'Connexion…' : 'Connexion perdue, reconnexion…'}</div>;
}

const HEX = '0123456789abcdef';
let lineSeq = 0;
const randomHash = () => Array.from({ length: 24 }, () => HEX[Math.floor(Math.random() * 16)]).join('');

/** Mining animation, then the block reveal. The server fixes the winner; this is only theatre. */
export function MiningScene({
  block,
  players,
  serverNow,
  meId,
  compact = false,
}: {
  block: BlockPublic;
  players: PlayerPublic[];
  serverNow: () => number;
  meId?: string;
  compact?: boolean;
}) {
  useTicker(100);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const candidates = useMemo(() => [...block.candidates].sort((a, b) => b.share - a.share), [block.candidates]);
  const [lines, setLines] = useState<{ id: string; hash: string; k: number }[]>([]);
  const mining = !block.found;

  useEffect(() => {
    if (!mining) return;
    const pick = () => {
      let r = Math.random();
      for (const c of candidates) {
        r -= c.share;
        if (r <= 0) return c.id;
      }
      return candidates[0]?.id ?? '';
    };
    const id = window.setInterval(() => {
      setLines((prev) => [{ id: pick(), hash: randomHash(), k: ++lineSeq }, ...prev].slice(0, compact ? 4 : 9));
    }, 110);
    return () => window.clearInterval(id);
  }, [mining, candidates, compact]);

  const elapsed = Math.max(0, serverNow() - block.startedAt);
  const progress = Math.min(1, elapsed / Math.max(1, block.revealAt - block.startedAt));
  const nonce = Math.floor(elapsed * 9_871);

  if (mining) {
    const mine = meId ? candidates.find((c) => c.id === meId) : undefined;
    return (
      <div className={'mining' + (compact ? ' compact' : '')}>
        <div className="mining-head">
          <div className="cube spinning" />
          <div>
            <div className="eyebrow">Minage du bloc {block.n}{block.label ? ` · ${block.label}` : ''}</div>
            <div className="mining-title">Recherche d’un hash valide…</div>
            <div className="mono muted">nonce {nonce.toLocaleString('fr-FR')}</div>
          </div>
        </div>
        {meId ? (
          <div className="my-chance">{mine ? <>Vos chances : <b>{pct(mine.share)}</b></> : 'Vous ne participez pas à ce tirage.'}</div>
        ) : null}
        <div className="hash-stream">
          {lines.map((l) => {
            const p = byId.get(l.id);
            return (
              <div key={l.k} className="hash-line">
                <span className="dot" style={{ background: playerColor(p?.color ?? 0) }} />
                <span className="mono">{l.hash}</span>
                <span className="who">{p?.name}</span>
                <span className="ko">✗</span>
              </div>
            );
          })}
        </div>
        <div className="progress">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
    );
  }

  const winner = block.winnerId ? byId.get(block.winnerId) : undefined;
  const chance = candidates.find((c) => c.id === block.winnerId)?.share ?? 0;
  const favourite = candidates[0];
  const upset = favourite && block.winnerId && favourite.id !== block.winnerId;
  return (
    <div className={'block-found' + (compact ? ' compact' : '') + (meId && meId === block.winnerId ? ' mine' : '')}>
      <div className="eyebrow">Bloc {block.n} trouvé{block.label ? ` · ${block.label}` : ''}</div>
      {winner ? (
        <>
          <Avatar name={winner.name} color={winner.color} size={compact ? 64 : 120} />
          <div className="winner-name">{meId === winner.id ? 'Vous avez trouvé le bloc !' : winner.name}</div>
          <div className="muted">avec {pct(chance)} des chances</div>
        </>
      ) : (
        <div className="winner-name">Aucun gagnant</div>
      )}
      <div className="block-hash mono">
        <span className="zeros">{block.hash?.slice(0, 10)}</span>
        {block.hash?.slice(10, compact ? 30 : 64)}
        {compact ? '…' : ''}
      </div>
      {upset && !compact ? <div className="upset">Le plus gros mineur ({byId.get(favourite.id)?.name}, {pct(favourite.share)}) n’a pas gagné : la preuve de travail est une loterie.</div> : null}
    </div>
  );
}
