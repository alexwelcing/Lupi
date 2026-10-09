/** Live demo receipt. API/MCP checks, not installed ChatGPT or device acceptance. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CHATGPT_UI_URI } from '../apps/mcp-worker/src/chatgpt';
import { DISCOVERY_CATALOG, DISCOVERY_SCHEMA } from '../packages/core/src/jev/moleculeDiscovery';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--') && a.includes('=')).map((a) => {
  const at = a.indexOf('='); return [a.slice(2, at), a.slice(at + 1)];
}));
const origin = new URL(args.url ?? 'https://lupi.live').origin;
const directory = `.verify-artifacts/jev-discovery/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const checks: Record<string, unknown>[] = [];
const report: Record<string, unknown> = { origin, actualChatGpt: false, physicalDevice: false, checks };
const client = new Client({ name: 'Lupi investor demo API check', version: '1.0.0' });
await mkdir(directory, { recursive: true });
const check = (name: string, condition: unknown, evidence?: unknown) => {
  checks.push({ name, passed: Boolean(condition), evidence });
  assert(condition, name);
};
const fetchBounded: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
});
try {
  const health = await fetchBounded(`${origin}/health`).then((r) => r.json()) as { release?: { tag?: string }; jev?: { configured?: boolean; routes?: string[] } };
  report.health = health;
  if (args['expected-sha']) check('Public health matches the expected main revision', health.release?.tag === args['expected-sha'], health.release);
  check('Public edge advertises configured Jev discovery', health.jev?.configured && health.jev.routes?.includes('/v1/discovery/molecule'), health.jev);
  for (const [query, expected] of [
    ['H2O', 'water'],
    ['a hollow football-shaped cage of carbon atoms', 'c60_buckyball'],
    ['the molecule in coffee', 'caffeine'],
    ['a six-carbon aromatic ring', 'benzene'],
    ['an imaginary compound outside this catalogue', null],
  ] as const) {
    const response = await fetchBounded(`${origin}/v1/discovery/molecule`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    const result = await response.json() as { schema: string; query: string; method: string; model: string | null; confidence: number | null; candidates: { id: string }[] };
    check(`Discovery: ${query}`, response.ok && result.schema === DISCOVERY_SCHEMA && result.query === query && (result.candidates[0]?.id ?? null) === expected, result);
    if (expected) assert.deepEqual(result.candidates, [DISCOVERY_CATALOG.find((c) => c.id === expected)]);
  }
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/chatgpt/mcp`), { fetch: fetchBounded }));
  const tools = await client.listTools();
  check('Live MCP advertises six read-only tools', tools.tools.length === 6 && tools.tools.some((t) => t.name === 'recommend_molecule') && tools.tools.every((t) => t.annotations?.readOnlyHint === true));
  const resources = await client.listResources();
  check('Live MCP advertises molecule-v3', resources.resources.some((r) => r.uri === CHATGPT_UI_URI));
  const recommendation = await client.callTool({ name: 'recommend_molecule', arguments: { query: 'buckyball' } });
  check('MCP recommendation returns the owned C60 CID', !recommendation.isError && (recommendation.structuredContent?.candidates as { pubchemCid: number }[])?.[0]?.pubchemCid === 123591, recommendation.structuredContent);
  if (!process.argv.includes('--no-source')) {
    for (const cid of [123591, 2519]) {
      const resolved = await client.callTool({ name: 'resolve_molecule', arguments: { query: `cid:${cid}`, cacheMode: 'refresh' } });
      check(`Retrieve live PubChem CID ${cid}`, !resolved.isError && resolved.structuredContent?.cid === cid && resolved.structuredContent?.status === 'resolved', resolved.structuredContent);
      const shown = await client.callTool({ name: 'show_molecule', arguments: { structureRef: resolved.structuredContent?.structureRef } });
      check(`Prepare source-bound viewer CID ${cid}`, !shown.isError && shown.structuredContent?.structureRef === resolved.structuredContent?.structureRef && Boolean(shown._meta?.molecule), shown.structuredContent);
    }
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client.close();
  await writeFile(`${directory}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, receipt: `${directory}/report.json`, error: report.error ?? null }));
}
