import { nanoFromJSON, shareOf } from './hashrate.js';
import type { Avatar, BlockBonusEvent, BlockFeedStatus, BlockInfo, Competitor, GameEvent, Phase, PrizeSeries, Question, QuestionRun, RoundDef, RoundState, SessionConfig, SessionState } from './types.js';

/** Competitor as shown on boards and phones (no token). */
export interface CompetitorView {
  id: string;
  kind: Competitor['kind'];
  name: string;
  members: string[];
  bitaxeNumber?: number;
  avatar: Avatar;
  connected: boolean;
  hashrate: string; // nano, current round (or final of last round)
  /** Gain credited on the last closed question of the round (nano), for the ranking screen. */
  lastGain?: string;
  lastRank?: number;
  share: number; // 0..1 of the total
  rank: number; // 1-based by hashrate
}

export interface PublicQuestion {
  id: string;
  type: Question['type'];
  text: string;
  options: string[];
  difficulty: Question['difficulty'];
  /** Only present once the question is closed. */
  correctIndex?: number;
  explanation?: string;
  source?: Question['source'];
  demo?: boolean;
}

export interface QuestionView {
  roundIndex: number;
  questionIndex: number;
  questionTotal: number;
  question: PublicQuestion;
  openedAt: number;
  closesAt: number;
  closedAt?: number;
  durationMs: number;
  closed: boolean;
  cancelled?: boolean;
  answerCount: number;
  results?: QuestionRun['results'];
}

export interface RoundSummary {
  index: number;
  title: string;
  status: RoundState['status'];
  questionCount: number;
  currentQuestion: number;
  tipHeightAtStart: number | null;
  blockBonusCount: number;
}

export interface BoardView {
  kind: 'board';
  code: string;
  phase: Phase;
  config: SessionConfig;
  contentName: string;
  competitors: CompetitorView[];
  totalHashrate: string;
  rounds: RoundSummary[];
  currentRoundIndex: number;
  question?: QuestionView;
  recentBlocks: BlockInfo[];
  blockFeed: BlockFeedStatus;
  blockBonuses: BlockBonusEvent[]; // current round
  lastBlockBonus?: BlockBonusEvent;
  prizeSeries: PrizeSeries[];
  prizesDraft: SessionState['prizesDraft'];
  joinUrl?: string;
}

export interface PlayerView extends Omit<BoardView, 'kind'> {
  kind: 'player';
  me?: CompetitorView & { token: string };
  myAnswer?: { optionIndex: number; firstAt: number; lastAt: number; changes: number };
}

export interface ConsoleView extends Omit<BoardView, 'kind' | 'competitors'> {
  kind: 'console';
  competitors: (CompetitorView & { token: string; joinedAt: number; lastSeenAt: number })[];
  questions: Record<string, Question>;
  roundDefs: RoundDef[];
  roundStates: RoundState[];
  recentEvents: GameEvent[];
  contentPacks: { name: string; description?: string; questions: number; rounds: number; file: string }[];
  serverInfo: { lanUrls: string[]; port: number; dataDir: string; version: string };
}

export type AnyView = BoardView | PlayerView | ConsoleView;

function rankedCompetitors(state: SessionState): { list: CompetitorView[]; total: bigint } {
  const round = state.roundStates[state.currentRoundIndex];
  const source = round?.status === 'ended' ? round.finalHashrates ?? round.hashrates : round?.hashrates ?? {};
  const active = Object.values(state.competitors).filter((c) => !c.removed);
  const withHr = active.map((c) => ({ c, hr: nanoFromJSON(source[c.id] ?? '0') }));
  const total = withHr.reduce((s, x) => s + x.hr, 0n);
  withHr.sort((a, b) => (a.hr === b.hr ? a.c.joinedAt - b.c.joinedAt : a.hr > b.hr ? -1 : 1));
  const lastRun = round && round.currentQuestion >= 0 ? round.questionRuns[round.currentQuestion] : undefined;
  const lastGains = new Map((lastRun?.results?.gains ?? []).map((g) => [g.competitorId, g]));
  const list = withHr.map((x, i) => {
    const g = lastGains.get(x.c.id);
    return {
      id: x.c.id,
      kind: x.c.kind,
      name: x.c.name,
      members: x.c.members,
      bitaxeNumber: x.c.bitaxeNumber,
      avatar: x.c.avatar,
      connected: x.c.connected,
      hashrate: x.hr.toString(),
      share: shareOf(x.hr, total),
      rank: i + 1,
      lastGain: g?.gain,
      lastRank: g?.rank,
    };
  });
  return { list, total };
}

function publicQuestion(q: Question, revealed: boolean): PublicQuestion {
  const base: PublicQuestion = { id: q.id, type: q.type, text: q.text, options: q.options, difficulty: q.difficulty, source: q.source, demo: q.demo };
  if (revealed) {
    base.correctIndex = q.correctIndex;
    base.explanation = q.explanation;
  }
  return base;
}

function questionView(state: SessionState, revealToConsole: boolean): QuestionView | undefined {
  const round = state.roundStates[state.currentRoundIndex];
  if (!round || round.currentQuestion < 0) return undefined;
  const run = round.questionRuns[round.currentQuestion];
  if (!run) return undefined;
  const q = state.questions[run.questionId];
  const closed = run.closedAt !== undefined;
  return {
    roundIndex: round.index,
    questionIndex: run.questionIndex,
    questionTotal: state.rounds[round.index]?.questionIds.length ?? 0,
    question: publicQuestion(q, closed || revealToConsole),
    openedAt: run.openedAt,
    closesAt: run.closesAt,
    closedAt: run.closedAt,
    durationMs: run.durationMs,
    closed,
    cancelled: run.cancelled,
    answerCount: Object.keys(run.answers).length,
    results: closed ? run.results : undefined,
  };
}

