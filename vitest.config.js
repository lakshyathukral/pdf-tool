import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // tests/browser is Playwright's. Vitest matches *.spec.js by default and
    // would otherwise try to run those files and fail to even load them.
    include: ['tests/**/*.test.js'],
    exclude: ['tests/browser/**', 'node_modules/**'],
  },
})
