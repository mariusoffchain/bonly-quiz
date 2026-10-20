#!/usr/bin/env node
// Builds a content pack from the open-source Plan B Network repository
// (github.com/PlanB-Network/bitcoin-educational-content, CC BY-SA 4.0), the same
// material served by planb.academy. Nothing is invented: every question, answer and
// explanation is copied verbatim with its attribution.
//
// Usage: node scripts/import-planb.mjs [--repo <path>] [--course btc101] [--lang fr]
//        [--parts 5] [--per-part 10] [--mix 4,3,3] [--out content/questions/planb-btc101-fr.json]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
const repo = args.repo ?? process.env.PLANB_CONTENT_DIR ?? path.join(os.homedir(), 'Documents/bitcoin-educational-content');
const course = args.course ?? 'btc101';
const lang = args.lang ?? 'fr';
const partsWanted = Number(args.parts ?? 5);
const perPart = Number(args['per-part'] ?? 10);
const mix = (args.mix ?? '4,3,3').split(',').map(Number); // easy, intermediate, hard
const out = args.out ?? `content/questions/planb-${course}-${lang}.json`;

const courseDir = path.join(repo, 'courses', course);
if (!fs.existsSync(courseDir)) {
  console.error(`course directory not found: ${courseDir}\nclone https://github.com/PlanB-Network/bitcoin-educational-content or pass --repo`);
  process.exit(1);
}
let repoCommit = 'unknown';
try {
  const head = fs.readFileSync(path.join(repo, '.git/HEAD'), 'utf8').trim();
  repoCommit = head.startsWith('ref:') ? fs.readFileSync(path.join(repo, '.git', head.slice(5)), 'utf8').trim() : head;
} catch {}

// ---- chapters (parts) from the course markdown: "# Part title" then "<chapterId>" tags
const md = fs.readFileSync(path.join(courseDir, `${lang}.md`), 'utf8').split('\n');
const courseTitle = (md.find((l) => l.startsWith('# ')) ?? `# ${course}`).slice(2).trim();
const parts = []; // { title, chapterIds[] }
let current = null;
for (const line of md) {
  if (line.startsWith('# ')) {
    current = { title: line.slice(2).trim(), chapterIds: [] };
    parts.push(current);
  }
  const m = /<chapterId>([0-9a-f-]+)<\/chapterId>/.exec(line);
  if (m && current) current.chapterIds.push(m[1]);
}
// Drop the title heading and parts without chapters (e.g. "Section finale").
const contentParts = parts.filter((p) => p.chapterIds.length > 0);

// ---- quizzes
const quizDir = path.join(courseDir, 'quizz');
const quizzes = [];
for (const d of fs.readdirSync(quizDir).sort()) {
  const metaPath = path.join(quizDir, d, 'question.yml');
  const langPath = path.join(quizDir, d, `${lang}.yml`);
  if (!fs.existsSync(metaPath) || !fs.existsSync(langPath)) continue;
  try {
    const meta = YAML.parse(fs.readFileSync(metaPath, 'utf8'));
    const q = YAML.parse(fs.readFileSync(langPath, 'utf8'));
    if (!q?.question || !q?.answer || !Array.isArray(q.wrong_answers) || q.wrong_answers.length < 1) continue;
    quizzes.push({ dir: d, meta, q });
  } catch (e) {
    console.warn(`skip ${d}: ${e.message}`);
  }
}

const hash = (s) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};
const seededShuffle = (arr, seed) => {
  const a = [...arr];
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const questions = [];
const rounds = [];
const report = [];
const retrievedAt = new Date().toISOString().slice(0, 10);
for (let pi = 0; pi < Math.min(partsWanted, contentParts.length); pi++) {
  const part = contentParts[pi];
  const pool = quizzes.filter((z) => part.chapterIds.includes(z.meta.chapterId));
  const byDiff = { easy: [], intermediate: [], hard: [] };
  for (const z of pool) (byDiff[z.meta.difficulty] ?? byDiff.easy).push(z);
  // Prefer reviewed questions, keep repository order for reproducibility.
  for (const k of Object.keys(byDiff)) byDiff[k].sort((a, b) => Number(b.q.reviewed === true) - Number(a.q.reviewed === true) || a.dir.localeCompare(b.dir));
  const picked = [];
  const want = { easy: mix[0], intermediate: mix[1], hard: mix[2] };
  for (const k of ['easy', 'intermediate', 'hard']) picked.push(...byDiff[k].splice(0, want[k]));
  // Fill up to perPart with whatever remains, hardest first to keep the game interesting.
  for (const k of ['hard', 'intermediate', 'easy']) while (picked.length < perPart && byDiff[k].length) picked.push(byDiff[k].shift());
  const ids = [];
  for (const z of picked) {
    const options = seededShuffle([z.q.answer, ...z.q.wrong_answers].map(String), hash(z.meta.id));
    const id = `planb-${course}-${z.dir}`;
    questions.push({
      id,
      type: 'single-choice',
      text: String(z.q.question).trim(),
      options,
      correctIndex: options.indexOf(String(z.q.answer)),
      difficulty: z.meta.difficulty,
      explanation: z.q.explanation ? String(z.q.explanation).trim() : undefined,
      source: {
        provider: 'Plan B Network (planb.academy)',
        license: 'CC BY-SA 4.0',
        url: `https://github.com/PlanB-Network/bitcoin-educational-content/tree/main/courses/${course}/quizz/${z.dir}`,
        author: z.meta.author,
        sourceId: z.meta.id,
        courseId: course,
        chapter: part.title,
        retrievedAt,
        note: `repo commit ${repoCommit.slice(0, 12)}, lesson quiz, ${lang}`,
      },
    });
    ids.push(id);
  }
  rounds.push({ id: `round-${pi + 1}`, title: `Manche ${pi + 1}, ${part.title}`, questionIds: ids });
  report.push({ part: part.title, available: pool.length, picked: picked.length, mix: picked.reduce((m, z) => ((m[z.meta.difficulty] = (m[z.meta.difficulty] ?? 0) + 1), m), {}) });
}

const pack = {
  name: `Plan B ${course.toUpperCase()} ${lang} (provisoire)`,
  description: `Questions des quiz de fin de leçon du cours « ${courseTitle} » (${course}), 5 premières sections, 10 questions chacune. Matériau provisoire, à remplacer pour B-only. Source : Plan B Network, CC BY-SA 4.0, dépôt commit ${repoCommit.slice(0, 12)}, importé le ${retrievedAt}.`,
  attribution: {
    provider: 'Plan B Network / Plan B Academy',
    repository: 'https://github.com/PlanB-Network/bitcoin-educational-content',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    course,
    courseTitle,
    repoCommit,
    importedAt: retrievedAt,
  },
  questions,
  rounds,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
console.log(`wrote ${out}: ${questions.length} questions in ${rounds.length} rounds from "${courseTitle}"`);
console.table(report);
