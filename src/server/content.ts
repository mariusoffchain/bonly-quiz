import fs from 'node:fs';
import path from 'node:path';
import type { ContentPack, Question } from '../shared/types.js';

export interface PackInfo {
  name: string;
  description?: string;
  questions: number;
  rounds: number;
  file: string;
}

const DIFFS = new Set(['easy', 'intermediate', 'hard']);

export function validatePack(pack: unknown, file = 'inline'): ContentPack {
  const p = pack as Partial<ContentPack>;
  if (!p || typeof p.name !== 'string' || !Array.isArray(p.questions) || !Array.isArray(p.rounds)) {
    throw new Error(`${file}: a content pack needs name, questions[] and rounds[]`);
  }
  const ids = new Set<string>();
  for (const q of p.questions as Question[]) {
    if (!q.id || ids.has(q.id)) throw new Error(`${file}: missing or duplicate question id ${q.id}`);
    ids.add(q.id);
    if (q.type !== 'single-choice') throw new Error(`${file}: unsupported question type ${q.type} (${q.id})`);
    if (typeof q.text !== 'string' || !q.text.trim()) throw new Error(`${file}: question ${q.id} has no text`);
    if (!Array.isArray(q.options) || q.options.length < 2) throw new Error(`${file}: question ${q.id} needs >= 2 options`);
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`${file}: question ${q.id} has an invalid correctIndex`);
    }
    if (!DIFFS.has(q.difficulty)) throw new Error(`${file}: question ${q.id} has an invalid difficulty`);
    if (q.durationMs !== undefined && !(q.durationMs >= 1000)) throw new Error(`${file}: question ${q.id} duration < 1000 ms`);
  }
  for (const r of p.rounds) {
    if (!r.id || !r.title || !Array.isArray(r.questionIds)) throw new Error(`${file}: round needs id, title, questionIds[]`);
    for (const qid of r.questionIds) if (!ids.has(qid)) throw new Error(`${file}: round ${r.id} references unknown question ${qid}`);
  }
  return p as ContentPack;
}

export class ContentLibrary {
  constructor(public readonly dir: string) {}

  list(): PackInfo[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: PackInfo[] = [];
    for (const f of fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const pack = this.load(f);
        out.push({ name: pack.name, description: pack.description, questions: pack.questions.length, rounds: pack.rounds.length, file: f });
      } catch (e) {
        console.warn('[content] skipping', f, (e as Error).message);
      }
    }
    return out;
  }

  load(file: string): ContentPack {
    const p = path.join(this.dir, path.basename(file));
    return validatePack(JSON.parse(fs.readFileSync(p, 'utf8')), file);
  }

  loadByName(name: string): ContentPack {
    const info = this.list().find((p) => p.name === name || p.file === name);
    if (!info) throw new Error(`content pack not found: ${name}`);
    return this.load(info.file);
  }

  /** Default pack: first file whose name starts with "planb", else the first pack. */
  defaultPack(): ContentPack | null {
    const all = this.list();
    const pick = all.find((p) => p.file.startsWith('planb')) ?? all[0];
    return pick ? this.load(pick.file) : null;
  }
}
