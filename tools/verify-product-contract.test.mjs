import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyProductContract } from './verify-product-contract.mjs';

const OWNERSHIP_SECTIONS = [
  'Core users',
  'Owned outcomes',
  'Supporting capabilities',
  'Consumed contracts',
  'Adjacent products with separate owners',
  'Decision rules for recovered work',
  'Current nonconformities',
  'Not now',
  'Accountability map',
];
const TRUTH_LANES = ['Local', 'CI', 'Deploy', 'Live API', 'Public site'];
const STATUS_TERMS = ['PASS', 'FAIL', 'NOT CHECKED', 'BLOCKED'];
const REQUIRED_SCRIPTS = [
  'build', 'test', 'test:ui', 'cloudflare:test', 'lint',
  'verify:product-contract',
];

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lupi-product-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write(root, 'docs/product-ownership-contract.md', `# Ownership

${OWNERSHIP_SECTIONS.map((section) => `## ${section}\n\n${
  section === 'Current nonconformities'
    ? 'Known contradictions block affected release evidence until their exit condition is met.\n\n| Current contradiction | Exit condition |\n|---|---|\n| `?view=compare` mounts Comparison Theater | Public-site evidence cannot PASS while the route remains reachable. |'
    : 'Required content.'
}`).join('\n\n')}

[Release](release-truth-contract.md)
`);
  write(root, 'docs/release-truth-contract.md', `# Release

[Ownership](product-ownership-contract.md)

| Truth lane | Minimum evidence |
|---|---|
${TRUTH_LANES.map((lane) => `| ${lane} | evidence |`).join('\n')}

## Status vocabulary

${STATUS_TERMS.map((status) => `- **${status}**: definition`).join('\n')}

Direct \`workers.dev\` and custom-domain evidence are separate.

Run \`pnpm verify:product-contract\`, \`pnpm build\`, \`pnpm test\`,
\`pnpm test:ui\`, \`pnpm cloudflare:test\`, and \`pnpm lint\` as distinct gates.
`);
  write(root, 'LUPINE.md', '[Ownership](docs/product-ownership-contract.md)\n');
  write(root, 'README.md', `[Ownership](docs/product-ownership-contract.md)

Terminal authentication is planned—not yet shipped. Plan 026 owns it.
`);
  write(root, 'docs/api-keys.md', 'API keys are planned—not yet shipped. Plan 026 owns the flow.\n');
  write(root, 'docs/ux-redesign-2026.md', '[Ownership](product-ownership-contract.md)\n');
  write(root, 'docs/go-live-playbook.md', `# Historical

> **Historical campaign plan — not current product authority.**
> [Ownership](product-ownership-contract.md)
`);
  write(root, 'docs/operations.md', `[Ownership](product-ownership-contract.md)
[Release](release-truth-contract.md)
`);
  write(root, 'docs/release-checklist.md', `[Ownership](product-ownership-contract.md)
[Release](release-truth-contract.md)
`);
  write(root, 'package.json', `${JSON.stringify({
    scripts: {
      build: 'echo build',
      test: 'echo test',
      'test:ui': 'echo ui',
      'cloudflare:test': 'echo worker',
      lint: 'echo lint',
      'verify:product-contract': 'node tools/verify-product-contract.mjs',
    },
  }, null, 2)}\n`);
  return root;
}

function mutate(root, relativePath, transform) {
  const target = path.join(root, relativePath);
  const before = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, transform(before), 'utf8');
}

function check(result, id) {
  const found = result.checks.find((entry) => entry.id === id);
  assert.ok(found, `missing check ${id}`);
  return found;
}

test('valid fixture passes every contract check', (t) => {
  const root = createFixture(t);
  const result = verifyProductContract(root);
  assert.equal(result.ok, true, result.checks.filter((entry) => !entry.ok).map((entry) => entry.id).join(', '));
});

for (const relativePath of [
  'docs/product-ownership-contract.md',
  'docs/release-truth-contract.md',
]) {
  test(`missing canonical file fails: ${relativePath}`, (t) => {
    const root = createFixture(t);
    fs.rmSync(path.join(root, relativePath));
    const result = verifyProductContract(root);
    assert.equal(check(result, `file:${relativePath}`).ok, false);
  });
}

for (const section of OWNERSHIP_SECTIONS) {
  test(`missing ownership section fails: ${section}`, (t) => {
    const root = createFixture(t);
    mutate(root, 'docs/product-ownership-contract.md', (text) => text.replace(`## ${section}`, `### ${section}`));
    const result = verifyProductContract(root);
    assert.equal(check(result, `ownership-section:${section}`).ok, false);
  });
}

