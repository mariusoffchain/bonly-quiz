import type { Game, NextStep } from './game.js';
import type { Difficulty, Phase, Question, QuestionResult, SessionConfig } from './types.js';

/** A player as everyone may see it (no token). */
export interface PlayerPublic {
  id: string;
  name: string;
  color: number;
  connected: boolean;
  hashrate: number;
  /** Share of the total hashrate, 0..1 = chance of finding the next block. */
  share: number;
  /** 1-based, by hashrate. */
  rank: number;
  streak: number;
  correctCount: number;
  /** Gain on the last closed question. */
  lastGain?: number;
}

export interface QuestionPublic {
  index: number;
  total: number;
  text: string;
  options: string[];
  difficulty: Difficulty;
  baseGain: number;
  openedAt: number;
  closesAt: number;
  durationMs: number;
  closed: boolean;
  cancelled?: boolean;
  answerCount: number;
  /** Sent once the question is closed (or to the console). */
  correctIndex?: number;
  explanation?: string;
  source?: Question['source'];
  demo?: boolean;
  /** Answers per option, after closing. */
  optionCounts?: number[];
  /** Best gains of the question, after closing. */
  top?: (QuestionResult & { id: string })[];
}

export interface BlockPublic {
  /** Block number = podium place. */
  n: number;
  startedAt: number;
  revealAt: number;
  found: boolean;
  /** Candidates and their chances at draw time. */
  candidates: { id: string; hashrate: number; share: number }[];
  winnerId?: string | null;
  hash?: string;
  total?: number;
  roll?: number;
}

export interface PartPublic {
  /** 1-based. */
  n: number;
  title: string;
  subtitle?: string;
  /** First question, 0-based. */
  from: number;
  count: number;
  /** Base gains of its questions, distinct, ascending (TH). */
  gains: number[];
}

export type PublicConfig = Pick<
  SessionConfig,
  'baseGainThs' | 'speedBonusRanks' | 'streakBonusStep' | 'streakBonusMax' | 'reinvestRate' | 'startHashrateThs' | 'podiumSize' | 'miningDurationMs'
>;

export interface BoardView {
  kind: 'board';
  code: string;
  joinUrl: string;
  phase: Phase;
  packName: string;
  questionTotal: number;
  /** Parts of the game; empty when the pack has none. */
  parts: PartPublic[];
  /**
   * 0-based index in `parts` of the part being played, or announced during an
   * intermission. Undefined in the lobby, at the end, or without parts.
   */
  part?: number;
  question?: QuestionPublic;
  players: PlayerPublic[];
  totalHashrate: number;
  blocks: BlockPublic[];
  config: PublicConfig;
}

export interface PlayerView extends Omit<BoardView, 'kind'> {
  kind: 'player';
  me?: PlayerPublic;
  myAnswer?: { option: number; ms: number };
  /** My result on the current question, once closed. */
  myResult?: QuestionResult;
}

export interface PackInfo {
  file: string;
  name: string;
  description?: string;
  questions: number;
}

export interface ConsoleView extends Omit<BoardView, 'kind'> {
  kind: 'console';
  next: NextStep | null;
  fullConfig: SessionConfig;
  questions: Question[];
  packs: PackInfo[];
  lanUrls: string[];
  answeredIds: string[];
}

export type AnyView = BoardView | PlayerView | ConsoleView;

function players(game: Game): { list: PlayerPublic[]; total: number } {
  const active = game.activePlayers();
  const total = active.reduce((s, p) => s + p.hashrate, 0);
  const results = game.state.phase !== 'question' ? game.run?.results : undefined;
  const sorted = [...active].sort((a, b) => b.hashrate - a.hashrate || a.joinedAt - b.joinedAt);
  const list = sorted.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    connected: p.connected,
    hashrate: p.hashrate,
    share: total > 0 ? p.hashrate / total : 0,
    rank: i + 1,
    streak: p.streak,
    correctCount: p.correctCount,
    lastGain: results?.[p.id]?.gain,
  }));
  return { list, total };
}

function question(game: Game, reveal: boolean): QuestionPublic | undefined {
  const run = game.run;
  if (!run) return undefined;
  const q = game.state.questions[run.index];
  const closed = run.closedAt !== undefined;
  const out: QuestionPublic = {
    index: run.index,
    total: game.total,
    text: q.text,
    options: q.options,
    difficulty: q.difficulty,
    baseGain: game.state.config.baseGainThs[q.difficulty],
    openedAt: run.openedAt,
    closesAt: run.closesAt,
    durationMs: run.durationMs,
    closed,
    cancelled: run.cancelled,
    answerCount: Object.keys(run.answers).length,
    source: q.source,
    demo: q.demo,
  };
  if (closed || reveal) {
    out.correctIndex = q.correctIndex;
    out.explanation = q.explanation;
  }
  if (closed) {
    out.optionCounts = q.options.map((_, i) => Object.values(run.answers).filter((a) => a.option === i).length);
    out.top = Object.entries(run.results ?? {})
      .filter(([, r]) => r.correct)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => b.gain - a.gain || (a.ms ?? 0) - (b.ms ?? 0))
      .slice(0, 5);
  }
  return out;
}

