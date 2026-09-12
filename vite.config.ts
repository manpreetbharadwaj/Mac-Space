import { readFileSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// tauri.conf.json's `version` is the single source of truth for the app's
// installed version (it's what `cargo tauri build` stamps onto the bundle
// and what the real getVersion() Tauri API reads). Bake it into the browser
// bundle too so the mock prototype (no installed app to ask) has a valid
// version for the update-policy/version-comparison UI to work against.
const tauriConf = JSON.parse(readFileSync(path.resolve(import.meta.dirname, './src-tauri/tauri.conf.json'), 'utf-8'))

// https://vite.dev/config/
// Tauri expects a fixed, predictable dev server port (see src-tauri/tauri.conf.json's devUrl).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(tauriConf.version as string),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