function roundSummaries(state: SessionState): RoundSummary[] {
  return state.roundStates.map((r) => ({
    index: r.index,
    title: r.title,
    status: r.status,
    questionCount: state.rounds[r.index]?.questionIds.length ?? 0,
    currentQuestion: r.currentQuestion,
    tipHeightAtStart: r.tipHeightAtStart,
    blockBonusCount: r.blockBonuses.length,
  }));
}

export function boardView(state: SessionState, joinUrl?: string): BoardView {
  const { list, total } = rankedCompetitors(state);
  const round = state.roundStates[state.currentRoundIndex];
  const bonuses = round?.blockBonuses ?? [];
  return {
    kind: 'board',
    code: state.code,
    phase: state.phase,
    config: state.config,
    contentName: state.contentName,
    competitors: list,
    totalHashrate: total.toString(),
    rounds: roundSummaries(state),
    currentRoundIndex: state.currentRoundIndex,
    question: questionView(state, false),
    recentBlocks: state.recentBlocks,
    blockFeed: state.blockFeed,
    blockBonuses: bonuses,
    lastBlockBonus: bonuses[bonuses.length - 1],
    prizeSeries: state.prizeSeries,
    prizesDraft: state.prizesDraft,
    joinUrl,
  };
}

export function playerView(state: SessionState, competitorId: string | undefined, joinUrl?: string): PlayerView {
  const b = boardView(state, joinUrl);
  const c = competitorId ? state.competitors[competitorId] : undefined;
  const me = c && !c.removed ? { ...b.competitors.find((x) => x.id === c.id)!, token: c.token } : undefined;
  const round = state.roundStates[state.currentRoundIndex];
  const run = round && round.currentQuestion >= 0 ? round.questionRuns[round.currentQuestion] : undefined;
  const myAnswer = run && c ? run.answers[c.id] : undefined;
  return { ...b, kind: 'player', me, myAnswer: myAnswer ? { ...myAnswer } : undefined };
}

export function consoleView(
  state: SessionState,
  extra: { joinUrl?: string; contentPacks: ConsoleView['contentPacks']; serverInfo: ConsoleView['serverInfo'] },
): ConsoleView {
  const b = boardView(state, extra.joinUrl);
  const competitors = b.competitors.map((cv) => {
    const c = state.competitors[cv.id];
    return { ...cv, token: c.token, joinedAt: c.joinedAt, lastSeenAt: c.lastSeenAt };
  });
  return {
    ...b,
    kind: 'console',
    competitors,
    question: questionView(state, true),
    questions: state.questions,
    roundDefs: state.rounds,
    roundStates: state.roundStates,
    recentEvents: state.recentEvents.slice(-120),
    contentPacks: extra.contentPacks,
    serverInfo: extra.serverInfo,
  };
}

// ------------------------------------------------------------------ protocol
export type ClientHello =
  | { type: 'hello'; role: 'player'; sessionCode?: string; token?: string }
  | { type: 'hello'; role: 'board'; sessionCode?: string }
  | { type: 'hello'; role: 'console'; consoleToken: string };

export type PlayerMessage =
  | { type: 'join-pool'; name: string; members: string[] }
  | { type: 'join-bitaxe'; owner?: string }
  | { type: 'update-me'; name?: string; members?: string[] }
  | { type: 'answer'; questionId: string; optionIndex: number; clientId?: string };

export type ConsoleCommand =
  | { type: 'new-session'; packName?: string; config?: Partial<SessionConfig> }
  | { type: 'set-config'; patch: Partial<SessionConfig> }
  | { type: 'set-content'; packName: string }
  | { type: 'update-question'; id: string; durationMs?: number; difficulty?: Question['difficulty'] }
  | { type: 'remove-competitor'; id: string }
  | { type: 'update-competitor'; id: string; name?: string; members?: string[] }
  | { type: 'start-round'; index: number }
  | { type: 'open-question'; durationMs?: number }
  | { type: 'close-question' }
  | { type: 'cancel-question' }
  | { type: 'end-round' }
  | { type: 'set-prizes'; prizes: { id?: string; label: string; rank?: number }[] }
  | { type: 'draw-prizes'; roundIndexes?: number[]; scope?: 'round' | 'sumOfRounds' }
  | { type: 'set-block-mode'; mode: 'real' | 'simulated' | 'off' }
  | { type: 'simulate-block' };

export type ClientMessage = ClientHello | PlayerMessage | ConsoleCommand | { type: 'ping'; t: number };

export type ServerMessage =
  | { type: 'state'; serverNow: number; view: AnyView }
  | { type: 'joined'; competitorId: string; token: string }
  | { type: 'answer-ack'; questionId: string; accepted: boolean; reason?: string; optionIndex: number; serverAt: number; clientId?: string }
  | { type: 'event'; serverNow: number; event: GameEvent }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; t: number; serverNow: number }
  | { type: 'hello-ok'; role: string; serverNow: number; competitorId: string | null; tokenRecognized: boolean };
