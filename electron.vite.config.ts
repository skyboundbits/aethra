/**
 * electron.vite.config.ts
 * Build configuration for the Aethra Electron application.
 *
 * Three build targets:
 *   main     – Electron main process  (Node.js, CommonJS output)
 *   preload  – Context bridge script  (Node.js, CommonJS output)
 *   renderer – React UI               (browser, ESM/Vite output)
 */

import { resolve }                       from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react                             from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, 'electron/main/index.ts') },
    },
    plugins: [externalizeDepsPlugin()],
  },

  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },

  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
      },
    },
    plugins: [react()],
  },
})
