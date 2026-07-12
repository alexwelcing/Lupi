import { defineConfig, devices } from 'playwright/test';

const LOCAL_BASE_URL = 'http://127.0.0.1:4173';

function deployedBaseUrl() {
  const raw = process.env.UI_TEST_URL?.trim();
  if (!raw) return null;

  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`UI_TEST_URL must use http or https, received ${url.protocol}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('UI_TEST_URL must be a public origin without credentials, query, or hash');
  }
  if (url.pathname !== '/') {
    throw new Error('UI_TEST_URL must be an origin without a path');
  }

  return url.origin;
}

const externalBaseUrl = deployedBaseUrl();
const isDeployedRun = externalBaseUrl !== null;
const baseURL = externalBaseUrl ?? LOCAL_BASE_URL;
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: isDeployedRun ? 2 : process.env.CI ? 1 : 0,
  workers: 1,
  timeout: isDeployedRun ? 150_000 : 120_000,
  expect: {
    timeout: 15_000,
  },
  outputDir: 'test-results/playwright',
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'off',
    launchOptions: {
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      args: ['--disable-webgpu', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isDeployedRun
    ? undefined
    : {
        command: 'node tools/serve-web.mjs',
        url: `${LOCAL_BASE_URL}/`,
        env: {
          HOST: '127.0.0.1',
          PORT: '4173',
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
