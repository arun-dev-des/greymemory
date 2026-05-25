import { defineConfig } from 'vite'
import react             from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,  // 5173 is greymemory-viz; both can run side by side
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
})
