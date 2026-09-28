import vue from '@vitejs/plugin-vue'
import { skewforge } from '@skewforge/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), skewforge()],
})
