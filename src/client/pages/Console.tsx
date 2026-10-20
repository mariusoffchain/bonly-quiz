import { useEffect, useMemo, useState } from 'react';
import type { SessionConfig } from '../../shared/config';
import type { ConsoleView } from '../../shared/views';
import { BlocksStrip, Countdown, FeedBadge, PoolList } from '../components/Shared';
import { difficultyLabel, fmtClock, ths } from '../lib/format';
import { useQuizSocket, useTicker } from '../lib/ws';

const TOKEN_KEY = 'bq_console_token';

export function Console() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  if (!token) return <Login onToken={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); }} />;
  return <ConsoleApp token={token} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setToken(null); }} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [t, setT] = useState('');
  const [err, setErr] = useState('');
  const check = async () => {
    const r = await fetch('/api/console/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: t.trim() }) });
    const j = (await r.json()) as { ok: boolean };
    if (j.ok) onToken(t.trim());
    else setErr('Jeton invalide. Il est affiché dans le terminal du serveur au démarrage (ou dans data/console-token.txt).');
  };
  return (
    <div className="login">
      <h1>Console d’animation</h1>
      <input className="input" placeholder="Jeton console" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void check()} autoFocus />
      <button className="btn" onClick={() => void check()}>
        Entrer
      </button>
      {err ? <div className="alert error">{err}</div> : null}
    </div>
  );
}

