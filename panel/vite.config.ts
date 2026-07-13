import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3001
  },
  preview: {
    host: '0.0.0.0',
    port: 3001
  }
})

