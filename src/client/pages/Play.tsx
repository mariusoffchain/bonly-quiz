import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlayerView } from '../../shared/views';
import { ConnBadge, Countdown, Label, Mining, NetworkBar, Rules, Wordmark } from '../components/ui';
import { LETTERS, difficultyLabel, pct, placeLabel, seconds, ths } from '../lib/format';
import { useQuizSocket, useTicker } from '../lib/ws';

const TOKEN_KEY = 'bq_token';

const store = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the session simply won't survive a reload */
    }
  },
};

const REFUSED: Record<string, string> = {
  'too-late': 'Trop tard.',
  'already-answered': 'Réponse déjà enregistrée.',
  'not-open': 'Question fermée.',
};

export function Play() {
  const tokenRef = useRef<string | null>(store.get());
  const sock = useQuizSocket<PlayerView>(() => ({ type: 'hello', role: 'player', token: tokenRef.current ?? undefined }));
  const { view, send } = sock;
  const [pending, setPending] = useState<{ q: number; option: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      sock.onMessage((m) => {
        if (m.type === 'joined') {
          tokenRef.current = m.token;
          store.set(m.token);
        }
        if (m.type === 'hello-ok' && tokenRef.current && !m.tokenRecognized) {
          tokenRef.current = null;
          store.set(null);
        }
        if (m.type === 'answer-ack' && !m.ok) {
          setPending(null);
          setNotice(REFUSED[m.reason ?? ''] ?? 'Réponse refusée.');
        }
        if (m.type === 'error') setNotice(m.message);
      }),
    [sock.onMessage],
  );

  useEffect(() => {
    setPending(null);
    setNotice(null);
  }, [view?.question?.index, view?.phase]);

  if (!view) {
    return (
      <div className="phone">
        <p className="muted pad">{sock.conn === 'open' ? 'Chargement…' : 'Connexion…'}</p>
      </div>
    );
  }

  if (!view.me) return <Join view={view} onJoin={(name) => send({ type: 'join', name })} conn={sock.conn} error={notice} />;

  const me = view.me;
  return (
    <div className="phone">
      <ConnBadge conn={sock.conn} />
      <header className="phone-head">
        <div>
          <div className="me-name">{me.name}</div>
          <div className="muted small">
            {me.rank}
            {me.rank === 1 ? 'er' : 'e'} sur {view.players.length}
            {me.streak >= 2 ? ` · série de ${me.streak}` : ''}
          </div>
        </div>
        <div className="me-hr">{ths(me.hashrate)}</div>
      </header>
      <main className="phone-body">
        {view.phase === 'lobby' ? (
          <>
            <p className="big-line">Inscrit. La partie commence bientôt.</p>
            <Rules config={view.config} />
          </>
        ) : null}
        {view.phase === 'question' && view.question ? (
          <QuestionPad
            view={view}
            serverNow={sock.serverNow}
            pending={pending}
            notice={notice}
            onAnswer={(option) => {
              setPending({ q: view.question!.index, option });
              send({ type: 'answer', questionIndex: view.question!.index, option });
            }}
          />
        ) : null}
        {view.phase === 'reveal' ? <Reveal view={view} /> : null}
        {view.phase === 'final' ? <Final view={view} serverNow={sock.serverNow} /> : null}
      </main>
    </div>
  );
}

function Join({ view, onJoin, conn, error }: { view: PlayerView; onJoin: (name: string) => void; conn: 'connecting' | 'open' | 'closed'; error: string | null }) {
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (error) setSent(false);
  }, [error]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || sent) return;
    setSent(true);
    onJoin(name.trim());
  };
  return (
    <div className="phone">
      <ConnBadge conn={conn} />
      <main className="phone-body join">
        <Wordmark size="lg" />
        <p>
          {view.questionTotal} questions sur Bitcoin. Les bonnes réponses rapportent du hashrate, et à la fin on mine un bloc.
        </p>
        <form onSubmit={submit} className="join-form">
          <label htmlFor="name">Nom (le vôtre ou celui de l’équipe)</label>
          <input id="name" className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
          <button className="btn primary" disabled={!name.trim() || sent || conn !== 'open'}>
            Rejoindre
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        {view.phase !== 'lobby' ? <p className="muted">La partie a commencé, vous partez de 0 TH.</p> : null}
        <Rules config={view.config} />
      </main>
    </div>
  );
}

