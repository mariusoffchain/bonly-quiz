import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerView, ServerMessage } from '../../shared/views';
import { ConnDot, Countdown, FeedBadge, PoolList } from '../components/Shared';
import { difficultyLabel, fmtClock, pctText, ths } from '../lib/format';
import { useQuizSocket, useTicker } from '../lib/ws';

const LETTERS = 'ABCDEFGH';
const storageKey = (code: string) => `bq_player_${code}`;

function readStored(code: string): { token: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(code));
    return raw ? (JSON.parse(raw) as { token: string }) : null;
  } catch {
    return null;
  }
}

export function Play() {
  const params = new URLSearchParams(location.search);
  const code = params.get('s') ?? '';
  // A rescue link from the console carries the token directly (?t=...).
  const urlToken = params.get('t');
  const [token, setToken] = useState<string | null>(() => urlToken ?? readStored(code)?.token ?? null);
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;
  const sock = useQuizSocket<PlayerView>(() => ({ type: 'hello', role: 'player', sessionCode: code, token: tokenRef.current ?? undefined }));
  const { view } = sock;

  useEffect(() => {
    if (urlToken && code) {
      localStorage.setItem(storageKey(code), JSON.stringify({ token: urlToken }));
      history.replaceState(null, '', `${location.pathname}?s=${encodeURIComponent(code)}`);
    }
  }, [urlToken, code]);

  useEffect(() => {
    return sock.onMessage((m: ServerMessage) => {
      if (m.type === 'joined') {
        localStorage.setItem(storageKey(code), JSON.stringify({ token: m.token }));
        setToken(m.token);
      }
      // The server tells us explicitly whether the token we presented is still valid
      // (unknown token = new session or removed competitor). Only then do we forget it.
      if (m.type === 'hello-ok' && m.role === 'player' && tokenRef.current && !m.tokenRecognized) {
        localStorage.removeItem(storageKey(code));
        setToken(null);
      }
    });
  }, [sock, code]);

  if (!view) {
    return (
      <div className="play">
        <TopBar conn={sock.conn} code={code} />
        <div className="card">{sock.conn === 'open' ? 'Chargement de la partie…' : 'Connexion au serveur…'}</div>
        {sock.lastError ? <div className="alert error">{sock.lastError.message}</div> : null}
      </div>
    );
  }

  return (
    <div className="play">
      <TopBar conn={sock.conn} code={view.code} feed={view.blockFeed} />
      {sock.lastError ? (
        <div className="alert error" onClick={sock.clearError}>
          {sock.lastError.message}
        </div>
      ) : null}
      {!view.me ? <Join sock={sock} view={view} /> : <Game sock={sock} view={view} />}
    </div>
  );
}

function TopBar({ conn, code, feed }: { conn: 'connecting' | 'open' | 'closed'; code: string; feed?: PlayerView['blockFeed'] }) {
  return (
    <div className="topbar">
      <span className="brand">B-only Quiz</span>
      <span>
        <ConnDot state={conn} />
        {conn === 'open' ? 'connecté' : conn === 'closed' ? 'hors ligne, reconnexion…' : 'connexion…'} · partie <span className="kbd">{code || '—'}</span>
      </span>
      {feed ? <FeedBadge feed={feed} /> : null}
    </div>
  );
}

