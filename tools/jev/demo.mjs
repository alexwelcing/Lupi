import { fileURLToPath } from 'node:url';
import { createClient, warmConnection } from './client.mjs';
import { interpret } from './interpreter.mjs';
import { startDemo } from './server.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const evaluate = createClient({ apiKey: process.env.TYPESAFE_API_KEY });
if (process.env.TYPESAFE_API_KEY) {
  console.log('Preparing the TypeSafe connection (up to 10 seconds)…');
  if (!await warmConnection(process.env.TYPESAFE_API_KEY)) console.log('Connection unavailable; local commands remain available.');
}
export const server = startDemo({ port: 4318, assets: {
  '/': [here('index.html'), 'text/html; charset=utf-8'],
  '/app.js': [here('app.js'), 'text/javascript; charset=utf-8'],
}, evaluate: text => interpret(text, evaluate), data: () => ({ configured: Boolean(process.env.TYPESAFE_API_KEY) }) });
