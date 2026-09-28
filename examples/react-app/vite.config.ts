import react from '@vitejs/plugin-react'
import { skewforge } from '@skewforge/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), skewforge()],
})
