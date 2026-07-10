/** Boots the local viewer static server, then the render service. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const VIEWER_PORT = process.env.VIEWER_PORT || '4173';
const WEB_DIST = process.env.WEB_DIST || '/app/web-dist';

const viewer = spawn('npx', ['serve', '-s', WEB_DIST, '-l', VIEWER_PORT], { stdio: 'inherit' });
viewer.on('exit', (code) => { console.error(`[supervisor] viewer server exited ${code}`); process.exit(1); });

let up = false;
for (let i = 0; i < 30 && !up; i++) {
  await sleep(1000);
  try { up = (await fetch(`http://127.0.0.1:${VIEWER_PORT}/`)).ok; } catch {}
}
if (!up) { console.error('[supervisor] viewer never came up'); process.exit(1); }
console.log(`[supervisor] viewer serving :${VIEWER_PORT}, starting render service`);
await import('./server.mjs');
