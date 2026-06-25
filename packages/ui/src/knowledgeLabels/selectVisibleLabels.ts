import type { KnowledgeLabel } from '../store';

export interface SelectVisibleLabelsOptions {
  labels: KnowledgeLabel[];
  visibleKinds: Set<string>;
  visible: boolean;
  threshold: number;
  maxCount: number;
  cullDistance: number;
  cameraPosition: [number, number, number];
  hoveredAtom: number | null;
}

export interface SelectVisibleLabelsResult {
  visibleLabels: KnowledgeLabel[];
  hoverLabelToRender: KnowledgeLabel | undefined;
}

export function selectVisibleLabels(options: SelectVisibleLabelsOptions): SelectVisibleLabelsResult {
  const { labels, visibleKinds, visible, threshold, maxCount, cullDistance, cameraPosition, hoveredAtom } = options;
  if (!visible || labels.length === 0) {
    return { visibleLabels: [], hoverLabelToRender: undefined };
  }

  const [cx, cy, cz] = cameraPosition;
  const scored: Array<{ label: KnowledgeLabel; dist: number }> = [];

  for (const label of labels) {
    if (!visibleKinds.has(label.kind)) continue;
    if (label.kind === 'sphere') {
      const dx = label.position[0] - cx;
      const dy = label.position[1] - cy;
      const dz = label.position[2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= cullDistance) scored.push({ label, dist });
      continue;
    }
    if ((label.salience ?? 0) < threshold) continue;
    const dx = label.position[0] - cx;
    const dy = label.position[1] - cy;
    const dz = label.position[2] - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= cullDistance) scored.push({ label, dist });
  }

  scored.sort((a, b) => a.dist - b.dist);
  const kept = scored.slice(0, maxCount).map((s) => s.label);
  const visibleIds = new Set(kept.map((l) => l.id));

  const hoveredLabel =
    hoveredAtom != null
      ? labels.find((l) => l.kind === 'node' && l.atomIndex === hoveredAtom && visibleKinds.has('node'))
      : undefined;
  const hoverLabelToRender =
    hoveredLabel && !visibleIds.has(hoveredLabel.id) ? hoveredLabel : undefined;

  return { visibleLabels: kept, hoverLabelToRender };
}
