/**
 * activity.ts — when the MCP bridge last ran a command.
 *
 * A molecule an agent loads opens as on the MCP route: at once, with no
 * morph arrival (lupi.* tools stay instant). The bridge brackets every
 * command (`beginMcpActivity`), and the Play layer asks whether one ran just
 * now: the file a command sets commits a moment after the command returns.
 */

let running = 0;
let lastAt = -Infinity;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Mark an MCP command as running; call the returned function when it ends. */
export function beginMcpActivity(): () => void {
  running += 1;
  lastAt = now();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    running -= 1;
    lastAt = now();
  };
}

/** True while an MCP command runs, and for `graceMs` after the last one ended. */
export function mcpActiveWithin(graceMs = 1500): boolean {
  return running > 0 || now() - lastAt < graceMs;
}
