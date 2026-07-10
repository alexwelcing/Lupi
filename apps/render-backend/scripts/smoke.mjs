/** Boot the server, request one small merch asset, assert a valid PNG comes back. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const srv = spawn('node', ['src/server.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: '8123' } });
try {
  let up = false;
  for (let i = 0; i < 30 && !up; i++) { await sleep(1000); try { up = (await fetch('http://127.0.0.1:8123/health')).ok; } catch {} }
  if (!up) throw new Error('server did not come up');
  const res = await fetch('http://127.0.0.1:8123/v1/merch-asset', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ molecule: 'caffeine', colorway: 'ion', product: 'square-social', masterSize: 512 }),
  });
  const j = await res.json();
  if (!res.ok || !j.asset?.dataBase64) throw new Error('render failed: ' + JSON.stringify(j).slice(0, 300));
  const png = Buffer.from(j.asset.dataBase64, 'base64');
  if (png.subarray(1, 4).toString() !== 'PNG') throw new Error('not a PNG');
  console.log('SMOKE OK', png.length, 'bytes', JSON.stringify(j.design));
} finally { srv.kill('SIGTERM'); }
