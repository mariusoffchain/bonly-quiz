import { useEffect, useMemo, useState } from 'react';
import type { BoardView } from '../../shared/views';
import { BlocksStrip, Countdown, Donut, FeedBadge, PoolList } from '../components/Shared';
import { difficultyLabel, fmtClock, pctText, ths } from '../lib/format';
import { useQuizSocket, useTicker } from '../lib/ws';

const LETTERS = 'ABCDEFGH';

export function Board() {
  const sock = useQuizSocket<BoardView>(() => ({ type: 'hello', role: 'board' }));
  const { view } = sock;
  const now = useTicker(1000);
  const [flash, setFlash] = useState<string | null>(null);
  const names = useMemo(() => new Map((view?.competitors ?? []).map((c) => [c.id, c.name])), [view?.competitors]);

  // Flash the winner of the latest block bonus.
  useEffect(() => {
    const w = view?.lastBlockBonus?.winnerId;
    if (!w) return;
    setFlash(w);
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [view?.lastBlockBonus?.blockId]);

  if (!view) {
    return (
      <div className="board">
        <div className="head">
          <div className="title">B-only Quiz</div>
          <div className="muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion au serveur…'}</div>
        </div>
      </div>
    );
  }

  const q = view.question;
  const round = view.rounds[view.currentRoundIndex];
  const showQuestion = q && (view.phase === 'question-open' || view.phase === 'question-closed');
  const open = showQuestion && !q.closed && q.closesAt > sock.serverNow();
  const lastBonus = view.lastBlockBonus;

  return (
    <div className="board">
      <div className="head">
        <div className="title">
          B-only Quiz
          <span>{round ? `${round.title} · ${round.status === 'ended' ? 'terminée' : q ? `question ${q.questionIndex + 1}/${round.questionCount}` : 'prête'}` : 'Lobby'}</span>
        </div>
        <div className="row">
          <FeedBadge feed={view.blockFeed} />
          {sock.conn !== 'open' ? <span className="badge down">Écran déconnecté du serveur</span> : null}
          <span className="mono muted">{fmtClock(now)}</span>
        </div>
      </div>

      <div className="main">
        {showQuestion ? (
          <div className="card question-card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className={'badge ' + q.question.difficulty}>
                    {difficultyLabel[q.question.difficulty]} · {view.config.baseGainThs[q.question.difficulty]} TH/s
                  </span>
                  {q.question.demo ? <span className="badge sim">démo</span> : null}
                  <span className="muted small">
                    {q.answerCount} réponse{q.answerCount > 1 ? 's' : ''} reçue{q.answerCount > 1 ? 's' : ''} sur {view.competitors.length}
                  </span>
                </div>
                <div className="q">{q.question.text}</div>
              </div>
              {open ? <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={sock.serverNow} /> : null}
            </div>
            {q.closed && !q.cancelled && q.results ? (
              <Results view={view} names={names} />
            ) : (
              <div className="options">
                {q.question.options.map((opt, i) => {
                  const revealed = q.closed && q.question.correctIndex !== undefined;
                  const cls = ['option'];
                  if (revealed) cls.push(i === q.question.correctIndex ? 'correct' : 'dim');
                  return (
                    <div key={i} className={cls.join(' ')}>
                      <span className="letter">{LETTERS[i]}</span>
                      <span>{opt}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : view.phase === 'lobby' || view.phase === 'round-ready' ? (
          <div className="card lobby">
            <div>
              <div className="card-title">Rejoignez la partie</div>
              <div className="big-url">{view.joinUrl ?? '—'}</div>
              <p className="muted">Scannez le QR code. 1 téléphone par pool classique (3 membres minimum), ou jouez seul en Bitaxe.</p>
              <div className="row" style={{ marginTop: 20, gap: 20 }}>
                <div className="stat">
                  <div className="label">Concurrents</div>
                  <div className="value">{view.competitors.length}</div>
                </div>
                <div className="stat">
                  <div className="label">Pools</div>
                  <div className="value">{view.competitors.filter((c) => c.kind === 'pool').length}</div>
                </div>
                <div className="stat">
                  <div className="label">Bitaxe</div>
                  <div className="value">{view.competitors.filter((c) => c.kind === 'bitaxe').length}</div>
                </div>
                <div className="stat">
                  <div className="label">Manches</div>
                  <div className="value">{view.rounds.length}</div>
                </div>
              </div>
              {view.phase === 'round-ready' ? <div className="alert" style={{ marginTop: 16 }}>{round?.title} commence. Hashrate initial {view.config.initialHashrateThs} TH/s pour tous.</div> : null}
            </div>
            <div className="qr">
              <img src={`/api/qr.svg?text=${encodeURIComponent(view.joinUrl ?? '')}&v=${view.code}`} alt="QR code pour rejoindre" />
            </div>
          </div>
        ) : (
          <RoundEnd view={view} names={names} />
        )}

        <div className="ticker">
          {lastBonus && lastBonus.roundIndex === view.currentRoundIndex ? (
            <>
              <span className="tag">{lastBonus.origin === 'simulated' ? 'BLOC SIMULÉ' : 'NOUVEAU BLOC'} {lastBonus.height.toLocaleString('fr-FR')}</span>
              {lastBonus.winnerId ? (
                <span>
                  Tirage pondéré par le hashrate : <b>{names.get(lastBonus.winnerId) ?? '?'}</b> gagne +{view.config.blockBonusPercent.replace('.', ',')} % ({ths(lastBonus.bonus)}), {ths(lastBonus.before)} → {ths(lastBonus.after)}
                </span>
              ) : (
                <span>aucun concurrent éligible (hashrate total nul)</span>
              )}
            </>
          ) : (
            <span className="muted">Chaque nouveau bloc Bitcoin réel déclenche un tirage, chances = part du hashrate fictif. Le gagnant reçoit +{view.config.blockBonusPercent.replace('.', ',')} %.</span>
          )}
        </div>
      </div>

      <div className="side">
        <div className="card">
          <div className="card-title">Derniers blocs Bitcoin ({view.blockFeed.mode === 'simulated' ? 'simulation' : 'réseau réel'})</div>
          <BlocksStrip blocks={view.recentBlocks} bonuses={view.blockBonuses} names={names} limit={4} />
          <div className="small muted">
            Pointe {view.blockFeed.tipHeight?.toLocaleString('fr-FR') ?? '—'}
            {round?.tipHeightAtStart !== null && round?.tipHeightAtStart !== undefined ? ` · éligibles au-dessus de ${round.tipHeightAtStart.toLocaleString('fr-FR')}` : ''} · {view.blockBonuses.length} bonus cette manche
          </div>
        </div>
        <div className="card pools">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="card-title">Pools du quiz, hashrate fictif</div>
            <div className="mono small">{ths(view.totalHashrate)}</div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Donut competitors={view.competitors} size={120} />
            <div className="grow small muted">
              {view.competitors.slice(0, 3).map((c) => (
                <div key={c.id}>
                  {c.rank}. {c.name} {pctText(c.share)}
                </div>
              ))}
            </div>
          </div>
          <PoolList competitors={view.competitors} highlightId={flash} />
        </div>
      </div>
    </div>
  );
}

function Results({ view, names }: { view: BoardView; names: Map<string, string> }) {
  const q = view.question!;
  const r = q.results!;
  return (
    <div>
      <div className="options" style={{ marginBottom: 14 }}>
        {q.question.options.map((opt, i) => (
          <div key={i} className={'option ' + (i === q.question.correctIndex ? 'correct' : 'dim')}>
            <span className="letter">{LETTERS[i]}</span>
            <span>{opt}</span>
          </div>
        ))}
      </div>
      <table className="ranking-table">
        <thead>
          <tr>
            <th>Rang rapidité</th>
            <th>Concurrent</th>
            <th>Bonus</th>
            <th style={{ textAlign: 'right' }}>Gain</th>
          </tr>
        </thead>
        <tbody>
          {r.gains.map((g) => (
            <tr key={g.competitorId}>
              <td className="mono">
                {g.rank}
                {g.tied ? '=' : ''}
              </td>
              <td>{names.get(g.competitorId) ?? '?'}</td>
              <td className="mono">+{g.bonusPercent.replace('.', ',')} %</td>
              <td className="num">{ths(g.gain)}</td>
            </tr>
          ))}
          {r.gains.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                Aucune bonne réponse.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="small muted" style={{ marginTop: 8 }}>
        {r.wrong.length} mauvaise{r.wrong.length > 1 ? 's' : ''} réponse{r.wrong.length > 1 ? 's' : ''}, {r.silent.length} sans réponse. 0 TH/s, aucune pénalité.
        {q.question.explanation ? <div style={{ marginTop: 6 }}>{q.question.explanation}</div> : null}
        {q.question.source ? (
          <div style={{ marginTop: 6 }}>
            Source : {q.question.source.provider}, {q.question.source.license}
            {q.question.source.chapter ? `, ${q.question.source.chapter}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RoundEnd({ view, names }: { view: BoardView; names: Map<string, string> }) {
  const round = view.rounds[view.currentRoundIndex];
  const series = view.prizeSeries.filter((s) => s.roundIndexes.includes(view.currentRoundIndex));
  return (
    <div className="card question-card">
      <div>
        <div className="card-title">{view.phase === 'finished' ? 'Partie terminée' : `${round?.title ?? 'Manche'} terminée`}</div>
        <div className="q">Classement final de la manche</div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <table className="ranking-table" style={{ flex: 1 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Concurrent</th>
              <th style={{ textAlign: 'right' }}>Hashrate final</th>
              <th style={{ textAlign: 'right' }}>Part</th>
            </tr>
          </thead>
          <tbody>
            {view.competitors.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.rank}</td>
                <td>
                  {c.name} <span className="muted small">{c.kind === 'pool' ? c.members.join(', ') : c.members[0] ?? ''}</span>
                </td>
                <td className="num">{ths(c.hashrate)}</td>
                <td className="num">{pctText(c.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ flex: 1 }}>
          <div className="card-title">Lots</div>
          {series.length === 0 ? <div className="muted">Tirages à venir. Chances = part du hashrate final, 1 lot maximum par concurrent.</div> : null}
          {series.map((s) => (
            <div key={s.id} style={{ marginBottom: 12 }}>
              {s.awards.map((a, i) => {
                const prize = s.prizes.find((p) => p.id === a.prizeId);
                const w = a.winnerId ? view.competitors.find((c) => c.id === a.winnerId) : undefined;
                return (
                  <div key={a.prizeId} className="stat" style={{ marginBottom: 6 }}>
                    <div className="label">
                      Lot {i + 1} · {prize?.label}
                    </div>
                    <div className="value">{a.winnerId ? names.get(a.winnerId) ?? '?' : 'non attribué'}</div>
                    {w ? <div className="small muted">{w.kind === 'pool' ? w.members.join(', ') : w.members[0] ?? ''}</div> : null}
                  </div>
                );
              })}
              <div className="small muted">
                Série {s.scope === 'round' ? 'sur la manche' : 'sur la somme des manches'} {s.roundIndexes.map((i) => i + 1).join(', ')} · {fmtClock(s.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
