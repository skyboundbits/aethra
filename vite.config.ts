/**
 * vite.config.ts
 * Vite build configuration for the Aethra roleplay application.
 * Uses the official React plugin for JSX transform and Fast Refresh.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
