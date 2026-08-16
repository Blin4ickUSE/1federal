import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-telegram-sdk',
      closeBundle() {
        const sdkSrc = resolve(__dirname, 'public/telegram-web-app.js')
        if (!existsSync(sdkSrc)) return
        const outRoot = resolve(__dirname, 'dist/telegram-web-app.js')
        const outSdk = resolve(__dirname, 'dist/sdk/telegram-web-app.js')
        mkdirSync(resolve(__dirname, 'dist/sdk'), { recursive: true })
        cpSync(sdkSrc, outRoot)
        cpSync(sdkSrc, outSdk)
      },
    },
  ],
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
    port: 3000
  },
  preview: {
    host: '0.0.0.0',
    port: 3000
  }
})
