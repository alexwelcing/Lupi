// lupi.gen.edit@1, the writer's side (scale-spec §2.6, §3.5): flattening a
// removal into an existing edit, and refusing an edit that is full.

import { fail } from './bytes';
import { encodePath, pathContains, type Step } from './paths';
import { encodeRecord, EDIT_MAX_REMOVALS, RECORD_MAX_BYTES, type EditNode, type NodeID } from './records';

/** Record bytes of an edit with these removals: 48 + Σ (4 + path bytes). */
export function editRecordLength(removed: readonly Step[][]): number {
  return 48 + removed.reduce((s, r) => s + 4 + encodePath(r).length, 0);
}

export function editFits(removed: readonly Step[][]): boolean {
  return removed.length >= 1 && removed.length <= EDIT_MAX_REMOVALS && editRecordLength(removed) <= RECORD_MAX_BYTES;
}

/**
 * Removes `removal` (a path from the base) from `edit`, or from a node that
 * is no edit yet when `edit` is a bare base. Writers flatten: the new edit's
 * removals are the old ones minus those the new removal contains, plus it.
 * A removal inside an existing one is ScaleError('path'); one that would
 * pass 256 removals or 65,536 bytes is ScaleError('limit') ("this one is full").
 */
export function removeFrom(edit: EditNode | { base: NodeID }, removal: readonly Step[]): EditNode {
  if (removal.length === 0) fail('validity', 'the empty path is not a removal');
  if (removal.some((s) => s.tag === 'atoms')) fail('validity', 'a removal holds an atoms step');
  const existing = 'removed' in edit ? edit.removed : [];
  for (const r of existing) {
    if (pathContains(r, removal)) fail('path', 'that piece is already gone');
  }
  const kept = existing.filter((r) => !pathContains(removal, r));
  const removed = [...kept, removal.map((s) => ({ ...s })) as Step[]];
  if (!editFits(removed)) fail('limit', 'this one is full');
  const node: EditNode = { kind: 'edit', base: edit.base, removed };
  encodeRecord(node);
  return node;
}
