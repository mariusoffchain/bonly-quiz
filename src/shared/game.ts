import { DEFAULT_CONFIG, type Difficulty, type SessionConfig } from './config.js';
import { cryptoRng, drawPrizeSeries, weightedDraw, type PrizeDef, type Rng, type WeightedCandidate } from './draw.js';
import { applyPercent, nanoFromJSON, parsePercent, percentToString, thsToNano, type Nano } from './hashrate.js';
import { rankCorrectAnswers } from './scoring.js';
import type {
  BlockBonusEvent,
  BlockInfo,
  Competitor,
  ContentPack,
  GameEvent,
  GainRecord,
  PrizeSeries,
  QuestionRun,
  RoundState,
  SessionState,
} from './types.js';

export class GameError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface GameDeps {
  rng?: Rng;
  newId?: () => string;
  newToken?: () => string;
}

const defaultId = () => Math.random().toString(36).slice(2, 10);
const defaultToken = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Authoritative game engine. Pure with respect to time (`now` is always passed in)
 * and randomness (`rng` injectable), so every rule is unit-testable and replayable.
 * Hashrates are nano TH/s strings inside the state.
 */
export class Game {
  state: SessionState;
  private rng: Rng;
  private newId: () => string;
  private newToken: () => string;
  private listeners: ((ev: GameEvent) => void)[] = [];

  constructor(state: SessionState, deps: GameDeps = {}) {
    this.state = state;
    this.rng = deps.rng ?? cryptoRng;
    this.newId = deps.newId ?? defaultId;
    this.newToken = deps.newToken ?? defaultToken;
  }

  static create(code: string, now: number, content: ContentPack, config: Partial<SessionConfig> = {}, deps: GameDeps = {}): Game {
    const state: SessionState = {
      code,
      createdAt: now,
      config: { ...DEFAULT_CONFIG, ...config },
      contentName: content.name,
      questions: Object.fromEntries(content.questions.map((q) => [q.id, q])),
      rounds: content.rounds,
      roundStates: content.rounds.map((r, i) => emptyRound(i, r.id, r.title)),
      currentRoundIndex: -1,
      phase: 'lobby',
      competitors: {},
      nextBitaxeNumber: 1,
      processedBlockIds: [],
      recentBlocks: [],
      prizesDraft: [],
      prizeSeries: [],
      blockFeed: { mode: 'off', connected: false, tipHeight: null },
      eventSeq: 0,
      recentEvents: [],
    };
    const g = new Game(state, deps);
    g.emit(now, 'session.created', { code, contentName: content.name, rounds: content.rounds.length });
    return g;
  }

