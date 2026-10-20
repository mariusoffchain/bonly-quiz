import { useEffect, useRef, useState } from 'react';
import type { BlockBonusEvent, BlockFeedStatus, BlockInfo } from '../../shared/types';
import type { CompetitorView } from '../../shared/views';
import { colorFor, pctText, ths, timeAgo } from '../lib/format';
import { useTicker } from '../lib/ws';

export function ConnDot({ state }: { state: 'connecting' | 'open' | 'closed' }) {
  return <span className={'conn ' + (state === 'open' ? '' : state === 'closed' ? 'off' : 'wait')} />;
}

export function FeedBadge({ feed }: { feed: BlockFeedStatus }) {
  const now = useTicker(1000);
  if (feed.mode === 'off') return <span className="badge off">Blocs désactivés</span>;
  if (feed.mode === 'simulated') return <span className="badge sim">Simulation de blocs</span>;
  const stale = feed.lastMessageAt ? now - feed.lastMessageAt > 90_000 : true;
  if (!feed.connected && stale) return <span className="badge down">Flux de blocs interrompu</span>;
  if (!feed.connected) return <span className="badge down">Flux de blocs reconnexion…</span>;
  return <span className="badge real">Blocs réels, mempool.space</span>;
}

/** Pool ranking list: bar = share of the total fictitious hashrate. */
export function PoolList({ competitors, meId, highlightId }: { competitors: CompetitorView[]; meId?: string; highlightId?: string | null }) {
  const colorIndex = useColorIndex(competitors);
  if (competitors.length === 0) return <div className="muted small">Aucun concurrent pour l’instant.</div>;
  return (
    <div className="pool-list">
      {competitors.map((c) => (
        <div key={c.id} className={'pool-row' + (c.connected ? '' : ' offline') + (c.id === meId ? ' me' : '') + (c.id === highlightId ? ' flash' : '')}>
          <div className="bar" style={{ width: `${Math.max(0, c.share * 100)}%`, background: colorFor(colorIndex.get(c.id) ?? 0) }} />
          <div className="dot" style={{ background: colorFor(colorIndex.get(c.id) ?? 0) }} />
          <div className="name" title={c.members.join(', ')}>
            {c.name}
            <span className="kind">{c.kind === 'pool' ? `pool · ${c.members.length}` : 'solo'}</span>
          </div>
          <div className="hr">
            <div>{ths(c.hashrate)}</div>
            <div className="share">{pctText(c.share)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stable colour per competitor by join order (not by rank), so colours don't jump. */
export function useColorIndex(competitors: CompetitorView[]): Map<string, number> {
  const ref = useRef(new Map<string, number>());
  for (const c of competitors) if (!ref.current.has(c.id)) ref.current.set(c.id, ref.current.size);
  return ref.current;
}

export function Donut({ competitors, size = 220 }: { competitors: CompetitorView[]; size?: number }) {
  const colorIndex = useColorIndex(competitors);
  const r = 44;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const segs = competitors.filter((c) => c.share > 0);
  return (
    <svg className="donut" viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Parts de hashrate">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--secondary)" strokeWidth="16" />
      {segs.map((c) => {
        const len = c.share * circ;
        const el = (
          <circle key={c.id} cx="60" cy="60" r={r} fill="none" stroke={colorFor(colorIndex.get(c.id) ?? 0)} strokeWidth="16" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray .6s, stroke-dashoffset .6s' }} />
        );
        acc += len;
        return el;
      })}
      <text x="60" y="56" textAnchor="middle" fill="var(--fg)" fontSize="9" fontFamily="var(--mono)" fontWeight="700">
        {segs.length} {segs.length > 1 ? 'pools' : 'pool'}
      </text>
      <text x="60" y="68" textAnchor="middle" fill="var(--tooltip-grey)" fontSize="6">
        parts du hashrate fictif
      </text>
    </svg>
  );
}

/** Real Bitcoin blocks (or simulated ones, visibly orange), newest on the left as on mempool. */
export function BlocksStrip({ blocks, bonuses, names, limit = 5 }: { blocks: BlockInfo[]; bonuses: BlockBonusEvent[]; names: Map<string, string>; limit?: number }) {
  const now = useTicker(1000);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => setSeen(new Set(blocks.map((b) => b.id))), 900);
    return () => clearTimeout(t);
  }, [blocks]);
  // Simulated blocks (rehearsals) are shown first so they stay visible next to real history.
  const sims = bonuses.filter((b) => b.origin === 'simulated').map(simToBlock).sort((a, b) => b.height - a.height);
  const list = [...sims, ...[...blocks].sort((a, b) => b.height - a.height)].slice(0, limit);
  const bonusByBlock = new Map(bonuses.map((b) => [b.blockId, b]));
  return (
    <div className="blocks-strip">
      {list.map((b) => {
        const bonus = bonusByBlock.get(b.id);
        return (
          <div key={b.id} className={'bitcoin-block' + (b.origin === 'simulated' ? ' sim' : '') + (seen.has(b.id) ? '' : ' new')}>
            <div className="height">{b.height.toLocaleString('fr-FR')}</div>
            <div className="body">
              <div className="pool">{b.pool ?? (b.origin === 'simulated' ? 'Simulation' : '…')}</div>
              {b.txCount ? <div>{b.txCount.toLocaleString('fr-FR')} tx</div> : null}
              <div className="ago">{timeAgo(b.timestamp, now)}</div>
            </div>
            {bonus ? <div className="winner">{bonus.winnerId ? `+2,1 % → ${names.get(bonus.winnerId) ?? '?'}` : 'aucun éligible'}</div> : null}
          </div>
        );
      })}
      {list.length === 0 ? <div className="muted small">En attente des blocs…</div> : null}
    </div>
  );
}

function simToBlock(b: BlockBonusEvent): BlockInfo {
  return { id: b.blockId, height: b.height, timestamp: Math.floor(b.at / 1000), origin: 'simulated', receivedAt: b.at, pool: 'Simulation' };
}

export function Countdown({ closesAt, durationMs, serverNow, small }: { closesAt: number; durationMs: number; serverNow: () => number; small?: boolean }) {
  useTicker(50);
  const left = Math.max(0, closesAt - serverNow());
  const frac = durationMs > 0 ? left / durationMs : 0;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const color = left <= 3000 ? 'var(--red)' : left <= 6000 ? 'var(--orange)' : 'var(--primary)';
  return (
    <div className={'countdown' + (small ? ' small' : '')} aria-label={`Temps restant ${Math.ceil(left / 1000)} s`}>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--secondary)" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${frac * circ} ${circ}`} />
      </svg>
      <div className="num" style={{ color }}>
        {(left / 1000).toFixed(left < 10_000 ? 1 : 0)}
      </div>
    </div>
  );
}