for (const [label, transform] of [
  ['comparison route', (text) => text.replace('?view=compare', '?view=other')],
  ['release-blocking exit condition', (text) => text.replace('cannot PASS', 'may PASS')],
]) {
  test(`missing Comparison Theater nonconformity detail fails: ${label}`, (t) => {
    const root = createFixture(t);
    mutate(root, 'docs/product-ownership-contract.md', transform);
    assert.equal(
      check(verifyProductContract(root), 'current-nonconformity:comparison-theater').ok,
      false,
    );
  });
}

test('ownership heading inside a fenced example does not satisfy the contract', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/product-ownership-contract.md', (text) => (
    `${text.replace('## Core users', '### Core users')}\n\n\`\`\`md\n## Core users\n\`\`\`\n`
  ));
  assert.equal(check(verifyProductContract(root), 'ownership-section:Core users').ok, false);
});

test('ownership heading inside an HTML comment does not satisfy the contract', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/product-ownership-contract.md', (text) => (
    `${text.replace('## Core users', '### Core users')}\n\n<!--\n## Core users\n-->\n`
  ));
  assert.equal(check(verifyProductContract(root), 'ownership-section:Core users').ok, false);
});

const LINK_CASES = [
  ['LUPINE.md', 'docs/product-ownership-contract.md', 'docs/product-ownership-contract.md'],
  ['README.md', 'docs/product-ownership-contract.md', 'docs/product-ownership-contract.md'],
  ['docs/ux-redesign-2026.md', 'product-ownership-contract.md', 'docs/product-ownership-contract.md'],
  ['docs/go-live-playbook.md', 'product-ownership-contract.md', 'docs/product-ownership-contract.md'],
  ['docs/operations.md', 'product-ownership-contract.md', 'docs/product-ownership-contract.md'],
  ['docs/operations.md', 'release-truth-contract.md', 'docs/release-truth-contract.md'],
  ['docs/release-checklist.md', 'product-ownership-contract.md', 'docs/product-ownership-contract.md'],
  ['docs/release-checklist.md', 'release-truth-contract.md', 'docs/release-truth-contract.md'],
];

for (const [source, rawTarget, normalizedTarget] of LINK_CASES) {
  test(`missing canonical link fails: ${source} -> ${rawTarget}`, (t) => {
    const root = createFixture(t);
    mutate(root, source, (text) => text.replace(rawTarget, 'unrelated.md'));
    const result = verifyProductContract(root);
    assert.equal(check(result, `ownership-link:${source}->${normalizedTarget}`).ok, false);
  });
}

test('required link inside a fenced example does not satisfy the contract', (t) => {
  const root = createFixture(t);
  mutate(root, 'LUPINE.md', (text) => (
    `${text.replace('docs/product-ownership-contract.md', 'docs/unrelated.md')}
\`\`\`md
[Example](docs/product-ownership-contract.md)
\`\`\`
`
  ));
  assert.equal(
    check(
      verifyProductContract(root),
      'ownership-link:LUPINE.md->docs/product-ownership-contract.md',
    ).ok,
    false,
  );
});

test('required link inside an HTML comment does not satisfy the contract', (t) => {
  const root = createFixture(t);
  mutate(root, 'LUPINE.md', (text) => (
    `${text.replace('docs/product-ownership-contract.md', 'docs/unrelated.md')}
<!-- [Example](docs/product-ownership-contract.md) -->
`
  ));
  assert.equal(
    check(
      verifyProductContract(root),
      'ownership-link:LUPINE.md->docs/product-ownership-contract.md',
    ).ok,
    false,
  );
});

test('required link may use a reference-style definition', (t) => {
  const root = createFixture(t);
  write(root, 'LUPINE.md', `[Ownership][contract]

[contract]: docs/product-ownership-contract.md "Canonical contract"
`);
  assert.equal(
    check(
      verifyProductContract(root),
      'ownership-link:LUPINE.md->docs/product-ownership-contract.md',
    ).ok,
    true,
  );
});

test('missing historical banner fails', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/go-live-playbook.md', (text) => text.replace('Historical campaign plan', 'Campaign plan'));
  assert.equal(check(verifyProductContract(root), 'historical-banner').ok, false);
});

test('historical banner appearing too late fails', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/go-live-playbook.md', (text) => `${'intro\n'.repeat(16)}${text}`);
  assert.equal(check(verifyProductContract(root), 'historical-banner').ok, false);
});

test('historical banner inside an HTML comment does not satisfy the contract', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/go-live-playbook.md', (text) => (
    `<!-- ${text.replace(/^# Historical\s*/u, '')} -->\n# Campaign plan\n`
  ));
  assert.equal(check(verifyProductContract(root), 'historical-banner').ok, false);
});

