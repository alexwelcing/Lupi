#!/usr/bin/env node
/** Validate the checked-in portable plugin and optionally build a deterministic ZIP.
 * This checks package contents; it does not connect, install, submit, or publish.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(repoRoot, 'plugins/lupi-live');
const expectedMcpUrl = 'https://lupi.live/chatgpt/mcp';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function nonemptyString(value, field, max = 4000) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${field} must be a nonempty string.`);
  requireValue(value.length <= max, `${field} exceeds ${max} characters.`);
}

function httpsUrl(value, field) {
  nonemptyString(value, field, 2048);
  const url = new URL(value);
  requireValue(url.protocol === 'https:' && !url.username && !url.password, `${field} must be HTTPS without credentials.`);
}

async function inventory(directory = packageRoot, prefix = '') {
  const entries = (await readdir(directory)).sort();
  const files = [];
  for (const name of entries) {
    requireValue(!name.startsWith('.'), `Unexpected hidden package entry: ${prefix}${name}`);
    const relative = `${prefix}${name}`;
    const absolute = path.join(directory, name);
    const info = await lstat(absolute);
    requireValue(!info.isSymbolicLink(), `Package symlinks are not allowed: ${relative}`);
    if (info.isDirectory()) files.push(...await inventory(absolute, `${relative}/`));
    else {
      requireValue(info.isFile(), `Unsupported package entry: ${relative}`);
      requireValue(info.size <= 5 * 1024 * 1024, `Package file exceeds 5 MiB: ${relative}`);
      files.push({ name: relative, content: await readFile(absolute) });
    }
  }
  return files;
}

async function validate() {
  const files = await inventory();
  const byName = new Map(files.map((file) => [file.name, file]));
  for (const file of files) {
    requireValue(
      ['plugin.json', 'mcp.json', 'LICENSE', 'LICENSE-CONTENT.md'].includes(file.name)
        || /^skills\/[a-z0-9-]+\/SKILL\.md$/.test(file.name)
        || /^assets\/[a-z0-9._-]+\.(png|jpe?g|webp|svg)$/i.test(file.name),
      `Unexpected distributable file: ${file.name}`,
    );
  }
  const json = (name) => {
    requireValue(byName.has(name), `Missing ${name}`);
    return JSON.parse(byName.get(name).content.toString('utf8'));
  };
  const manifest = json('plugin.json');
  const mcp = json('mcp.json');
  requireValue(manifest.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'Use the portable Agent Plugins 1.0.0 manifest schema.');
  requireValue(mcp.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'Use the portable Agent Plugins 1.0.0 MCP schema.');
  requireValue(manifest.name === 'lupi-live', 'Keep the stable package name lupi-live.');
  requireValue(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version), 'Use an explicit semantic package version.');
  nonemptyString(manifest.description, 'description');
  nonemptyString(manifest.author?.name, 'author.name', 120);
  httpsUrl(manifest.homepage, 'homepage');
  requireValue(Object.keys(mcp.mcpServers ?? {}).join(',') === 'lupi', 'Expose only the named lupi MCP connection.');
  requireValue(mcp.mcpServers.lupi.type === 'streamable-http', 'The public connection must use streamable-http.');
  requireValue(mcp.mcpServers.lupi.url === expectedMcpUrl, `The intended stable MCP route is ${expectedMcpUrl}.`);
  requireValue(Object.keys(mcp.mcpServers.lupi).every((key) => ['type', 'url'].includes(key)), 'Do not package auth headers or runtime secrets.');

  const extension = manifest.extensions?.['com.openai'];
  requireValue(extension && typeof extension === 'object', 'Missing extensions.com.openai.');
  const ui = extension.interface;
  requireValue(ui && typeof ui === 'object', 'Missing OpenAI listing interface.');
  for (const [key, limit] of [['displayName', 30], ['shortDescription', 30], ['longDescription', 4000], ['developerName', 80]]) {
    nonemptyString(ui[key], `interface.${key}`, limit);
  }
  httpsUrl(ui.websiteURL, 'interface.websiteURL');
  requireValue(Array.isArray(ui.defaultPrompt) && ui.defaultPrompt.length > 0 && ui.defaultPrompt.length <= 3, 'Provide one to three starter prompts.');
  for (const prompt of ui.defaultPrompt) {
    nonemptyString(prompt, 'defaultPrompt', 128);
    requireValue(!/@lupi\b/i.test(prompt), 'Starter prompts must omit app @mentions.');
  }

  function referencedFile(value, field) {
    requireValue(typeof value === 'string' && /^\.\/[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)+$/.test(value), `${field} must use a ./-prefixed package path.`);
    requireValue(!value.split('/').includes('..'), `${field} must stay inside the package.`);
    const file = byName.get(value.slice(2));
    requireValue(file, `Missing referenced file for ${field}: ${value}`);
    return file;
  }
  for (const field of ['logo', 'composerIcon']) {
    const file = referencedFile(ui[field], `interface.${field}`);
    requireValue(file.name.endsWith('.png'), `${field}: this package's checked-in brand asset is PNG.`);
    requireValue(file.content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${field} is not a PNG.`);
    const width = file.content.readUInt32BE(16);
    const height = file.content.readUInt32BE(20);
    requireValue(width === height && width >= 48 && width <= 4096, `${field} must be square and 48–4096 pixels.`);
  }
  for (const screenshot of ui.screenshots ?? []) referencedFile(screenshot, 'screenshots');
  const onboarding = referencedFile(extension.onboardingSkill, 'onboardingSkill');
  const skills = files.filter((file) => file.name.endsWith('/SKILL.md'));
  requireValue(skills.length > 0 && skills.includes(onboarding), 'Include the onboarding skill.');
  for (const skill of skills) {
    const text = skill.content.toString('utf8');
    const match = text.match(/^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n([\s\S]+)$/);
    requireValue(match, `${skill.name}: expected name and description frontmatter plus a skill body.`);
    requireValue(skill.name === `skills/${match[1]}/SKILL.md`, `${skill.name}: folder and skill name must agree.`);
    requireValue(match[1].length < 64 && match[2].trim().length > 0, `${skill.name}: invalid skill metadata.`);
  }
  const cases = extension.review?.test_cases;
  requireValue(cases?.positive?.length >= 5 && cases?.negative?.length >= 3, 'Include at least five positive and three negative review cases.');
  for (const [kind, tests] of Object.entries(cases)) {
    for (const test of tests) {
      nonemptyString(test.description, `${kind} case description`);
      nonemptyString(test.prompt, `${kind} case prompt`);
      nonemptyString(test.expected_behavior, `${kind} case expected_behavior`);
      if (kind === 'positive') nonemptyString(test.tools_triggered, 'positive case tools_triggered');
    }
  }
  requireValue(!('test_credentials' in extension.review) && !('reviewer_instructions' in extension.review), 'Keep reviewer credentials and private instructions out of the ZIP.');
  nonemptyString(extension.publication?.release_notes, 'publication.release_notes');

  const pending = [];
  if (!ui.category) pending.push('interface.category (choose a current portal category)');
  for (const field of ['supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (!ui[field]) pending.push(`interface.${field} (publish and verify the actual page)`);
    else httpsUrl(ui[field], `interface.${field}`);
  }
  if (!extension.review.demo_recording_url) pending.push('review.demo_recording_url (record the real installed-host flow)');
  else httpsUrl(extension.review.demo_recording_url, 'review.demo_recording_url');
  return { files, manifest, pending };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// STORE entries with a fixed 1980-01-01 timestamp make identical inputs byte-identical.
function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const checksum = crc32(file.content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(file.content.length, 18);
    header.writeUInt32LE(file.content.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, file.content);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(file.content.length, 20);
    entry.writeUInt32LE(file.content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + file.content.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node tools/package-chatgpt-plugin.mjs [--check] [--submission] [--output=path.zip]');
    console.log('Default: validate draft package. --submission additionally requires listing/review metadata.');
    return;
  }
  requireValue(args.every((arg) => ['--check', '--submission'].includes(arg) || arg.startsWith('--output=')), 'Unknown argument. Use --help.');
  requireValue(args.filter((arg) => arg.startsWith('--output=')).length <= 1, 'Specify at most one output path.');
  const { files, manifest, pending } = await validate();
  console.log(`Draft package checks passed: ${manifest.name} ${manifest.version}, ${files.length} files.`);
  if (pending.length) console.log(`Submission metadata pending:\n${pending.map((item) => `- ${item}`).join('\n')}`);
  if (args.includes('--submission')) requireValue(pending.length === 0, 'Submission metadata is incomplete. Draft validation does not establish host acceptance or publication readiness.');
  const outputArg = args.find((arg) => arg.startsWith('--output='));
  if (outputArg) {
    const output = path.resolve(outputArg.slice('--output='.length));
    requireValue(output.endsWith('.zip'), 'Output path must end in .zip.');
    const relative = path.relative(packageRoot, output);
    requireValue(relative.startsWith('..') || path.isAbsolute(relative), 'Write generated ZIPs outside the source package.');
    const archive = zip(files);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, archive);
    console.log(`Wrote development ZIP: ${output}`);
    console.log(`SHA256 ${createHash('sha256').update(archive).digest('hex')}`);
  }
  console.log('No connection, installation, submission, or publication was performed.');
}

main().catch((error) => {
  console.error(`Plugin package check failed: ${error.message}`);
  process.exitCode = 1;
});
