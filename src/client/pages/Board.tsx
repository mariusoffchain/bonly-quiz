import type { BoardView } from '../../shared/views';
import { ConnBadge, Countdown, Label, Mining, Mountains, NetworkBar, Rules, Standings, Swatch, Wordmark } from '../components/ui';
import { LETTERS, difficultyLabel, gainsLabel, partPrefix, pct, placeLabel, seconds, ths } from '../lib/format';
import { useQuizSocket } from '../lib/ws';

export function Board() {
  const sock = useQuizSocket<BoardView>(() => ({ type: 'hello', role: 'board' }));
  const { view } = sock;
  if (!view) return <div className="board muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion…'}</div>;
  return (
    <div className="board">
      <ConnBadge conn={sock.conn} />
      <Head view={view} />
      {view.phase === 'lobby' ? <Lobby view={view} /> : null}
      {view.phase === 'intermission' ? <Intermission view={view} /> : null}
      {view.phase === 'question' ? <Question view={view} serverNow={sock.serverNow} /> : null}
      {view.phase === 'reveal' ? <Reveal view={view} /> : null}
      {view.phase === 'final' ? <Final view={view} serverNow={sock.serverNow} /> : null}
    </div>
  );
}

function Head({ view }: { view: BoardView }) {
  const q = view.question;
  const part = view.part !== undefined ? view.parts[view.part] : undefined;
  const done =
    view.phase === 'final' ? view.questionTotal : view.phase === 'intermission' ? (part?.from ?? 0) : q ? q.index + (view.phase === 'question' ? 0 : 1) : 0;
  return (
    <header className="board-head">
      <Wordmark />
      <span className="muted">
        {view.phase === 'lobby'
          ? `${view.questionTotal} questions${view.parts.length > 1 ? ` en ${view.parts.length} parties` : ''}`
          : view.phase === 'final'
            ? 'Fin du quiz'
            : view.phase === 'intermission'
              ? `Partie ${(view.part ?? 0) + 1} / ${view.parts.length}`
              : `${partPrefix(view)}Question ${q!.index + 1} / ${view.questionTotal}`}
      </span>
      <span className="head-right">
        <span className="mono">{ths(view.totalHashrate)}</span>
        <span className="muted">
          {' '}
          · {view.players.length} joueur{view.players.length > 1 ? 's' : ''}
        </span>
      </span>
      <span className="head-progress">
        <span style={{ width: `${(done / Math.max(1, view.questionTotal)) * 100}%` }} />
      </span>
    </header>
  );
}

