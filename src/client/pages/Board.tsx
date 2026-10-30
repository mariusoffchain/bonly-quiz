import type { BoardView } from '../../shared/views';
import { Avatar, ConnBadge, Leaderboard, MiningScene, NetworkBar, Rules, TimerRing } from '../components/ui';
import { LETTERS, difficultyLabel, pct, playerColor, seconds, ths } from '../lib/format';
import { useQuizSocket } from '../lib/ws';

export function Board() {
  const sock = useQuizSocket<BoardView>(() => ({ type: 'hello', role: 'board' }));
  const { view } = sock;
  if (!view) {
    return (
      <div className="board center">
        <div className="brand-lg">B-only Quiz</div>
        <div className="muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion au serveur…'}</div>
      </div>
    );
  }
  return (
    <div className="board">
      <ConnBadge conn={sock.conn} />
      <BoardHead view={view} />
      {view.phase === 'lobby' ? <LobbyScreen view={view} /> : null}
      {view.phase === 'question' ? <QuestionScreen view={view} serverNow={sock.serverNow} /> : null}
      {view.phase === 'reveal' ? <RevealScreen view={view} /> : null}
      {view.phase === 'final' ? <FinalScreen view={view} serverNow={sock.serverNow} /> : null}
    </div>
  );
}

function BoardHead({ view }: { view: BoardView }) {
  const current = view.question?.index ?? -1;
  const done = view.phase === 'final' ? view.questionTotal : view.phase === 'question' ? current : current + 1;
  return (
    <header className="board-head">
      <div className="brand">
        <span className="logo">₿</span> B-only Quiz
      </div>
      <div className="progress-dots" aria-label={`Question ${current + 1} sur ${view.questionTotal}`}>
        {Array.from({ length: view.questionTotal }, (_, i) => (
          <span key={i} className={i < done ? 'done' : i === current && view.phase === 'question' ? 'now' : ''} />
        ))}
      </div>
      <div className="network">
        <div className="label">Réseau</div>
        <div className="value">{ths(view.totalHashrate)}</div>
        <div className="muted small">
          {view.players.length} mineur{view.players.length > 1 ? 's' : ''}
        </div>
      </div>
    </header>
  );
}