  onEvent(fn: (ev: GameEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(at: number, type: string, payload: unknown): GameEvent {
    const ev: GameEvent = { seq: ++this.state.eventSeq, at, type, payload };
    this.state.recentEvents.push(ev);
    if (this.state.recentEvents.length > 300) this.state.recentEvents.splice(0, this.state.recentEvents.length - 300);
    for (const l of this.listeners) l(ev);
    return ev;
  }

  // ---------------------------------------------------------------- helpers
  get round(): RoundState | undefined {
    return this.state.roundStates[this.state.currentRoundIndex];
  }

  get currentRun(): QuestionRun | undefined {
    const r = this.round;
    if (!r || r.currentQuestion < 0) return undefined;
    return r.questionRuns[r.currentQuestion];
  }

  activeCompetitors(): Competitor[] {
    return Object.values(this.state.competitors).filter((c) => !c.removed);
  }

  private hashrate(round: RoundState, id: string): Nano {
    return nanoFromJSON(round.hashrates[id] ?? '0');
  }

  // ----------------------------------------------------------- configuration
  setConfig(patch: Partial<SessionConfig>, now: number): void {
    // Validate the numeric-looking strings early so the console gets a clear error.
    const next = { ...this.state.config, ...patch };
    for (const k of ['easy', 'intermediate', 'hard'] as const) thsToNano(next.baseGainThs[k]);
    thsToNano(next.initialHashrateThs);
    parsePercent(next.blockBonusPercent);
    if (!(next.defaultQuestionDurationMs >= 1000)) throw new GameError('bad-config', 'duration must be >= 1000 ms');
    this.state.config = next;
    this.emit(now, 'config.updated', patch);
  }

  /** Replace questions and rounds. Allowed while no round is running. */
  setContent(content: ContentPack, now: number): void {
    if (this.round?.status === 'running') throw new GameError('round-running', 'cannot change content during a round');
    const ended = this.state.roundStates.filter((r) => r.status === 'ended');
    this.state.contentName = content.name;
    this.state.questions = Object.fromEntries(content.questions.map((q) => [q.id, q]));
    this.state.rounds = content.rounds;
    this.state.roundStates = content.rounds.map((r, i) => {
      const prev = ended.find((e) => e.defId === r.id);
      return prev ?? emptyRound(i, r.id, r.title);
    });
    if (this.state.currentRoundIndex >= this.state.roundStates.length) this.state.currentRoundIndex = -1;
    this.emit(now, 'content.updated', { name: content.name, questions: content.questions.length, rounds: content.rounds.length });
  }

  /** Override a question's duration or difficulty from the console. */
  updateQuestion(id: string, patch: { durationMs?: number; difficulty?: Difficulty }, now: number): void {
    const q = this.state.questions[id];
    if (!q) throw new GameError('not-found', 'unknown question');
    if (patch.durationMs !== undefined) {
      if (!(patch.durationMs >= 1000)) throw new GameError('bad-config', 'duration must be >= 1000 ms');
      q.durationMs = patch.durationMs;
    }
    if (patch.difficulty) q.difficulty = patch.difficulty;
    this.emit(now, 'question.updated', { id, ...patch });
  }

  // ------------------------------------------------------------ competitors
  joinPool(input: { name: string; members: string[] }, now: number): Competitor {
    const name = input.name.trim();
    if (!name) throw new GameError('bad-input', 'pool name required');
    const members = input.members.map((m) => m.trim()).filter(Boolean);
    if (members.length < this.state.config.minPoolMembers) {
      throw new GameError('too-few-members', `a pool needs at least ${this.state.config.minPoolMembers} members`);
    }
    const c: Competitor = {
      id: 'c_' + this.newId(),
      kind: 'pool',
      name,
      members,
      token: this.newToken(),
      joinedAt: now,
      connected: true,
      lastSeenAt: now,
    };
    this.registerCompetitor(c, now);
    return c;
  }

  joinBitaxe(input: { name?: string; owner?: string }, now: number): Competitor {
    const n = this.state.nextBitaxeNumber++;
    const c: Competitor = {
      id: 'c_' + this.newId(),
      kind: 'bitaxe',
      name: `Bitaxe ${n}`,
      members: input.owner?.trim() ? [input.owner.trim()] : [],
      bitaxeNumber: n,
      token: this.newToken(),
      joinedAt: now,
      connected: true,
      lastSeenAt: now,
    };
    this.registerCompetitor(c, now);
    return c;
  }

  private registerCompetitor(c: Competitor, now: number): void {
    this.state.competitors[c.id] = c;
    // Late joiners during a running round start at the initial hashrate of that round.
    const r = this.round;
    if (r && r.status === 'running' && r.hashrates[c.id] === undefined) {
      r.hashrates[c.id] = thsToNano(this.state.config.initialHashrateThs).toString();
    }
    this.emit(now, 'competitor.joined', { id: c.id, kind: c.kind, name: c.name, members: c.members.length });
  }

  updateCompetitor(id: string, patch: { name?: string; members?: string[] }, now: number): Competitor {
    const c = this.state.competitors[id];
    if (!c || c.removed) throw new GameError('not-found', 'unknown competitor');
    if (patch.name !== undefined && c.kind === 'pool') {
      const name = patch.name.trim();
      if (!name) throw new GameError('bad-input', 'pool name required');
      c.name = name;
    }
    if (patch.members) {
      const members = patch.members.map((m) => m.trim()).filter(Boolean);
      if (c.kind === 'pool' && members.length < this.state.config.minPoolMembers) {
        throw new GameError('too-few-members', `a pool needs at least ${this.state.config.minPoolMembers} members`);
      }
      c.members = members;
    }
    this.emit(now, 'competitor.updated', { id, name: c.name, members: c.members.length });
    return c;
  }

  removeCompetitor(id: string, now: number): void {
    const c = this.state.competitors[id];
    if (!c) throw new GameError('not-found', 'unknown competitor');
    c.removed = true;
    this.emit(now, 'competitor.removed', { id });
  }

  setConnected(id: string, connected: boolean, now: number): void {
    const c = this.state.competitors[id];
    if (!c) return;
    c.connected = connected;
    c.lastSeenAt = now;
  }

  findByToken(token: string): Competitor | undefined {
    return Object.values(this.state.competitors).find((c) => c.token === token && !c.removed);
  }

  // ------------------------------------------------------------------ rounds
  /** Prepare a round: every competitor starts from the configured initial hashrate. */
  startRound(index: number, now: number, tipHeight: number | null): RoundState {
    const r = this.state.roundStates[index];
    if (!r) throw new GameError('not-found', 'unknown round');
    if (r.status !== 'pending') throw new GameError('round-not-pending', 'round already started');
    const running = this.state.roundStates.find((x) => x.status === 'running');
    if (running) throw new GameError('round-running', `round ${running.index + 1} is still running`);
    r.status = 'running';
    r.startedAt = now;
    r.tipHeightAtStart = tipHeight;
    r.hashrates = {};
    const init = thsToNano(this.state.config.initialHashrateThs).toString();
    for (const c of this.activeCompetitors()) r.hashrates[c.id] = init;
    r.questionRuns = [];
    r.currentQuestion = -1;
    r.blockBonuses = [];
    this.state.currentRoundIndex = index;
    this.state.phase = 'round-ready';
    this.emit(now, 'round.started', { index, title: r.title, tipHeightAtStart: tipHeight, initialHashrate: init, competitors: Object.keys(r.hashrates).length });
    return r;
  }

  /** Open the next question of the running round. Server timer must call closeQuestion at closesAt. */
  openNextQuestion(now: number, durationOverrideMs?: number): QuestionRun {
    const r = this.round;
    if (!r || r.status !== 'running') throw new GameError('no-round', 'no running round');
    if (this.state.phase === 'question-open') throw new GameError('question-open', 'a question is already open');
    const def = this.state.rounds[r.index];
    const nextIndex = r.currentQuestion + 1;
    if (nextIndex >= def.questionIds.length) throw new GameError('round-exhausted', 'no more questions in this round');
    const qid = def.questionIds[nextIndex];
    const q = this.state.questions[qid];
    if (!q) throw new GameError('not-found', `question ${qid} missing`);
    const durationMs = durationOverrideMs ?? q.durationMs ?? this.state.config.defaultQuestionDurationMs;
    const run: QuestionRun = {
      roundIndex: r.index,
      questionIndex: nextIndex,
      questionId: qid,
      openedAt: now,
      closesAt: now + durationMs,
      durationMs,
      answers: {},
    };
    r.questionRuns[nextIndex] = run;
    r.currentQuestion = nextIndex;
    this.state.phase = 'question-open';
    this.emit(now, 'question.opened', { roundIndex: r.index, questionIndex: nextIndex, questionId: qid, closesAt: run.closesAt, durationMs });
    return run;
  }

  /** Record or modify an answer. Rejected after closesAt according to the server clock. */
  submitAnswer(competitorId: string, optionIndex: number, now: number): { accepted: boolean; reason?: string; record?: Record<string, unknown> } {
    const c = this.state.competitors[competitorId];
    if (!c || c.removed) throw new GameError('not-found', 'unknown competitor');
    const run = this.currentRun;
    if (!run || this.state.phase !== 'question-open') return { accepted: false, reason: 'no-open-question' };
    if (now >= run.closesAt || run.closedAt !== undefined) return { accepted: false, reason: 'closed' };
    const q = this.state.questions[run.questionId];
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) {
      return { accepted: false, reason: 'bad-option' };
    }
    const prev = run.answers[competitorId];
    if (prev) {
      if (prev.optionIndex === optionIndex) return { accepted: true, record: { ...prev, unchanged: true } };
      prev.optionIndex = optionIndex;
      prev.lastAt = now;
      prev.changes += 1;
    } else {
      run.answers[competitorId] = { optionIndex, firstAt: now, lastAt: now, changes: 0 };
    }
    const rec = run.answers[competitorId];
    this.emit(now, 'answer.recorded', { competitorId, questionId: run.questionId, optionIndex, changes: rec.changes });
    return { accepted: true, record: { ...rec } };
  }

  /** Close the current question, compute gains, credit hashrates. Idempotent. */
  closeQuestion(now: number): QuestionRun {
    const r = this.round;
    const run = this.currentRun;
    if (!r || !run) throw new GameError('no-question', 'no question to close');
    if (run.closedAt !== undefined) return run;
    const q = this.state.questions[run.questionId];
    run.closedAt = now; // close time is the server call time
    const base = thsToNano(this.state.config.baseGainThs[q.difficulty]);
    const correct = Object.entries(run.answers)
      .filter(([, a]) => a.optionIndex === q.correctIndex)
      .map(([competitorId, a]) => ({
        competitorId,
        referenceAt: this.state.config.speedReference === 'first' ? a.firstAt : a.lastAt,
      }));
    const ranked = rankCorrectAnswers(correct, base, this.state.config);
    const gains: GainRecord[] = ranked.map((g) => ({
      competitorId: g.competitorId,
      rank: g.rank,
      tied: g.tied,
      bonusPercent: percentToString(g.bonus),
      base: g.base.toString(),
      gain: g.gain.toString(),
    }));
    for (const g of ranked) {
      const before = this.hashrate(r, g.competitorId);
      r.hashrates[g.competitorId] = (before + g.gain).toString();
    }
    const wrong = Object.entries(run.answers)
      .filter(([, a]) => a.optionIndex !== q.correctIndex)
      .map(([id]) => id);
    const silent = this.activeCompetitors()
      .map((c) => c.id)
      .filter((id) => !run.answers[id]);
    run.results = { correctIndex: q.correctIndex, gains, wrong, silent };
    this.state.phase = 'question-closed';
    this.emit(now, 'question.closed', {
      roundIndex: r.index,
      questionIndex: run.questionIndex,
      questionId: run.questionId,
      correctIndex: q.correctIndex,
      base: base.toString(),
      gains,
      wrong,
      silent,
      hashrates: { ...r.hashrates },
    });
    return run;
  }

  /** Abort the open question without scoring (host mistake). Logged explicitly. */
  cancelQuestion(now: number): void {
    const run = this.currentRun;
    if (!run || this.state.phase !== 'question-open') throw new GameError('no-question', 'no open question');
    run.closedAt = now;
    run.cancelled = true;
    run.results = { correctIndex: this.state.questions[run.questionId].correctIndex, gains: [], wrong: [], silent: [] };
    this.state.phase = 'question-closed';
    this.emit(now, 'question.cancelled', { questionId: run.questionId });
  }

  endRound(now: number): RoundState {
    const r = this.round;
    if (!r || r.status !== 'running') throw new GameError('no-round', 'no running round');
    if (this.state.phase === 'question-open') throw new GameError('question-open', 'close the question first');
    r.status = 'ended';
    r.endedAt = now;
    r.finalHashrates = { ...r.hashrates };
    const allDone = this.state.roundStates.every((x) => x.status === 'ended');
    this.state.phase = allDone ? 'finished' : 'round-ended';
    this.emit(now, 'round.ended', { index: r.index, finalHashrates: r.finalHashrates });
    return r;
  }

  // ------------------------------------------------------------------ blocks
  /**
   * Handle a block from the feed. Returns the bonus event when a draw happened.
   * Deduplicated by block id; blocks at or below the round's starting tip are history.
   */
  onBlock(block: BlockInfo, now: number): BlockBonusEvent | null {
    if (this.state.processedBlockIds.includes(block.id)) {
      return null; // duplicate delivery (reconnection, replay)
    }
    this.state.processedBlockIds.push(block.id);
    if (this.state.processedBlockIds.length > 5000) this.state.processedBlockIds.splice(0, 1000);
    if (block.origin === 'real') {
      this.state.recentBlocks = [block, ...this.state.recentBlocks.filter((b) => b.id !== block.id)]
        .sort((a, b) => b.height - a.height)
        .slice(0, 8);
      this.state.blockFeed.tipHeight = Math.max(this.state.blockFeed.tipHeight ?? 0, block.height);
    }
    const r = this.round;
    if (!r || r.status !== 'running') {
      this.emit(now, 'block.ignored', { blockId: block.id, height: block.height, origin: block.origin, reason: 'no-running-round' });
      return null;
    }
    if (block.origin === 'real' && r.tipHeightAtStart !== null && block.height <= r.tipHeightAtStart) {
      this.emit(now, 'block.ignored', { blockId: block.id, height: block.height, origin: block.origin, reason: 'historical' });
      return null;
    }
    const candidates: WeightedCandidate[] = this.activeCompetitors().map((c) => ({ competitorId: c.id, weight: this.hashrate(r, c.id) }));
    const res = weightedDraw(candidates, this.rng);
    const ev: BlockBonusEvent = {
      blockId: block.id,
      height: block.height,
      origin: block.origin,
      roundIndex: r.index,
      at: now,
      winnerId: res.winnerId,
      reason: res.reason,
      base: this.state.config.blockBonusBase,
      audit: res.audit,
    };
    if (res.winnerId) {
      const before = this.hashrate(r, res.winnerId);
      const total = candidates.reduce((s, c) => s + c.weight, 0n);
      const pctv = parsePercent(this.state.config.blockBonusPercent);
      const bonus = applyPercent(this.state.config.blockBonusBase === 'own' ? before : total, pctv);
      r.hashrates[res.winnerId] = (before + bonus).toString();
      ev.before = before.toString();
      ev.bonus = bonus.toString();
      ev.after = (before + bonus).toString();
    }
    r.blockBonuses.push(ev);
    this.emit(now, 'block.bonus', ev);
    return ev;
  }

  setBlockFeed(status: Partial<SessionState['blockFeed']>, now: number, log = false): void {
    this.state.blockFeed = { ...this.state.blockFeed, ...status };
    if (log) this.emit(now, 'blockfeed.status', status);
  }

  seedRecentBlocks(blocks: BlockInfo[]): void {
    // History shown on the board; marked as processed so they can never trigger a draw.
    for (const b of blocks) if (!this.state.processedBlockIds.includes(b.id)) this.state.processedBlockIds.push(b.id);
    this.state.recentBlocks = [...blocks].sort((a, b) => b.height - a.height).slice(0, 8);
    const top = this.state.recentBlocks[0];
    if (top) this.state.blockFeed.tipHeight = Math.max(this.state.blockFeed.tipHeight ?? 0, top.height);
  }

  // ------------------------------------------------------------------ prizes
  setPrizesDraft(prizes: PrizeDef[], now: number): void {
    this.state.prizesDraft = prizes.map((p, i) => ({ id: p.id || 'p_' + this.newId(), label: p.label.trim() || `Lot ${i + 1}`, rank: p.rank ?? i + 1 }));
    this.emit(now, 'prizes.updated', { count: prizes.length });
  }

  /**
   * Run a prize series. Weights come from the final hashrates of the given rounds
   * (one round by default). Each competitor wins at most one prize per series.
   */
  drawPrizes(input: { roundIndexes?: number[]; scope?: 'round' | 'sumOfRounds' }, now: number): PrizeSeries {
    if (this.state.prizesDraft.length === 0) throw new GameError('no-prizes', 'no prizes configured');
    const scope = input.scope ?? this.state.config.prizeScope;
    let roundIndexes = input.roundIndexes;
    if (!roundIndexes || roundIndexes.length === 0) {
      const ended = this.state.roundStates.filter((r) => r.status === 'ended');
      if (ended.length === 0) throw new GameError('no-ended-round', 'no ended round to draw from');
      roundIndexes = scope === 'sumOfRounds' ? ended.map((r) => r.index) : [ended[ended.length - 1].index];
    }
    const weights: Record<string, bigint> = {};
    for (const idx of roundIndexes) {
      const r = this.state.roundStates[idx];
      if (!r || r.status !== 'ended' || !r.finalHashrates) throw new GameError('round-not-ended', `round ${idx + 1} has no final hashrate`);
      for (const [id, v] of Object.entries(r.finalHashrates)) weights[id] = (weights[id] ?? 0n) + nanoFromJSON(v);
    }
    const previousWinners = new Set(
      this.state.config.excludePrizeWinnersAcrossSeries
        ? this.state.prizeSeries.flatMap((s) => s.awards.map((a) => a.winnerId)).filter((x): x is string => !!x)
        : [],
    );
    const candidates: WeightedCandidate[] = this.activeCompetitors()
      .filter((c) => !previousWinners.has(c.id))
      .map((c) => ({ competitorId: c.id, weight: weights[c.id] ?? 0n }));
    const awards = drawPrizeSeries(this.state.prizesDraft, candidates, this.rng);
    const series: PrizeSeries = {
      id: 's_' + this.newId(),
      createdAt: now,
      scope,
      roundIndexes,
      prizes: [...this.state.prizesDraft],
      weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v.toString()])),
      awards,
    };
    this.state.prizeSeries.push(series);
    this.emit(now, 'prizes.drawn', series);
    return series;
  }
}

function emptyRound(index: number, defId: string, title: string): RoundState {
  return {
    index,
    defId,
    title,
    status: 'pending',
    tipHeightAtStart: null,
    hashrates: {},
    questionRuns: [],
    currentQuestion: -1,
    blockBonuses: [],
  };
}