for (const lane of TRUTH_LANES) {
  test(`missing truth lane fails: ${lane}`, (t) => {
    const root = createFixture(t);
    mutate(root, 'docs/release-truth-contract.md', (text) => text.replace(`| ${lane} | evidence |`, ''));
    assert.equal(check(verifyProductContract(root), `truth-lane:${lane}`).ok, false);
  });
}

for (const status of STATUS_TERMS) {
  test(`missing status definition fails: ${status}`, (t) => {
    const root = createFixture(t);
    mutate(root, 'docs/release-truth-contract.md', (text) => text.replace(`**${status}**`, status));
    assert.equal(check(verifyProductContract(root), `status:${status}`).ok, false);
  });
}

test('missing workers.dev/custom-domain separation fails', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/release-truth-contract.md', (text) => text.replace('custom-domain evidence are separate', 'deployment evidence is checked'));
  assert.equal(check(verifyProductContract(root), 'origin-separation').ok, false);
});

test('interchangeable workers.dev/custom-domain evidence fails despite separation wording', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/release-truth-contract.md', (text) => (
    text.replace(
      'Direct `workers.dev` and custom-domain evidence are separate.',
      'Direct `workers.dev` and custom-domain evidence are separate and interchangeable.',
    )
  ));
  assert.equal(check(verifyProductContract(root), 'origin-separation').ok, false);
});

test('workers.dev/custom-domain terms and separation must occur in one assertion', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/release-truth-contract.md', (text) => (
    text.replace(
      'Direct `workers.dev` and custom-domain evidence are separate.',
      'Direct `workers.dev` evidence exists. Custom-domain evidence exists. The lanes are separate.',
    )
  ));
  assert.equal(check(verifyProductContract(root), 'origin-separation').ok, false);
});

test('workers.dev/custom-domain separation inside a fence does not satisfy the contract', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/release-truth-contract.md', (text) => (
    `${text.replace(
      'Direct `workers.dev` and custom-domain evidence are separate.',
      'Deployment origins are checked.',
    )}\n\`\`\`md\nDirect \`workers.dev\` and custom-domain evidence are separate.\n\`\`\`\n`
  ));
  assert.equal(check(verifyProductContract(root), 'origin-separation').ok, false);
});

test('malformed package JSON fails', (t) => {
  const root = createFixture(t);
  write(root, 'package.json', '{');
  assert.equal(check(verifyProductContract(root), 'package-scripts').ok, false);
});

test('missing scripts object fails', (t) => {
  const root = createFixture(t);
  write(root, 'package.json', '{}\n');
  assert.equal(check(verifyProductContract(root), 'package-scripts').ok, false);
});

