/**
 * nodePath.ts — how a knowledge-graph node id shows in the UI.
 *
 * A node id is often a local path from the export that wrote the labels
 * (`hermes-core://config//home/<user>/.hermes/SOUL.md`). The ids stay as they
 * are: pinning, label search, Herdr events and `lupi.knowledge_graph` use
 * them. What the UI prints, and its tooltips, never names a home directory:
 * `/home/<user>`, `/Users/<user>` and `C:\Users\<user>` read as `~`, and the
 * path is shown from there.
 */

/** A home directory as a whole path segment: /home/<user>, /Users/<user>, <drive>:\Users\<user>. */
const HOME_DIR = /(?:[A-Za-z]:)?[\\/](?:home|Users)[\\/][^\\/\s]+(?=[\\/\s]|$)/g;

/** Drop `.` segments and fold `name/..` pairs, never past `~` or the start. */
function foldDots(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '.') continue;
    const last = out[out.length - 1];
    if (segment === '..' && last !== undefined && last !== '' && last !== '..' && last !== '~' && !last.endsWith(':')) {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/** `text` with every home directory replaced by `~`, and `..` folded where a home was. */
export function scrubHomePaths(text: string): string {
  const scrubbed = text.replace(HOME_DIR, '~');
  return scrubbed === text ? text : foldDots(scrubbed);
}

/** The full node id as a tooltip shows it: the id, home directories as `~`. */
export function nodePathTitle(nodeId: string | undefined): string | undefined {
  return nodeId ? scrubHomePaths(nodeId) : undefined;
}

/**
 * The node id as the atom card prints it: from the home directory on when it
 * has one (`~/.hermes/SOUL.md`), else without its scheme
 * (`claim/S5`); very long paths keep their last segment.
 */
export function nodePathLabel(nodeId: string | undefined): string | undefined {
  if (!nodeId) return undefined;
  let cleaned: string;
  const homes = [...nodeId.matchAll(HOME_DIR)];
  if (homes.length > 0) {
    const last = homes[homes.length - 1];
    cleaned = foldDots(`~${nodeId.slice((last.index ?? 0) + last[0].length)}`);
  } else {
    cleaned = nodeId.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\//, '');
  }
  if (cleaned.length <= 42) return cleaned;
  const parts = cleaned.split('/');
  const file = parts.pop() ?? '';
  const dir = parts.join('/');
  if (file.length > 38) return `…/${file.slice(0, 36)}…`;
  const prefix = dir.slice(0, 40 - file.length - 4);
  return `${prefix}…/${file}`;
}