function QuestionPad({
  view,
  serverNow,
  pending,
  notice,
  onAnswer,
}: {
  view: PlayerView;
  serverNow: () => number;
  pending: { q: number; option: number } | null;
  notice: string | null;
  onAnswer: (i: number) => void;
}) {
  useTicker(250);
  const q = view.question!;
  const chosen = view.myAnswer?.option ?? (pending?.q === q.index ? pending.option : undefined);
  const timeUp = serverNow() >= q.closesAt;
  return (
    <>
      <Label>
        Question {q.index + 1}/{q.total} · {difficultyLabel[q.difficulty]} · {q.baseGain} TH
      </Label>
      <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={serverNow} />
      <h2 className="q-text">{q.text}</h2>
      <div className="answers">
        {q.options.map((opt, i) => (
          <button
            key={i}
            className={'answer' + (chosen === i ? ' chosen' : chosen !== undefined ? ' faded' : '')}
            disabled={chosen !== undefined || timeUp}
            onClick={() => onAnswer(i)}
          >
            <span className="letter">{LETTERS[i]}</span>
            <span>{opt}</span>
          </button>
        ))}
      </div>
      {view.myAnswer ? (
        <p className="muted">
          Réponse {LETTERS[view.myAnswer.option]} enregistrée en {seconds(view.myAnswer.ms)}. Le résultat s’affiche quand tout le monde a répondu ou à la
          fin du chrono.
        </p>
      ) : timeUp && chosen === undefined ? (
        <p className="muted">Temps écoulé.</p>
      ) : null}
      {notice ? <p className="error">{notice}</p> : null}
    </>
  );
}

function Reveal({ view }: { view: PlayerView }) {
  const q = view.question!;
  const r = view.myResult;
  const answer = q.correctIndex !== undefined ? `${LETTERS[q.correctIndex]}. ${q.options[q.correctIndex]}` : '';
  return (
    <>
      {q.cancelled ? (
        <p className="big-line">Question annulée, aucun point.</p>
      ) : r?.correct ? (
        <section className="result">
          <p className="gain-big ok">+{ths(r.gain)}</p>
          <table className="breakdown">
            <tbody>
              <tr>
                <td>Bonne réponse</td>
                <td>{ths(r.base, false)}</td>
              </tr>
              <tr>
                <td>{r.speedRank ? `Rapidité : ${placeLabel(r.speedRank)} bonne réponse` : `Rapidité : ${seconds(r.ms ?? 0)}, hors des ${view.config.speedBonusRanks.length} premiers`}</td>
                <td>+{ths(r.speedBonus, false)}</td>
              </tr>
              {r.streakBonus > 0 ? (
                <tr>
                  <td>Série de {r.streak}</td>
                  <td>+{ths(r.streakBonus, false)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="result">
          <p className="gain-big">0 TH</p>
          <p>
            {r?.option === null || !r ? 'Pas de réponse.' : 'Faux.'} La réponse était <b>{answer}</b>
          </p>
        </section>
      )}
      <Standing view={view} />
      {q.explanation ? <p className="explain">{q.explanation}</p> : null}
    </>
  );
}

function Standing({ view }: { view: PlayerView }) {
  const me = view.me!;
  return (
    <section className="standing">
      <div className="figures">
        <div>
          <span className="cap">Hashrate</span>
          <span className="value">{ths(me.hashrate)}</span>
        </div>
        <div>
          <span className="cap">Rang</span>
          <span className="value">
            {me.rank}/{view.players.length}
          </span>
        </div>
        <div>
          <span className="cap">Chances</span>
          <span className="value">{pct(me.share)}</span>
        </div>
      </div>
      <NetworkBar players={view.players} highlightId={me.id} />
    </section>
  );
}

function Final({ view, serverNow }: { view: PlayerView; serverNow: () => number }) {
  const me = view.me!;
  const last = view.blocks[view.blocks.length - 1];
  const won = view.blocks.find((b) => b.found && b.winnerId === me.id);
  return (
    <>
      {last ? (
        <Mining block={last} players={view.players} serverNow={serverNow} meId={me.id} myPlace={won?.n} compact />
      ) : (
        <p className="big-line">
          Quiz terminé, {me.correctCount} bonne{me.correctCount > 1 ? 's' : ''} réponse{me.correctCount > 1 ? 's' : ''} sur {view.questionTotal}. Le tirage va commencer.
        </p>
      )}
      {won && won !== last ? <p className="big-line">Vous avez la {placeLabel(won.n)} place.</p> : null}
      <Standing view={view} />
    </>
  );
}