for (const script of REQUIRED_SCRIPTS) {
  test(`missing required package script fails: ${script}`, (t) => {
    const root = createFixture(t);
    const packagePath = path.join(root, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    delete parsed.scripts[script];
    write(root, 'package.json', `${JSON.stringify(parsed, null, 2)}\n`);
    assert.equal(check(verifyProductContract(root), `required-script:${script}`).ok, false);
  });
}

test('miswired verifier script fails', (t) => {
  const root = createFixture(t);
  const packagePath = path.join(root, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  parsed.scripts['verify:product-contract'] = 'echo pretend';
  write(root, 'package.json', `${JSON.stringify(parsed, null, 2)}\n`);
  assert.equal(check(verifyProductContract(root), 'verifier-script-wiring').ok, false);
});

for (const command of [
  'pnpm --silent made-up-script',
  'pnpm -C . made-up-script',
  'pnpm --dir=. made-up-script',
  'pnpm -w made-up-script',
  'pnpm --filter @atlas/web made-up-script',
  'pnpm --filter=@atlas/web run made-up-script',
]) {
  test(`pnpm command behind global flags is validated: ${command}`, (t) => {
    const root = createFixture(t);
    mutate(root, 'README.md', (text) => `${text}\n\`\`\`bash\n${command}\n\`\`\`\n`);
    assert.equal(check(verifyProductContract(root), 'documented-pnpm-scripts').ok, false);
  });
}

test('pnpm commands are scanned in every required Markdown document', (t) => {
  const root = createFixture(t);
  mutate(root, 'LUPINE.md', (text) => `${text}\n\`pnpm made-up-script\`\n`);
  assert.equal(check(verifyProductContract(root), 'documented-pnpm-scripts').ok, false);
});

test('pnpm commands inside HTML comments are not advertised commands', (t) => {
  const root = createFixture(t);
  mutate(root, 'README.md', (text) => `${text}\n<!-- pnpm made-up-script -->\n`);
  assert.equal(check(verifyProductContract(root), 'documented-pnpm-scripts').ok, true);
});

test('any lupi:auth package script fails the Plan 022 gate', (t) => {
  const root = createFixture(t);
  const packagePath = path.join(root, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  parsed.scripts['lupi:auth'] = 'echo placeholder';
  write(root, 'package.json', `${JSON.stringify(parsed, null, 2)}\n`);
  assert.equal(check(verifyProductContract(root), 'auth-package-script-absent').ok, false);
});

test('empty auth script cannot suppress planned markers or command checks', (t) => {
  const root = createFixture(t);
  const packagePath = path.join(root, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  parsed.scripts['lupi:auth'] = '';
  write(root, 'package.json', `${JSON.stringify(parsed, null, 2)}\n`);
  for (const doc of ['README.md', 'docs/api-keys.md']) {
    mutate(root, doc, (text) => text.replace(/planned.{0,24}not yet shipped/isu, 'available now'));
  }
  mutate(root, 'README.md', (text) => `${text}\n\`pnpm --silent lupi:auth\`\n`);
  const result = verifyProductContract(root);
  assert.equal(check(result, 'auth-package-script-absent').ok, false);
  assert.equal(check(result, 'auth-doc-status:README.md').ok, false);
  assert.equal(check(result, 'auth-doc-status:docs/api-keys.md').ok, false);
  assert.equal(check(result, 'auth-doc-command-absent').ok, false);
  assert.equal(check(result, 'documented-pnpm-scripts').ok, false);
});

for (const doc of ['README.md', 'docs/api-keys.md']) {
  test(`undefined lupi:auth example fails: ${doc}`, (t) => {
    const root = createFixture(t);
    mutate(root, doc, (text) => `${text}\n\`\`\`bash\npnpm lupi:auth login\n\`\`\`\n`);
    const result = verifyProductContract(root);
    assert.equal(check(result, 'documented-pnpm-scripts').ok, false);
    assert.equal(check(result, 'auth-doc-command-absent').ok, false);
  });

  test(`missing planned/not-yet-shipped marker fails: ${doc}`, (t) => {
    const root = createFixture(t);
    mutate(root, doc, (text) => text.replace('planned—not yet shipped', 'available now'));
    assert.equal(check(verifyProductContract(root), `auth-doc-status:${doc}`).ok, false);
  });
}

for (const doc of [
  'docs/product-ownership-contract.md',
  'docs/release-truth-contract.md',
]) {
  test(`broken relative link fails: ${doc}`, (t) => {
    const root = createFixture(t);
    mutate(root, doc, (text) => `${text}\n[Broken](missing.md)\n`);
    assert.equal(check(verifyProductContract(root), `canonical-links:${doc}`).ok, false);
  });
}

test('broken used reference-style link fails canonical link validation', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/product-ownership-contract.md', (text) => (
    `${text}\n[Broken][missing-target]\n\n[missing-target]: missing.md\n`
  ));
  assert.equal(
    check(verifyProductContract(root), 'canonical-links:docs/product-ownership-contract.md').ok,
    false,
  );
});

test('balanced and angle-bracket inline targets with titles are supported', (t) => {
  const root = createFixture(t);
  write(root, 'docs/why_(now).md', '# Why now\n');
  write(root, 'docs/my contract.md', '# Contract\n');
  mutate(root, 'docs/product-ownership-contract.md', (text) => (
    `${text}\n[Balanced](why_(now).md "Why")\n[Angle](<my contract.md> 'Contract')\n`
  ));
  assert.equal(
    check(verifyProductContract(root), 'canonical-links:docs/product-ownership-contract.md').ok,
    true,
  );
});

test('links inside fences and HTML comments are ignored by canonical validation', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/product-ownership-contract.md', (text) => (
    `${text}\n\`\`\`md\n[Broken](missing-in-fence.md)\n\`\`\`\n<!-- [Broken](missing-in-comment.md) -->\n`
  ));
  assert.equal(
    check(verifyProductContract(root), 'canonical-links:docs/product-ownership-contract.md').ok,
    true,
  );
});

test('link escaping the repository fails', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/product-ownership-contract.md', (text) => `${text}\n[Escape](../../outside.md)\n`);
  assert.equal(check(verifyProductContract(root), 'canonical-links:docs/product-ownership-contract.md').ok, false);
});

test('external and anchor links are allowed', (t) => {
  const root = createFixture(t);
  mutate(root, 'docs/product-ownership-contract.md', (text) => `${text}\n[External](https://example.com) [Anchor](#core-users)\n`);
  assert.equal(check(verifyProductContract(root), 'canonical-links:docs/product-ownership-contract.md').ok, true);
});

test('CLI exits nonzero and prints the failed check id', (t) => {
  const root = createFixture(t);
  fs.rmSync(path.join(root, 'docs/product-ownership-contract.md'));
  const verifierPath = fileURLToPath(new URL('./verify-product-contract.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [verifierPath, '--root', root], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /FAIL file:docs\/product-ownership-contract\.md/u);
});
