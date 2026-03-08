/**
 * src/main.tsx
 * Application entry point.
 * Mounts the React root into the #root div defined in index.html.
 * StrictMode is enabled to surface potential issues during development.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Mount the application
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
