import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerView, ServerMessage } from '../../shared/views';
import { AvatarBadge, ConnDot, Countdown, Leaderboard, PoolList } from '../components/Shared';
import { medal, pctText, ths } from '../lib/format';
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
        <TopBar conn={sock.conn} />
        <div className="card">{sock.conn === 'open' ? 'Chargement de la partie…' : 'Connexion au serveur…'}</div>
        {sock.lastError ? <div className="alert error">{sock.lastError.message}</div> : null}
      </div>
    );
  }

  return (
    <div className="play">
      {!(view.me && (view.phase === 'question-open' || view.phase === 'question-closed')) ? <TopBar conn={sock.conn} /> : null}
      {sock.lastError ? (
        <div className="alert error" onClick={sock.clearError}>
          {sock.lastError.message}
        </div>
      ) : null}
      {!view.me ? <Join sock={sock} view={view} /> : <Game sock={sock} view={view} />}
    </div>
  );
}

function Connection({ conn }: { conn: 'connecting' | 'open' | 'closed' }) {
  const label = conn === 'open' ? 'Connecté' : conn === 'closed' ? 'Reconnexion…' : 'Connexion…';
  return <span className="player-connection" role="status" aria-label={label} title={label}>
    <ConnDot state={conn} />{conn !== 'open' ? label : null}
  </span>;
}