function blocks(game: Game, now: number): BlockPublic[] {
  return game.state.blocks.map((b) => {
    const found = now >= b.revealAt;
    const out: BlockPublic = {
      n: b.n,
      startedAt: b.startedAt,
      revealAt: b.revealAt,
      found,
      candidates: b.weights.map((w) => ({ ...w, share: b.total > 0 ? Math.round(w.hashrate * 10) / b.total : 0 })),
    };
    if (found) Object.assign(out, { winnerId: b.winnerId, hash: b.hash, total: b.total, roll: b.roll });
    return out;
  });
}

function parts(game: Game): { list: PartPublic[]; current?: number } {
  const s = game.state;
  const list = game.parts().map((p) => ({
    n: p.n,
    title: p.title,
    subtitle: p.subtitle,
    from: p.from,
    count: p.to - p.from,
    gains: [...new Set(s.questions.slice(p.from, p.to).map((q) => s.config.baseGainThs[q.difficulty]))].sort((a, b) => a - b),
  }));
  const index = s.phase === 'intermission' ? s.current + 1 : s.phase === 'question' || s.phase === 'reveal' ? s.current : -1;
  const n = index >= 0 ? game.partOf(index)?.n : undefined;
  return { list, current: n === undefined ? undefined : n - 1 };
}

export function boardView(game: Game, now: number, joinUrl: string): BoardView {
  const s = game.state;
  const { list, total } = players(game);
  const c = s.config;
  const p = parts(game);
  return {
    kind: 'board',
    code: s.code,
    joinUrl,
    phase: s.phase,
    packName: s.packName,
    questionTotal: game.total,
    parts: p.list,
    part: p.current,
    question: s.phase === 'intermission' ? undefined : question(game, false),
    players: list,
    totalHashrate: total,
    blocks: blocks(game, now),
    config: {
      baseGainThs: c.baseGainThs,
      speedBonusRanks: c.speedBonusRanks,
      streakBonusStep: c.streakBonusStep,
      streakBonusMax: c.streakBonusMax,
      reinvestRate: c.reinvestRate,
      startHashrateThs: c.startHashrateThs,
      podiumSize: c.podiumSize,
      miningDurationMs: c.miningDurationMs,
    },
  };
}

export function playerView(game: Game, now: number, joinUrl: string, playerId?: string): PlayerView {
  const b = boardView(game, now, joinUrl);
  const me = playerId ? b.players.find((p) => p.id === playerId) : undefined;
  const run = game.run;
  const a = me && run ? run.answers[me.id] : undefined;
  return {
    ...b,
    kind: 'player',
    me,
    myAnswer: a && run ? { option: a.option, ms: a.at - run.openedAt } : undefined,
    myResult: me && run?.closedAt !== undefined ? run.results?.[me.id] : undefined,
  };
}

export function consoleView(game: Game, now: number, joinUrl: string, extra: { packs: PackInfo[]; lanUrls: string[] }): ConsoleView {
  const b = boardView(game, now, joinUrl);
  return {
    ...b,
    kind: 'console',
    question: game.state.phase === 'intermission' ? undefined : question(game, true),
    next: game.nextStep(now),
    fullConfig: game.state.config,
    questions: game.state.questions.slice(0, game.total),
    packs: extra.packs,
    lanUrls: extra.lanUrls,
    answeredIds: Object.keys(game.run?.answers ?? {}),
  };
}

// ------------------------------------------------------------------ protocol
export type ClientMessage =
  | { type: 'hello'; role: 'player'; token?: string }
  | { type: 'hello'; role: 'board' }
  | { type: 'hello'; role: 'console'; consoleToken: string }
  | { type: 'ping'; t: number }
  // player
  | { type: 'join'; name: string }
  | { type: 'reclaim'; name: string }
  | { type: 'answer'; questionIndex: number; option: number }
  // console
  | { type: 'next'; key: string }
  | { type: 'cancel-question' }
  | { type: 'remove-player'; id: string }
  | { type: 'rename-player'; id: string; name: string }
  | { type: 'set-config'; patch: Partial<SessionConfig> }
  | { type: 'set-pack'; file: string }
  | { type: 'new-session' };

export type ServerMessage =
  | { type: 'hello-ok'; role: string; serverNow: number; playerId: string | null; tokenRecognized: boolean }
  | { type: 'state'; serverNow: number; view: AnyView }
  | { type: 'joined'; playerId: string; token: string }
  | { type: 'answer-ack'; questionIndex: number; option: number; ok: boolean; reason?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number; serverNow: number };
