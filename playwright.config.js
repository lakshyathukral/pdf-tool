import { defineConfig, devices } from '@playwright/test'

// Tested against three engines, and WebKit is the one that matters: it is what
// Safari runs, on every iPhone, iPad and Mac. The bug that made every PDF fail
// on iOS would have been caught here in seconds.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,

  // Every test renders PDF pages, which is CPU-bound. Running four engines
  // flat out starves them and produces timeouts that look like bugs.
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 2 : 1,

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // A real phone viewport. The redaction dialog running off the side of the
    // screen was invisible at desktop width.
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],

  // Tests run against the PRODUCTION build, not the dev server: the two are
  // different machinery, and it is the built one that reaches people.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
