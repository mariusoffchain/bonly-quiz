#!/usr/bin/env node
// Builds the B-only pack from a hand-picked list of Plan B Network quiz questions
// (github.com/PlanB-Network/bitcoin-educational-content, CC BY-SA 4.0). Question,
// answers and explanation are copied verbatim with their attribution; only the
// answer order is shuffled (deterministically) and markdown links are reduced to
// their text, since the big screen cannot follow them.
//
// Usage: node scripts/pick-planb.mjs [--repo <path>] [--out content/questions/bonly-21-fr.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

/**
 * The 3 parts of the game, in play order: course/quiz folder, `as` overrides Plan B's
 * difficulty, `explanation` replaces Plan B's (outdated or inaccurate text).
 * Part 1 is meant for beginners: someone new to Bitcoin should know at least 4 of 7.
 */
const PARTS = [
  {
    title: 'Les bases',
    subtitle: 'Ce que tout le monde devrait savoir',
    picks: [
      { q: 'min304/023' }, // 21 millions
      { q: 'btc101/054' }, // le halving
      { q: 'min101/054' }, // la blockchain
      { q: 'btc101/156' }, // 10 minutes
      {
        q: 'btc101/203', // El Salvador
        explanation:
          "El Salvador a fait du bitcoin une monnaie légale en septembre 2021, une première mondiale. Début 2025, le pays est revenu en partie sur cette loi : les commerçants ne sont plus obligés de l'accepter.",
      },
      { q: 'btc202/008' }, // rôle d'un portefeuille
      { q: 'min101/044' }, // CPU au début
    ],
  },
  {
    title: 'Pour aller plus loin',
    subtitle: 'Histoire, minage et Lightning',
    picks: [
      { q: 'btc101/059' }, // 2140
      { q: 'btc102/029' }, // Bitmain
      { q: 'his201/023', as: 'intermediate' }, // livre blanc sur la Cryptography mailing list
      { q: 'his201/012', as: 'intermediate' }, // généraux byzantins
      { q: 'his201/040' }, // bitcoins minés par Satoshi
      { q: 'btc101/214' }, // ouverture de canal Lightning onchain
      { q: 'cyp201/016' }, // Schnorr avec Taproot
    ],
  },
  {
    title: 'Pour les experts',
    subtitle: 'Les questions qui piquent',
    picks: [
      { q: 'his201/033' }, // James Howells
      {
        q: 'btc102/033', // inventeurs de Lightning
        explanation:
          'Joseph Poon et Thaddeus Dryja ont publié le livre blanc du Lightning Network en 2015, puis sa version de référence en janvier 2016, pour faire passer Bitcoin à l’échelle.',
      },
      { q: 'his201/014' }, // Dwork et Naor, piège avec Adam Back
      { q: 'min101/010' }, // nonce de 32 bits
      { q: 'btc101/116' }, // bloc 170, la 1re transaction (Satoshi à Hal Finney)
      { q: 'btc202/076' }, // mempool de 300 Mo par défaut
      { q: 'his201/030' }, // date de naissance de Satoshi : 5 avril 1975
    ],
  },
];
const PICKS = PARTS.flatMap((p) => p.picks);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const repo = args.repo ?? process.env.PLANB_CONTENT_DIR ?? path.join(os.homedir(), 'Documents/bitcoin-educational-content');
const out = args.out ?? 'content/questions/bonly-21-fr.json';
const lang = 'fr';

let commit = 'unknown';
try {
  const head = fs.readFileSync(path.join(repo, '.git/HEAD'), 'utf8').trim();
  commit = head.startsWith('ref:') ? fs.readFileSync(path.join(repo, '.git', head.slice(5)), 'utf8').trim() : head;
} catch {}

/** Chosen so that the right answer lands on A, B, C and D 5 or 6 times each, never 3 times in a row. */
const SALT = Number(process.env.SALT ?? 248);

const hash = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const shuffle = (arr, seed) => {
  const a = [...arr];
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const j = (x >>> 16) % (i + 1); // high bits: the low bits of this generator repeat
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const plain = (s) => String(s ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();

/** Chapter title for a chapterId, from the course markdown ("## Title" then <chapterId>). */
const chapters = new Map();
function chapterTitle(course, chapterId) {
  if (!chapters.has(course)) {
    const map = new Map();
    let title = '';
    for (const line of fs.readFileSync(path.join(repo, 'courses', course, `${lang}.md`), 'utf8').split('\n')) {
      if (/^#{1,3} /.test(line)) title = line.replace(/^#+ /, '').trim();
      const m = /<chapterId>([0-9a-f-]+)<\/chapterId>/.exec(line);
      if (m) map.set(m[1], title);
    }
    chapters.set(course, map);
  }
  return chapters.get(course).get(chapterId);
}

const today = new Date().toISOString().slice(0, 10);
const questions = PICKS.map(({ q, as, explanation }) => {
  const [course, dir] = q.split('/');
  const base = path.join(repo, 'courses', course, 'quizz', dir);
  const meta = YAML.parse(fs.readFileSync(path.join(base, 'question.yml'), 'utf8'));
  const t = YAML.parse(fs.readFileSync(path.join(base, `${lang}.yml`), 'utf8'));
  const answer = String(t.answer).trim();
  const options = shuffle([answer, ...t.wrong_answers.map((w) => String(w).trim())], hash(SALT + meta.id));
  return {
    id: `planb-${course}-${dir}`,
    type: 'single-choice',
    text: plain(t.question),
    options,
    correctIndex: options.indexOf(answer),
    difficulty: as ?? meta.difficulty,
    explanation: explanation ?? (plain(t.explanation) || undefined),
    source: {
      provider: 'Plan B Network (planb.academy)',
      license: 'CC BY-SA 4.0',
      url: `https://github.com/PlanB-Network/bitcoin-educational-content/tree/main/courses/${course}/quizz/${dir}`,
      author: meta.author,
      sourceId: meta.id,
      courseId: course,
      chapter: chapterTitle(course, meta.chapterId),
      retrievedAt: today,
      note: `repo commit ${commit.slice(0, 12)}, lesson quiz, ${lang}${as ? `, difficulté Plan B : ${meta.difficulty}` : ''}${explanation ? ', explication réécrite' : ''}`,
    },
  };
});

const pack = {
  name: 'B-only 2026 · 21 questions',
  description: `21 questions choisies dans ${new Set(PICKS.map((p) => p.q.split('/')[0])).size} cours de Plan B Network, en 3 parties de difficulté croissante (7 + 7 + 7). Source : Plan B Network, CC BY-SA 4.0.`,
  parts: PARTS.map((p) => ({ title: p.title, subtitle: p.subtitle, questions: p.picks.length })),
  questions,
};
fs.writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
const count = questions.reduce((m, q) => ((m[q.difficulty] = (m[q.difficulty] ?? 0) + 1), m), {});
const letters = questions.reduce((m, q) => ((m['ABCD'[q.correctIndex]] = (m['ABCD'[q.correctIndex]] ?? 0) + 1), m), {});
console.log(`${out}: ${questions.length} questions`, count, 'bonnes réponses', letters);
