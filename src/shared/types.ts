import type { Difficulty, SessionConfig } from './config.js';

export type { Difficulty, SessionConfig };

export interface QuestionSource {
  provider: string;
  license: string;
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
  type: 'single-choice';
  text: string;
  options: string[];
  correctIndex: number;
  difficulty: Difficulty;
  /** Overrides config.questionDurationMs when set. */
  durationMs?: number;
  explanation?: string;
  source?: QuestionSource;
  /** Content written for rehearsals only. */
  demo?: boolean;
}

export interface ContentPack {
  name: string;
  description?: string;
  questions: Question[];
}

export interface Player {
  id: string;
  name: string;
  /** Palette index assigned at registration. */
  color: number;
  /** Secret kept by the phone to reconnect. Never sent to the board. */
  token: string;
  joinedAt: number;
  connected: boolean;
  removed?: boolean;
  /** Fictitious hashrate in TH, the weight of the final draw. */
  hashrate: number;
  /** Consecutive correct answers up to the last closed question. */
  streak: number;
  bestStreak: number;
  correctCount: number;
}

export interface Answer {
  option: number;
  /** Server receive time. */
  at: number;
}

/** What a player earned on one question. */
export interface QuestionResult {
  option: number | null;
  correct: boolean;
  /** Time taken to answer, ms. */
  ms?: number;
  base: number;
  speedBonus: number;
  /** 1 = first correct answer received, when it earned a speed bonus. */
  speedRank?: number;
  streakBonus: number;
  /** Share of the hashrate already held, added by reinvestment. */
  reinvest: number;
  gain: number;
  /** Streak after this question. */
  streak: number;
}

export interface QuestionRun {
  index: number;
  questionId: string;
  openedAt: number;
  closesAt: number;
  durationMs: number;
  answers: Record<string, Answer>;
  closedAt?: number;
  /** Closed without awarding anything (host mistake); streaks are left untouched. */
  cancelled?: boolean;
  results?: Record<string, QuestionResult>;
}

export interface BlockDraw {
  /** 1-based block number in this game, which is also the podium place. */
  n: number;
  startedAt: number;
  /** The winner is kept secret until this time. */
  revealAt: number;
  winnerId: string | null;
  /** Decorative hash displayed for the found block. */
  hash: string;
  /** Hashrate of every candidate at draw time (TH). */
  weights: { id: string; hashrate: number }[];
  total: number;
  /** Random integer in [0, total) that selected the winner. */
  roll: number;
}

export type Phase = 'lobby' | 'question' | 'reveal' | 'final';

export interface GameEvent {
  seq: number;
  at: number;
  type: string;
  payload: unknown;
}

export interface SessionState {
  version: 2;
  code: string;
  createdAt: number;
  config: SessionConfig;
  packName: string;
  /** The questions of the pack, in pack order. */
  questions: Question[];
  phase: Phase;
  /** Index of the current question run, -1 before the first. */
  current: number;
  runs: QuestionRun[];
  players: Record<string, Player>;
  nextColor: number;
  blocks: BlockDraw[];
  eventSeq: number;
}
