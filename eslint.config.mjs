import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,tsx}'];
const reactFiles = ['apps/**/*.{jsx,tsx}', 'packages/**/*.{jsx,tsx}'];
const testFiles = ['**/*.{test,spec}.{js,mjs,cjs,ts,tsx}', 'tests/**/*.{js,mjs,cjs,ts,tsx}'];

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
