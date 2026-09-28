import react from '@vitejs/plugin-react'
import { skewforge } from '@skewforge/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), skewforge()],
  build: {
    rolldownOptions: {
      // A stable vendor chunk: releases that only touch app code reuse it, so SkewForge stores it once.
      output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
    },
  },
})
