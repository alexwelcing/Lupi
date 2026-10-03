import { useEffect, useState } from 'react';
import {
  DAILY_EPOCH,
  DAILY_HOME_PATH,
  addDays,
  dailyPose,
  dailyPuzzlePath,
  dayNumber,
  formatLongDate,
  localDateKey,
  msUntilLocalMidnight,
  puzzleNumber,
  queueIndex,
} from '../daily/schedule';
import type { DailyPuzzleFile } from '../daily/secret';
import { verdictLine } from '../daily/share';
import { dailyStats, readDailyStore } from '../daily/store';

/** /daily/schedule.json, written by the build next to the puzzles. */
interface DailySchedule {
  tokens: string[];
}

const IDLE_FALLBACK_MS = 600;

function countdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

/** A generic ink silhouette (a ring with three arms) until today's own arrives. */
function MysteryMark() {
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    return [50 + 20 * Math.cos(a), 50 + 20 * Math.sin(a)] as const;
  });
  const arms: Array<[number, number, number, number]> = [
    [ring[0][0], ring[0][1], 80, 63],
    [ring[2][0], ring[2][1], 32, 85],
    [ring[4][0], ring[4][1], 50, 14],
  ];
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g fill="#0c1211" stroke="#0c1211" strokeLinecap="round" strokeWidth="5">
        {ring.map(([x, y], i) => {
          const [nx, ny] = ring[(i + 1) % 6];
          return <line key={`b${i}`} x1={x} y1={y} x2={nx} y2={ny} />;
        })}
        {arms.map(([x1, y1, x2, y2], i) => (
          <line key={`a${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
        {ring.map(([x, y], i) => (
          <circle key={`c${i}`} cx={x} cy={y} r="8" stroke="none" />
        ))}
        {arms.map(([, , x, y], i) => (
          <circle key={`e${i}`} cx={x} cy={y} r={i === 2 ? 9 : 6.5} stroke="none" />
        ))}
      </g>
    </svg>
  );
}

/**
 * The home page's door to Lupi Daily: today's number, the visitor's own
 * state (from this device's history), and, once the page is idle, today's
 * actual silhouette (or, if they solved it, the drawing in colour). Still,
 * SVG only: the landing page keeps zero canvases and no idle motion.
 */
export function DailyCard() {
  const [now, setNow] = useState(() => new Date());
  // Keyed by its day, so yesterday's drawing never shows under today's number.
  const [loaded, setLoaded] = useState<{ day: string; markup: string } | null>(null);
  const today = localDateKey(now);
  const art = loaded?.day === today ? loaded.markup : null;
  const started = dayNumber(today) >= 0;

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const store = readDailyStore();
  const todays = store.days[today];
  const solvedToday = Boolean(todays && todays.s !== 'play');

  useEffect(() => {
    if (!started || saveData()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const schedule = (await (await fetch('/daily/schedule.json')).json()) as DailySchedule;
        const day = dayNumber(today);
        const token = schedule.tokens[queueIndex(day, schedule.tokens.length)];
        if (!token) return;
        const file = (await (await fetch(dailyPuzzlePath(token))).json()) as DailyPuzzleFile;
        const [{ silhouetteSvg }, { inkSvgMarkup }] = await Promise.all([import('../daily/art'), import('../moleculePage/ink')]);
        const pose = dailyPose(file.model, day, schedule.tokens.length);
        const attrs = { width: '100%', height: '100%' };
        const markup = solvedToday
          ? inkSvgMarkup(file.model, pose, { idPrefix: 'daily-card', attrs })
          : silhouetteSvg(file.model, pose, { ...attrs, 'aria-hidden': 'true' });
        if (!cancelled) setLoaded({ day: today, markup });
      } catch {
        /* offline or not built: the generic mark stays */
      }
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const handle = idle ? idle(() => void load()) : window.setTimeout(() => void load(), IDLE_FALLBACK_MS);
    return () => {
      cancelled = true;
      if (!idle) window.clearTimeout(handle);
    };
  }, [today, started, solvedToday]);

  let line: string;
  let cta: string;
  if (!started) {
    line = `The first mystery molecule arrives on ${formatLongDate(DAILY_EPOCH)}.`;
    cta = 'Have a look';
  } else if (todays && todays.s !== 'play') {
    const stats = dailyStats(today, store);
    const streak = stats.streak >= 2 && todays.s === 'won' ? ` · ${stats.streak}-day streak` : '';
    line = `${verdictLine(todays)}${streak}. Next one in ${countdown(msUntilLocalMidnight(now))}.`;
    cta = 'See today’s';
  } else if (todays && todays.g.length > 0) {
    line = `Clue ${todays.g.length + 1} of 6 is waiting for you.`;
    cta = 'Keep going';
  } else {
    const yesterday = store.days[addDays(today, -1)];
    line = yesterday?.n ? `Yesterday’s was ${yesterday.n}. Today’s is new, and the same for everyone.` : 'Six clues, one mystery molecule, the same for everyone today.';
    cta = 'Play today’s';
  }

  return (
    <section className="daily-card student-width" aria-labelledby="daily-card-title">
      <a className="daily-card__link" href={DAILY_HOME_PATH}>
        <span className={`daily-card__disc${solvedToday && art ? ' daily-card__disc--lit' : ''}`} aria-hidden="true">
          {art ? <span className="daily-card__art" dangerouslySetInnerHTML={{ __html: art }} /> : <MysteryMark />}
        </span>
        <span className="daily-card__text">
          <span className="daily-card__kicker">Lupi Daily{started ? ` · No. ${puzzleNumber(today)}` : ''}</span>
          <strong id="daily-card-title">Who’s that molecule?</strong>
          <span className="daily-card__line">{line}</span>
        </span>
        <span className="daily-card__go">
          {cta} <span aria-hidden="true">→</span>
        </span>
      </a>
    </section>
  );
}
