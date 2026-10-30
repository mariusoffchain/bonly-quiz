import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BlockPublic, PlayerPublic, PublicConfig } from '../../shared/views';
import { pct, placeLabel, playerColor, ths } from '../lib/format';
import { remaining, useTicker } from '../lib/ws';

import mountainsUrl from '../assets/mountains.webp';

export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={'wordmark ' + size}>
      <span className="pixel">B-ONLY</span> quiz
    </span>
  );
}

/** Section label in the site's style: "// texte". */
export function Label({ children }: { children: ReactNode }) {
  return (
    <p className="label">
      <span className="slashes">//</span> {children}
    </p>
  );
}

export function Mountains() {
  return <img className="mountains" src={mountainsUrl} alt="" aria-hidden />;
}

export function Swatch({ color }: { color: number }) {
  return <span className="swatch" style={{ background: playerColor(color) }} aria-hidden />;
}

export function Countdown({ closesAt, durationMs, serverNow }: { closesAt: number; durationMs: number; serverNow: () => number }) {
  useTicker(100);
  const { ms, frac } = remaining(closesAt, durationMs, serverNow());
  return (
    <div className={'countdown' + (ms < 5000 ? ' late' : '')}>
      <span className="secs">{Math.ceil(ms / 1000)}</span>
      <span className="track">
        <span style={{ width: `${frac * 100}%` }} />
      </span>
    </div>
  );
}

/** The network as one bar: each slice is a player's chance of finding the block. */
export function NetworkBar({ players, highlightId }: { players: PlayerPublic[]; highlightId?: string }) {
  const visible = players.filter((p) => p.share > 0);
  return (
    <div className="network-bar">
      {visible.map((p) => (
        <span key={p.id} className={p.id === highlightId ? 'me' : ''} style={{ flexGrow: p.share, background: playerColor(p.color) }} title={`${p.name} ${pct(p.share)}`} />
      ))}
    </div>
  );
}

