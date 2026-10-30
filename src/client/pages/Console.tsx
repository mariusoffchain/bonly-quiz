import { useEffect, useState } from 'react';
import type { SessionConfig } from '../../shared/config';
import type { ConsoleView } from '../../shared/views';
import { Avatar, ConnBadge, TimerRing } from '../components/ui';
import { LETTERS, difficultyLabel, pct, ths } from '../lib/format';
import { useQuizSocket } from '../lib/ws';

const TOKEN_KEY = 'bq_console_token';

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

export function Console() {
  const [token, setToken] = useState<string | null>(() => new URLSearchParams(location.search).get('token') ?? readToken());
  useEffect(() => {
    if (token) writeToken(token);
    if (location.search.includes('token=')) history.replaceState(null, '', location.pathname);
  }, [token]);
  if (!token) return <Login onToken={setToken} />;
  return (
    <ConsoleApp
      token={token}
      onLogout={() => {
        writeToken(null);
        setToken(null);
      }}
    />
  );
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [t, setT] = useState('');
  const [err, setErr] = useState('');
  const check = async () => {
    const r = await fetch('/api/console/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t.trim() }) });
    const j = (await r.json()) as { ok: boolean };
    if (j.ok) onToken(t.trim());
    else setErr('Jeton invalide. Il est affiché dans le terminal du serveur au démarrage, et dans data/console-token.txt.');
  };
  return (
    <div className="login">
      <div className="brand-lg">Console</div>
      <input className="input" placeholder="Jeton console" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void check()} autoFocus />
      <button className="btn primary big" onClick={() => void check()}>
        Entrer
      </button>
      {err ? <div className="notice bad">{err}</div> : null}
    </div>
  );
}

const PHASE_TEXT: Record<ConsoleView['phase'], string> = {
  lobby: 'Inscriptions ouvertes',
  question: 'Question en cours',
  reveal: 'Réponse affichée',
  final: 'Quiz terminé · minage',
};

function ConsoleApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  const sock = useQuizSocket<ConsoleView>(() => ({ type: 'hello', role: 'console', consoleToken: token }));
  const { view, send } = sock;
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      sock.onMessage((m) => {
        if (m.type === 'state') setSentKey(null);
        if (m.type === 'error') {
          setSentKey(null);
          if (m.code === 'unauthorized') onLogout();
          else setError(m.message);
        }
      }),
    [sock.onMessage, onLogout],
  );

  if (!view) {
    return (
      <div className="login">
        <div className="brand-lg">Console</div>
        <div className="muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion au serveur…'}</div>
      </div>
    );
  }

  const next = view.next;
  const q = view.question;
  const connected = view.players.filter((p) => p.connected).length;
  const go = () => {
    if (!next || sentKey === next.key) return;
    setSentKey(next.key);
    setError(null);
    send({ type: 'next', key: next.key, label: next.action === 'mine' ? label : undefined });
    if (next.action === 'mine') setLabel('');
  };

  return (
    <div className="console">
      <ConnBadge conn={sock.conn} />
      <header className="console-head">
        <div className="brand">
          <span className="logo">₿</span> Console
        </div>
        <span className="muted small">
          Partie {view.code} · {view.packName}
        </span>
        <nav>
          <a href="/board" target="_blank" rel="noreferrer">
            Ouvrir l’écran ↗
          </a>
          <a href={view.joinUrl} target="_blank" rel="noreferrer">
            Page joueur ↗
          </a>
          <button className="link" onClick={onLogout}>
            Déconnexion
          </button>
        </nav>
      </header>

      <div className="console-grid">
        <section className="stack">
          <div className="card control">
            <div className="row between">
              <div>
                <div className="eyebrow">{PHASE_TEXT[view.phase]}</div>
                <div className="control-title">
                  {view.phase === 'lobby'
                    ? `${view.players.length} inscrit${view.players.length > 1 ? 's' : ''}`
                    : view.phase === 'final'
                      ? `${view.blocks.filter((b) => b.found).length} bloc(s) trouvé(s)`
                      : `Question ${(q?.index ?? 0) + 1} / ${view.questionTotal}`}
                </div>
              </div>
              {view.phase === 'question' && q ? <TimerRing closesAt={q.closesAt} durationMs={q.durationMs} serverNow={sock.serverNow} size={72} /> : null}
            </div>
            {view.phase === 'question' && q ? (
              <div className="answered">
                <div className="answered-bar">
                  <div style={{ width: `${connected ? Math.min(100, (q.answerCount / connected) * 100) : 0}%` }} />
                </div>
                <span>
                  {q.answerCount} / {connected} ont répondu
                </span>
              </div>
            ) : null}
            {next?.action === 'mine' ? (
              <input className="input" placeholder="Lot pour ce bloc (optionnel)" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            ) : null}
            {next ? (
              <button className="btn primary huge" onClick={go} disabled={sentKey === next.key}>
                {next.label} →
              </button>
            ) : view.phase === 'final' ? (
              <button className="btn huge" disabled>
                Minage en cours…
              </button>
            ) : null}
            {view.phase === 'question' ? (
              <button className="btn ghost" onClick={() => confirm('Annuler cette question ? Personne ne gagne de TH/s.') && send({ type: 'cancel-question' })}>
                Annuler la question (aucun point)
              </button>
            ) : null}
            {error ? <div className="notice bad">{error}</div> : null}
          </div>

          {q && view.phase !== 'final' ? <QuestionCard view={view} /> : null}
          {view.phase === 'lobby' || view.phase === 'reveal' ? <UpNext view={view} /> : null}
          {view.phase === 'final' ? <Blocks view={view} /> : null}
          {view.phase === 'lobby' ? <Settings view={view} send={send} /> : null}
        </section>

        <section className="stack">
          <Players view={view} send={send} />
          <div className="card">
            <div className="panel-title">Pour rejoindre</div>
            <div className="join-mini">
              <img src={`/api/qr.svg?text=${encodeURIComponent(view.joinUrl)}`} alt="" />
              <div>
                <div className="mono">{view.joinUrl}</div>
                {view.lanUrls.length > 1 ? <div className="muted small">Autres adresses : {view.lanUrls.join(', ')}</div> : null}
              </div>
            </div>
          </div>
          <div className="card row between">
            <a className="btn ghost" href={`/api/export?token=${encodeURIComponent(token)}`}>
              Exporter la partie (JSON)
            </a>
            <button
              className="btn danger"
              onClick={() => confirm('Démarrer une nouvelle partie ? Les joueurs devront se réinscrire.') && send({ type: 'new-session' })}
            >
              Nouvelle partie
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function QuestionCard({ view }: { view: ConsoleView }) {
  const q = view.question!;
  return (
    <div className="card">
      <div className="panel-title">
        Question {q.index + 1} · {difficultyLabel[q.difficulty]} · {q.baseGain} TH/s
      </div>
      <div className="q-console">{q.text}</div>
      <ol className="opts-console">
        {q.options.map((o, i) => (
          <li key={i} className={i === q.correctIndex ? 'correct' : ''}>
            <b>{LETTERS[i]}</b> {o}
            {q.optionCounts ? <span className="muted"> · {q.optionCounts[i]}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function UpNext({ view }: { view: ConsoleView }) {
  const i = view.phase === 'lobby' ? 0 : (view.question?.index ?? -1) + 1;
  const q = view.questions[i];
  if (!q) return null;
  return (
    <div className="card upnext">
      <div className="panel-title">
        À suivre · question {i + 1} · {difficultyLabel[q.difficulty]}
      </div>
      <div>{q.text}</div>
      <div className="muted small">
        Réponse : {LETTERS[q.correctIndex]}. {q.options[q.correctIndex]}
      </div>
    </div>
  );
}

function Blocks({ view }: { view: ConsoleView }) {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  if (view.blocks.length === 0) {
    return (
      <div className="card muted">
        Chaque clic sur « Miner le bloc » tire 1 gagnant, chances = part du hashrate.
        {view.config.excludeBlockWinners ? ' Un gagnant ne peut pas retrouver un bloc.' : ''}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="panel-title">Blocs</div>
      <ul className="blocks-list">
        {view.blocks.map((b) => {
          const w = b.winnerId ? byId.get(b.winnerId) : undefined;
          const share = b.candidates.find((c) => c.id === b.winnerId)?.share;
          return (
            <li key={b.n}>
              <span className="mono">#{b.n}</span>
              <span className="grow">{b.label ?? ''}</span>
              {b.found ? (
                <>
                  <b>{w?.name ?? 'personne'}</b>
                  {share !== undefined ? <span className="muted">{pct(share)}</span> : null}
                  <span className="muted small mono">
                    tirage {b.roll?.toLocaleString('fr-FR')} / {b.total?.toLocaleString('fr-FR')}
                  </span>
                </>
              ) : (
                <span className="muted">minage…</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Players({ view, send }: { view: ConsoleView; send: ReturnType<typeof useQuizSocket>['send'] }) {
  const answered = new Set(view.answeredIds);
  return (
    <div className="card">
      <div className="panel-title">
        Joueurs ({view.players.length}, {view.players.filter((p) => p.connected).length} connectés)
      </div>
      {view.players.length === 0 ? <div className="muted">Personne pour l’instant. Affichez l’écran avec le QR code.</div> : null}
      <ul className="players-console">
        {view.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            <span className="rank">{p.rank}</span>
            <Avatar name={p.name} color={p.color} size={26} />
            <span className="grow">
              {p.name}
              {view.phase === 'question' && answered.has(p.id) ? <span className="tick"> ✓</span> : null}
              {!p.connected ? <span className="muted small"> · hors ligne</span> : null}
            </span>
            {p.streak >= 2 ? <span className="small">🔥{p.streak}</span> : null}
            <span className="mono small">{ths(p.hashrate)}</span>
            <button
              className="icon-btn"
              title="Retirer"
              onClick={() => confirm(`Retirer ${p.name} de la partie ?`) && send({ type: 'remove-player', id: p.id })}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Settings({ view, send }: { view: ConsoleView; send: ReturnType<typeof useQuizSocket>['send'] }) {
  const c = view.fullConfig;
  const [draft, setDraft] = useState<SessionConfig>(c);
  useEffect(() => setDraft(c), [JSON.stringify(c)]);
  const num = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')));
  const set = (patch: Partial<SessionConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(c);
  const currentPack = view.packs.find((p) => p.name === view.packName);
  return (
    <details className="card settings">
      <summary>Réglages de la partie</summary>
      <label>
        Questions
        <select value={currentPack?.file ?? ''} onChange={(e) => send({ type: 'set-pack', file: e.target.value })}>
          {view.packs.map((p) => (
            <option key={p.file} value={p.file}>
              {p.name} ({p.questions})
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <label>
          Nombre de questions
          <input type="number" min={1} value={draft.questionCount} onChange={(e) => set({ questionCount: num(e.target.value) })} />
        </label>
        <label>
          Chrono (s)
          <input type="number" min={3} value={draft.questionDurationMs / 1000} onChange={(e) => set({ questionDurationMs: num(e.target.value) * 1000 })} />
        </label>
        {(['easy', 'intermediate', 'hard'] as const).map((d) => (
          <label key={d}>
            Gain {difficultyLabel[d].toLowerCase()} (TH/s)
            <input type="number" min={0} value={draft.baseGainThs[d]} onChange={(e) => set({ baseGainThs: { ...draft.baseGainThs, [d]: num(e.target.value) } })} />
          </label>
        ))}
        <label>
          Hashrate de départ
          <input type="number" min={0} value={draft.startHashrateThs} onChange={(e) => set({ startHashrateThs: num(e.target.value) })} />
        </label>
        <label>
          Bonus rapidité max (%)
          <input type="number" min={0} value={Math.round(draft.speedBonusMax * 100)} onChange={(e) => set({ speedBonusMax: num(e.target.value) / 100 })} />
        </label>
        <label>
          Bonus série par réponse (%)
          <input type="number" min={0} value={Math.round(draft.streakBonusStep * 100)} onChange={(e) => set({ streakBonusStep: num(e.target.value) / 100 })} />
        </label>
        <label>
          Bonus série max (%)
          <input type="number" min={0} value={Math.round(draft.streakBonusMax * 100)} onChange={(e) => set({ streakBonusMax: num(e.target.value) / 100 })} />
        </label>
        <label>
          Animation de minage (s)
          <input type="number" min={0} max={60} value={draft.miningDurationMs / 1000} onChange={(e) => set({ miningDurationMs: num(e.target.value) * 1000 })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.closeWhenAllAnswered} onChange={(e) => set({ closeWhenAllAnswered: e.target.checked })} />
        Révéler dès que tout le monde a répondu
      </label>
      <label className="check">
        <input type="checkbox" checked={draft.excludeBlockWinners} onChange={(e) => set({ excludeBlockWinners: e.target.checked })} />
        Un gagnant de bloc ne peut pas en gagner un autre
      </label>
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={() => send({ type: 'set-config', patch: draft })}>
          Enregistrer
        </button>
        <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(c)}>
          Annuler
        </button>
      </div>
    </details>
  );
}
