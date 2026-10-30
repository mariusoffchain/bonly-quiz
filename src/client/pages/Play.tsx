import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlayerView } from '../../shared/views';
import { Avatar, ConnBadge, MiningScene, NetworkBar, Rules, TimerBar } from '../components/ui';
import { LETTERS, difficultyLabel, pct, seconds, ths } from '../lib/format';
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
  'too-late': 'Trop tard, le temps est écoulé.',
  'already-answered': 'Réponse déjà enregistrée.',
  'not-open': 'La question est fermée.',
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
      <div className="phone center">
        <div className="brand-lg">B-only Quiz</div>
        <div className="muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion au serveur…'}</div>
      </div>
    );
  }

  if (!view.me) return <Join view={view} onJoin={(name) => send({ type: 'join', name })} conn={sock.conn} error={notice} />;

  const me = view.me;
  return (
    <div className="phone">
      <ConnBadge conn={sock.conn} />
      <header className="phone-head">
        <Avatar name={me.name} color={me.color} size={36} />
        <div className="grow">
          <div className="me-name">{me.name}</div>
          <div className="muted small">
            Rang {me.rank}/{view.players.length}
            {me.streak >= 2 ? ` · 🔥 série de ${me.streak}` : ''}
          </div>
        </div>
        <div className="hr-chip">{ths(me.hashrate)}</div>
      </header>
      <main className="phone-body">
        {view.phase === 'lobby' ? <Lobby view={view} /> : null}
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
        <div className="brand-lg">B-only Quiz</div>
        <p className="lead">
          {view.questionTotal} questions sur Bitcoin. Chaque bonne réponse vous rapporte du <b>hashrate</b>. À la fin, on mine un bloc.
        </p>
        <form onSubmit={submit} className="join-form">
          <label htmlFor="name">Votre nom ou celui de votre équipe</label>
          <input id="name" className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Satoshi’s pool" autoComplete="off" autoFocus />
          <button className="btn primary big" disabled={!name.trim() || sent || conn !== 'open'}>
            {sent ? 'Inscription…' : 'Rejoindre la partie'}
          </button>
          {error ? <div className="notice bad">{error}</div> : null}
        </form>
        {view.phase !== 'lobby' ? <div className="notice">La partie a déjà commencé, vous partez de 0 TH/s.</div> : null}
        <Rules config={view.config} />
      </main>
    </div>
  );
}

function Lobby({ view }: { view: PlayerView }) {
  return (
    <div className="stack">
      <div className="card hero">
        <div className="big-emoji">⛏️</div>
        <h2>Vous êtes inscrit</h2>
        <p className="muted">La partie commence bientôt. Gardez cet écran ouvert.</p>
        <div className="muted small">{view.players.length} mineur{view.players.length > 1 ? 's' : ''} connecté{view.players.length > 1 ? 's' : ''}</div>
      </div>
      <Rules config={view.config} />
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
    <div className="stack">
      <div className="q-meta">
        <span>
          Question {q.index + 1}/{q.total}
        </span>
        <span className={'diff ' + q.difficulty}>
          {difficultyLabel[q.difficulty]} · {q.baseGain} TH/s
        </span>
      </div>
      <TimerBar closesAt={q.closesAt} durationMs={q.durationMs} serverNow={serverNow} />
      <h2 className="q-text">{q.text}</h2>
      <div className="answers">
        {q.options.map((opt, i) => (
          <button
            key={i}
            className={'answer opt-' + i + (chosen === i ? ' chosen' : chosen !== undefined ? ' faded' : '')}
            disabled={chosen !== undefined || timeUp}
            onClick={() => onAnswer(i)}
          >
            <span className="letter">{LETTERS[i]}</span>
            <span>{opt}</span>
          </button>
        ))}
      </div>
      {view.myAnswer ? (
        <div className="notice ok">Réponse verrouillée en {seconds(view.myAnswer.ms)}. Résultat à la fin du chrono.</div>
      ) : chosen !== undefined ? (
        <div className="notice">Envoi…</div>
      ) : timeUp ? (
        <div className="notice bad">Temps écoulé.</div>
      ) : null}
      {notice ? <div className="notice bad">{notice}</div> : null}
    </div>
  );
}

function Reveal({ view }: { view: PlayerView }) {
  const q = view.question!;
  const r = view.myResult;
  const me = view.me!;
  const correctText = q.correctIndex !== undefined ? `${LETTERS[q.correctIndex]}. ${q.options[q.correctIndex]}` : '';
  return (
    <div className="stack">
      {q.cancelled ? (
        <div className="card result neutral">
          <h2>Question annulée</h2>
          <p className="muted">Aucun point, votre série est conservée.</p>
        </div>
      ) : r?.correct ? (
        <div className="card result good">
          <div className="result-title">Bonne réponse !</div>
          <div className="gain-big">+{ths(r.gain)}</div>
          <dl className="breakdown">
            <dt>Bonne réponse</dt>
            <dd>+{ths(r.base, false)}</dd>
            <dt>⚡ Rapidité ({seconds(r.ms ?? 0)})</dt>
            <dd>+{ths(r.speedBonus, false)}</dd>
            {r.streakBonus > 0 ? (
              <>
                <dt>🔥 Série de {r.streak}</dt>
                <dd>+{ths(r.streakBonus, false)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : (
        <div className="card result bad">
          <div className="result-title">{r?.option === null || !r ? 'Pas de réponse' : 'Raté'}</div>
          <p>
            La bonne réponse était <b>{correctText}</b>
          </p>
          {me.streak === 0 && r ? <p className="muted small">Série remise à zéro.</p> : null}
        </div>
      )}
      <Standing view={view} />
      {q.explanation ? <p className="explain">{q.explanation}</p> : null}
      <div className="muted small center-text">Prochaine question sur l’écran principal.</div>
    </div>
  );
}

function Standing({ view }: { view: PlayerView }) {
  const me = view.me!;
  return (
    <div className="card standing">
      <div className="stat-row">
        <div>
          <div className="label">Votre hashrate</div>
          <div className="value">{ths(me.hashrate)}</div>
        </div>
        <div>
          <div className="label">Rang</div>
          <div className="value">
            {me.rank}
            <small>/{view.players.length}</small>
          </div>
        </div>
        <div>
          <div className="label">Chances de bloc</div>
          <div className="value accent">{pct(me.share)}</div>
        </div>
      </div>
      <NetworkBar players={view.players} highlightId={me.id} />
    </div>
  );
}

function Final({ view, serverNow }: { view: PlayerView; serverNow: () => number }) {
  const me = view.me!;
  const last = view.blocks[view.blocks.length - 1];
  const won = view.blocks.filter((b) => b.found && b.winnerId === me.id);
  return (
    <div className="stack">
      {last ? (
        <MiningScene block={last} players={view.players} serverNow={serverNow} meId={me.id} compact />
      ) : (
        <div className="card hero">
          <div className="big-emoji">🏁</div>
          <h2>Quiz terminé !</h2>
          <p className="muted">
            {me.correctCount} bonne{me.correctCount > 1 ? 's' : ''} réponse{me.correctCount > 1 ? 's' : ''} sur {view.questionTotal}. Le minage du bloc va commencer.
          </p>
        </div>
      )}
      {won.length > 0 && last && last.found && last.winnerId !== me.id ? (
        <div className="notice ok">Vous avez déjà trouvé le bloc {won.map((b) => b.n).join(', ')}.</div>
      ) : null}
      <Standing view={view} />
    </div>
  );
}
