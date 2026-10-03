/**
 * painter.ts — the Daily stage's painter: every look of art.ts as live SVG
 * nodes under one ink stage (moleculePage/inkStage.ts), so the silhouette,
 * the outline, the colours and the bloom all turn with the same drag, coast
 * and detents as the /m drawing.
 *
 * Nodes are made once; a draw only moves them. Only the look on show (and
 * the one fading out) is drawn, so a turning silhouette costs one layer.
 *
 *   .dl-art[data-look]
 *     svg.dl-paper   g.dl-layer--silhouette | --outline | --colour
 *     div.dl-lit     the lit drawing on the plate, revealed by the bloom
 *     div.dl-ring    the lime ring the bloom sends out
 */
import { INK_VIEW, type InkLayout, type InkModel } from '../moleculePage/ink';
import { createLitInkPainter, reorder, type InkPainter } from '../moleculePage/inkStage';
import {
  COLOUR_RING_WIDTH,
  DAILY_INK,
  DAILY_PAPER,
  OUTLINE_WIDTH,
  outlineBondOpacity,
  outlineBondWidth,
  outlineOpacity,
  silhouetteBondWidth,
} from './art';

export type DailyLook = 'silhouette' | 'outline' | 'colour' | 'lit';

export interface DailyPainter extends InkPainter {
  readonly root: HTMLDivElement;
  setLook(look: DailyLook): void;
  look(): DailyLook;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** How long an outgoing look keeps drawing while it fades (CSS fades in 0.45 s). */
const FADE_MS = 700;
/** The paper under the bloom keeps turning until the bloom has covered it (CSS: 0.9 s). */
const BLOOM_MS = 1400;

function svg<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

interface Layer {
  group: SVGGElement;
  draw(layout: InkLayout): void;
}

function silhouetteLayer(model: InkModel): Layer {
  const group = svg('g', { class: 'dl-layer dl-layer--silhouette', fill: DAILY_INK, stroke: DAILY_INK, 'stroke-linecap': 'round' });
  const lines: SVGLineElement[] = [];
  const circles: SVGCircleElement[] = [];
  for (let b = 0; b < model.b.length / 2; b += 1) {
    const line = svg('line', {});
    lines.push(line);
    group.appendChild(line);
  }
  for (let i = 0; i < model.k.length; i += 1) {
    const circle = svg('circle', { stroke: 'none' });
    circles.push(circle);
    group.appendChild(circle);
  }
  let widthSet = false;
  return {
    group,
    draw(layout) {
      if (!widthSet) {
        group.setAttribute('stroke-width', silhouetteBondWidth(layout).toFixed(2));
        widthSet = true;
      }
      for (let b = 0; b < lines.length; b += 1) {
        const line = lines[b];
        line.setAttribute('x1', layout.x1[b].toFixed(2));
        line.setAttribute('y1', layout.y1[b].toFixed(2));
        line.setAttribute('x2', layout.x2[b].toFixed(2));
        line.setAttribute('y2', layout.y2[b].toFixed(2));
      }
      for (let i = 0; i < circles.length; i += 1) {
        const circle = circles[i];
        circle.setAttribute('cx', layout.cx[i].toFixed(2));
        circle.setAttribute('cy', layout.cy[i].toFixed(2));
        circle.setAttribute('r', layout.r[i].toFixed(2));
      }
    },
  };
}

function outlineLayer(model: InkModel, colour: boolean): Layer {
  const group = svg('g', {
    class: `dl-layer dl-layer--${colour ? 'colour' : 'outline'}`,
    stroke: DAILY_INK,
    'stroke-linecap': 'round',
  });
  const atomCount = model.k.length;
  const bondCount = model.b.length / 2;
  const items: SVGElement[] = [];
  const circles: SVGCircleElement[] = [];
  const lines: SVGLineElement[] = [];
  for (let i = 0; i < atomCount; i += 1) {
    const circle = svg('circle', {
      fill: colour ? model.kinds[model.k[i]].c : DAILY_PAPER,
      'stroke-width': String(colour ? COLOUR_RING_WIDTH : OUTLINE_WIDTH),
    });
    circles.push(circle);
    items.push(circle);
  }
  for (let b = 0; b < bondCount; b += 1) {
    const line = svg('line', {});
    lines.push(line);
    items.push(line);
  }
  const shown = new Int32Array(atomCount + bondCount).fill(-1);
  let widthSet = false;
  return {
    group,
    draw(layout) {
      if (!widthSet) {
        for (const line of lines) line.setAttribute('stroke-width', outlineBondWidth(layout).toFixed(2));
        widthSet = true;
      }
      for (let i = 0; i < atomCount; i += 1) {
        const circle = circles[i];
        circle.setAttribute('cx', layout.cx[i].toFixed(2));
        circle.setAttribute('cy', layout.cy[i].toFixed(2));
        circle.setAttribute('r', layout.r[i].toFixed(2));
        circle.setAttribute('stroke-opacity', outlineOpacity(layout, i).toFixed(3));
      }
      for (let b = 0; b < bondCount; b += 1) {
        const line = lines[b];
        line.setAttribute('x1', layout.x1[b].toFixed(2));
        line.setAttribute('y1', layout.y1[b].toFixed(2));
        line.setAttribute('x2', layout.x2[b].toFixed(2));
        line.setAttribute('y2', layout.y2[b].toFixed(2));
        line.setAttribute('stroke-opacity', outlineBondOpacity(layout, b).toFixed(3));
      }
      reorder(group, items, shown, layout.order);
    },
  };
}

export function createDailyPainter(model: InkModel, idPrefix: string, initial: DailyLook = 'silhouette'): DailyPainter {
  const root = document.createElement('div');
  root.className = 'dl-art';
  root.dataset.look = initial;
  const paper = svg('svg', {
    viewBox: `0 0 ${INK_VIEW} ${INK_VIEW}`,
    class: 'dl-paper',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const layers: Record<Exclude<DailyLook, 'lit'>, Layer> = {
    silhouette: silhouetteLayer(model),
    outline: outlineLayer(model, false),
    colour: outlineLayer(model, true),
  };
  paper.append(layers.silhouette.group, layers.outline.group, layers.colour.group);
  const litWrap = document.createElement('div');
  litWrap.className = 'dl-lit';
  const lit = createLitInkPainter(model, `${idPrefix}-lit`);
  lit.root.setAttribute('class', 'dl-lit__art');
  litWrap.appendChild(lit.root);
  const ring = document.createElement('div');
  ring.className = 'dl-ring';
  ring.setAttribute('aria-hidden', 'true');
  root.append(paper, litWrap, ring);

  let current: DailyLook = initial;
  const active = new Set<DailyLook>([initial]);
  let last: InkLayout | null = null;

  const drawLook = (look: DailyLook, layout: InkLayout) => {
    if (look === 'lit') lit.draw(layout);
    else layers[look].draw(layout);
  };

  return {
    root,
    draw(layout) {
      last = layout;
      for (const look of active) drawLook(look, layout);
    },
    setLook(next) {
      if (next === current) return;
      const previous = current;
      current = next;
      active.add(next);
      if (last) drawLook(next, last);
      root.dataset.look = next;
      // The look the bloom opens from stays on show beneath it.
      root.dataset.from = previous;
      // Drop the outgoing look once it has faded, or once the bloom has covered it.
      window.setTimeout(() => {
        if (current !== previous) active.delete(previous);
      }, next === 'lit' ? BLOOM_MS : FADE_MS);
    },
    look() {
      return current;
    },
  };
}
