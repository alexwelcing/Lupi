import { shutdownRenderer } from './engine.mjs';
import { requireRendererToken, startRenderServer, stopRenderServer } from './server.mjs';
import { startStaticServer, stopStaticServer } from './static-server.mjs';

// Fail before opening either listener. The renderer is never allowed to fall
// back to an unauthenticated production mode.
requireRendererToken();

let staticServer;
let renderServer;
try {
  staticServer = await startStaticServer();
  renderServer = await startRenderServer();
} catch (error) {
  if (staticServer) await stopStaticServer(staticServer).catch(() => undefined);
  throw error;
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[render-backend] stopping on ${signal}`);
  await Promise.allSettled([
    stopRenderServer(renderServer),
    stopStaticServer(staticServer),
    shutdownRenderer(),
  ]);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void stop(signal).finally(() => process.exit(0));
  });
}
