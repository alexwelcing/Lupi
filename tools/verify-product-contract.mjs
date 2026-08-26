import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FILES = [
  'docs/product-ownership-contract.md',
  'docs/release-truth-contract.md',
  'LUPINE.md',
  'README.md',
  'docs/api-keys.md',
  'docs/ux-redesign-2026.md',
  'docs/go-live-playbook.md',
  'docs/operations.md',
  'docs/release-checklist.md',
  'package.json',
];

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
  'build',
  'test',
  'test:ui',
  'cloudflare:test',
  'lint',
  'verify:product-contract',
];

const COMMAND_DOCS = REQUIRED_FILES.filter((relativePath) => relativePath.endsWith('.md'));

const PNPM_BUILTINS = new Set([
  'add', 'audit', 'config', 'create', 'deploy', 'dlx', 'env', 'exec', 'fetch',
  'i', 'import', 'init', 'install', 'link', 'list', 'ls', 'outdated', 'pack',
  'prune', 'publish', 'rebuild', 'remove', 'root', 'run', 'setup', 'store',
  'unlink', 'up', 'update', 'why',
]);

const REQUIRED_LINKS = [
  ['LUPINE.md', 'docs/product-ownership-contract.md'],
  ['README.md', 'docs/product-ownership-contract.md'],
  ['docs/ux-redesign-2026.md', 'docs/product-ownership-contract.md'],
  ['docs/go-live-playbook.md', 'docs/product-ownership-contract.md'],
  ['docs/operations.md', 'docs/product-ownership-contract.md'],
  ['docs/operations.md', 'docs/release-truth-contract.md'],
  ['docs/release-checklist.md', 'docs/product-ownership-contract.md'],
  ['docs/release-checklist.md', 'docs/release-truth-contract.md'],
];

function readText(rootDir, relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return fs.existsSync(absolutePath)
    ? fs.readFileSync(absolutePath, 'utf8')
    : null;
}

function preserveNewlinesOnly(value) {
  return value.replace(/[^\r\n]/gu, ' ');
}

function stripHtmlComments(markdown) {
  if (markdown == null) return null;
  return markdown.replace(/<!--[\s\S]*?(?:-->|$)/gu, preserveNewlinesOnly);
}

