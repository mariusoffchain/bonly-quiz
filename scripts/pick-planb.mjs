#!/usr/bin/env node
// Builds the B-only pack from a hand-picked list of Plan B Network quiz questions
// (github.com/PlanB-Network/bitcoin-educational-content, CC BY-SA 4.0). Each question
// keeps its attribution; answers rewritten here (traps and a joke answer) or a
// replaced explanation are flagged in the source note. The answer order is shuffled
// (deterministically) and markdown links are reduced to their text.
//
// Usage: node scripts/pick-planb.mjs [--repo <path>] [--out content/questions/bonly-21-fr.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

/**
 * The 3 parts of the game, in play order. Each pick names a Plan B quiz (course/folder);
 * `as` overrides Plan B's difficulty, `text` and `explanation` replace Plan B's wording.
 * `options` replaces Plan B's answers: the right one first, then two traps, then (in most
 * questions) a joke answer. In a part with `trollOnD`, the last option always shows as D
 * and only A, B and C are shuffled: a running gag for the easy part.
 * Part 1 is meant for beginners: someone new to Bitcoin should know at least 4 of 7.
 */
const PARTS = [
  {
    title: 'Les bases',
    subtitle: 'Ce que tout le monde devrait savoir',
    trollOnD: true,
    picks: [
      {
        q: 'min304/023',
        options: ['Environ 21 millions', 'Environ 20 millions', 'Environ 100 millions', "Illimité, comme l'euro"],
        explanation: "Bitcoin a un plafond fixe de 21 millions d'unités. Près de 20 millions ont déjà été créés : c'est le piège.",
      },
      { q: 'btc101/054', options: ['Le halving', 'Le doubling', 'Le burning', 'Le Black Friday'] },
      { q: 'min101/054', options: ['La blockchain', 'Le wallet', 'La mempool', 'Un fichier Excel chez Satoshi'] },
      { q: 'btc101/156', options: ['10 minutes', '1 minute', '1 heure', 'Une fois par semaine, le dimanche'] },
      {
        q: 'btc101/203',
        options: ['El Salvador', 'États-Unis', 'Argentine', 'Le Groland'],
        explanation:
          "El Salvador a fait du bitcoin une monnaie légale en septembre 2021, une première mondiale. Début 2025, le pays est revenu en partie sur cette loi : les commerçants ne sont plus obligés de l'accepter.",
      },
      {
        q: 'btc202/008',
        options: ['Garder les clés privées', 'Stocker les bitcoins eux-mêmes', 'Miner de nouveaux bitcoins', 'Ranger sa carte bleue'],
        explanation:
          'Un portefeuille garde les clés privées qui permettent de dépenser les bitcoins. Les bitcoins, eux, ne quittent jamais la blockchain.',
      },
      {
        q: 'min101/044',
        options: ['Le processeur (CPU)', 'La carte graphique (GPU)', 'Des machines spécialisées (ASIC)', 'Une calculatrice Casio'],
      },
    ],
  },
  {
    title: 'On creuse',
    subtitle: 'Histoire, minage et Lightning',
    picks: [
      {
        q: 'btc101/059',
        text: 'En quelle année la création de bitcoins devrait-elle s’arrêter ?',
        options: ['2140', '2104', '2041', 'Quand la France aura remboursé sa dette'],
      },
      {
        q: 'btc102/029',
        options: ['Bitmain', 'Foundry USA', 'Nvidia', 'Thermomix'],
        explanation:
          'Bitmain fabrique les Antminer, les machines de minage les plus répandues. Foundry USA est un pool de minage, et Nvidia fait des cartes graphiques.',
      },
      {
        q: 'his201/023',
        as: 'intermediate',
        options: ['La Cryptography mailing list', 'Le forum BitcoinTalk', 'Reddit', 'Sur son Skyblog'],
        explanation:
          "Satoshi l'a envoyé le 31 octobre 2008 sur la Cryptography mailing list, héritière de la liste des cypherpunks. Le forum BitcoinTalk n'existait pas encore : il a ouvert fin 2009.",
      },
      {
        q: 'his201/012',
        as: 'intermediate',
        options: [
          'Le problème des généraux byzantins',
          'Le dilemme du prisonnier',
          'Le problème du voyageur de commerce',
          'Le problème des réunions de copropriété',
        ],
      },
      {
        q: 'his201/040',
        text: 'Combien de bitcoins Satoshi Nakamoto aurait-il minés au total, environ ?',
        options: ['Environ 1,1 million', 'Environ 110 000', 'Environ 11 000', 'Juste de quoi payer deux pizzas'],
        explanation:
          "C'est une estimation : en 2013, Sergio Demian Lerner a repéré dans les premiers blocs une signature attribuée à Satoshi, le « Patoshi pattern ». Une étude de Whale Alert (2020) arrive à 1 122 693 bitcoins. Satoshi a cessé de miner en mai 2010.",
      },
      {
        q: 'btc101/214',
        options: ["L'ouverture d'un canal", 'Un paiement dans le canal', 'Le routage multi-sauts', "Le partage de l'addition au resto"],
      },
      {
        q: 'cyp201/016',
        options: ['Schnorr', 'ECDSA', 'Shor', 'Le tampon de la mairie'],
        explanation:
          "Les signatures de Schnorr sont arrivées en novembre 2021 avec Taproot. Avant, Bitcoin n'utilisait qu'ECDSA. Shor, c'est l'algorithme quantique qui menacerait justement ces signatures.",
      },
    ],
  },
  {
    title: 'Au fond du terrier',
    subtitle: 'Les questions qui piquent',
    picks: [
      {
        q: 'his201/033',
        options: ['James Howells', 'Hal Finney', 'Luke Dashjr', 'Aurore Lalucq'],
        explanation:
          "James Howells, un ingénieur britannique, avait miné 8 000 bitcoins en 2009. Son disque dur est parti à la décharge en 2013. Luke Dashjr a lui aussi perdu ses bitcoins, mais dans un piratage, fin 2022.",
      },
      {
        q: 'btc102/033',
        options: ['Joseph Poon et Thaddeus Dryja', 'Pieter Wuille et Gregory Maxwell', 'Adam Back et Hal Finney', 'Laurel et Hardy'],
        explanation:
          'Joseph Poon et Thaddeus Dryja ont publié le livre blanc du Lightning Network en 2015, puis sa version de référence en janvier 2016, pour faire passer Bitcoin à l’échelle.',
      },
      {
        q: 'his201/014',
        options: ['Cynthia Dwork et Moni Naor', 'Adam Back', 'Hal Finney', 'Karl Marx'],
        explanation:
          "Cynthia Dwork et Moni Naor ont décrit le concept en 1992. Adam Back l'a repris en 1997 pour Hashcash, et Hal Finney en 2004 pour RPOW.",
      },
      {
        q: 'min101/010',
        options: ['32 bits', '64 bits', '256 bits', '69 bits'],
        explanation: "Le nonce est un champ de 32 bits dans l'en-tête du bloc. Les 256 bits, c'est la taille du hash du bloc.",
      },
      {
        q: 'btc101/116',
        text: 'Dans quel bloc se trouve la première transaction entre deux personnes (Satoshi → Hal Finney) ?',
        options: ['Bloc 170', 'Bloc 0', 'Bloc 9', 'Bloc 420'],
        explanation:
          "Le 12 janvier 2009, Satoshi envoie 10 BTC à Hal Finney : c'est la transaction du bloc 170. Ces bitcoins venaient de la récompense du bloc 9. Ceux du bloc 0, le bloc genesis, ne peuvent pas être dépensés.",
      },
      {
        q: 'his201/054', // value overflow incident (Plan B : qui a repéré le bloc)
        as: 'hard',
        text: 'Combien de fois une faille de Bitcoin a-t-elle été exploitée pour créer des bitcoins à partir de rien ?',
        options: ['Une fois', 'Jamais', 'Deux fois', '21 fois'],
        explanation:
          "Une seule fois : le 15 août 2010, le « value overflow bug » a créé plus de 184 milliards de bitcoins dans le bloc 74 638. Satoshi a publié un correctif en quelques heures et la chaîne a repris sans cette transaction. Une faille du même type, découverte en 2018, a été corrigée avant d'être exploitée.",
      },
      {
        q: 'his201/030',
        options: ['5 avril 1975', '5 avril 1971', '5 avril 1968', '5 avril 1989'],
        explanation:
          "Cette date fait référence à l'interdiction pour les Américains de détenir de l'or : le 5 avril 1933 est le jour où elle a été instaurée (Executive Order 6102), et 1975 l'année où elle a été abrogée. 1971, c'est la fin des accords de Bretton Woods.",
      },
    ],
  },
];
const PICKS = PARTS.flatMap((p) => p.picks.map((pick) => ({ ...pick, trollOnD: p.trollOnD })));

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
const SALT = Number(process.env.SALT ?? 417);

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
const questions = PICKS.map(({ q, as, text, options: own, trollOnD, explanation }) => {
  const [course, dir] = q.split('/');
  const base = path.join(repo, 'courses', course, 'quizz', dir);
  const meta = YAML.parse(fs.readFileSync(path.join(base, 'question.yml'), 'utf8'));
  const t = YAML.parse(fs.readFileSync(path.join(base, `${lang}.yml`), 'utf8'));
  const all = own ?? [t.answer, ...t.wrong_answers].map((x) => String(x).trim());
  const answer = all[0];
  const seed = hash(SALT + meta.id);
  const options = trollOnD ? [...shuffle(all.slice(0, -1), seed), all.at(-1)] : shuffle(all, seed);
  const rewritten = [text && 'question', own && 'réponses', explanation && 'explication'].filter(Boolean);
  return {
    id: `planb-${course}-${dir}`,
    type: 'single-choice',
    text: text ?? plain(t.question),
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
      note: `repo commit ${commit.slice(0, 12)}, lesson quiz, ${lang}${as ? `, difficulté Plan B : ${meta.difficulty}` : ''}${rewritten.length ? `, réécrit ici : ${rewritten.join(', ')}` : ''}`,
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
