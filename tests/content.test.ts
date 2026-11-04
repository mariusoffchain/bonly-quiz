import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentLibrary, validatePack } from '../src/server/content';

describe('content packs', () => {
  it('the B-only pack has 3 parts of 7 questions, from easy to hard', () => {
    const pack = new ContentLibrary(path.join(__dirname, '../content/questions')).load('bonly-21-fr.json');
    expect(pack.parts?.map((p) => p.questions)).toEqual([7, 7, 7]);
    expect(pack.questions.map((q) => q.difficulty)).toEqual([...Array(7).fill('easy'), ...Array(7).fill('intermediate'), ...Array(7).fill('hard')]);
    const letters = pack.questions.map((q) => q.correctIndex);
    for (const i of [0, 1, 2, 3]) expect(letters.filter((x) => x === i).length).toBeGreaterThanOrEqual(5);
  });

  it('rejects parts that do not add up to the questions', () => {
    const q = { id: 'a', type: 'single-choice', text: 'x', options: ['a', 'b'], correctIndex: 0, difficulty: 'easy' };
    expect(() => validatePack({ name: 'p', parts: [{ title: 'A', questions: 2 }], questions: [q] })).toThrow(/parts/);
    expect(validatePack({ name: 'p', parts: [{ title: 'A', questions: 1 }], questions: [q] }).parts).toHaveLength(1);
  });
});