function semanticMarkdown(markdown) {
  if (markdown == null) return null;

  let fence = null;
  const lines = markdown.split(/\r?\n/u).map((line) => {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)?.[1] ?? null;
    if (fence != null) {
      const closing = line.match(/^[ \t]{0,3}([`~]+)[ \t]*$/u)?.[1] ?? null;
      if (
        closing != null
        && closing[0] === fence.character
        && closing.length >= fence.length
      ) {
        fence = null;
      }
      return '';
    }
    if (marker != null) {
      fence = { character: marker[0], length: marker.length };
      return '';
    }
    return line;
  });

  return stripHtmlComments(lines.join('\n'));
}

function headingExists(markdown, heading) {
  const semantic = semanticMarkdown(markdown);
  if (semantic == null) return false;
  return semantic
    .split(/\r?\n/u)
    .some((line) => line.trim() === `## ${heading}`);
}

function normalizeReferenceLabel(label) {
  return label
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, '$1')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function unescapeMarkdownDestination(target) {
  return target.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/gu, '$1');
}

function findClosingBracket(markdown, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
    } else if (markdown[index] === '[') {
      depth += 1;
    } else if (markdown[index] === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findUnescaped(markdown, startIndex, expected) {
  for (let index = startIndex; index < markdown.length; index += 1) {
    if (markdown[index] === '\\') {
      index += 1;
    } else if (markdown[index] === expected) {
      return index;
    }
  }
  return -1;
}

function finishInlineLink(markdown, startIndex) {
  let index = startIndex;
  while (/\s/u.test(markdown[index] ?? '')) index += 1;
  if (markdown[index] === ')') return index;

  const opener = markdown[index];
  const closer = opener === '"' ? '"' : opener === "'" ? "'" : opener === '(' ? ')' : null;
  if (closer == null) return -1;
  const titleEnd = findUnescaped(markdown, index + 1, closer);
  if (titleEnd === -1) return -1;
  index = titleEnd + 1;
  while (/\s/u.test(markdown[index] ?? '')) index += 1;
  return markdown[index] === ')' ? index : -1;
}

function parseInlineLink(markdown, openingParenIndex) {
  let index = openingParenIndex + 1;
  while (/\s/u.test(markdown[index] ?? '')) index += 1;

  if (markdown[index] === '<') {
    const targetEnd = findUnescaped(markdown, index + 1, '>');
    if (targetEnd === -1) return null;
    const linkEnd = finishInlineLink(markdown, targetEnd + 1);
    if (linkEnd === -1) return null;
    return {
      target: unescapeMarkdownDestination(markdown.slice(index + 1, targetEnd)),
      end: linkEnd,
    };
  }

  const targetStart = index;
  let nestedParentheses = 0;
  while (index < markdown.length) {
    const character = markdown[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '(') {
      nestedParentheses += 1;
    } else if (character === ')') {
      if (nestedParentheses === 0) {
        return {
          target: unescapeMarkdownDestination(markdown.slice(targetStart, index)),
          end: index,
        };
      }
      nestedParentheses -= 1;
    } else if (/\s/u.test(character) && nestedParentheses === 0) {
      const linkEnd = finishInlineLink(markdown, index);
      if (linkEnd === -1) return null;
      return {
        target: unescapeMarkdownDestination(markdown.slice(targetStart, index)),
        end: linkEnd,
      };
    }
    index += 1;
  }
  return null;
}

function parseReferenceDestination(rawTarget) {
  let index = 0;
  while (/[ \t]/u.test(rawTarget[index] ?? '')) index += 1;
  if (rawTarget[index] === '<') {
    const targetEnd = findUnescaped(rawTarget, index + 1, '>');
    return targetEnd === -1
      ? null
      : unescapeMarkdownDestination(rawTarget.slice(index + 1, targetEnd));
  }

  const targetStart = index;
  let nestedParentheses = 0;
  while (index < rawTarget.length) {
    const character = rawTarget[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '(') {
      nestedParentheses += 1;
    } else if (character === ')') {
      if (nestedParentheses === 0) break;
      nestedParentheses -= 1;
    } else if (/\s/u.test(character) && nestedParentheses === 0) {
      break;
    }
    index += 1;
  }
  if (nestedParentheses !== 0 || index === targetStart) return null;
  return unescapeMarkdownDestination(rawTarget.slice(targetStart, index));
}

function extractReferenceDefinitions(markdown) {
  const definitions = new Map();
  const body = markdown.split(/\r?\n/u).map((line) => {
    const match = line.match(/^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(.*)$/u);
    if (match == null) return line;
    definitions.set(normalizeReferenceLabel(match[1]), {
      target: parseReferenceDestination(match[2]),
    });
    return '';
  }).join('\n');
  return { definitions, body };
}

function skipInlineCode(markdown, openingIndex) {
  let length = 1;
  while (markdown[openingIndex + length] === '`') length += 1;
  const marker = '`'.repeat(length);
  const closingIndex = markdown.indexOf(marker, openingIndex + length);
  return closingIndex === -1 ? openingIndex + length - 1 : closingIndex + length - 1;
}

function markdownLinkInventory(markdown) {
  const semantic = semanticMarkdown(markdown);
  if (semantic == null) return { targets: [], errors: [] };
  const { definitions, body } = extractReferenceDefinitions(semantic);
  const targets = [];
  const errors = [];

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '`') {
      index = skipInlineCode(body, index);
      continue;
    }
    if (body[index] !== '[') continue;

    const labelEnd = findClosingBracket(body, index);
    if (labelEnd === -1) continue;
    const label = body.slice(index + 1, labelEnd);
    const nextIndex = labelEnd + 1;

    if (body[nextIndex] === '(') {
      const inline = parseInlineLink(body, nextIndex);
      if (inline == null) {
        errors.push(`malformed inline link near ${label}`);
      } else {
        targets.push(inline.target);
        index = inline.end;
      }
      continue;
    }

    let referenceLabel = normalizeReferenceLabel(label);
    if (body[nextIndex] === '[') {
      const referenceEnd = findClosingBracket(body, nextIndex);
      if (referenceEnd === -1) {
        errors.push(`malformed reference link near ${label}`);
        continue;
      }
      const explicitLabel = body.slice(nextIndex + 1, referenceEnd);
      if (explicitLabel.trim().length > 0) {
        referenceLabel = normalizeReferenceLabel(explicitLabel);
      }
      index = referenceEnd;
      if (!definitions.has(referenceLabel)) {
        errors.push(`missing reference definition ${referenceLabel}`);
        continue;
      }
    } else if (!definitions.has(referenceLabel)) {
      index = labelEnd;
      continue;
    }

    const definition = definitions.get(referenceLabel);
    if (definition?.target == null) {
      errors.push(`malformed reference definition ${referenceLabel}`);
    } else {
      targets.push(definition.target);
    }
  }

  return { targets, errors };
}

function markdownTargets(markdown) {
  return markdownLinkInventory(markdown).targets;
}

function normalizedRepositoryTarget(rootDir, sourcePath, rawTarget) {
  if (/^(?:https?:|mailto:|tel:)/iu.test(rawTarget) || rawTarget.startsWith('#')) {
    return { external: true };
  }

  const withoutFragment = rawTarget.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return { external: true };

  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return { error: `cannot decode target ${rawTarget}` };
  }

  const resolved = path.resolve(rootDir, path.dirname(sourcePath), decoded);
  const relative = path.relative(rootDir, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { error: `target escapes repository: ${rawTarget}` };
  }
  return { relative: relative.split(path.sep).join('/'), resolved };
}

function hasRequiredLink(rootDir, sourcePath, expectedTarget) {
  const markdown = readText(rootDir, sourcePath);
  return markdownTargets(markdown).some((rawTarget) => {
    const normalized = normalizedRepositoryTarget(rootDir, sourcePath, rawTarget);
    return normalized.relative === expectedTarget;
  });
}

function documentedPnpmScripts(rootDir) {
  const results = [];
  const optionValue = String.raw`(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s\x60]+)`;
  const noValueOption = String.raw`(?:-s|--silent|-w|--workspace-root)`;
  const valueOption = String.raw`(?:-C|--dir|--filter)(?:=${optionValue}|[ \t]+${optionValue})`;
  const globalOption = String.raw`(?:${noValueOption}|${valueOption})`;
  const optionPrefix = String.raw`(?:${globalOption}[ \t]+)*`;
  const pattern = new RegExp(
    String.raw`\bpnpm[ \t]+${optionPrefix}(?:run[ \t]+${optionPrefix})?([A-Za-z][A-Za-z0-9:_-]*)`,
    'gu',
  );
  for (const doc of COMMAND_DOCS) {
    const markdown = stripHtmlComments(readText(rootDir, doc));
    if (markdown == null) continue;
    for (const match of markdown.matchAll(pattern)) {
      const candidate = match[1];
      if (!PNPM_BUILTINS.has(candidate)) {
        results.push({ doc, script: candidate });
      }
    }
  }
  return results;
}

function plannedAuthMarker(markdown) {
  const semantic = semanticMarkdown(markdown);
  if (semantic == null) return false;
  const normalized = semantic
    .replace(/[—–]/gu, '-')
    .toLowerCase();
  return /planned.{0,24}not yet shipped/su.test(normalized)
    && normalized.includes('plan 026');
}

function comparisonNonconformityExists(markdown) {
  const semantic = semanticMarkdown(markdown);
  if (semantic == null) return false;
  const heading = /^## Current nonconformities\s*$/mu.exec(semantic);
  if (heading == null) return false;
  const remainder = semantic.slice(heading.index + heading[0].length);
  const nextHeading = /^##\s/mu.exec(remainder);
  const section = nextHeading == null ? remainder : remainder.slice(0, nextHeading.index);
  return section.includes('?view=compare')
    && /Comparison Theater/iu.test(section)
    && /exit condition/iu.test(section)
    && /block[\s\S]{0,80}release evidence/iu.test(section)
    && /cannot\s+(?:\*\*)?PASS/iu.test(section);
}

function separatesDeploymentOrigins(markdown) {
  const semantic = semanticMarkdown(markdown);
  if (semantic == null) return false;
  const clauses = semantic.split(/(?:\r?\n)+|[.!?](?:\s+|$)/u);
  const jointClauses = clauses.filter(
    (clause) => /workers\.dev/iu.test(clause) && /custom-domain/iu.test(clause),
  );
  const explicitlySeparate = jointClauses.some(
    (clause) => /\b(?:separate(?:d|ly)?|distinct)\b/iu.test(clause),
  );
  const contradictory = jointClauses.some(
    (clause) => /\b(?:interchangeable|substitut(?:e|ed|able|ing|ion))\b/iu.test(clause),
  );
  return explicitlySeparate && !contradictory;
}

export function verifyProductContract(rootDir) {
  const root = path.resolve(rootDir);
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  for (const relativePath of REQUIRED_FILES) {
    add(
      `file:${relativePath}`,
      fs.existsSync(path.join(root, relativePath)),
      `required file ${relativePath}`,
    );
  }

  const ownership = readText(root, 'docs/product-ownership-contract.md');
  for (const section of OWNERSHIP_SECTIONS) {
    add(
      `ownership-section:${section}`,
      headingExists(ownership, section),
      `ownership contract has H2 ${section}`,
    );
  }
  add(
    'current-nonconformity:comparison-theater',
    comparisonNonconformityExists(ownership),
    'Current nonconformities records ?view=compare/Comparison Theater and its release-blocking exit condition',
  );

  for (const [source, target] of REQUIRED_LINKS) {
    add(
      `ownership-link:${source}->${target}`,
      hasRequiredLink(root, source, target),
      `${source} links to ${target}`,
    );
  }

  const playbook = readText(root, 'docs/go-live-playbook.md');
  const banner = semanticMarkdown(
    playbook?.split(/\r?\n/u).slice(0, 15).join('\n') ?? '',
  ) ?? '';
  add(
    'historical-banner',
    /Historical campaign plan/iu.test(banner)
      && /not current product authority/iu.test(banner),
    'go-live playbook has a prominent historical/non-authoritative banner',
  );

  const release = readText(root, 'docs/release-truth-contract.md');
  const semanticRelease = semanticMarkdown(release);
  for (const lane of TRUTH_LANES) {
    const escaped = lane.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    add(
      `truth-lane:${lane}`,
      semanticRelease != null
        && new RegExp(`^\\|\\s*${escaped}\\s*\\|`, 'mu').test(semanticRelease),
      `release contract has ${lane} evidence row`,
    );
  }
  for (const status of STATUS_TERMS) {
    add(
      `status:${status}`,
      semanticRelease?.includes(`**${status}**`) ?? false,
      `release contract defines ${status}`,
    );
  }
  add(
    'origin-separation',
    separatesDeploymentOrigins(release),
    'release contract separates workers.dev and custom-domain evidence',
  );

  let scripts = null;
  let rootPackage = null;
  const packageText = readText(root, 'package.json');
  if (packageText != null) {
    try {
      const parsed = JSON.parse(packageText);
      rootPackage = parsed;
      scripts = parsed?.scripts && typeof parsed.scripts === 'object'
        ? parsed.scripts
        : null;
    } catch {
      scripts = null;
    }
  }
  add('package-scripts', scripts != null, 'package.json has a valid scripts object');

  let webPackage = null;
  const webPackageText = readText(root, 'apps/web/package.json');
  if (webPackageText != null) {
    try {
      webPackage = JSON.parse(webPackageText);
    } catch {
      webPackage = null;
    }
  }
  const rootTsxScripts = ['nist:build', 'doctor', 'bake:glimbin', 'generate:mcp-manifest'];
  add(
    'tsx-owner:root',
    rootPackage?.devDependencies?.tsx === '^4.20.0'
      && rootTsxScripts.every((name) => /^tsx\s/u.test(rootPackage?.scripts?.[name] ?? ''))
      && rootTsxScripts.every((name) => !/\bnpx\b[^\n]*\btsx\b/u.test(rootPackage?.scripts?.[name] ?? '')),
    'root scripts directly own and invoke the pinned tsx CLI',
  );
  add(
    'tsx-owner:web',
    webPackage?.devDependencies?.tsx === '^4.20.0'
      && /(?:^|&&\s*)tsx\s+\.\.\/\.\.\/tools\/generate-mcp-manifest\.ts(?:\s*&&|$)/u.test(webPackage?.scripts?.build ?? '')
      && !/\bnpx\b[^\n]*\btsx\b/u.test(webPackage?.scripts?.build ?? ''),
    '@atlas/web directly owns the tsx CLI used by its build',
  );

  const documentedCommands = documentedPnpmScripts(root);
  if (scripts != null) {
    for (const script of REQUIRED_SCRIPTS) {
      add(
        `required-script:${script}`,
        typeof scripts[script] === 'string' && scripts[script].trim().length > 0,
        `package.json defines ${script}`,
      );
    }
    add(
      'verifier-script-wiring',
      scripts['verify:product-contract'] === 'node tools/verify-product-contract.mjs',
      'verify:product-contract invokes the canonical verifier',
    );

    const undefinedCommands = documentedCommands
      .filter(({ script }) => (
        typeof scripts[script] !== 'string' || scripts[script].trim().length === 0
      ));
    add(
      'documented-pnpm-scripts',
      undefinedCommands.length === 0,
      undefinedCommands.length === 0
        ? 'all documented pnpm script commands exist'
        : `undefined commands: ${undefinedCommands.map(({ doc, script }) => `${doc}:${script}`).join(', ')}`,
    );
  }

  add(
    'auth-package-script-absent',
    scripts != null && !Object.prototype.hasOwnProperty.call(scripts, 'lupi:auth'),
    'Plan 022 requires lupi:auth to remain absent until Plan 026 changes the gate',
  );
  const readme = readText(root, 'README.md');
  const apiKeys = readText(root, 'docs/api-keys.md');
  add(
    'auth-doc-status:README.md',
    plannedAuthMarker(readme),
    'README marks terminal auth planned/not yet shipped and points to Plan 026',
  );
  add(
    'auth-doc-status:docs/api-keys.md',
    plannedAuthMarker(apiKeys),
    'API-key docs mark the flow planned/not yet shipped and points to Plan 026',
  );
  const executableAuth = documentedCommands
    .filter(({ script }) => script === 'lupi:auth')
    .map(({ doc }) => doc);
  add(
    'auth-doc-command-absent',
    executableAuth.length === 0,
    executableAuth.length === 0
      ? 'no executable pnpm lupi:auth example is advertised'
      : `lupi:auth advertised in ${[...new Set(executableAuth)].join(', ')}`,
  );

  for (const canonicalDoc of [
    'docs/product-ownership-contract.md',
    'docs/release-truth-contract.md',
  ]) {
    const markdown = readText(root, canonicalDoc);
    const inventory = markdownLinkInventory(markdown);
    const broken = [...inventory.errors];
    for (const rawTarget of inventory.targets) {
      const normalized = normalizedRepositoryTarget(root, canonicalDoc, rawTarget);
      if (normalized.external) continue;
      if (normalized.error) {
        broken.push(normalized.error);
      } else if (!fs.existsSync(normalized.resolved)) {
        broken.push(`missing ${normalized.relative}`);
      }
    }
    add(
      `canonical-links:${canonicalDoc}`,
      markdown != null && broken.length === 0,
      broken.length === 0
        ? `${canonicalDoc} relative links resolve inside the repository`
        : broken.join('; '),
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}

function cliRoot(args) {
  const rootIndex = args.indexOf('--root');
  if (rootIndex === -1) {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  }
  if (!args[rootIndex + 1]) {
    throw new Error('--root requires a directory');
  }
  return path.resolve(args[rootIndex + 1]);
}

function runCli() {
  let root;
  try {
    root = cliRoot(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL cli: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = verifyProductContract(root);
  for (const check of result.checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