export function Standings({
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
  /** Podium so far: winners[0] is 1st place. */
  winners?: (string | null | undefined)[];
}) {
  const top = players.slice(0, limit);
  const me = highlightId ? players.find((p) => p.id === highlightId) : undefined;
  const rows = me && !top.includes(me) ? [...top, me] : top;
  if (players.length === 0) return <p className="muted">Aucun joueur.</p>;
  return (
    <table className="standings">
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className={(p.id === highlightId ? 'me ' : '') + (p.connected ? '' : 'off')}>
            <td className="rank">{p.rank}</td>
            <td className="who">
              <Swatch color={p.color} />
              <span className="nm">{p.name}</span>
              {winners.includes(p.id) ? <span className="mark">{placeLabel(winners.indexOf(p.id) + 1)}</span> : null}
            </td>
            {showGain ? <td className={'gain' + (p.lastGain ? '' : ' none')}>{p.lastGain ? `+${ths(p.lastGain, false)}` : '–'}</td> : null}
            <td className="num">{ths(p.hashrate, false)}</td>
            <td className="num share">{pct(p.share)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Rules({ config }: { config: PublicConfig }) {
  const g = config.baseGainThs;
  return (
    <dl className="rules">
      {config.startHashrateThs > 0 ? (
        <>
          <dt>Départ</dt>
          <dd>{ths(config.startHashrateThs)} pour tout le monde</dd>
        </>
      ) : null}
      <dt>Bonne réponse</dt>
      <dd>
        {g.easy}, {g.intermediate} ou {g.hard} TH/s selon la difficulté, {g.expert} pour une question expert
      </dd>
      <dt>Rapidité</dt>
      <dd>jusqu’à +{Math.round(config.speedBonusMax * 100)} %</dd>
      <dt>Série</dt>
      <dd>
        +{Math.round(config.streakBonusStep * 100)} % par bonne réponse d’affilée, max +{Math.round(config.streakBonusMax * 100)} %
      </dd>
      <dt>Fin</dt>
      <dd>
        tirage {config.podiumSize > 1 ? `des ${config.podiumSize} places du podium` : 'du gagnant'}, vos chances = votre part du hashrate
      </dd>
    </dl>
  );
}

export function ConnBadge({ conn }: { conn: 'connecting' | 'open' | 'closed' }) {
  if (conn === 'open') return null;
  return <div className="conn">{conn === 'connecting' ? 'Connexion…' : 'Hors ligne, reconnexion…'}</div>;
}

const HEX = '0123456789abcdef';
const randomHash = (n: number) => Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join('');
let lineSeq = 0;

/** Hashes scrolling while the block is "mined", then the winner. The server fixed the result already. */
export function Mining({
  block,
  players,
  serverNow,
  meId,
  myPlace,
  compact = false,
}: {
  block: BlockPublic;
  players: PlayerPublic[];
  serverNow: () => number;
  meId?: string;
  /** Place already won by this phone's player, if any. */
  myPlace?: number;
  compact?: boolean;
}) {
  useTicker(100);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const candidates = useMemo(() => [...block.candidates].sort((a, b) => b.share - a.share), [block.candidates]);
  const [lines, setLines] = useState<{ id: string; hash: string; k: number }[]>([]);
  const mining = !block.found;
  const rows = compact ? 5 : 10;

  useEffect(() => {
    if (!mining) return;
    const pick = () => {
      let r = Math.random();
      for (const c of candidates) if ((r -= c.share) <= 0) return c.id;
      return candidates[0]?.id ?? '';
    };
    const id = window.setInterval(() => {
      setLines((prev) => [{ id: pick(), hash: randomHash(compact ? 20 : 40), k: ++lineSeq }, ...prev].slice(0, rows));
    }, 120);
    return () => window.clearInterval(id);
  }, [mining, candidates, compact, rows]);

  const title = `${placeLabel(block.n)} place · bloc ${block.n}`;

  if (mining) {
    const elapsed = Math.max(0, serverNow() - block.startedAt);
    const mine = meId ? candidates.find((c) => c.id === meId) : undefined;
    return (
      <div className={'mining' + (compact ? ' compact' : '')}>
        <Label>{title}</Label>
        <p className="mining-status">Tirage en cours</p>
        <p className="mono muted">nonce {Math.floor(elapsed * 9871).toLocaleString('fr-FR')}</p>
        {meId ? (
          <p>{mine ? `Vos chances : ${pct(mine.share)}` : myPlace ? `Vous avez déjà la ${placeLabel(myPlace)} place.` : 'Vous ne participez pas à ce tirage.'}</p>
        ) : null}
        <ul className="hashes">
          {lines.map((l) => (
            <li key={l.k}>
              <Swatch color={byId.get(l.id)?.color ?? 0} />
              <span className="mono">{l.hash}</span>
              {compact ? null : <span className="muted">{byId.get(l.id)?.name}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const winner = block.winnerId ? byId.get(block.winnerId) : undefined;
  const chance = candidates.find((c) => c.id === block.winnerId)?.share ?? 0;
  const favourite = candidates[0];
  const isMe = !!meId && meId === block.winnerId;
  return (
    <div className={'found' + (compact ? ' compact' : '')}>
      <Label>{title}</Label>
      {winner ? (
        <>
          <p className="winner">{isMe ? 'Vous' : winner.name}</p>
          <p>
            {isMe ? 'trouvez le bloc' : 'trouve le bloc'} avec {pct(chance)} de chances
          </p>
        </>
      ) : (
        <p className="winner">Personne</p>
      )}
      <p className="mono hash">
        <span className="zeros">{block.hash?.slice(0, 10)}</span>
        {compact ? `${block.hash?.slice(10, 24)}…` : block.hash?.slice(10)}
      </p>
      {!compact && favourite && favourite.id !== block.winnerId ? (
        <p className="muted">
          Favori : {byId.get(favourite.id)?.name}, {pct(favourite.share)}
        </p>
      ) : null}
    </div>
  );
}
