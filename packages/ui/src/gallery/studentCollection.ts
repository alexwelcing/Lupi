import { EXAMPLES, type GalleryExample } from './catalog';

/** Positive publication list: new research assets never become student content by accident.
 * Steward: Lupi product owner. Basis: the existing coordinate files named by each entry.
 * Prompts ask for observations, not experimental properties or bond orders.
 */
export const STUDENT_COLLECTION = [
  {
    id: 'water',
    topic: 'Start small',
    prompt: 'Rotate the three atoms. Does the shape look straight or bent?',
  },
  {
    id: 'ethanol',
    topic: 'Start small',
    prompt: 'Find the oxygen atom, then follow the two-carbon chain.',
  },
  {
    id: 'acetone',
    topic: 'Start small',
    prompt: 'Look at the arrangement of atoms around the central carbon.',
  },
  {
    id: 'benzene',
    topic: 'Rings & groups',
    prompt: 'View the ring from above, then from the side. What changes?',
  },
  {
    id: 'caffeine',
    topic: 'Rings & groups',
    prompt: 'Find the nitrogen and oxygen atoms among the carbon atoms.',
  },
  {
    id: 'aspirin',
    topic: 'Rings & groups',
    prompt: 'Compare the oxygen-containing groups on the edge of the ring.',
  },
  {
    id: 'phenol',
    topic: 'Rings & groups',
    prompt: 'Compare this structure with benzene. What has been added?',
  },
  {
    id: 'glucose',
    topic: 'Rings & groups',
    prompt: 'Locate the oxygen atoms inside and outside the ring.',
  },
  {
    id: 'diamond_crystal',
    topic: 'Carbon structures',
    prompt: 'Find an interior atom and inspect its nearest neighbours.',
  },
  {
    id: 'graphene_ribbon',
    topic: 'Carbon structures',
    prompt: 'Compare atoms at the edge of the sheet with those in the middle.',
  },
  {
    id: 'c60_buckyball',
    topic: 'Carbon structures',
    prompt: 'Rotate the carbon cage. Look for different polygon shapes.',
  },
  {
    id: 'cnt_6_6',
    topic: 'Carbon structures',
    prompt: 'Look down the tube, then compare its shape with the graphene sheet.',
  },
] as const;

export const STUDENT_IDS: ReadonlySet<string> = new Set(STUDENT_COLLECTION.map(entry => entry.id));
export const STUDENT_EXAMPLES: GalleryExample[] = STUDENT_COLLECTION.flatMap(entry => {
  const example = EXAMPLES.find(candidate => candidate.id === entry.id);
  return example?.available && example.file && !example.route ? [example] : [];
});
export function studentPromptForFile(name: string, sourceUrl?: string) {
  const example = STUDENT_EXAMPLES.find(
    entry =>
      name === entry.title ||
      name === entry.file.split('/').pop() ||
      sourceUrl?.split('?')[0].endsWith(entry.file),
  );
  return STUDENT_COLLECTION.find(entry => entry.id === example?.id)?.prompt;
}