function TopBar({ conn }: { conn: 'connecting' | 'open' | 'closed' }) {
  return <div className="topbar"><span className="brand">B-only Quiz</span><Connection conn={conn} /></div>;
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
          <p>Jouez en équipe (pool classique, 1 téléphone pour toute l’équipe) ou en solo, avec votre propre hashrate.</p>
          <div className="row">
            <button className="btn grow" onClick={() => setMode('pool')}>
              Créer une pool
            </button>
            <button className="btn secondary grow" onClick={() => setMode('bitaxe')}>
              Jouer en solo
            </button>
          </div>
        </div>
        <p className="join-count muted small">{view.competitors.length} concurrent{view.competitors.length > 1 ? 's' : ''} inscrit{view.competitors.length > 1 ? 's' : ''}</p>
      </>
    );
  }

  if (mode === 'bitaxe') {
    return (
      <div className="card">
        <div className="card-title">Jouer en solo</div>
        <p>Vous jouez seul, avec votre propre hashrate et vos propres chances. Vous apparaîtrez comme « Bitaxe n ».</p>
        <label className="small muted">Votre prénom ou pseudo (facultatif, pour la remise des lots)</label>
        <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Prénom ou pseudo" aria-label="Prénom ou pseudo" maxLength={40} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => setMode('choose')}>
            Retour
          </button>
          <button className="btn grow" onClick={() => sock.send({ type: 'join-bitaxe', owner })}>
            Rejoindre la partie
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

// Show the exact credited nano-TH/s, trimming only insignificant zeroes.
function playerThs(nano: string): string {
  return ths(nano, { unit: false, maxFrac: 9 }).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',') + ' TH/s';
}

function Game({ sock, view }: { sock: ReturnType<typeof useQuizSocket<PlayerView>>; view: PlayerView }) {
  const me = view.me!;
  const q = view.question;
  const [pending, setPending] = useState<{ optionIndex: number; clientId: string } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [ack, setAck] = useState<Extract<ServerMessage, { type: 'answer-ack' }> | null>(null);
  useTicker(250);

  useEffect(() => sock.onMessage((m) => {
    // Ignore older replies while a newer choice is in flight.
    if (m.type === 'answer-ack' && pendingRef.current?.clientId === m.clientId) {
      pendingRef.current = null;
      setPending(null);
      setAck(m);
    }
    // A fresh server snapshot after reconnect is authoritative even if an ack was lost.
    if (m.type === 'hello-ok') {
      pendingRef.current = null;
      setPending(null);
      setAck(null);
    }
  }), [sock.onMessage]);

  useEffect(() => {
    pendingRef.current = null;
    setPending(null);
    setAck(null);
  }, [q?.question.id, q?.openedAt]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [q?.question.id, q?.openedAt, q?.closed]);

  const questionPhase = !!q && (view.phase === 'question-open' || view.phase === 'question-closed');
  const waiting = view.phase === 'lobby' || view.phase === 'round-ready';
  const roundOver = view.phase === 'round-ended' || view.phase === 'finished';
  const focused = questionPhase || waiting || roundOver;
  // After the close: personal result (revealHoldMs), then the ranking with its own timer (leaderboardHoldMs).
  const nowS = sock.serverNow();
  const closedAt = q?.closedAt ?? 0;
  const resultUntil = closedAt + view.config.revealHoldMs;
  const lbUntil = resultUntil + view.config.leaderboardHoldMs;
  const showLeaderboard = view.config.leaderboardHoldMs > 0 && !!q && q.closed && view.phase === 'question-closed' && nowS >= resultUntil;
  const lbTimerRunning = showLeaderboard && nowS < lbUntil && view.config.leaderboardHoldMs > 0;
  const open = !!q && !q.closed && view.phase === 'question-open' && q.closesAt > sock.serverNow();
  const canAnswer = open && sock.conn === 'open';
  const currentAck = ack?.questionId === q?.question.id ? ack : null;
  const confirmedOption = !q?.closed && currentAck?.accepted ? currentAck.optionIndex : view.myAnswer?.optionIndex;
  const selected = q?.closed ? view.myAnswer?.optionIndex : pending?.optionIndex ?? confirmedOption;
  const myGain = q?.results?.gains.find((g) => g.competitorId === me.id);
  const names = useMemo(() => new Map(view.competitors.map((c) => [c.id, c.name])), [view.competitors]);

  const answer = (i: number) => {
    if (!q || !canAnswer) return;
    const next = { optionIndex: i, clientId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
    pendingRef.current = next;
    setPending(next);
    setAck(null);
    sock.send({ type: 'answer', questionId: q.question.id, ...next });
  };

  const status = (() => {
    if (!q || q.closed) return null;
    if (sock.conn !== 'open') return <span className="status-line err">Connexion interrompue · vérification de votre réponse à la reconnexion.</span>;
    if (pending) return <span className="status-line">Envoi de la réponse {LETTERS[pending.optionIndex]}…</span>;
    if (currentAck && !currentAck.accepted) {
      const why = currentAck.reason === 'closed' ? 'le temps est écoulé' : currentAck.reason === 'stale-question' ? 'la question est passée' : 'réessayez';
      return <span className="status-line err">Réponse {LETTERS[currentAck.optionIndex]} refusée · {why}.{view.myAnswer ? ` Réponse ${LETTERS[view.myAnswer.optionIndex]} conservée.` : ''}</span>;
    }
    if (confirmedOption !== undefined) return <span className="status-line ok">Réponse {LETTERS[confirmedOption]} enregistrée{open ? ' · modifiable jusqu’à la fin' : ' · en attente du résultat'}</span>;
    return <span className="status-line">{open ? 'Choisissez votre réponse.' : 'Temps écoulé · en attente du résultat.'}</span>;
  })();

  return (
    <>
      {questionPhase ? (
        <header className="player-header">
          <span className="player-name"><AvatarBadge competitor={me} size={22} /> {me.name}</span>
          <span className="player-header-end">
            {!q?.closed ? <span className="player-balance">{ths(me.hashrate)}</span> : null}
            <Connection conn={sock.conn} />
          </span>
        </header>
      ) : !waiting && !roundOver ? (
        <div className="card me-card player-identity">
          <div><div className="player-name"><AvatarBadge competitor={me} size={22} /> {me.name}</div><div className="small muted">Rang {me.rank}/{view.competitors.length} · {pctText(me.share)} du hashrate</div></div>
          <div className="hr">{playerThs(me.hashrate)}</div>
        </div>
      ) : null}

      {q && questionPhase ? (
        <section className="player-question" aria-label={q.closed ? 'Résultat' : 'Question en cours'}>
          <div className="question-heading">
            <span className="question-progress">Manche {view.currentRoundIndex + 1} / {view.rounds.length} · Question {q.questionIndex + 1} / {q.questionTotal}</span>
            {q.question.demo ? <span className="badge sim">Démo</span> : null}
            {open ? <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={sock.serverNow} small /> : null}
          </div>
          <div className="progress" aria-hidden><div style={{ width: `${((q.questionIndex + 1) / Math.max(1, q.questionTotal)) * 100}%` }} /></div>
          {showLeaderboard ? (
            <>
              <div className="phase-head">
                <div className="card-title">Classement après la question {q.questionIndex + 1}</div>
                {lbTimerRunning ? <Countdown closesAt={lbUntil} durationMs={view.config.leaderboardHoldMs} serverNow={sock.serverNow} small /> : <span className="small muted">Prochaine question bientôt</span>}
              </div>
              <Leaderboard competitors={view.competitors} meId={me.id} />
              {!q.cancelled && q.question.correctIndex !== undefined ? (
                <details className="answer-details" style={{ marginTop: 14 }}>
                  <summary>Revoir la question</summary>
                  <p className="review-question">{q.question.text}</p>
                  <p className="correct-answer"><span aria-hidden="true">✓</span>{q.question.options[q.question.correctIndex]}</p>
                  {q.question.explanation ? <p className="answer-explanation">{q.question.explanation}</p> : null}
                </details>
              ) : null}
            </>
          ) : q.closed ? (
            <>
              <div className={'player-result ' + (myGain && !q.cancelled ? 'success' : 'neutral')} role="status">
                <h1 className="result-title">{q.cancelled ? 'Question annulée' : myGain ? 'Bonne réponse !' : view.myAnswer ? 'Mauvaise réponse' : 'Pas de réponse'}</h1>
                {myGain && !q.cancelled ? (
                  <>
                    <div className="result-gain">+{playerThs(myGain.gain)}</div>
                    <p className="result-breakdown">{playerThs(myGain.base)} + {playerThs((BigInt(myGain.gain) - BigInt(myGain.base)).toString())} de rapidité</p>
                  </>
                ) : <p className="result-breakdown">Votre hashrate est conservé.</p>}
                <p className="result-total">Votre total <strong>{playerThs(me.hashrate)}</strong></p>
              </div>
              {!q.cancelled && q.question.correctIndex !== undefined ? (
                <div className="answer-review">
                  <p className="review-question">{q.question.text}</p>
                  <p className="correct-answer"><span aria-hidden="true">✓</span>{q.question.options[q.question.correctIndex]}</p>
                  {view.myAnswer && !myGain ? <p className="previous-answer">Votre réponse · {q.question.options[view.myAnswer.optionIndex]}</p> : null}
                  {q.question.explanation ? (
                    <details className="answer-details" key={`${q.question.id}-${q.openedAt}`}>
                      <summary>Pourquoi ?</summary>
                      <p className="answer-explanation">{q.question.explanation}</p>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h1 className="question-text">{q.question.text}</h1>
              <div className="options">
                {q.question.options.map((opt, i) => (
                  <button key={i} className={'option' + (selected === i ? ' selected' : '')} disabled={!canAnswer} aria-pressed={selected === i} onClick={() => answer(i)}>
                    <span className="letter">{LETTERS[i]}</span><span>{opt}</span>
                  </button>
                ))}
              </div>
              <div className="answer-status" role="status" aria-live="polite">{status}</div>
            </>
          )}
        </section>
      ) : waiting ? (
        <section className="player-waiting" aria-label="Salle d’attente">
          <p className="waiting-name">{me.name}</p>
          <div className="waiting-check" aria-hidden="true">✓</div>
          <h1>{view.phase === 'round-ready' ? `Manche ${view.currentRoundIndex + 1} / ${view.rounds.length}` : me.kind === 'pool' ? 'Vous êtes inscrits' : 'Vous êtes inscrit'}</h1>
          <p className="muted">{view.phase === 'lobby' ? 'La partie va commencer.' : 'La première question arrive.'}</p>
          {view.phase === 'round-ready' ? <p className="player-balance">{playerThs(me.hashrate)}{view.currentRoundIndex > 0 ? ' · hashrate conservé' : ''}</p> : null}
          <details className="waiting-help">
            <summary>Comment jouer ?</summary>
            <ul className="waiting-rules">
              <li>Chaque bonne réponse augmente votre hashrate.</li>
              <li>La rapidité apporte un bonus.</li>
              <li>Vous pouvez modifier votre réponse jusqu’à la fin du compte à rebours.</li>
            </ul>
          </details>
        </section>
      ) : roundOver ? (
        <FinalScreen view={view} />
      ) : (
        <div className="card"><div className="card-title">{phaseLabel(view)}</div><p className="muted small">Regardez l’écran pour les tirages.</p></div>
      )}

      {!focused ? <>
        {view.lastBlockBonus && view.lastBlockBonus.roundIndex === view.currentRoundIndex ? (
          <div className="card small">
            <span className="badge">{view.lastBlockBonus.origin === 'simulated' ? 'Bloc simulé' : 'Bloc réel'} {view.lastBlockBonus.height.toLocaleString('fr-FR')}</span>{' '}
            {view.lastBlockBonus.winnerId ? <>bonus +{view.config.blockBonusPercent.replace('.', ',')} % pour <b>{names.get(view.lastBlockBonus.winnerId) ?? '?'}</b> ({ths(view.lastBlockBonus.bonus)})</> : 'aucun concurrent éligible'}
          </div>
        ) : null}
        <div className="card"><div className="card-title">Hashrate du quiz (fictif), {view.rounds[view.currentRoundIndex]?.title ?? 'avant la 1re manche'}</div><PoolList competitors={view.competitors} meId={me.id} /></div>
        {view.prizeSeries.length > 0 ? <div className="card"><div className="card-title">Lots</div>{view.prizeSeries.map((s) => <div key={s.id} className="small">{s.awards.map((a) => <div key={a.prizeId}>{s.prizes.find((p) => p.id === a.prizeId)?.label} → <b>{a.winnerId ? names.get(a.winnerId) ?? '?' : 'non attribué'}</b></div>)}</div>)}</div> : null}
      </> : null}
      {!questionPhase ? <details className="player-profile"><summary>{me.kind === 'pool' ? 'Mon équipe' : 'Mon profil'}</summary><EditMe sock={sock} view={view} /></details> : null}
    </>
  );
}

/** Personal end-of-round screen: rank, final hashrate, share, prizes won, top 10. */
function FinalScreen({ view }: { view: PlayerView }) {
  const me = view.me!;
  const round = view.rounds[view.currentRoundIndex];
  const names = new Map(view.competitors.map((c) => [c.id, c.name]));
  const myPrizes = view.prizeSeries
    .filter((s) => s.roundIndexes.includes(view.currentRoundIndex))
    .flatMap((s) => s.awards.filter((a) => a.winnerId === me.id).map((a) => s.prizes.find((p) => p.id === a.prizeId)?.label ?? 'Lot'));
  const remaining = view.rounds.filter((r) => r.status === 'pending').length;
  return (
    <section className="card final" aria-label="Résultat de la manche">
      <div className="card-title">{view.phase === 'finished' ? 'Partie terminée' : `${round?.title ?? 'Manche'} terminée`}</div>
      <div className="result" style={{ padding: '8px 0 4px' }}>
        <AvatarBadge competitor={me} size={64} />
        <div className="headline">{me.name}</div>
        <div className="big-num">{medal(me.rank)}{me.rank > 3 ? `/${view.competitors.length}` : ''}</div>
        <div className="detail">{me.rank <= 3 ? `${me.rank}${me.rank === 1 ? 'er' : 'e'} sur ${view.competitors.length}` : 'au classement de la partie'}</div>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">{view.phase === 'finished' ? 'Hashrate final' : 'Hashrate cumulé'}</div><div className="value">{ths(me.hashrate)}</div></div>
        <div className="stat"><div className="label">Part du total</div><div className="value">{pctText(me.share)}</div></div>
      </div>
      {myPrizes.length > 0 ? myPrizes.map((label, i) => <div key={i} className="prize-won">🎁 Vous gagnez : {label}</div>) : view.prizeSeries.some((s) => s.roundIndexes.includes(view.currentRoundIndex)) ? <p className="small muted">Pas de lot cette fois. Chances = part du hashrate final.</p> : <p className="small muted">Vos chances pour les lots suivent votre part du hashrate cumulé.</p>}
      <div className="card-title" style={{ marginTop: 14 }}>Classement de la partie</div>
      <Leaderboard competitors={view.competitors} meId={me.id} />
      {view.prizeSeries.filter((s) => s.roundIndexes.includes(view.currentRoundIndex)).map((s) => (
        <div key={s.id} className="small" style={{ marginTop: 10 }}>
          {s.awards.map((a) => <div key={a.prizeId}>{s.prizes.find((p) => p.id === a.prizeId)?.label} → <b>{a.winnerId ? names.get(a.winnerId) ?? '?' : 'non attribué'}</b></div>)}
        </div>
      ))}
      <p className="small muted" style={{ marginTop: 12 }}>{remaining > 0 ? `${remaining} manche${remaining > 1 ? 's' : ''} à venir, votre hashrate est conservé.` : 'Merci d’avoir joué.'}</p>
    </section>
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
