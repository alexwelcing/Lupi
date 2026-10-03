/**
 * clipCompositor.ts — the 9:16 clip's frames: the viewer's own frame, then
 * the labels burned in with 2D canvas, so a clip carries its honesty
 * wherever it is posted.
 *
 *   ┌──────────────────┐
 *   │                  │  the top quarter stays clear (a phone's clock,
 *   │                  │  a story's header)
 *   │     molecule     │
 *   │                  │
 *   │ ( Pentagon face-on · 5-fold axis )   the pill's flash, as it played
 *   │ Caffeine                            the molecule's name
 *   │ ● Illustrative motion · lupi.live   always
 *   └──────────────────┘
 *
 * The last ENDCARD_S seconds fade to the sage plate with "Your turn" and the
 * molecule's page. Colours are the house's: sage #101817, lime #d5ef9c.
 */
import type { VideoCompositor } from '../store';
import { playStore } from '../play/playStore';

/** The end card's length (s). */
export const ENDCARD_S = 0.9;

const SAGE = '#101817';
const LIME = '#d5ef9c';
const INK = '#e4f2c6';
const MUTED = '#a7b9a1';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface ClipCompositorOptions {
  width: number;
  height: number;
  /** The molecule's name. */
  title: string;
  /** The clip moves toys (says "Illustrative motion"). */
  toys: boolean;
  /** Where the end card points ("lupi.live/m/caffeine"). */
  linkLabel: string;
  /** Total clip length (s), end card included. */
  duration: number;
  /** A Remix code's Foil finish on screen ("Holo"), labelled as cosmetic. */
  finish?: string | null;
}

export interface ClipCompositor extends VideoCompositor {
  width: number;
  height: number;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function clampText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** The pixel at (x, y) has any alpha (the source drew something there). */
function painted(ctx: CanvasRenderingContext2D, x: number, y: number): boolean {
  try {
    return ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 0;
  } catch {
    return true; // unreadable (tainted): assume it drew
  }
}

export function createClipCompositor(options: ClipCompositorOptions): ClipCompositor {
  const { width, height } = options;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = 'lupi-replay-sheet__clip-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  // With alpha, so the first frames can tell an unreadable source (nothing drawn) apart.
  const ctx = canvas.getContext('2d');
  const u = width / 360;
  let checks = 0;

  const drawLabels = (seconds: number) => {
    if (!ctx) return;
    // Legibility band at the bottom.
    const band = ctx.createLinearGradient(0, height - 190 * u, 0, height);
    band.addColorStop(0, 'rgba(16, 24, 23, 0)');
    band.addColorStop(1, 'rgba(16, 24, 23, 0.78)');
    ctx.fillStyle = band;
    ctx.fillRect(0, height - 190 * u, width, 190 * u);

    const left = 22 * u;
    // The pill's flash as it played (a face's name, "Flip!").
    const flash = playStore.getState().flash;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (flash && flash.until > now && flash.kind !== 'info') {
      ctx.font = `650 ${13.5 * u}px ${FONT}`;
      const text = clampText(ctx, flash.text, width - 2 * left - 28 * u);
      const textWidth = ctx.measureText(text).width;
      const chipW = textWidth + 28 * u;
      const chipH = 30 * u;
      const chipY = height - 128 * u;
      roundedRect(ctx, left, chipY, chipW, chipH, chipH / 2);
      ctx.fillStyle = 'rgba(20, 36, 30, 0.94)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, u);
      ctx.strokeStyle = '#40564a';
      ctx.stroke();
      ctx.fillStyle = LIME;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + 14 * u, chipY + chipH / 2 + 0.5 * u);
    }

    ctx.textBaseline = 'alphabetic';
    if (options.finish) {
      // A Foil finish says what it is on every frame: cosmetic.
      ctx.font = `680 ${12 * u}px ${FONT}`;
      ctx.fillStyle = LIME;
      ctx.fillText(`✦ ${options.finish} foil · cosmetic finish`, left, height - 96 * u);
    }
    ctx.font = `720 ${24 * u}px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(clampText(ctx, options.title, width - 2 * left), left, height - 66 * u);

    // ● Illustrative · lupi.live
    const lineY = height - 40 * u;
    ctx.beginPath();
    ctx.arc(left + 4.5 * u, lineY - 4.5 * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fillStyle = LIME;
    ctx.fill();
    ctx.font = `600 ${12.5 * u}px ${FONT}`;
    ctx.fillStyle = MUTED;
    const label = options.toys ? 'Illustrative motion · lupi.live' : 'Illustrative replay · lupi.live';
    ctx.fillText(label, left + 15 * u, lineY);

    // End card.
    const endStart = options.duration - ENDCARD_S;
    if (seconds > endStart) {
      const k = Math.min(1, (seconds - endStart) / 0.35);
      ctx.fillStyle = `rgba(16, 24, 23, ${0.84 * k})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = k;
      ctx.textAlign = 'center';
      ctx.font = `760 ${40 * u}px ${FONT}`;
      ctx.fillStyle = LIME;
      ctx.fillText('Your turn', width / 2, height * 0.47);
      ctx.font = `620 ${15 * u}px ${FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(options.linkLabel, width / 2, height * 0.47 + 34 * u);
      ctx.font = `560 ${11.5 * u}px ${FONT}`;
      ctx.fillStyle = MUTED;
      ctx.fillText('Illustrative rendering, not a simulation', width / 2, height * 0.47 + 58 * u);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  };

  const draw = (source: HTMLCanvasElement, seconds: number): boolean => {
    if (!ctx) return false;
    ctx.fillStyle = SAGE;
    ctx.fillRect(0, 0, width, height);
    // A probe frame first: is there anything to draw from the viewer canvas?
    let ok = true;
    if (checks < 3) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
      ok = painted(ctx, width / 2, height / 2) || painted(ctx, width * 0.1, height * 0.1) || painted(ctx, width * 0.9, height * 0.9);
      checks += 1;
      if (!ok) return false;
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = SAGE;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(source, 0, 0, width, height);
    }
    drawLabels(seconds);
    return ok;
  };

  return { canvas, width, height, draw };
}
