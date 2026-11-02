/**
 * Simulates thousands of games with fictitious players to see how the scoring
 * settings shape everyone's chances in the final draw.
 *
 *   npm run simulate              50 players, 4000 games per profile
 *   npm run simulate -- 80 2000   80 players, 2000 games
 *
 * Player model (an assumption, not data): each player has a level drawn from a
 * normal law; the chance of a right answer follows a logistic curve of
 * level - difficulty, with a 25 % floor (4 options, guessing). Better players
 * also answer a little faster. 3 % of answers are missed. The speed bonus goes
 * to the first correct answers, as in the game.
 */
import { DEFAULT_CONFIG, PRESETS, type Difficulty, type ScoringSettings } from '../src/shared/config.js';
import { drawWinner } from '../src/shared/draw.js';
import { round1, scoreAnswer, speedRanks } from '../src/shared/scoring.js';
import type { Answer } from '../src/shared/types.js';

const PLAYERS = Number(process.argv[2] ?? 50);
const GAMES = Number(process.argv[3] ?? 4000);
const DURATION = 20_000;

/** Difficulty on the players' level scale: about 85 %, 62 %, 43 % and 33 % of right answers. */
const HARDNESS: Record<Difficulty, number> = { easy: -1.2, intermediate: 0, hard: 1, expert: 1.8 };

const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const mathRng = (max: number) => Math.floor(Math.random() * max);

const mix = (easy: number, intermediate: number, hard: number, expert = 0): Difficulty[] => [
  ...Array<Difficulty>(easy).fill('easy'),
  ...Array<Difficulty>(intermediate).fill('intermediate'),
  ...Array<Difficulty>(hard).fill('hard'),
  ...Array<Difficulty>(expert).fill('expert'),
];

function playGame(s: ScoringSettings, questions: Difficulty[], spread: number): number[] {
  const level = Array.from({ length: PLAYERS }, () => spread * randn());
  const pace = Array.from({ length: PLAYERS }, () => Math.exp(0.3 * randn()));
  const hashrate = new Array<number>(PLAYERS).fill(s.startHashrateThs);
  const streak = new Array<number>(PLAYERS).fill(0);
  for (const difficulty of questions) {
    const answers: Record<string, Answer> = {};
    for (let i = 0; i < PLAYERS; i++) {
      const t = 0.3 * Math.exp(-0.25 * level[i]) * pace[i] * Math.exp(0.35 * randn());
      if (Math.random() < 0.03 || t >= 1) continue;
      const right = Math.random() < 0.25 + 0.75 * sigmoid(1.7 * (level[i] - HARDNESS[difficulty]));
      answers[i] = { option: right ? 0 : 1, at: t * DURATION };
    }
    // Same steps as Game.closeQuestion: rank the correct answers, then score everyone.
    const ranks = speedRanks(answers, 0);
    for (let i = 0; i < PLAYERS; i++) {
      const r = scoreAnswer({ difficulty, correctIndex: 0 }, answers[i], { openedAt: 0 }, streak[i], s, ranks.get(String(i)));
      hashrate[i] = round1(hashrate[i] + r.gain);
      streak[i] = r.streak;
    }
  }
  return hashrate;
}

function drawPodium(hashrate: number[], places: number): number[] {
  const left = hashrate.map((h, i) => ({ id: String(i), hashrate: h }));
  const out: number[] = [];
  for (let k = 0; k < places; k++) {
    const { winnerId } = drawWinner(left, mathRng);
    if (winnerId === null) break;
    out.push(Number(winnerId));
    left[Number(winnerId)].hashrate = 0;
  }
  return out;
}

interface Row {
  name: string;
  scoring: ScoringSettings;
  questions?: Difficulty[];
  spread?: number;
}

function evaluate({ scoring, questions = mix(7, 7, 7), spread = 1 }: Row) {
  const mid = Math.floor(PLAYERS / 2);
  const acc = { first: 0, tenth: 0, median: 0, last: 0, leaderOnPodium: 0, lowerHalfOnPodium: 0, ratio: 0 };
  for (let g = 0; g < GAMES; g++) {
    const hr = playGame(scoring, questions, spread);
    const total = hr.reduce((a, b) => a + b, 0);
    const order = hr.map((h, i) => ({ h, i })).sort((a, b) => b.h - a.h);
    const rank = new Map(order.map((o, r) => [o.i, r]));
    acc.first += order[0].h / total;
    acc.tenth += order[Math.min(9, PLAYERS - 1)].h / total;
    acc.median += order[mid].h / total;
    acc.last += order[PLAYERS - 1].h / total;
    acc.ratio += order[0].h / Math.max(1, order[mid].h);
    const podium = drawPodium(hr, DEFAULT_CONFIG.podiumSize);
    if (podium.includes(order[0].i)) acc.leaderOnPodium++;
    if (podium.some((i) => rank.get(i)! >= mid)) acc.lowerHalfOnPodium++;
  }
  const pct = (x: number) => `${((100 * x) / GAMES).toFixed(1).replace('.', ',')} %`;
  return [pct(acc.first), pct(acc.tenth), pct(acc.median), pct(acc.last), pct(acc.leaderOnPodium), pct(acc.lowerHalfOnPodium), `x${(acc.ratio / GAMES).toFixed(1).replace('.', ',')}`];
}

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.scoring;
const eq = preset('equilibre');
const rows: Row[] = [
  ...PRESETS.map((p) => ({ name: `**${p.name}**`, scoring: p.scoring })),
  { name: 'Équilibré, rapidité top 10 (+10 % à +1 %)', scoring: { ...eq, speedBonusRanks: preset('competitif').speedBonusRanks } },
  { name: 'Équilibré, sans bonus de rapidité', scoring: { ...eq, speedBonusRanks: [] } },
  { name: 'Ancien bonus : top 3 à +50 / +30 / +10 %', scoring: { ...eq, speedBonusRanks: [0.5, 0.3, 0.1] } },
  { name: 'Sans aucun bonus', scoring: { ...eq, speedBonusRanks: [], streakBonusStep: 0, streakBonusMax: 0 } },
  { name: 'Équilibré, base 100 (100/200/300)', scoring: { ...eq, baseGainThs: { easy: 100, intermediate: 200, hard: 300, expert: 500 } } },
  { name: 'Écart x10 (10/30/100)', scoring: { ...eq, baseGainThs: { easy: 10, intermediate: 30, hard: 100, expert: 150 } } },
  { name: 'Équilibré, 6/6/6 + 3 expert', scoring: eq, questions: mix(6, 6, 6, 3) },
  { name: 'Équilibré, public homogène', scoring: eq, spread: 0.5 },
  { name: 'Équilibré, public très hétérogène', scoring: eq, spread: 1.6 },
];

console.log(`${PLAYERS} joueurs, ${GAMES} parties simulées par ligne, 21 questions (7 faciles, 7 moyennes, 7 difficiles sauf mention).`);
console.log(`Chances égales pour tous : ${(100 / PLAYERS).toFixed(1).replace('.', ',')} % chacun pour la 1re place.\n`);
console.log('| Réglage | 1re place : chances du 1er | du 10e | du joueur médian | du dernier | 1er du classement sur le podium | au moins un joueur de la moitié basse sur le podium | hashrate 1er / médian |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${evaluate(r).join(' | ')} |`);