function Join({ sock, view }: { sock: ReturnType<typeof useQuizSocket<PlayerView>>; view: PlayerView }) {
  const [mode, setMode] = useState<'choose' | 'pool' | 'bitaxe'>('choose');
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>(['', '', '']);
  const [owner, setOwner] = useState('');
  const min = view.config.minPoolMembers;
  const filled = members.map((m) => m.trim()).filter(Boolean);
  const canCreate = name.trim().length > 0 && filled.length >= min;

  if (mode === 'choose') {
    return (
      <>
        <div className="card">
          <div className="card-title">Rejoindre la partie</div>
          <p>Jouez en équipe (pool classique, 1 téléphone pour toute l’équipe) ou seul (Bitaxe, votre propre hashrate).</p>
          <div className="row">
            <button className="btn grow" onClick={() => setMode('pool')}>
              Créer une pool
            </button>
            <button className="btn secondary grow" onClick={() => setMode('bitaxe')}>
              Jouer en Bitaxe (solo)
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Déjà {view.competitors.length} concurrent{view.competitors.length > 1 ? 's' : ''}</div>
          <PoolList competitors={view.competitors} />
        </div>
      </>
    );
  }

  if (mode === 'bitaxe') {
    return (
      <div className="card">
        <div className="card-title">Bitaxe individuel</div>
        <p>Vous jouez seul, avec votre propre hashrate et vos propres chances. Vous apparaîtrez comme « Bitaxe n ».</p>
        <label className="small muted">Votre prénom ou pseudo (facultatif, pour la remise des lots)</label>
        <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Prénom ou pseudo" />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => setMode('choose')}>
            Retour
          </button>
          <button className="btn grow" onClick={() => sock.send({ type: 'join-bitaxe', owner })}>
            Rejoindre comme Bitaxe
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <label className="small muted">Nom de la pool</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de votre pool" autoFocus maxLength={60} />
      <div className="card-title" style={{ marginTop: 14 }}>
        Membres ({filled.length}/{min} minimum)
      </div>
      <div className="members">
        {members.map((m, i) => (
          <input key={i} className="input" value={m} onChange={(e) => setMembers(members.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Membre ${i + 1}`} maxLength={40} />
        ))}
        <button className="btn ghost sm" onClick={() => setMembers([...members, ''])}>
          + Ajouter un membre
        </button>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn ghost" onClick={() => setMode('choose')}>
          Retour
        </button>
        <button className="btn grow" disabled={!canCreate} onClick={() => sock.send({ type: 'join-pool', name, members: filled })}>
          Créer la pool
        </button>
      </div>
      {!canCreate ? <div className="small muted" style={{ marginTop: 8 }}>Il faut un nom et au moins {min} membres.</div> : null}
    </div>
  );
}

function Game({ sock, view }: { sock: ReturnType<typeof useQuizSocket<PlayerView>>; view: PlayerView }) {
  const me = view.me!;
  const q = view.question;
  const [pending, setPending] = useState<{ optionIndex: number; clientId: string } | null>(null);
  const [ack, setAck] = useState<{ accepted: boolean; reason?: string; optionIndex: number; serverAt: number; questionId: string } | null>(null);
  useTicker(250);

  useEffect(() => {
    return sock.onMessage((m) => {
      if (m.type === 'answer-ack') {
        setPending((p) => (p && p.clientId === m.clientId ? null : p));
        setAck({ accepted: m.accepted, reason: m.reason, optionIndex: m.optionIndex, serverAt: m.serverAt, questionId: m.questionId });
      }
    });
  }, [sock]);

  // Reset local answer state when a new question opens.
  useEffect(() => {
    setPending(null);
    setAck(null);
  }, [q?.question.id, q?.openedAt]);

  const open = q && !q.closed && view.phase === 'question-open' && q.closesAt > sock.serverNow();
  const selected = pending?.optionIndex ?? view.myAnswer?.optionIndex;
  const myGain = q?.results?.gains.find((g) => g.competitorId === me.id);
  const names = useMemo(() => new Map(view.competitors.map((c) => [c.id, c.name])), [view.competitors]);

  const answer = (i: number) => {
    if (!q || !open) return;
    const clientId = Math.random().toString(36).slice(2);
    setPending({ optionIndex: i, clientId });
    sock.send({ type: 'answer', questionId: q.question.id, optionIndex: i, clientId });
  };

  const status = (() => {
    if (!q) return null;
    if (pending) return <span className="status-line">Envoi de la réponse {LETTERS[pending.optionIndex]}…</span>;
    if (ack && ack.questionId === q.question.id && !ack.accepted) {
      const why = ack.reason === 'closed' ? 'trop tard, le temps était écoulé' : ack.reason === 'stale-question' ? 'question déjà passée' : ack.reason;
      return <span className="status-line err">Réponse refusée ({why}).</span>;
    }
    if (view.myAnswer) {
      return (
        <span className="status-line ok">
          Réponse {LETTERS[view.myAnswer.optionIndex]} enregistrée à {fmtClock(view.myAnswer.lastAt)}
          {view.myAnswer.changes > 0 ? ` (modifiée ${view.myAnswer.changes}×)` : ''}
          {open ? ', modifiable jusqu’à la fin du compte à rebours' : ''}
        </span>
      );
    }
    if (open) return <span className="status-line">Aucune réponse envoyée pour l’instant.</span>;
    return <span className="status-line">Pas de réponse enregistrée.</span>;
  })();

  return (
    <>
      <div className="card me-card">
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{me.name}</div>
          <div className="small muted">
            {me.kind === 'pool' ? `Pool · ${me.members.join(', ')}` : me.members[0] ? `Bitaxe · ${me.members[0]}` : 'Bitaxe'} · rang {me.rank}/{view.competitors.length} · {pctText(me.share)} du hashrate
          </div>
        </div>
        <div className="hr">{ths(me.hashrate)}</div>
      </div>

      {q && (view.phase === 'question-open' || view.phase === 'question-closed') ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="card-title" style={{ margin: 0 }}>
                {view.rounds[q.roundIndex]?.title} · question {q.questionIndex + 1}/{q.questionTotal}
              </div>
              <span className={'badge ' + q.question.difficulty}>{difficultyLabel[q.question.difficulty]} · {view.config.baseGainThs[q.question.difficulty]} TH/s</span>
              {q.question.demo ? <span className="badge sim" style={{ marginLeft: 6 }}>démo</span> : null}
            </div>
            {open ? <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={sock.serverNow} small /> : <span className="badge">{q.cancelled ? 'Annulée' : 'Terminée'}</span>}
          </div>
          <div className="question-text">{q.question.text}</div>
          <div className="options">
            {q.question.options.map((opt, i) => {
              const revealed = q.closed && q.question.correctIndex !== undefined;
              const cls = ['option'];
              if (!revealed && selected === i) cls.push('selected');
              if (revealed) {
                if (i === q.question.correctIndex) cls.push('correct');
                else if (selected === i) cls.push('wrong');
                else cls.push('dim');
              }
              return (
                <button key={i} className={cls.join(' ')} disabled={!open} onClick={() => answer(i)}>
                  <span className="letter">{LETTERS[i]}</span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}>{status}</div>
          {q.closed && !q.cancelled ? (
            <div className="alert ok" style={{ marginTop: 10 }}>
              {myGain ? (
                <>
                  Bonne réponse, rang {myGain.rank}{myGain.tied ? ' (ex æquo)' : ''} parmi les bonnes réponses, bonus +{myGain.bonusPercent.replace('.', ',')} %. Gain {ths(myGain.gain)}.
                </>
              ) : view.myAnswer ? (
                <>Mauvaise réponse, 0 TH/s. Aucune pénalité.</>
              ) : (
                <>Pas de réponse, 0 TH/s. Aucune pénalité.</>
              )}
              {q.question.explanation ? <div className="small muted" style={{ marginTop: 6 }}>{q.question.explanation}</div> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <div className="card-title">{phaseLabel(view)}</div>
          <p className="muted small">{view.phase === 'lobby' ? 'L’animateur va lancer la première manche. Gardez cette page ouverte.' : view.phase === 'round-ready' ? 'La manche commence, première question imminente.' : 'Manche terminée, regardez l’écran pour les tirages.'}</p>
        </div>
      )}

      {view.lastBlockBonus && view.lastBlockBonus.roundIndex === view.currentRoundIndex ? (
        <div className="card small">
          <span className="badge" style={{ marginRight: 8 }}>{view.lastBlockBonus.origin === 'simulated' ? 'Bloc simulé' : 'Bloc réel'} {view.lastBlockBonus.height.toLocaleString('fr-FR')}</span>
          {view.lastBlockBonus.winnerId ? (
            <>
              bonus +{view.config.blockBonusPercent.replace('.', ',')} % pour <b>{names.get(view.lastBlockBonus.winnerId) ?? '?'}</b> ({ths(view.lastBlockBonus.bonus)})
            </>
          ) : (
            'aucun concurrent éligible'
          )}
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">Hashrate du quiz (fictif), {view.rounds[view.currentRoundIndex]?.title ?? 'avant la 1re manche'}</div>
        <PoolList competitors={view.competitors} meId={me.id} />
      </div>

      {view.prizeSeries.length > 0 ? (
        <div className="card">
          <div className="card-title">Lots</div>
          {view.prizeSeries.map((s) => (
            <div key={s.id} className="small">
              {s.awards.map((a) => {
                const prize = s.prizes.find((p) => p.id === a.prizeId);
                return (
                  <div key={a.prizeId}>
                    {prize?.label} → <b>{a.winnerId ? names.get(a.winnerId) ?? '?' : 'non attribué'}</b>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      <details className="card">
        <summary className="small">Modifier l’équipe</summary>
        <EditMe sock={sock} view={view} />
      </details>
    </>
  );
}

function EditMe({ sock, view }: { sock: ReturnType<typeof useQuizSocket<PlayerView>>; view: PlayerView }) {
  const me = view.me!;
  const [name, setName] = useState(me.name);
  const [members, setMembers] = useState(me.members.join('\n'));
  return (
    <div style={{ marginTop: 10 }}>
      {me.kind === 'pool' ? (
        <>
          <label className="small muted">Nom de la pool</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </>
      ) : null}
      <label className="small muted">{me.kind === 'pool' ? 'Membres (1 par ligne)' : 'Votre nom (pour les lots)'}</label>
      <textarea className="input" rows={4} value={members} onChange={(e) => setMembers(e.target.value)} />
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => sock.send({ type: 'update-me', name: me.kind === 'pool' ? name : undefined, members: members.split('\n').map((m) => m.trim()).filter(Boolean) })}>
        Enregistrer
      </button>
    </div>
  );
}

function phaseLabel(view: PlayerView): string {
  switch (view.phase) {
    case 'lobby':
      return 'En attente du début de la partie';
    case 'round-ready':
      return `${view.rounds[view.currentRoundIndex]?.title ?? 'Manche'} prête`;
    case 'round-ended':
      return `${view.rounds[view.currentRoundIndex]?.title ?? 'Manche'} terminée`;
    case 'finished':
      return 'Partie terminée';
    default:
      return 'En attente de la prochaine question';
  }
}