function ConsoleApp({ token, onLogout }: { token: string; onLogout: () => void }) {
  const sock = useQuizSocket<ConsoleView>(() => ({ type: 'hello', role: 'console', consoleToken: token }));
  const { view, send } = sock;
  const now = useTicker(500);
  const names = useMemo(() => new Map((view?.competitors ?? []).map((c) => [c.id, c.name])), [view?.competitors]);

  useEffect(() => {
    if (sock.lastError?.code === 'unauthorized') onLogout();
  }, [sock.lastError, onLogout]);

  if (!view) {
    return (
      <div className="login">
        <h1>Console d’animation</h1>
        <div className="muted">{sock.conn === 'open' ? 'Chargement…' : 'Connexion au serveur…'}</div>
        {sock.lastError ? <div className="alert error">{sock.lastError.message}</div> : null}
        {sock.lastError?.code === 'no-session' ? (
          <button className="btn" onClick={() => send({ type: 'new-session' })}>
            Créer une session
          </button>
        ) : null}
      </div>
    );
  }

  const round = view.roundStates[view.currentRoundIndex];
  const def = view.roundDefs[view.currentRoundIndex];
  const q = view.question;
  const open = view.phase === 'question-open';
  const canOpen = round?.status === 'running' && !open && (round.currentQuestion + 1) < (def?.questionIds.length ?? 0);
  const canEnd = round?.status === 'running' && !open;
  const nextRoundIndex = view.roundStates.findIndex((r) => r.status === 'pending');
  const noRunning = !view.roundStates.some((r) => r.status === 'running');

  return (
    <div className="console">
      {/* ------------------------------------------------ left: session, competitors, blocks */}
      <div className="col">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h1>Console</h1>
            <span className="phase">{view.phase}</span>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Session <span className="kbd">{view.code}</span> · pack « {view.contentName} » · serveur {sock.conn === 'open' ? 'connecté' : 'DÉCONNECTÉ'}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="qr-mini">
              <img src={`/api/qr.svg?text=${encodeURIComponent(view.joinUrl ?? '')}&v=${view.code}`} alt="QR" />
            </div>
            <div className="small grow">
              <div className="mono" style={{ wordBreak: 'break-all' }}>{view.joinUrl}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Écran : <a href="/board" target="_blank" rel="noreferrer">/board</a>
              </div>
              <div className="muted">Autres adresses LAN : {view.serverInfo.lanUrls.join(', ') || '—'}</div>
            </div>
          </div>
          <details style={{ marginTop: 10 }}>
            <summary>Nouvelle session (remet tout à zéro)</summary>
            <div className="row" style={{ marginTop: 8 }}>
              <NewSession view={view} onCreate={(packName) => confirm('Créer une nouvelle session ? Les téléphones devront se réinscrire.') && send({ type: 'new-session', packName })} />
            </div>
          </details>
          {sock.lastError ? (
            <div className="alert error" onClick={sock.clearError}>
              {sock.lastError.code}: {sock.lastError.message}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="card-title">Blocs Bitcoin</div>
            <FeedBadge feed={view.blockFeed} />
          </div>
          <div className="small muted">
            Pointe {view.blockFeed.tipHeight?.toLocaleString('fr-FR') ?? '—'} · dernier message {view.blockFeed.lastMessageAt ? fmtClock(view.blockFeed.lastMessageAt) : '—'}
            {view.blockFeed.lastError ? <div style={{ color: 'var(--orange)' }}>{view.blockFeed.lastError}</div> : null}
            {view.blockFeed.endpoint ? <div>{view.blockFeed.endpoint}</div> : null}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className={'btn sm ' + (view.blockFeed.mode === 'real' ? '' : 'secondary')} onClick={() => send({ type: 'set-block-mode', mode: 'real' })}>
              Réel
            </button>
            <button className={'btn sm ' + (view.blockFeed.mode === 'simulated' ? '' : 'secondary')} onClick={() => confirm('Passer en SIMULATION ? Les blocs réels seront ignorés.') && send({ type: 'set-block-mode', mode: 'simulated' })}>
              Simulation
            </button>
            <button className={'btn sm ' + (view.blockFeed.mode === 'off' ? '' : 'secondary')} onClick={() => send({ type: 'set-block-mode', mode: 'off' })}>
              Off
            </button>
            {view.blockFeed.mode === 'simulated' ? (
              <button className="btn sm danger" onClick={() => send({ type: 'simulate-block' })}>
                Bloc simulé
              </button>
            ) : null}
          </div>
          <BlocksStrip blocks={view.recentBlocks} bonuses={view.blockBonuses} names={names} limit={3} />
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="card-title">
              Concurrents ({view.competitors.length}) · {ths(view.totalHashrate)}
            </div>
          </div>
          <PoolList competitors={view.competitors} />
          <details style={{ marginTop: 8 }}>
            <summary>Détails, jetons de reconnexion, retrait</summary>
            {view.competitors.map((c) => (
              <div key={c.id} className="comp">
                <div>
                  <div>
                    {c.name} <span className="m">{c.connected ? 'en ligne' : `hors ligne depuis ${fmtClock(c.lastSeenAt)}`}</span>
                  </div>
                  <div className="m">{c.members.join(', ') || '—'}</div>
                  <div className="m">
                    Lien de secours : <span className="mono">{`${location.origin}/play?s=${view.code}&t=${c.token}`}</span>
                  </div>
                </div>
                <button className="btn sm danger" onClick={() => confirm(`Retirer ${c.name} ?`) && send({ type: 'remove-competitor', id: c.id })}>
                  Retirer
                </button>
              </div>
            ))}
          </details>
        </div>
      </div>

      {/* ------------------------------------------------ middle: run the game */}
      <div className="col">
        <div className="card">
          <div className="card-title">Déroulé</div>
          <div className="row" style={{ marginBottom: 8 }}>
            {view.roundStates.map((r) => (
              <span key={r.index} className="badge" style={{ background: r.status === 'running' ? 'var(--primary)' : r.status === 'ended' ? 'var(--success)' : 'var(--secondary)' }}>
                M{r.index + 1} {r.status === 'pending' ? 'à venir' : r.status === 'running' ? 'en cours' : 'finie'}
              </span>
            ))}
          </div>
          <div className="commands">
            <div className="row">
              <button className="btn" disabled={!noRunning || nextRoundIndex < 0} onClick={() => send({ type: 'start-round', index: nextRoundIndex })}>
                Lancer {nextRoundIndex >= 0 ? view.roundDefs[nextRoundIndex]?.title : 'la manche'}
              </button>
              {noRunning && nextRoundIndex >= 0 ? <span className="small muted">Hashrate initial {view.config.initialHashrateThs} TH/s, pointe actuelle {view.blockFeed.tipHeight ?? '—'}</span> : null}
            </div>
            <div className="row">
              <button className="btn" disabled={!canOpen} onClick={() => send({ type: 'open-question' })}>
                Question suivante ({round ? round.currentQuestion + 2 : '-'}/{def?.questionIds.length ?? '-'})
              </button>
              <button className="btn secondary" disabled={!open} onClick={() => send({ type: 'close-question' })}>
                Clore maintenant
              </button>
              <button className="btn ghost" disabled={!open} onClick={() => confirm('Annuler la question sans la compter ?') && send({ type: 'cancel-question' })}>
                Annuler la question
              </button>
              <button className="btn danger" disabled={!canEnd} onClick={() => confirm(`Terminer ${def?.title} ? Le hashrate final sera figé.`) && send({ type: 'end-round' })}>
                Terminer la manche
              </button>
            </div>
          </div>
          {q ? (
            <div className="stat" style={{ marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="label">
                    Question {q.questionIndex + 1}/{q.questionTotal} · {difficultyLabel[q.question.difficulty]} · {q.closed ? (q.cancelled ? 'annulée' : 'close') : 'OUVERTE'} · {q.answerCount} réponse{q.answerCount > 1 ? 's' : ''}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>{q.question.text}</div>
                  <div className="small" style={{ marginTop: 4 }}>
                    {q.question.options.map((o, i) => (
                      <div key={i} style={{ color: i === q.question.correctIndex ? 'var(--green)' : undefined }}>
                        {'ABCD'[i]}. {o} {i === q.question.correctIndex ? '✓' : ''}
                      </div>
                    ))}
                  </div>
                </div>
                {!q.closed ? <Countdown closesAt={q.closesAt} durationMs={q.durationMs} serverNow={sock.serverNow} small /> : null}
              </div>
              {q.results ? (
                <div className="small" style={{ marginTop: 8 }}>
                  {q.results.gains.map((g) => (
                    <div key={g.competitorId}>
                      #{g.rank}{g.tied ? '=' : ''} {names.get(g.competitorId)} +{g.bonusPercent} % → {ths(g.gain)}
                    </div>
                  ))}
                  <div className="muted">
                    Faux : {q.results.wrong.map((id) => names.get(id)).join(', ') || '—'} · Sans réponse : {q.results.silent.map((id) => names.get(id)).join(', ') || '—'}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="card-title">Questions {def ? `· ${def.title}` : '(lancez une manche)'}</div>
            <ContentPicker view={view} onPick={(name) => send({ type: 'set-content', packName: name })} />
          </div>
          <RoundQuestions view={view} roundIndex={view.currentRoundIndex >= 0 ? view.currentRoundIndex : Math.max(0, nextRoundIndex)} onUpdate={(id, patch) => send({ type: 'update-question', id, ...patch })} />
        </div>

        <div className="card">
          <div className="card-title">Lots et tirages finaux</div>
          <Prizes view={view} onSave={(prizes) => send({ type: 'set-prizes', prizes })} onDraw={(scope, roundIndexes) => send({ type: 'draw-prizes', scope, roundIndexes })} names={names} />
        </div>
      </div>

      {/* ------------------------------------------------ right: config + log */}
      <div className="col">
        <div className="card">
          <div className="card-title">Réglages (hypothèses provisoires modifiables)</div>
          <ConfigForm config={view.config} onSave={(patch) => send({ type: 'set-config', patch })} />
        </div>
        <div className="card">
          <div className="card-title">Journal des événements ({view.recentEvents.length} derniers)</div>
          <div className="log">
            {view.recentEvents.map((e) => (
              <div key={e.seq}>
                <span className="muted">{fmtClock(e.at)}</span> <b>{e.type}</b> {summarize(e.type, e.payload, names)}
              </div>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Journal complet : <span className="mono">{view.serverInfo.dataDir}/sessions/{view.code}.events.jsonl</span> · heure serveur {fmtClock(sock.serverNow())} (écart {Math.round(sock.serverNow() - now)} ms)
          </div>
        </div>
        <button className="btn ghost sm" onClick={onLogout}>
          Se déconnecter de la console
        </button>
      </div>
    </div>
  );
}

function summarize(type: string, payload: unknown, names: Map<string, string>): string {
  const p = payload as Record<string, unknown>;
  const n = (id: unknown) => names.get(String(id)) ?? String(id);
  switch (type) {
    case 'answer.recorded':
      return `${n(p.competitorId)} → option ${'ABCDEFGH'[Number(p.optionIndex)]}${Number(p.changes) > 0 ? ` (modif ${p.changes})` : ''}`;
    case 'question.closed':
      return `${(p.gains as { competitorId: string; rank: number; gain: string }[]).map((g) => `#${g.rank} ${n(g.competitorId)} ${ths(g.gain)}`).join(', ') || 'aucune bonne réponse'}`;
    case 'block.bonus':
      return `bloc ${p.height} (${p.origin}) → ${p.winnerId ? `${n(p.winnerId)} +${ths(p.bonus as string)} (tirage ${p.audit ? (p.audit as { roll: string }).roll : ''}/${(p.audit as { total: string })?.total})` : `personne (${p.reason})`}`;
    case 'block.ignored':
      return `bloc ${p.height} ${p.origin} ignoré (${p.reason})`;
    case 'competitor.joined':
      return `${p.name} (${p.kind})`;
    case 'round.started':
      return `${p.title}, pointe ${p.tipHeightAtStart ?? '—'}, ${p.competitors} concurrents`;
    case 'prizes.drawn':
      return (p.awards as { prizeId: string; winnerId: string | null }[]).map((a) => `${a.prizeId}→${a.winnerId ? n(a.winnerId) : '∅'}`).join(' ');
    default:
      return JSON.stringify(payload).slice(0, 140);
  }
}

function NewSession({ view, onCreate }: { view: ConsoleView; onCreate: (packName: string) => void }) {
  const [pack, setPack] = useState(view.contentPacks[0]?.name ?? '');
  return (
    <>
      <select className="input" value={pack} onChange={(e) => setPack(e.target.value)} style={{ padding: 8, fontSize: 13 }}>
        {view.contentPacks.map((p) => (
          <option key={p.file} value={p.name}>
            {p.name} ({p.questions} q, {p.rounds} manches)
          </option>
        ))}
      </select>
      <button className="btn sm danger" onClick={() => onCreate(pack)}>
        Créer
      </button>
    </>
  );
}

function ContentPicker({ view, onPick }: { view: ConsoleView; onPick: (name: string) => void }) {
  return (
    <select className="input" style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }} value={view.contentName} onChange={(e) => confirm('Remplacer les questions de la session ?') && onPick(e.target.value)}>
      {!view.contentPacks.some((p) => p.name === view.contentName) ? <option value={view.contentName}>{view.contentName}</option> : null}
      {view.contentPacks.map((p) => (
        <option key={p.file} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function RoundQuestions({ view, roundIndex, onUpdate }: { view: ConsoleView; roundIndex: number; onUpdate: (id: string, patch: { durationMs?: number; difficulty?: 'easy' | 'intermediate' | 'hard' }) => void }) {
  const def = view.roundDefs[roundIndex];
  const rs = view.roundStates[roundIndex];
  if (!def) return <div className="muted small">Aucune manche.</div>;
  return (
    <div className="qlist">
      {def.questionIds.map((qid, i) => {
        const q = view.questions[qid];
        const done = rs && rs.questionRuns[i]?.closedAt !== undefined;
        const current = rs && rs.currentQuestion === i;
        return (
          <div key={qid} className={'qitem' + (done ? ' done' : '') + (current ? ' current' : '')} title={q.options.map((o, j) => `${'ABCD'[j]}. ${o}${j === q.correctIndex ? ' ✓' : ''}`).join('\n')}>
            <span className="mono muted">{i + 1}</span>
            <span className="t">
              {q.text} {q.demo ? <span className="badge sim">démo</span> : null}
            </span>
            <select value={q.difficulty} onChange={(e) => onUpdate(qid, { difficulty: e.target.value as 'easy' })}>
              <option value="easy">facile</option>
              <option value="intermediate">intermédiaire</option>
              <option value="hard">difficile</option>
            </select>
            <input type="number" min={1} step={1} value={Math.round((q.durationMs ?? view.config.defaultQuestionDurationMs) / 1000)} onChange={(e) => onUpdate(qid, { durationMs: Math.max(1, Number(e.target.value)) * 1000 })} title="Durée en secondes" />
          </div>
        );
      })}
    </div>
  );
}

function ConfigForm({ config, onSave }: { config: SessionConfig; onSave: (p: Partial<SessionConfig>) => void }) {
  const [c, setC] = useState(config);
  useEffect(() => setC(config), [config]);
  const set = <K extends keyof SessionConfig>(k: K, v: SessionConfig[K]) => setC({ ...c, [k]: v });
  return (
    <>
      <div className="cfg">
        <label>Gain facile (TH/s)</label>
        <input value={c.baseGainThs.easy} onChange={(e) => set('baseGainThs', { ...c.baseGainThs, easy: e.target.value })} />
        <label>Gain intermédiaire (TH/s)</label>
        <input value={c.baseGainThs.intermediate} onChange={(e) => set('baseGainThs', { ...c.baseGainThs, intermediate: e.target.value })} />
        <label>Gain difficile (TH/s)</label>
        <input value={c.baseGainThs.hard} onChange={(e) => set('baseGainThs', { ...c.baseGainThs, hard: e.target.value })} />
        <label>Durée par défaut (s)</label>
        <input type="number" value={c.defaultQuestionDurationMs / 1000} onChange={(e) => set('defaultQuestionDurationMs', Number(e.target.value) * 1000)} />
        <label>Hashrate initial par manche (TH/s)</label>
        <input value={c.initialHashrateThs} onChange={(e) => set('initialHashrateThs', e.target.value)} />
        <label>Référence rapidité si réponse modifiée</label>
        <select value={c.speedReference} onChange={(e) => set('speedReference', e.target.value as 'last')}>
          <option value="last">dernière modification</option>
          <option value="first">première réponse</option>
        </select>
        <label>Bonus rapidité rangs 1-3 (%)</label>
        <input value={c.speedBonusHeadPercents.join(',')} onChange={(e) => set('speedBonusHeadPercents', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        <label>Bonus bloc (%)</label>
        <input value={c.blockBonusPercent} onChange={(e) => set('blockBonusPercent', e.target.value)} />
        <label>Assiette du bonus bloc</label>
        <select value={c.blockBonusBase} onChange={(e) => set('blockBonusBase', e.target.value as 'own')}>
          <option value="own">hashrate du gagnant</option>
          <option value="total">hashrate total du quiz</option>
        </select>
        <label>Poids des lots</label>
        <select value={c.prizeScope} onChange={(e) => set('prizeScope', e.target.value as 'round')}>
          <option value="round">manche terminée (défaut)</option>
          <option value="sumOfRounds">somme des manches</option>
        </select>
        <label>Exclure les gagnants des séries précédentes</label>
        <select value={String(c.excludePrizeWinnersAcrossSeries)} onChange={(e) => set('excludePrizeWinnersAcrossSeries', e.target.value === 'true')}>
          <option value="false">non</option>
          <option value="true">oui</option>
        </select>
        <label>Membres minimum par pool</label>
        <input type="number" value={c.minPoolMembers} onChange={(e) => set('minPoolMembers', Number(e.target.value))} />
      </div>
      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => onSave(c)}>
        Enregistrer les réglages
      </button>
    </>
  );
}

function Prizes({ view, onSave, onDraw, names }: { view: ConsoleView; onSave: (p: { id?: string; label: string; rank: number }[]) => void; onDraw: (scope: 'round' | 'sumOfRounds', roundIndexes?: number[]) => void; names: Map<string, string> }) {
  const [text, setText] = useState(view.prizesDraft.map((p) => p.label).join('\n'));
  useEffect(() => setText(view.prizesDraft.map((p) => p.label).join('\n')), [view.prizesDraft]);
  const ended = view.roundStates.filter((r) => r.status === 'ended');
  const [roundSel, setRoundSel] = useState<string>('last');
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return (
    <>
      <label className="small muted">1 lot par ligne, du plus gros au plus petit</label>
      <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Gros lot\nLot 2\nLot 3'} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm secondary" onClick={() => onSave(lines.map((label, i) => ({ id: view.prizesDraft[i]?.id, label, rank: i + 1 })))}>
          Enregistrer les lots ({lines.length})
        </button>
        <select className="input" style={{ width: 'auto', padding: 6, fontSize: 12 }} value={roundSel} onChange={(e) => setRoundSel(e.target.value)}>
          <option value="last">dernière manche terminée</option>
          {ended.map((r) => (
            <option key={r.index} value={String(r.index)}>
              manche {r.index + 1} seule
            </option>
          ))}
          <option value="sum">somme de toutes les manches terminées</option>
        </select>
        <button
          className="btn sm"
          disabled={view.prizesDraft.length === 0 || ended.length === 0}
          onClick={() => confirm('Lancer les tirages des lots maintenant ?') && (roundSel === 'sum' ? onDraw('sumOfRounds') : onDraw('round', roundSel === 'last' ? undefined : [Number(roundSel)]))}
        >
          Tirer les lots
        </button>
      </div>
      {view.prizeSeries.map((s) => (
        <div key={s.id} className="stat small" style={{ marginTop: 8 }}>
          <div className="label">
            Série {fmtClock(s.createdAt)} · {s.scope === 'round' ? 'manche' : 'somme des manches'} {s.roundIndexes.map((i) => i + 1).join(', ')}
          </div>
          {s.awards.map((a) => {
            const prize = s.prizes.find((p) => p.id === a.prizeId);
            return (
              <div key={a.prizeId}>
                {prize?.label} → <b>{a.winnerId ? names.get(a.winnerId) : `non attribué (${a.reason})`}</b> <span className="muted">tirage {a.audit.roll}/{a.audit.total}</span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
