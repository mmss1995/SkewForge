import { defineProject } from 'vitest/config'

export default defineProject({
  test: { name: 'react', environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
})
