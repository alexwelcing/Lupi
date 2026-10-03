/** Include the exact self-contained MCP component in the existing web assets. */
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'apps/chatgpt-widget/dist/index.html');
const destination = path.join(root, 'apps/web/dist/chatgpt-widget/index.html');
const html = await readFile(source, 'utf8');
if (!/<meta\s+name=["']lupi-widget["']\s+content=["']molecule-v2["']\s*\/?>/i.test(html)) {
  throw new Error('The generated component is not the Lupi molecule widget.');
}
await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log('Included the Lupi molecule component in the web asset bundle.');
