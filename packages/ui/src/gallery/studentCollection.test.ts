import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { STUDENT_COLLECTION, STUDENT_EXAMPLES, STUDENT_IDS, studentPromptForFile } from './studentCollection';

describe('student publication boundary', () => {
  it('has a unique, explicit lesson for every published example', () => {
    expect(STUDENT_IDS.size).toBe(12);
    expect(STUDENT_EXAMPLES.length).toBe(STUDENT_COLLECTION.length);
    expect(STUDENT_IDS.has('hfc_r32_research')).toBe(false);
    expect(STUDENT_IDS.has('billion_atom_block')).toBe(false);
  });
  it('ships each coordinate file and a preview bound to its LF-normalized source', () => {
    for (const example of STUDENT_EXAMPLES) {
      expect(example.file.startsWith('gallery/curated/')).toBe(true);
      const source = readFileSync(resolve('../../apps/web/public', example.file), 'utf8').replace(
        /\r\n/g,
        '\n',
      );
      const count = Number(source.toString().split(/\r?\n/)[0]);
      expect(count).toBe(Number(example.atoms.replace(/,/g, '')));
      const previewPath = resolve('../../apps/web/public/learn', `${example.id}.svg`);
      expect(existsSync(previewPath)).toBe(true);
      expect(readFileSync(previewPath, 'utf8')).toContain(createHash('sha256').update(source).digest('hex'));
    }
  });
  it('uses the same prompt after a curated file is opened', () => {
    expect(studentPromptForFile('Water')).toBe(STUDENT_COLLECTION[0].prompt);
    expect(studentPromptForFile('water.xyz')).toBe(STUDENT_COLLECTION[0].prompt);
    expect(studentPromptForFile('unrelated.xyz')).toBeUndefined();
  });
});
