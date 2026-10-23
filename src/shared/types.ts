import type { Difficulty, SessionConfig } from './config.js';
import type { DrawAudit, PrizeAward, PrizeDef } from './draw.js';

export type { Difficulty, SessionConfig, PrizeAward, PrizeDef, DrawAudit };

/** Question formats. Only 'single-choice' is playable today; add formats here. */
export type QuestionType = 'single-choice';

export interface QuestionSource {
  provider: string; // e.g. "Plan B Network / Plan B Academy"
  license: string; // e.g. "CC BY-SA 4.0"
  url?: string;
  author?: string;
  sourceId?: string;
  courseId?: string;
  chapter?: string;
  retrievedAt?: string;
  note?: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correctIndex: number;
  difficulty: Difficulty;
  /** Overrides config.defaultQuestionDurationMs when set. */
  durationMs?: number;
  explanation?: string;
  source?: QuestionSource;
  /** True for demo content that must never be presented as sourced material. */
  demo?: boolean;
}

export interface RoundDef {
  id: string;
  title: string;
  questionIds: string[];
}

export interface ContentPack {
  name: string;
  description?: string;
  questions: Question[];
  rounds: RoundDef[];
}

export type CompetitorKind = 'pool' | 'bitaxe';

/** Visual identity assigned by the server at registration: indexes into the client palettes. */
export interface Avatar {
  shape: number;
  color: number;
}

export interface Competitor {
  id: string;
  kind: CompetitorKind;
  name: string;
  members: string[];
  bitaxeNumber?: number;
  avatar: Avatar;
  /** Secret used by the phone to reconnect to this competitor. Never sent to the board. */
  token: string;
  joinedAt: number;
  connected: boolean;
  lastSeenAt: number;
  removed?: boolean;
}

export interface AnswerRecord {
  optionIndex: number;
  firstAt: number;
  lastAt: number;
  changes: number;
}

export interface GainRecord {
  competitorId: string;
  rank: number;
  tied: boolean;
  bonusPercent: string; // exact decimal text of the Percent
  base: string; // nano
  gain: string; // nano
}

export interface QuestionRun {
  roundIndex: number;
  questionIndex: number;
  questionId: string;
  openedAt: number;
  closesAt: number;
  durationMs: number;
  answers: Record<string, AnswerRecord>;
  closedAt?: number;
  cancelled?: boolean;
  results?: {
    correctIndex: number;
    gains: GainRecord[];
    /** competitorIds that answered wrong (0 gain, no penalty) */
    wrong: string[];
    /** competitorIds that did not answer (0 gain, no penalty) */
    silent: string[];
  };
}

export type RoundStatus = 'pending' | 'running' | 'ended';

export interface RoundState {
  index: number;
  defId: string;
  title: string;
  status: RoundStatus;
  startedAt?: number;
  endedAt?: number;
  /** Chain tip height known when the round started; blocks at or below are history. */
  tipHeightAtStart: number | null;
  /** Current fictitious hashrate per competitor (nano TH/s as string). */
  hashrates: Record<string, string>;
  questionRuns: QuestionRun[];
  currentQuestion: number; // index into def.questionIds, -1 before the first
  blockBonuses: BlockBonusEvent[];
  finalHashrates?: Record<string, string>;
}

export type BlockOrigin = 'real' | 'simulated';

export interface BlockInfo {
  id: string;
  height: number;
  timestamp: number; // unix seconds
  pool?: string;
  txCount?: number;
  origin: BlockOrigin;
  receivedAt: number;
}

export interface BlockBonusEvent {
  blockId: string;
  height: number;
  origin: BlockOrigin;
  roundIndex: number;
  at: number;
  winnerId: string | null;
  reason?: 'no-candidates' | 'zero-total';
  base: 'own' | 'total';
  before?: string;
  bonus?: string;
  after?: string;
  audit: DrawAudit;
}

export interface PrizeSeries {
  id: string;
  createdAt: number;
  scope: 'round' | 'sumOfRounds';
  roundIndexes: number[];
  prizes: PrizeDef[];
  weights: Record<string, string>;
  awards: PrizeAward[];
}

export interface BlockFeedStatus {
  mode: 'real' | 'simulated' | 'off';
  connected: boolean;
  lastMessageAt?: number;
  tipHeight: number | null;
  lastError?: string;
  endpoint?: string;
}

export type Phase = 'lobby' | 'round-ready' | 'question-open' | 'question-closed' | 'round-ended' | 'finished';

export interface GameEvent {
  seq: number;
  at: number;
  type: string;
  payload: unknown;
}

export interface SessionState {
  code: string;
  createdAt: number;
  config: SessionConfig;
  contentName: string;
  questions: Record<string, Question>;
  rounds: RoundDef[];
  roundStates: RoundState[];
  currentRoundIndex: number;
  phase: Phase;
  competitors: Record<string, Competitor>;
  nextBitaxeNumber: number;
  nextAvatarIndex: number;
  processedBlockIds: string[];
  recentBlocks: BlockInfo[];
  prizesDraft: PrizeDef[];
  prizeSeries: PrizeSeries[];
  blockFeed: BlockFeedStatus;
  eventSeq: number;
  /** Rolling tail of the audit log kept in memory (full log on disk). */
  recentEvents: GameEvent[];
}
