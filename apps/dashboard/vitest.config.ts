import { defineProject } from 'vitest/config'

export default defineProject({
  test: { name: 'dashboard', environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
})
