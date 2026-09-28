import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const admin = process.env.SKEWFORGE_ADMIN ?? 'http://localhost:8081'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same origin in development as in production, where the admin listener serves the build.
    proxy: { '/api': admin, '/health': admin },
  },
})
