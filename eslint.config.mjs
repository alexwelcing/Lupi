import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,tsx}'];
const reactFiles = ['apps/**/*.{jsx,tsx}', 'packages/**/*.{jsx,tsx}'];
const testFiles = ['**/*.{test,spec}.{js,mjs,cjs,ts,tsx}', 'tests/**/*.{js,mjs,cjs,ts,tsx}'];
const rendererStackFiles = [
  'apps/**/*.{js,mjs,ts,tsx}',
  'packages/**/*.{js,mjs,ts,tsx}',
  'tests/**/*.{js,mjs,ts,tsx}',
  'tools/**/*.{js,mjs,ts,tsx}',
];

// The one place each restricted import is allowed (R3F v10 port, plan §4.5).
const LUPI_CANVAS_FILE = 'packages/ui/src/viewer/LupiCanvas.tsx';
const TSL_HOOKS_FILE = 'packages/ui/src/render/tsl.ts';

/**
 * Import rules for the WebGPURenderer stack. `allow` drops the restriction a
 * file is the sanctioned home of: `canvas` (the only <Canvas>) and `tsl` (the
 * only @react-three/tsl import site).
 */
function rendererImportRestrictions({ allow = [] } = {}) {
  const paths = [
    { name: '@react-three/fiber', message: 'Import fiber from @react-three/fiber/webgpu.' },
    { name: '@react-three/fiber/legacy', message: 'Import fiber from @react-three/fiber/webgpu.' },
    {
      name: '@react-three/drei',
      message: 'Import drei from @react-three/drei/webgpu; the root entry is the WebGL build.',
    },
    { name: '@react-three/drei/legacy', message: 'Import drei from @react-three/drei/webgpu.' },
    {
      name: '@react-three/test-renderer',
      message: 'Import the test renderer from @react-three/test-renderer/webgpu; the root entry mounts on the WebGL fiber entry.',
    },
    { name: '@react-three/test-renderer/legacy', message: 'Import the test renderer from @react-three/test-renderer/webgpu.' },
    { name: '@react-three/postprocessing', message: 'Removed in the R3F v10 port; use the TSL render pipeline.' },
    { name: 'postprocessing', message: 'Removed in the R3F v10 port; use the TSL render pipeline.' },
    { name: 'n8ao', message: 'Removed in the R3F v10 port; use the TSL render pipeline.' },
    { name: 'r3f-perf', message: 'Removed in the R3F v10 port.' },
    { name: '@react-three/xr', message: 'Immersive XR was removed in the R3F v10 port.' },
  ];
  if (!allow.includes('tsl')) {
    paths.push({
      name: '@react-three/tsl',
      message: 'Import TSL hooks from packages/ui/src/render/tsl.ts (the one @react-three/tsl import site).',
    });
  }
  if (!allow.includes('canvas')) {
    paths.push({
      name: '@react-three/fiber/webgpu',
      importNames: ['Canvas'],
      message: 'Mount scenes through viewer/LupiCanvas.tsx, the only <Canvas>.',
    });
  }
  return [
    'error',
    {
      paths,
      patterns: [
        {
          group: ['@react-three/xr/*', '@iwer/*', 'postprocessing/*', '@react-three/postprocessing/*'],
          message: 'Removed in the R3F v10 port.',
        },
        {
          group: ['three/src/*', 'three/build/*'],
          message: 'Import TSL nodes from three/tsl and renderer classes from three/webgpu.',
        },
      ],
    },
  ];
}

const WEBGL_ONLY_THREE_EXPORTS = new Set([
  'WebGLRenderer',
  'WebGLRenderTarget',
  'WebGLCubeRenderTarget',
  'PMREMGenerator',
]);

/**
 * `three` exports the WebGL renderer classes; the port renders with
 * WebGPURenderer, whose PMREMGenerator and RenderTarget come from
 * three/webgpu. TSL nodes come from three/tsl, not the `TSL` namespace of
 * three/webgpu. `no-restricted-imports` cannot express either without also
 * rejecting every `import * as THREE from 'three'`, so this rule follows the
 * namespace binding to the member that is used.
 */
const threeRendererImportsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      webgl: "'{{name}}' from 'three' is the WebGL renderer stack; use WebGPURenderer and three/webgpu instead.",
      tsl: "Import TSL nodes from 'three/tsl' rather than the TSL namespace of three/webgpu.",
    },
  },
  create(context) {
    const namespaces = new Map();
    const bannedFor = (source, name) => {
      if (source === 'three' && WEBGL_ONLY_THREE_EXPORTS.has(name)) return 'webgl';
      if (source === 'three/webgpu' && name === 'TSL') return 'tsl';
      return null;
    };
    const checkMember = (node, objectNode, propertyNode) => {
      if (objectNode?.type !== 'Identifier' || propertyNode?.type !== 'Identifier') return;
      const source = namespaces.get(objectNode.name);
      const messageId = source ? bannedFor(source, propertyNode.name) : null;
      if (messageId) context.report({ node, messageId, data: { name: propertyNode.name } });
    };
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source !== 'three' && source !== 'three/webgpu') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.set(specifier.local.name, source);
          } else if (specifier.type === 'ImportSpecifier') {
            const name = specifier.imported.name ?? specifier.imported.value;
            const messageId = bannedFor(source, name);
            if (messageId) context.report({ node: specifier, messageId, data: { name } });
          }
        }
      },
      MemberExpression(node) {
        if (!node.computed) checkMember(node, node.object, node.property);
      },
      TSQualifiedName(node) {
        checkMember(node, node.left, node.right);
      },
    };
  },
};

const lupiPlugin = { rules: { 'three-renderer-imports': threeRendererImportsRule } };

// Errors since the port closed (plan §4.6, §4.7): fiber v10 frame jobs use
// named phases, and WebGPURenderer compiles node materials only.
const legacyRenderingPatterns = [
  'error',
  {
    selector: "CallExpression[callee.name='useFrame'][arguments.1.type=/^(Literal|UnaryExpression)$/]",
    message: 'Numeric useFrame priorities are reordered by fiber v10 and a positive one disables rendering; use { phase, id } from LUPI_PHASE/LUPI_JOB.',
  },
  {
    selector: "CallExpression[callee.name='useFrame'] > ObjectExpression > Property[key.name='priority']",
    message: 'Numeric useFrame priorities are reordered by fiber v10 and a positive one disables rendering; use { phase, id } from LUPI_PHASE/LUPI_JOB.',
  },
  {
    selector: "NewExpression[callee.name=/^(Raw)?ShaderMaterial$/], NewExpression[callee.property.name=/^(Raw)?ShaderMaterial$/]",
    message: 'No new GLSL: write node materials with TSL (three/tsl) instead of ShaderMaterial/RawShaderMaterial.',
  },
  {
    selector: "JSXOpeningElement[name.name=/^(raw)?[sS]haderMaterial$/]",
    message: 'No new GLSL: write node materials with TSL (three/tsl) instead of ShaderMaterial/RawShaderMaterial.',
  },
  {
    selector: "MemberExpression[property.name='onBeforeCompile']",
    message: 'onBeforeCompile patches GLSL, which WebGPURenderer never compiles; use a node material.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      '**/lib/**',
      '**/out/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      '**/.verify-artifacts/**',
      'apps/web/public/**',
      'packages/parsers/pkg/**',
      'docs/brainstorm/**/spike/**',
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.es2024,
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-constant-binary-expression': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{js,mjs,ts,tsx}', 'packages/**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['apps/mcp-worker/**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.node,
      },
    },
  },
  {
    files: [
      'apps/remotion-trailer/**/*.{js,mjs,ts,tsx}',
      'functions/**/*.{js,mjs,cjs,ts,tsx}',
      'scripts/**/*.{js,mjs,cjs,ts,tsx}',
      'tools/**/*.{js,mjs,cjs,ts,tsx}',
      '*.config.{js,mjs,cjs,ts}',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: reactFiles,
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      'react/jsx-no-duplicate-props': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: rendererStackFiles,
    plugins: { lupi: lupiPlugin },
    rules: {
      'no-restricted-imports': rendererImportRestrictions(),
      'no-restricted-syntax': legacyRenderingPatterns,
      'lupi/three-renderer-imports': 'error',
    },
  },
  {
    files: [LUPI_CANVAS_FILE],
    rules: { 'no-restricted-imports': rendererImportRestrictions({ allow: ['canvas'] }) },
  },
  {
    files: [TSL_HOOKS_FILE],
    rules: { 'no-restricted-imports': rendererImportRestrictions({ allow: ['tsl'] }) },
  },
  {
    files: testFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },
    },
  },
);
