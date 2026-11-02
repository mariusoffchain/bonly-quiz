import { useEffect, useState, type FormEvent } from 'react';
import { DIFFICULTIES, PRESETS, type SessionConfig } from '../../shared/config';
import type { ConsoleView } from '../../shared/views';
import { ConnBadge, Countdown, Swatch, Wordmark } from '../components/ui';
import { LETTERS, difficultyLabel, pct, placeLabel, ths } from '../lib/format';
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

type Send = ReturnType<typeof useQuizSocket>['send'];

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
  const check = async (e: FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/console/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t.trim() }) });
    const j = (await r.json()) as { ok: boolean };
    if (j.ok) onToken(t.trim());
    else setErr('Jeton invalide. Il s’affiche au démarrage du serveur et se trouve dans data/console-token.txt.');
  };
  return (
    <form className="narrow" onSubmit={(e) => void check(e)}>
      <Wordmark size="lg" />
      <input className="input" placeholder="Jeton" value={t} onChange={(e) => setT(e.target.value)} autoFocus />
      <button className="btn primary">Entrer</button>
      {err ? <p className="error">{err}</p> : null}
    </form>
  );
}

function ConsoleApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  const sock = useQuizSocket<ConsoleView>(() => ({ type: 'hello', role: 'console', consoleToken: token }));
  const { view, send } = sock;
  const [sentKey, setSentKey] = useState<string | null>(null);
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

  if (!view) return <p className="narrow muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion…'}</p>;

  const next = view.next;
  const q = view.question;
  const connected = view.players.filter((p) => p.connected).length;
  const go = () => {
    if (!next || sentKey === next.key) return;
    setSentKey(next.key);
    setError(null);
    send({ type: 'next', key: next.key });
  };
  const status =
    view.phase === 'lobby'
      ? `${view.players.length} inscrit${view.players.length > 1 ? 's' : ''}`
      : view.phase === 'final'
        ? `Fin du quiz, podium ${view.blocks.filter((b) => b.found).length} / ${view.config.podiumSize}`
        : `Question ${(q?.index ?? 0) + 1} / ${view.questionTotal}${view.phase === 'reveal' ? ', réponse affichée' : ''}`;

  return (
    <div className="console">
      <ConnBadge conn={sock.conn} />
      <header className="console-head">
        <Wordmark />
        <span className="muted">
          console · {view.code} · {view.packName}
        </span>
        <nav>
          <a href="/board" target="_blank" rel="noreferrer">
            Écran
          </a>
          <a href={view.joinUrl} target="_blank" rel="noreferrer">
            Page joueur
          </a>
          <button className="link" onClick={onLogout}>
            Déconnexion
          </button>
        </nav>
      </header>

      <div className="console-grid">
        <div>
          <section className="control">
            <p className="status">{status}</p>
            {view.phase === 'question' && q ? (
              <>
                <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={sock.serverNow} />
                <p className="muted">
                  {q.answerCount} / {view.players.length} réponses{connected < view.players.length ? ` (${view.players.length - connected} hors ligne)` : ''}
                </p>
              </>
            ) : null}
            {next ? (
              <button className="btn primary big" onClick={go} disabled={sentKey === next.key}>
                {next.label}
              </button>
            ) : view.phase === 'final' ? (
              <button className="btn big" disabled>
                {view.blocks.some((b) => !b.found) ? 'Tirage en cours…' : 'Podium complet'}
              </button>
            ) : null}
            {view.phase === 'question' ? (
              <button className="link" onClick={() => confirm('Annuler cette question ? Personne ne marque.') && send({ type: 'cancel-question' })}>
                Annuler la question sans points
              </button>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
          </section>

          {q && view.phase !== 'final' ? <QuestionPanel view={view} /> : null}
          {view.phase === 'lobby' || view.phase === 'reveal' ? <UpNext view={view} /> : null}
          {view.phase === 'final' ? <Blocks view={view} /> : null}
          {view.phase === 'lobby' ? <Settings view={view} send={send} /> : null}
        </div>

        <div>
          <Players view={view} send={send} />
          <section>
            <h3>Rejoindre</h3>
            <div className="join-mini">
              <img src={`/api/qr.svg?text=${encodeURIComponent(view.joinUrl)}`} alt="" />
              <div>
                <p className="mono">{view.joinUrl}</p>
                {view.lanUrls.length > 1 ? <p className="muted small">Autres adresses : {view.lanUrls.join(', ')}</p> : null}
              </div>
            </div>
          </section>
          <section className="row">
            <a href={`/api/export?token=${encodeURIComponent(token)}`}>Exporter la partie (JSON)</a>
            <button className="link danger" onClick={() => confirm('Nouvelle partie ? Les joueurs devront se réinscrire.') && send({ type: 'new-session' })}>
              Nouvelle partie
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function QuestionPanel({ view }: { view: ConsoleView }) {
  const q = view.question!;
  return (
    <section>
      <h3>
        Question {q.index + 1} · {difficultyLabel[q.difficulty]} · {q.baseGain} TH
      </h3>
      <p className="q-console">{q.text}</p>
      <ol className="opts-console">
        {q.options.map((o, i) => (
          <li key={i} className={i === q.correctIndex ? 'right' : ''}>
            <span className="letter">{LETTERS[i]}</span>
            <span className="grow">{o}</span>
            {q.optionCounts ? <span className="mono">{q.optionCounts[i]}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function UpNext({ view }: { view: ConsoleView }) {
  const i = view.phase === 'lobby' ? 0 : (view.question?.index ?? -1) + 1;
  const q = view.questions[i];
  if (!q) return null;
  return (
    <section>
      <h3>
        Ensuite · question {i + 1} · {difficultyLabel[q.difficulty]}
      </h3>
      <p>{q.text}</p>
      <p className="muted small">
        Réponse {LETTERS[q.correctIndex]} : {q.options[q.correctIndex]}
      </p>
    </section>
  );
}

function Blocks({ view }: { view: ConsoleView }) {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  if (view.blocks.length === 0) {
    return (
      <section>
        <p className="muted">
          Chaque clic tire une place, de la 1re à la {placeLabel(view.config.podiumSize)}. Chances = part du hashrate parmi les joueurs pas encore placés.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h3>Podium</h3>
      <table className="standings">
        <tbody>
          {view.blocks.map((b) => {
            const w = b.winnerId ? byId.get(b.winnerId) : undefined;
            const share = b.candidates.find((c) => c.id === b.winnerId)?.share;
            return (
              <tr key={b.n}>
                <td className="rank">{placeLabel(b.n)}</td>
                {b.found ? (
                  <>
                    <td className="who">
                      <span className="nm">{w?.name ?? 'personne'}</span>
                    </td>
                    <td className="num">{share !== undefined ? pct(share) : ''}</td>
                    <td className="num muted small">
                      tirage {ths((b.roll ?? 0) / 10, false)} sur {ths((b.total ?? 0) / 10)}
                    </td>
                  </>
                ) : (
                  <td className="muted" colSpan={3}>
                    tirage…
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Players({ view, send }: { view: ConsoleView; send: Send }) {
  const answered = new Set(view.answeredIds);
  return (
    <section>
      <h3>
        Joueurs · {view.players.length} ({view.players.filter((p) => p.connected).length} en ligne)
      </h3>
      {view.players.length === 0 ? <p className="muted">Personne pour l’instant.</p> : null}
      <table className="standings players">
        <tbody>
          {view.players.map((p) => (
            <tr key={p.id} className={p.connected ? '' : 'off'}>
              <td className="rank">{p.rank}</td>
              <td className="who">
                <Swatch color={p.color} />
                <span className="nm">{p.name}</span>
                {view.phase === 'question' && answered.has(p.id) ? <span className="mark">a répondu</span> : null}
              </td>
              <td className="num muted">{p.streak >= 2 ? `série ${p.streak}` : ''}</td>
              <td className="num">{ths(p.hashrate)}</td>
              <td>
                <button className="link" title="Retirer" onClick={() => confirm(`Retirer ${p.name} ?`) && send({ type: 'remove-player', id: p.id })}>
                  retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Settings({ view, send }: { view: ConsoleView; send: Send }) {
  const c = view.fullConfig;
  const [draft, setDraft] = useState<SessionConfig>(c);
  useEffect(() => setDraft(c), [JSON.stringify(c)]);
  const num = (v: string) => (v === '' ? 0 : Number(v.replace(',', '.')));
  const set = (patch: Partial<SessionConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(c);
  const currentPack = view.packs.find((p) => p.name === view.packName);
  const preset = PRESETS.find((p) => (Object.keys(p.scoring) as (keyof typeof p.scoring)[]).every((k) => JSON.stringify(p.scoring[k]) === JSON.stringify(draft[k])));
  return (
    <details className="settings">
      <summary>Réglages{preset ? ` · ${preset.name}` : ' · personnalisés'}</summary>
      <fieldset className="presets">
        <legend>Profil de points</legend>
        {PRESETS.map((p) => (
          <label key={p.id} className="check">
            <input type="radio" name="preset" checked={preset?.id === p.id} onChange={() => set(p.scoring)} />
            <span>
              <b>{p.name}</b> <span className="muted small">{p.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
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
        {DIFFICULTIES.map((d) => (
          <label key={d}>
            Gain {difficultyLabel[d]} (TH)
            <input type="number" min={0} value={draft.baseGainThs[d]} onChange={(e) => set({ baseGainThs: { ...draft.baseGainThs, [d]: num(e.target.value) } })} />
          </label>
        ))}
        <label>
          Hashrate de départ
          <input type="number" min={0} value={draft.startHashrateThs} onChange={(e) => set({ startHashrateThs: num(e.target.value) })} />
        </label>
        <label>
          Bonus rapidité par rang (%)
          <RanksInput value={draft.speedBonusRanks} onChange={(speedBonusRanks) => set({ speedBonusRanks })} />
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
          Places tirées au sort
          <input type="number" min={1} max={20} value={draft.podiumSize} onChange={(e) => set({ podiumSize: num(e.target.value) })} />
        </label>
        <label>
          Durée du tirage (s)
          <input type="number" min={0} max={60} value={draft.miningDurationMs / 1000} onChange={(e) => set({ miningDurationMs: num(e.target.value) * 1000 })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={draft.closeWhenAllAnswered} onChange={(e) => set({ closeWhenAllAnswered: e.target.checked })} />
        Afficher la réponse dès que tout le monde a répondu
      </label>
      <div className="row">
        <button className="btn primary" disabled={!dirty} onClick={() => send({ type: 'set-config', patch: draft })}>
          Enregistrer
        </button>
        <button className="link" disabled={!dirty} onClick={() => setDraft(c)}>
          Annuler
        </button>
      </div>
    </details>
  );
}

/** "10, 5, 2": bonus of the 1st, 2nd, 3rd correct answers, in % of the base gain. */
function RanksInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const show = (v: number[]) => v.map((f) => String(Math.round(f * 1000) / 10).replace('.', ',')).join(', ');
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value.join()]);
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="10, 5, 2"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parts = e.target.value.split(/[;\s]+|,\s+/).map((x) => x.trim().replace(',', '.')).filter(Boolean);
        const nums = parts.map(Number);
        if (nums.every((n) => Number.isFinite(n) && n >= 0)) onChange(nums.map((n) => n / 100));
      }}
    />
  );
}
