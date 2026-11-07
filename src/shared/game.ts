import { DEFAULT_CONFIG, placeLabel, validateConfig, type SessionConfig } from './config.js';
import { cryptoRng, drawWinner, fakeBlockHash, type Rng } from './draw.js';
import { round1, scoreAnswer, speedRanks } from './scoring.js';
import type { BlockDraw, ContentPack, GameEvent, Phase, Player, QuestionRun, SessionState } from './types.js';

/** A part of the game as played: questions `from` to `to` (excluded), 0-based. */
export interface PartRange {
  n: number;
  title: string;
  subtitle?: string;
  from: number;
  to: number;
}

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

export type StepAction = 'announce' | 'open' | 'close' | 'finish' | 'mine';
export interface NextStep {
  /** Changes with every transition, so a double click or a stale screen cannot skip a step. */
  key: string;
  action: StepAction;
  label: string;
}

const hex = (bytes: number) => {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const PLAYER_COLORS = 12;


/**
 * Authoritative game engine. Time (`now`) and randomness (`rng`) are injected so
 * every rule is unit-testable. One game = N questions in a row, optionally split
 * into parts announced on the big screen, then a podium drawn place by place,
 * weighted by the hashrate earned.
 */
export class Game {
  state: SessionState;
  private rng: Rng;
  private newId: () => string;
  private newToken: () => string;
  private listeners: ((ev: GameEvent) => void)[] = [];

  constructor(state: SessionState, deps: GameDeps = {}) {
    state.config = { ...DEFAULT_CONFIG, ...state.config, baseGainThs: { ...DEFAULT_CONFIG.baseGainThs, ...state.config.baseGainThs } };
    delete (state.config as { speedBonusMax?: number }).speedBonusMax; // replaced by speedBonusRanks
    this.state = state;
    this.rng = deps.rng ?? cryptoRng;
    this.newId = deps.newId ?? (() => hex(4));
    this.newToken = deps.newToken ?? (() => hex(16));
  }

  static create(code: string, now: number, pack: ContentPack, config: Partial<SessionConfig> = {}, deps: GameDeps = {}): Game {
    const g = new Game(
      {
        version: 2,
        code,
        createdAt: now,
        config: { ...DEFAULT_CONFIG, ...config },
        packName: pack.name,
        questions: pack.questions,
        parts: pack.parts,
        phase: 'lobby',
        current: -1,
        runs: [],
        players: {},
        nextColor: 0,
        blocks: [],
        eventSeq: 0,
      },
      deps,
    );
    g.emit(now, 'session.created', { code, pack: pack.name, questions: pack.questions.length });
    return g;
  }

  onEvent(fn: (ev: GameEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(at: number, type: string, payload: unknown): void {
    const ev: GameEvent = { seq: ++this.state.eventSeq, at, type, payload };
    for (const l of this.listeners) l(ev);
  }

  // ---------------------------------------------------------------- getters
  get phase(): Phase {
    return this.state.phase;
  }

  /** Number of questions actually played. */
  get total(): number {
    return Math.min(this.state.config.questionCount, this.state.questions.length);
  }

  /** The parts actually played (cut at `total` when fewer questions are played). */
  parts(): PartRange[] {
    const out: PartRange[] = [];
    let from = 0;
    for (const p of this.state.parts ?? []) {
      if (from >= this.total) break;
      const to = Math.min(this.total, from + p.questions);
      out.push({ n: out.length + 1, title: p.title, subtitle: p.subtitle, from, to });
      from = to;
    }
    return out;
  }

  /** The part containing question `index`. */
  partOf(index: number): PartRange | undefined {
    return this.parts().find((p) => index >= p.from && index < p.to);
  }

  /** The part that starts at question `index`, if one does. */
  private partStartingAt(index: number): PartRange | undefined {
    return this.parts().find((p) => p.from === index);
  }

  get run(): QuestionRun | undefined {
    return this.state.runs[this.state.current];
  }

  activePlayers(): Player[] {
    return Object.values(this.state.players).filter((p) => !p.removed);
  }

  /** The in-progress block draw, if its winner is not revealed yet. */
  miningBlock(now: number): BlockDraw | undefined {
    const b = this.state.blocks[this.state.blocks.length - 1];
    return b && now < b.revealAt ? b : undefined;
  }

  // ----------------------------------------------------------- configuration
  setConfig(patch: Partial<SessionConfig>, now: number): void {
    if (this.state.phase !== 'lobby') throw new GameError('locked', 'Les réglages se changent avant la 1re question.');
    const next = { ...this.state.config, ...patch, baseGainThs: { ...this.state.config.baseGainThs, ...patch.baseGainThs } };
    const err = validateConfig(next);
    if (err) throw new GameError('bad-config', err);
    this.state.config = next;
    for (const p of this.activePlayers()) p.hashrate = next.startHashrateThs;
    this.emit(now, 'config.updated', patch);
  }

  setPack(pack: ContentPack, now: number): void {
    if (this.state.phase !== 'lobby') throw new GameError('locked', 'Le pack se change avant la 1re question.');
    this.state.packName = pack.name;
    this.state.questions = pack.questions;
    this.state.parts = pack.parts;
    this.emit(now, 'pack.updated', { name: pack.name, questions: pack.questions.length });
  }

  // ----------------------------------------------------------------- players
  join(rawName: string, now: number): Player {
    const base = rawName.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!base) throw new GameError('bad-name', 'Choisissez un nom.');
    const taken = new Set(this.activePlayers().map((p) => p.name.toLowerCase()));
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    const p: Player = {
      id: 'p_' + this.newId(),
      name,
      color: this.state.nextColor++ % PLAYER_COLORS,
      token: this.newToken(),
      joinedAt: now,
      connected: true,
      hashrate: this.state.config.startHashrateThs,
      streak: 0,
      bestStreak: 0,
      correctCount: 0,
    };
    this.state.players[p.id] = p;
    this.emit(now, 'player.joined', { id: p.id, name });
    return p;
  }

  rename(id: string, rawName: string, now: number): void {
    const p = this.state.players[id];
    if (!p || p.removed) throw new GameError('not-found', 'Joueur inconnu.');
    const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) throw new GameError('bad-name', 'Choisissez un nom.');
    p.name = name;
    this.emit(now, 'player.renamed', { id, name });
  }

  removePlayer(id: string, now: number): void {
    const p = this.state.players[id];
    if (!p) throw new GameError('not-found', 'Joueur inconnu.');
    p.removed = true;
    this.emit(now, 'player.removed', { id });
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.state.players[id];
    if (p) p.connected = connected;
  }

  findByToken(token: string): Player | undefined {
    return Object.values(this.state.players).find((p) => p.token === token && !p.removed);
  }

  /**
   * Gives a seat back, by its exact name, to a player who lost it (new phone, or the
   * quiz address changed and the phone forgot its token). Only while the seat is
   * offline, so an active player cannot be taken over; the new phone gets a new
   * token, so the old one cannot come back: one phone per seat.
   */
  reclaim(rawName: string, now: number): Player {
    const name = rawName.replace(/\s+/g, ' ').trim().toLowerCase();
    const p = name ? this.activePlayers().find((x) => x.name.toLowerCase() === name) : undefined;
    if (!p) throw new GameError('unknown-name', 'Aucun joueur à ce nom. Vérifiez l’orthographe exacte.');
    if (p.connected) throw new GameError('seat-in-use', 'Ce joueur est connecté sur un autre téléphone.');
    p.token = this.newToken();
    this.emit(now, 'player.reclaimed', { id: p.id });
    return p;
  }

  // ---------------------------------------------------------------- progress
  nextStep(now: number): NextStep | null {
    const s = this.state;
    const key = `${s.code}:${s.phase}:${s.current}:${s.blocks.length}`;
    switch (s.phase) {
      case 'lobby':
        if (this.total === 0) return null;
        return this.partStartingAt(0)
          ? { key, action: 'announce', label: 'Annoncer la partie 1' }
          : { key, action: 'open', label: 'Lancer la question 1' };
      case 'intermission':
        return { key, action: 'open', label: `Lancer la partie ${this.partOf(s.current + 1)?.n ?? ''}` };
      case 'question':
        return { key, action: 'close', label: 'Révéler la réponse maintenant' };
      case 'reveal':
        if (s.current + 1 >= this.total) return { key, action: 'finish', label: 'Classement final' };
        return this.partStartingAt(s.current + 1)
          ? { key, action: 'announce', label: `Fin de la partie ${this.partOf(s.current)?.n ?? ''} : classement` }
          : { key, action: 'open', label: `Question ${s.current + 2} / ${this.total}` };
      case 'final':
        if (this.miningBlock(now)) return null;
        if (s.blocks.length >= s.config.podiumSize || this.drawCandidates().length === 0) return null;
        return { key, action: 'mine', label: s.config.podiumSize === 1 ? 'Tirer le gagnant' : `Tirer la ${placeLabel(s.blocks.length + 1)} place` };
    }
  }

  advance(expectedKey: string, now: number): void {
    const step = this.nextStep(now);
    if (!step || step.key !== expectedKey) throw new GameError('stale-step', 'Cette étape a déjà changé.');
    if (step.action === 'announce') this.announcePart(now);
    else if (step.action === 'open') this.openQuestion(now);
    else if (step.action === 'close') this.closeQuestion(now);
    else if (step.action === 'finish') this.finish(now);
    else this.mineBlock(now);
  }

  /** Show the next part on the big screen (and the standings so far), before its first question. */
  announcePart(now: number): PartRange {
    const s = this.state;
    if (s.phase !== 'lobby' && s.phase !== 'reveal') throw new GameError('bad-phase', 'Impossible d’annoncer une partie maintenant.');
    const part = this.partStartingAt(s.current + 1);
    if (!part) throw new GameError('no-part', 'Aucune partie ne commence ici.');
    s.phase = 'intermission';
    this.emit(now, 'part.announced', { n: part.n, title: part.title });
    return part;
  }

  openQuestion(now: number): QuestionRun {
    const s = this.state;
    if (s.phase !== 'lobby' && s.phase !== 'reveal' && s.phase !== 'intermission') throw new GameError('bad-phase', 'Impossible d’ouvrir une question maintenant.');
    const index = s.current + 1;
    if (index >= this.total) throw new GameError('no-more', 'Plus de question.');
    const q = s.questions[index];
    const durationMs = q.durationMs ?? s.config.questionDurationMs;
    const run: QuestionRun = { index, questionId: q.id, openedAt: now, closesAt: now + durationMs, durationMs, answers: {} };
    s.runs[index] = run;
    s.current = index;
    s.phase = 'question';
    this.emit(now, 'question.opened', { index, questionId: q.id, closesAt: run.closesAt });
    return run;
  }

  /**
   * One answer per player, which can be changed until the countdown ends. The time of the
   * last change counts for the speed bonus, so a fast first guess then a switch earns no edge.
   */
  answer(playerId: string, questionIndex: number, option: number, now: number): { ok: boolean; reason?: string } {
    const p = this.state.players[playerId];
    if (!p || p.removed) throw new GameError('not-found', 'Joueur inconnu.');
    const run = this.run;
    if (this.state.phase !== 'question' || !run || run.index !== questionIndex) return { ok: false, reason: 'not-open' };
    if (now >= run.closesAt) return { ok: false, reason: 'too-late' };
    const q = this.state.questions[run.index];
    if (!Number.isInteger(option) || option < 0 || option >= q.options.length) return { ok: false, reason: 'bad-option' };
    const previous = run.answers[playerId];
    if (previous?.option === option) return { ok: true };
    run.answers[playerId] = { option, at: now };
    this.emit(now, 'answer', { playerId, index: run.index, option, ms: now - run.openedAt, ...(previous ? { changedFrom: previous.option } : {}) });
    return { ok: true };
  }

  /** Close the open question and credit the hashrate. */
  closeQuestion(now: number): QuestionRun {
    const run = this.run;
    if (this.state.phase !== 'question' || !run) throw new GameError('bad-phase', 'Aucune question ouverte.');
    const q = this.state.questions[run.index];
    run.closedAt = now;
    run.results = {};
    const ranks = speedRanks(run.answers, q.correctIndex);
    for (const p of this.activePlayers()) {
      const r = scoreAnswer(q, run.answers[p.id], run, p.streak, this.state.config, ranks.get(p.id), p.hashrate);
      run.results[p.id] = r;
      p.hashrate = round1(p.hashrate + r.gain);
      p.streak = r.streak;
      if (r.correct) p.correctCount++;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
    }
    this.state.phase = 'reveal';
    this.emit(now, 'question.closed', { index: run.index, correctIndex: q.correctIndex, results: run.results });
    return run;
  }

  /** Close without awarding anything (wrong question, technical issue). */
  cancelQuestion(now: number): void {
    const run = this.run;
    if (this.state.phase !== 'question' || !run) throw new GameError('bad-phase', 'Aucune question ouverte.');
    run.closedAt = now;
    run.cancelled = true;
    this.state.phase = 'reveal';
    this.emit(now, 'question.cancelled', { index: run.index });
  }

  finish(now: number): void {
    if (this.state.phase !== 'reveal') throw new GameError('bad-phase', 'Terminez d’abord la question en cours.');
    this.state.phase = 'final';
    this.emit(now, 'game.finished', { hashrates: Object.fromEntries(this.activePlayers().map((p) => [p.id, p.hashrate])) });
  }

  /** Players still in the draw: some hashrate and no place yet. */
  drawCandidates(): { id: string; hashrate: number }[] {
    const placed = new Set(this.state.blocks.map((b) => b.winnerId));
    return this.activePlayers()
      .filter((p) => p.hashrate > 0 && !placed.has(p.id))
      .map((p) => ({ id: p.id, hashrate: p.hashrate }));
  }

  /**
   * Draw the next podium place (block n = place n): one winner with probability
   * = share of the hashrate among players without a place. The result is fixed
   * now and revealed after the mining animation.
   */
  mineBlock(now: number): BlockDraw {
    if (this.state.phase !== 'final') throw new GameError('bad-phase', 'Le tirage commence après la dernière question.');
    if (this.miningBlock(now)) throw new GameError('mining', 'Un tirage est déjà en cours.');
    if (this.state.blocks.length >= this.state.config.podiumSize) throw new GameError('podium-full', 'Le podium est complet.');
    const weights = this.drawCandidates();
    if (weights.length === 0) throw new GameError('no-candidates', 'Aucun mineur avec du hashrate.');
    const res = drawWinner(weights, this.rng);
    const block: BlockDraw = {
      n: this.state.blocks.length + 1,
      startedAt: now,
      revealAt: now + this.state.config.miningDurationMs,
      winnerId: res.winnerId,
      hash: fakeBlockHash(),
      weights,
      total: res.total,
      roll: res.roll,
    };
    this.state.blocks.push(block);
    this.emit(now, 'block.mined', block);
    return block;
  }
}
