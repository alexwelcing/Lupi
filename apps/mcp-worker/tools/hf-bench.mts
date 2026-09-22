// Drive the Hugging Face Spaces the scanner can use, through the same
// client the Worker uses, on the synthetic photos. Token from the
// environment or .dev.vars. Outputs land in .verify-artifacts/hf/.
//
//   pnpm scan:photos:export                       once, writes the JPEGs and masks
//   pnpm scan:hf:bench -- --photo=mug --sam3      SAM 3 concept mask for the subject
//   pnpm scan:hf:bench -- --photo=mug --sam3d     SAM 3D Objects: GLB mesh (segment + reconstruct, ZeroGPU, minutes)
//   pnpm scan:hf:bench -- --photo=mug --splat     SAM 3D Objects: gaussian splat PLY from our own mask
//   pnpm scan:hf:bench -- --mcp                   list the Hub MCP server's tools
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gradioCall, gradioFetchFile, gradioUpload, HfMcpClient, spaceHost, spaceRuntime } from '../src/hf';

function devVars(): Record<string, string> {
  try {
    const text = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    return Object.fromEntries(text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
  } catch {
    return {};
  }
}
const token = process.env.HF_TOKEN ?? devVars().HF_TOKEN;
if (!token) {
  console.error('No HF_TOKEN.');
  process.exit(2);
}
const args = process.argv.slice(2);
const photo = args.find((arg) => arg.startsWith('--photo='))?.slice('--photo='.length) ?? 'mug';
const subject = args.find((arg) => arg.startsWith('--subject='))?.slice('--subject='.length) ?? { mug: 'coffee mug', table: 'wooden table', tv: 'television', cat: 'cat', tree: 'oak tree', disc: 'red ball' }[photo] ?? photo;
const dir = fileURLToPath(new URL('../../../.verify-artifacts/hf/', import.meta.url));
const jpeg = () => new Blob([readFileSync(`${dir}photo-${photo}.jpg`)], { type: 'image/jpeg' });
const maskPng = () => new Blob([readFileSync(`${dir}mask-${photo}.png`)], { type: 'image/png' });
const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
const progress = (event: string, data: string) => {
  if (event !== 'heartbeat') log(`  ${event} ${data.slice(0, 160).replace(/\s+/g, ' ')}`);
};

async function save(host: string, file: { url?: string; path?: string }, name: string): Promise<number> {
  const response = await gradioFetchFile(host, file, { token });
  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(`${dir}${name}`, bytes);
  return bytes.byteLength;
}

const SAM3_SPACE = 'prithivMLmods/SAM3-Demo';
const SAM3D_SPACE = 'dev-bjoern/sam3d-objects-mcp';
const SPLAT_SPACE = 'fayyazio/sam3d-objects-gradio';

if (args.includes('--plan')) {
  // Jev's plan for this photo: the device's cut measured, the Spaces' state checked, one call.
  const { syntheticPhoto } = await import('../../../packages/ui/tools/synthetic-photos.mts');
  const { cutMask, DEFAULT_TOLERANCE } = await import('../../../packages/ui/src/scan/gist/volumeStage');
  const { handleScanPlan } = await import('../src/remote');
  const vars = devVars();
  const env = { HF_TOKEN: token, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY ?? vars.TYPESAFE_API_KEY };
  const kinds = (process.argv.find((arg) => arg.startsWith('--photos='))?.slice('--photos='.length) ?? photo).split(',');
  const { SYNTHETIC_KINDS } = await import('../../../packages/ui/tools/synthetic-photos.mts');
  const { loadPhotoFile } = await import('../../../packages/ui/tools/photo-file.mts');
  for (const kind of kinds) {
    // A synthetic photo by kind, or an imported real one (`photo-<kind>.jpg`).
    const pixels = (SYNTHETIC_KINDS as string[]).includes(kind) ? syntheticPhoto(kind as never) : (await loadPhotoFile(`${dir}photo-${kind}.jpg`)).pixels;
    const cut = cutMask(pixels, DEFAULT_TOLERANCE);
    const subjectFor = args.find((arg) => arg.startsWith('--subject='))?.slice('--subject='.length) ?? { mug: 'coffee mug', table: 'wooden table', tv: 'television', cat: 'cat', tree: 'oak tree', disc: 'red ball' }[kind] ?? kind;
    const started = performance.now();
    const response = await handleScanPlan(new Request('https://lupi.live/v1/scan/plan', { method: 'POST', body: JSON.stringify({ subject: subjectFor, features: cut.features, device: { masked: true, pieces: cut.features.components } }) }), env);
    const body = (await response.json()) as { mask?: { choice: string; confidence: number }; reconstruct?: { choice: string; confidence: number }; gains?: number; services?: Record<string, { stage: string; hardware: string | null }>; error?: string };
    log(`plan ${kind.padEnd(6)} "${subjectFor}": mask ${body.mask?.choice ?? body.error} (${body.mask?.confidence.toFixed(2) ?? '—'}) · reconstruct ${body.reconstruct?.choice ?? '—'} (${body.reconstruct?.confidence.toFixed(2) ?? '—'}) · gains ${body.gains?.toFixed(2) ?? '—'} · sam3 ${body.services?.sam3.stage} · sam3d ${body.services?.sam3d.stage} · ${Math.round(performance.now() - started)} ms`);
  }
}

if (args.includes('--mcp')) {
  const client = new HfMcpClient(token);
  const tools = await client.listTools();
  for (const tool of tools) log(`mcp tool ${tool.name}: ${(tool.description ?? '').slice(0, 100).replace(/\s+/g, ' ')}`);
}

if (args.includes('--sam3')) {
  const host = spaceHost(SAM3_SPACE);
  log(`${SAM3_SPACE}: ${JSON.stringify(await spaceRuntime(SAM3_SPACE, { token }))}`);
  const upload = await gradioUpload(host, jpeg(), `photo-${photo}.jpg`, { token });
  log(`uploaded ${upload.path}`);
  type Annotated = { image: { url?: string; path?: string }; annotations: Array<{ image: { url?: string; path?: string }; label: string }> };
  const { data, ms } = await gradioCall<[Annotated]>(host, '/run_image_segmentation', [upload, subject, 0.45], { token, timeoutMs: 120_000, onEvent: progress });
  const result = data[0];
  log(`sam3 "${subject}": ${result.annotations?.length ?? 0} masks in ${ms} ms`);
  for (const [index, annotation] of (result.annotations ?? []).entries()) {
    const bytes = await save(host, annotation.image, `sam3-${photo}-${index}.png`);
    log(`  mask ${index} "${annotation.label}" ${bytes} bytes → sam3-${photo}-${index}.png`);
  }
}

if (args.includes('--sam3d')) {
  const host = spaceHost(SAM3D_SPACE);
  log(`${SAM3D_SPACE}: ${JSON.stringify(await spaceRuntime(SAM3D_SPACE, { token }))}`);
  const upload = await gradioUpload(host, jpeg(), `photo-${photo}.jpg`, { token });
  log(`uploaded ${upload.path}`);
  type Out = [{ url?: string; path?: string } | null, { url?: string; path?: string } | null, string];
  const { data, ms } = await gradioCall<Out>(host, '/reconstruct_objects', [upload, subject], { token, timeoutMs: 600_000, onEvent: progress });
  log(`sam3d "${subject}" in ${ms} ms: ${data[2]}`);
  if (data[0]) log(`  model ${await save(host, data[0], `sam3d-${photo}.glb`)} bytes → sam3d-${photo}.glb`);
  if (data[1]) log(`  preview ${await save(host, data[1], `sam3d-${photo}-preview.png`)} bytes`);
}

if (args.includes('--splat')) {
  const host = spaceHost(SPLAT_SPACE);
  log(`${SPLAT_SPACE}: ${JSON.stringify(await spaceRuntime(SPLAT_SPACE, { token }))}`);
  const image = await gradioUpload(host, jpeg(), `photo-${photo}.jpg`, { token });
  const mask = await gradioUpload(host, maskPng(), `mask-${photo}.png`, { token });
  log(`uploaded ${image.path} and ${mask.path}`);
  type Out = [{ url?: string; path?: string } | null, string];
  const { data, ms } = await gradioCall<Out>(host, '/reconstruct', [image, mask, 42], { token, timeoutMs: 600_000, onEvent: progress });
  log(`splat in ${ms} ms: ${(data[1] ?? '').slice(0, 300).replace(/\s+/g, ' ')}`);
  if (data[0]) log(`  ply ${await save(host, data[0], `splat-${photo}.ply`)} bytes → splat-${photo}.ply`);
}