function Lobby({ view }: { view: BoardView }) {
  return (
    <main className="lobby">
      <figure className="qr-block">
        <img src={`/api/qr.svg?text=${encodeURIComponent(view.joinUrl)}`} alt="QR code pour rejoindre" />
        <figcaption className="mono">{view.joinUrl.replace(/^https?:\/\//, '')}</figcaption>
      </figure>
      <section className="lobby-text">
        <Label>
          {view.questionTotal} questions sur Bitcoin
          {view.parts.length > 1 ? `, en ${view.parts.length} parties de plus en plus difficiles` : ''}
        </Label>
        <h1>Scannez pour jouer.</h1>
        <Rules config={view.config} />
        <div className="names">
          {view.players.map((p) => (
            <span key={p.id}>
              <Swatch color={p.color} />
              {p.name}
            </span>
          ))}
        </div>
      </section>
      <Mountains />
    </main>
  );
}

/** A part is announced: what comes next and, after the first part, the standings so far. */
function Intermission({ view }: { view: BoardView }) {
  const part = view.parts[view.part ?? 0];
  if (!part) return null;
  const ended = part.n > 1 ? view.parts[part.n - 2] : undefined;
  return (
    <main className="split">
      <section className="part-intro">
        {ended ? <Label>Fin de la partie {ended.n} · {ended.title}</Label> : <Label>C’est parti</Label>}
        <p className="part-n">
          Partie {part.n} / {view.parts.length}
        </p>
        <h1>{part.title}</h1>
        {part.subtitle ? <p className="part-sub">{part.subtitle}</p> : null}
        <p className="part-gain">
          {part.count} question{part.count > 1 ? 's' : ''} {gainsLabel(part.gains)}
        </p>
      </section>
      <aside>
        {ended ? (
          <>
            <Label>Classement provisoire</Label>
            <NetworkBar players={view.players} />
            <Standings players={view.players} limit={10} />
          </>
        ) : (
          <>
            <Label>Les parties</Label>
            <ol className="part-list">
              {view.parts.map((p) => (
                <li key={p.n} className={p.n === part.n ? 'on' : ''}>
                  <span className="pn">{p.n}</span>
                  <span className="grow">{p.title}</span>
                  <span className="mono">{gainsLabel(p.gains)}</span>
                </li>
              ))}
            </ol>
            <Rules config={view.config} />
          </>
        )}
      </aside>
      <Mountains />
    </main>
  );
}

function Question({ view, serverNow }: { view: BoardView; serverNow: () => number }) {
  const q = view.question!;
  const n = view.players.length;
  return (
    <main className="question">
      <div className="q-meta">
        <Label>
          {partPrefix(view)}Question {q.index + 1} · {difficultyLabel[q.difficulty]} · {q.baseGain} TH
        </Label>
        <span className="muted">
          {q.answerCount} / {n} réponses
        </span>
      </div>
      <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={serverNow} />
      <h1 className="q-big">{q.text}</h1>
      <ol className="options">
        {q.options.map((opt, i) => (
          <li key={i}>
            <span className="letter">{LETTERS[i]}</span>
            <span>{opt}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Reveal({ view }: { view: BoardView }) {
  const q = view.question!;
  const total = (q.optionCounts ?? []).reduce((s, x) => s + x, 0);
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return (
    <main className="split">
      <section>
        <Label>Question {q.index + 1} · réponse</Label>
        <h2 className="q-mid">{q.text}</h2>
        {q.cancelled ? <p className="muted">Question annulée, aucun point.</p> : null}
        <ol className="results">
          {q.options.map((opt, i) => {
            const count = q.optionCounts?.[i] ?? 0;
            return (
              <li key={i} className={i === q.correctIndex ? 'right' : ''}>
                <span className="letter">{LETTERS[i]}</span>
                <span className="text">{opt}</span>
                <span className="count">{count}</span>
                <span className="bar">
                  <span style={{ width: `${total ? (count / total) * 100 : 0}%` }} />
                </span>
              </li>
            );
          })}
        </ol>
        {q.explanation ? <p className="explain">{q.explanation}</p> : null}
        {q.source ? (
          <p className="source">
            Source : {q.source.provider}, {q.source.license}
          </p>
        ) : null}
      </section>
      <aside>
        <Label>Meilleurs gains</Label>
        {q.top && q.top.length > 0 ? (
          <table className="standings">
            <tbody>
              {q.top.map((r) => {
                const p = byId.get(r.id);
                return (
                  <tr key={r.id}>
                    <td className="who">
                      {p ? <Swatch color={p.color} /> : null}
                      <span className="nm">{p?.name ?? '?'}</span>
                    </td>
                    <td className="num muted">
                      {seconds(r.ms ?? 0)}
                      {r.streak >= 2 ? ` · série ${r.streak}` : ''}
                    </td>
                    <td className="num gain">+{ths(r.gain, false)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">Personne n’a trouvé.</p>
        )}
        <Label>Classement</Label>
        <NetworkBar players={view.players} />
        <Standings players={view.players} limit={8} showGain />
      </aside>
    </main>
  );
}

function Final({ view, serverNow }: { view: BoardView; serverNow: () => number }) {
  const last = view.blocks[view.blocks.length - 1];
  const found = view.blocks.filter((b) => b.found);
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const places = view.config.podiumSize;
  return (
    <main className="split">
      <section>
        {last ? (
          <Mining block={last} players={view.players} serverNow={serverNow} single={places === 1} />
        ) : (
          <div className="final-intro">
            <Label>Fin du quiz</Label>
            <h1>Le tirage</h1>
            <p>
              {places > 1 ? `${places} places à tirer, de la 1re à la ${placeLabel(places)}.` : 'Un gagnant à tirer.'} À chaque tirage, vos chances sont votre
              part du hashrate. Le premier du classement est favori, pas gagnant.
            </p>
            <NetworkBar players={view.players} />
            <ol className="odds">
              {view.players.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <span className="value">{pct(p.share)}</span>
                  <span>
                    <Swatch color={p.color} />
                    {p.name}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
      <aside>
        {found.length > 0 && places > 1 ? (
          <>
            <Label>Podium</Label>
            <table className="standings podium">
              <tbody>
                {found.map((b) => {
                  const w = b.winnerId ? byId.get(b.winnerId) : undefined;
                  return (
                    <tr key={b.n}>
                      <td className="rank">{placeLabel(b.n)}</td>
                      <td className="who">
                        {w ? <Swatch color={w.color} /> : null}
                        <span className="nm">{w?.name ?? 'personne'}</span>
                      </td>
                      <td className="num share">{pct(b.candidates.find((c) => c.id === b.winnerId)?.share ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}
        <Label>Classement final</Label>
        <Standings players={view.players} limit={12} winners={found.map((b) => b.winnerId)} single={places === 1} />
      </aside>
      <Mountains />
    </main>
  );
}