function LobbyScreen({ view }: { view: BoardView }) {
  return (
    <main className="screen lobby-screen">
      <section className="join-card">
        <div className="eyebrow">Rejoignez la partie</div>
        <img className="qr" src={`/api/qr.svg?text=${encodeURIComponent(view.joinUrl)}`} alt="QR code pour rejoindre" />
        <div className="join-url mono">{view.joinUrl.replace(/^https?:\/\//, '')}</div>
      </section>
      <section className="lobby-side">
        <h1 className="headline">
          {view.questionTotal} questions.
          <br />
          Gagnez du hashrate.
          <br />
          <span className="accent">Minez le bloc.</span>
        </h1>
        <Rules config={view.config} />
        <div className="player-cloud">
          {view.players.map((p) => (
            <span key={p.id} className="chip" style={{ borderColor: playerColor(p.color) }}>
              <Avatar name={p.name} color={p.color} size={26} />
              {p.name}
            </span>
          ))}
          {view.players.length === 0 ? <span className="muted">En attente des premiers mineurs…</span> : null}
        </div>
      </section>
    </main>
  );
}

function QuestionScreen({ view, serverNow }: { view: BoardView; serverNow: () => number }) {
  const q = view.question!;
  const n = view.players.filter((p) => p.connected).length;
  return (
    <main className="screen question-screen">
      <div className="q-top">
        <div>
          <div className="eyebrow">
            Question {q.index + 1} / {q.total}
          </div>
          <div className={'diff ' + q.difficulty}>
            {difficultyLabel[q.difficulty]} · {q.baseGain} TH/s
          </div>
        </div>
        <TimerRing closesAt={q.closesAt} durationMs={q.durationMs} serverNow={serverNow} size={150} />
      </div>
      <h1 className="q-text-big">{q.text}</h1>
      <div className="options-grid">
        {q.options.map((opt, i) => (
          <div key={i} className={'option opt-' + i}>
            <span className="letter">{LETTERS[i]}</span>
            <span>{opt}</span>
          </div>
        ))}
      </div>
      <div className="answered">
        <div className="answered-bar">
          <div style={{ width: `${n ? Math.min(100, (q.answerCount / n) * 100) : 0}%` }} />
        </div>
        <span>
          {q.answerCount} / {n} réponse{q.answerCount > 1 ? 's' : ''}
        </span>
      </div>
    </main>
  );
}

function RevealScreen({ view }: { view: BoardView }) {
  const q = view.question!;
  const total = (q.optionCounts ?? []).reduce((s, x) => s + x, 0);
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return (
    <main className="screen reveal-screen">
      <section className="reveal-main">
        <div className="eyebrow">
          Question {q.index + 1} / {q.total}
          {q.cancelled ? ' · annulée, aucun point' : ''}
        </div>
        <h2 className="q-text-mid">{q.text}</h2>
        <div className="options-list">
          {q.options.map((opt, i) => {
            const count = q.optionCounts?.[i] ?? 0;
            const ok = i === q.correctIndex;
            return (
              <div key={i} className={'option-result' + (ok ? ' correct' : ' wrong')}>
                <span className={'letter opt-bg-' + i}>{LETTERS[i]}</span>
                <span className="text">{opt}</span>
                <span className="count">
                  <span className="fill" style={{ width: `${total ? (count / total) * 100 : 0}%` }} />
                  <b>{count}</b>
                </span>
                {ok ? <span className="check">✓</span> : null}
              </div>
            );
          })}
        </div>
        {q.explanation ? <p className="explain">{q.explanation}</p> : null}
        {q.source ? (
          <div className="source">
            Source : {q.source.provider}, {q.source.license}
          </div>
        ) : null}
      </section>
      <aside className="reveal-side">
        <div className="panel">
          <div className="panel-title">Meilleurs gains</div>
          {q.top && q.top.length > 0 ? (
            <ol className="top-gains">
              {q.top.map((r, i) => {
                const p = byId.get(r.id);
                return (
                  <li key={r.id}>
                    <span className="rank">{i + 1}</span>
                    {p ? <Avatar name={p.name} color={p.color} size={30} /> : null}
                    <span className="name">{p?.name ?? '?'}</span>
                    <span className="detail">
                      ⚡{seconds(r.ms ?? 0)}
                      {r.streak >= 2 ? ` · 🔥${r.streak}` : ''}
                    </span>
                    <span className="gain">+{ths(r.gain)}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="muted">Personne n’a trouvé. Aucun hashrate distribué.</div>
          )}
        </div>
        <div className="panel grow">
          <div className="panel-title">Classement · part du réseau</div>
          <NetworkBar players={view.players} />
          <Leaderboard players={view.players} limit={8} showGain />
        </div>
      </aside>
    </main>
  );
}

function FinalScreen({ view, serverNow }: { view: BoardView; serverNow: () => number }) {
  const last = view.blocks[view.blocks.length - 1];
  const winners = view.blocks.filter((b) => b.found && b.winnerId).map((b) => b.winnerId!);
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return (
    <main className="screen final-screen">
      <section className="final-main">
        {last ? (
          <MiningScene block={last} players={view.players} serverNow={serverNow} />
        ) : (
          <div className="final-intro">
            <div className="eyebrow">Fin du quiz</div>
            <h1 className="headline">
              Place au <span className="accent">minage</span>.
            </h1>
            <p className="lead">
              Comme sur le réseau Bitcoin, chaque mineur a une chance de trouver le bloc égale à sa part du hashrate. Le plus gros mineur est favori, mais rien n’est garanti.
            </p>
            <NetworkBar players={view.players} />
            <div className="odds">
              {view.players.slice(0, 3).map((p) => (
                <div key={p.id} className="odd">
                  <Avatar name={p.name} color={p.color} size={44} />
                  <div className="name">{p.name}</div>
                  <div className="value accent">{pct(p.share)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      <aside className="final-side">
        <div className="panel grow">
          <div className="panel-title">Classement final · chances de bloc</div>
          <Leaderboard players={view.players} limit={12} winners={winners} />
        </div>
        {view.blocks.some((b) => b.found) ? (
          <div className="panel">
            <div className="panel-title">Blocs trouvés</div>
            <ul className="blocks-list">
              {view.blocks
                .filter((b) => b.found)
                .map((b) => {
                  const w = b.winnerId ? byId.get(b.winnerId) : undefined;
                  return (
                    <li key={b.n}>
                      <span className="cube small" />
                      <span className="mono">#{b.n}</span>
                      <span className="grow">{b.label ?? ''}</span>
                      {w ? <Avatar name={w.name} color={w.color} size={24} /> : null}
                      <b>{w?.name ?? '—'}</b>
                    </li>
                  );
                })}
            </ul>
          </div>
        ) : null}
      </aside>
    </main>
  );
}
