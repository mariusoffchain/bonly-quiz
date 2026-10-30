import fs from 'node:fs';
import path from 'node:path';
import { DIFFICULTIES } from '../shared/config.js';
import type { ContentPack, Question } from '../shared/types.js';
import type { PackInfo } from '../shared/views.js';

const DIFFS = new Set<string>(DIFFICULTIES);

/** Checks a pack. Questions are played in file order; a legacy `rounds` field is ignored. */
export function validatePack(pack: unknown, file = 'inline'): ContentPack {
  const p = pack as Partial<ContentPack>;
  if (!p || typeof p.name !== 'string' || !Array.isArray(p.questions) || p.questions.length === 0) {
    throw new Error(`${file}: a content pack needs a name and at least 1 question`);
  }
  const ids = new Set<string>();
  for (const q of p.questions as Question[]) {
    if (!q.id || ids.has(q.id)) throw new Error(`${file}: missing or duplicate question id ${q.id}`);
    ids.add(q.id);
    if (q.type !== 'single-choice') throw new Error(`${file}: unsupported question type ${q.type} (${q.id})`);
    if (typeof q.text !== 'string' || !q.text.trim()) throw new Error(`${file}: question ${q.id} has no text`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) throw new Error(`${file}: question ${q.id} needs 2 to 4 options`);
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(`${file}: question ${q.id} has an invalid correctIndex`);
    }
    if (!DIFFS.has(q.difficulty)) throw new Error(`${file}: question ${q.id} has an invalid difficulty`);
    if (q.durationMs !== undefined && !(q.durationMs >= 3000)) throw new Error(`${file}: question ${q.id} duration < 3000 ms`);
  }
  return { name: p.name, description: p.description, questions: p.questions as Question[] };
}

export class ContentLibrary {
  constructor(public readonly dir: string) {}

  list(): PackInfo[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: PackInfo[] = [];
    for (const f of fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const pack = this.load(f);
        out.push({ file: f, name: pack.name, description: pack.description, questions: pack.questions.length });
      } catch (e) {
        console.warn('[content] skipping', f, (e as Error).message);
      }
    }
    return out;
  }

  load(file: string): ContentPack {
    return validatePack(JSON.parse(fs.readFileSync(path.join(this.dir, path.basename(file)), 'utf8')), file);
  }

  /** Default pack: bonly-21 when present, else the first pack. */
  defaultPack(): ContentPack | null {
    const all = this.list();
    const pick = all.find((p) => p.file.startsWith('bonly-')) ?? all[0];
    return pick ? this.load(pick.file) : null;
  }
}
