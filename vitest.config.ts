import { defineConfig } from 'vitest/config'

// One runner for the whole monorepo: each workspace declares its own environment.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
})
