import { defineProject } from 'vitest/config'

export default defineProject({
  test: { name: 'vite', environment: 'node' },
})
