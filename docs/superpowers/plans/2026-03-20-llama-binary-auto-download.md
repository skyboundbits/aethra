# Llama-Server Binary Auto-Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `llama-server` is missing, detect it and offer a one-click in-app download of the correct pre-built binary from GitHub releases, with progress UI in both SettingsModal and ModelLoaderModal.

**Architecture:** Main process handles all download/extraction logic via two new IPC channels (`llama:binary:check` and `llama:binary:install`). A shared React component `LlamaBinaryBanner` is rendered in both modals when the binary is absent. Progress is broadcast from main to renderer via `llama:binary:install:progress`.

**Tech Stack:** Electron 40, React 18, TypeScript 5 strict, Node.js built-ins only (https, fs, path, child_process) — no new npm dependencies.

---

## Confirmed Asset Names for Release `b5616`

These are the exact filenames to use in the lookup table:

| Platform | Backend | Filename | Est. MB |
|----------|---------|----------|---------|
| win32 | cuda | `llama-b5616-bin-win-cuda-12.4-x64.zip` | 126 |
| win32 | vulkan | `llama-b5616-bin-win-vulkan-x64.zip` | 21 |
| win32 | cpu | `llama-b5616-bin-win-cpu-x64.zip` | 14 |
| darwin arm64 | metal | `llama-b5616-bin-macos-arm64.zip` | 10 |
| darwin x64 | metal | `llama-b5616-bin-macos-x64.zip` | 25 |
| linux | vulkan | `llama-b5616-bin-ubuntu-vulkan-x64.zip` | 20 |
| linux | cpu | `llama-b5616-bin-ubuntu-x64.zip` | 12 |

**Note:** No Linux CUDA build exists for b5616 — Linux falls back to Vulkan if NVIDIA GPU detected, then CPU. All assets are `.zip` — `unzip` is used on all platforms (Windows uses PowerShell `Expand-Archive`).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/main/index.ts` | Modify | Add release constant, lookup table, `detectLlamaBinaryBackend()`, `installLlamaBinary()`, `isBinaryInstalling` flag, two IPC handlers, dev-mode candidate in `resolveLlamaExecutablePath` |
| `electron/preload/index.ts` | Modify | Expose `checkLlamaBinary`, `installLlamaBinary`, `onBinaryInstallProgress` on `window.api` |
| `src/types/index.ts` | Modify | Add `BinaryInstallProgress` interface |
| `src/types/electron.d.ts` | Modify | Add type declarations for three new API methods |
| `src/App.tsx` | Modify | Subscribe to `llama:binary:install:progress`; pass state to modals |
| `src/components/LlamaBinaryBanner.tsx` | Create | Shared banner component (prompt / progress / error states) |
| `src/components/SettingsModal.tsx` | Modify | Call `checkLlamaBinary` on open; render `<LlamaBinaryBanner>` |
| `src/components/ModelLoaderModal.tsx` | Modify | Intercept missing-binary error; render `<LlamaBinaryBanner>`; auto-retry |
| `src/styles/binary-install.css` | Create | Banner + progress bar styles (imported by both modals) |

---

## Task 1: Add `BinaryInstallProgress` type and IPC type declarations

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/types/electron.d.ts`

- [ ] **Step 1: Add `BinaryInstallProgress` to `src/types/index.ts`**

Open `src/types/index.ts`. Find the `ModelDownloadProgress` interface (around line 451). Add the new interface directly after it:

```typescript
/**
 * Progress update broadcast during an automatic llama-server binary install.
 * Sent via the `llama:binary:install:progress` IPC channel.
 */
export interface BinaryInstallProgress {
  /** Current phase of the install operation. */
  status: 'detecting' | 'downloading' | 'extracting' | 'complete' | 'error'
  /** Download completion 0–100; null during non-download phases. */
  percent: number | null
  /** Human-readable status line for display in the UI. */
  message: string
  /** Display name of the detected backend; null during the detecting phase. */
  backend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU' | null
}
```

- [ ] **Step 2: Add the three new methods to `src/types/electron.d.ts`**

Open `src/types/electron.d.ts`. Add this import at the top with the existing imports:

```typescript
  BinaryInstallProgress,
```

Then find the `onWindowStateChange` method (the last entry in `window.api`). Add these three new methods before the closing `}` of the `api` object — directly before `onWindowStateChange`:

```typescript
      /**
       * Check whether a usable llama-server binary exists for a local server profile.
       * @param serverId - Local llama.cpp server profile id.
       * @returns Detection result including found status, path, backend, and estimated size.
       */
      checkLlamaBinary: (serverId: string) => Promise<{
        found: boolean
        path: string | null
        detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
        estimatedSizeMb: number
      }>

      /**
       * Download and install the llama-server binary for a local server profile.
       * Progress is broadcast via onBinaryInstallProgress. Returns when complete or on error.
       * @param serverId - Local llama.cpp server profile id.
       * @returns Result with success flag and resolved executable path.
       */
      installLlamaBinary: (serverId: string) => Promise<{
        success: boolean
        executablePath: string | null
        error?: string
      }>

      /**
       * Subscribe to binary install progress updates from the main process.
       * @param listener - Called whenever install progress changes.
       * @returns Cleanup function to remove the listener.
       */
      onBinaryInstallProgress: (listener: (progress: BinaryInstallProgress) => void) => () => void
```

- [ ] **Step 3: Commit**

```bash
cd D:/Development/aethra
git add src/types/index.ts src/types/electron.d.ts
git commit -m "feat: add BinaryInstallProgress type and IPC type declarations"
```

---

## Task 2: Main process — release constants, backend detection, resolver update

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add release constant and asset lookup table**

Open `electron/main/index.ts`. Find the block of constants near line 56 (where `LOCAL_LLAMACPP_SERVER_ID` is defined). Add the following after those constants:

```typescript
/** Pinned llama.cpp GitHub release tag used for binary auto-download. */
const LLAMA_CPP_RELEASE = 'b5616'

/**
 * Static asset lookup table for the pinned llama.cpp release.
 * Key format: `{platform}-{backend}` where backend is the recommendedBackend value.
 * Update LLAMA_CPP_RELEASE and this table together when bumping the bundled version.
 */
const LLAMA_CPP_ASSETS: Record<string, { fileName: string; sizeMb: number; ext: 'zip' }> = {
  'win32-cuda':        { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-win-cuda-12.4-x64.zip`,    sizeMb: 126, ext: 'zip' },
  'win32-vulkan':      { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-win-vulkan-x64.zip`,        sizeMb: 21,  ext: 'zip' },
  'win32-cpu':         { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-win-cpu-x64.zip`,           sizeMb: 14,  ext: 'zip' },
  'darwin-metal-arm64':{ fileName: `llama-${LLAMA_CPP_RELEASE}-bin-macos-arm64.zip`,           sizeMb: 10,  ext: 'zip' },
  'darwin-metal-x64':  { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-macos-x64.zip`,            sizeMb: 25,  ext: 'zip' },
  'linux-cuda':        { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-ubuntu-vulkan-x64.zip`,     sizeMb: 20,  ext: 'zip' }, // no linux cuda build; fall back to vulkan
  'linux-vulkan':      { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-ubuntu-vulkan-x64.zip`,     sizeMb: 20,  ext: 'zip' },
  'linux-cpu':         { fileName: `llama-${LLAMA_CPP_RELEASE}-bin-ubuntu-x64.zip`,            sizeMb: 12,  ext: 'zip' },
}

/** Display name mapping for recommendedBackend values. */
const BACKEND_DISPLAY: Record<string, 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'> = {
  cuda:   'CUDA',
  vulkan: 'Vulkan',
  metal:  'Metal',
  cpu:    'CPU',
}

/** In-flight binary install guard — prevents concurrent installs. */
let isBinaryInstalling = false
```

- [ ] **Step 2: Add `detectLlamaBinaryBackend()` helper function**

Find the `resolveLlamaExecutablePath` function (around line 1895). Add this new function directly before it:

```typescript
/**
 * Detect the best llama.cpp backend for the current machine and return
 * the asset lookup key and display name.
 *
 * @returns Object with the asset key (e.g. 'win32-cuda') and display name.
 */
function detectLlamaBinaryBackend(): { key: string; display: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'; sizeMb: number } {
  const backend = cachedHardwareInfo?.recommendedBackend ?? 'cpu'
  const platform = process.platform // 'win32' | 'darwin' | 'linux'

  // On macOS, differentiate Apple Silicon (arm64) from Intel (x64)
  let key: string
  if (platform === 'darwin') {
    const arch = process.arch === 'x64' ? 'x64' : 'arm64'
    key = `darwin-metal-${arch}`
  } else {
    key = `${platform}-${backend}`
  }

  const asset = LLAMA_CPP_ASSETS[key] ?? LLAMA_CPP_ASSETS[`${platform}-cpu`]
  const display = BACKEND_DISPLAY[backend] ?? 'CPU'
  return { key, display, sizeMb: asset?.sizeMb ?? 0 }
}
```

- [ ] **Step 3: Update `resolveLlamaExecutablePath` to support dev-mode install path**

Find `resolveLlamaExecutablePath` (around line 1895). The `candidates` array currently looks like:

```typescript
  const candidates = [
    explicitPath,
    join(app.getAppPath(), fileName),
    join(app.getAppPath(), 'bin', fileName),
    join(dirname(app.getPath('exe')), fileName),
    join(dirname(app.getPath('exe')), 'llama.cpp', fileName),
  ].filter(...)
```

Add `join(app.getAppPath(), 'llama.cpp', fileName)` as a new candidate between the `bin` candidate and the exe-dir candidate:

```typescript
  const candidates = [
    explicitPath,
    join(app.getAppPath(), fileName),
    join(app.getAppPath(), 'bin', fileName),
    join(app.getAppPath(), 'llama.cpp', fileName),   // dev-mode install destination
    join(dirname(app.getPath('exe')), fileName),
    join(dirname(app.getPath('exe')), 'llama.cpp', fileName),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
```

- [ ] **Step 4: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat: add llama.cpp release constants, backend detection, and dev-mode resolver candidate"
```

---

## Task 3: Main process — `installLlamaBinary()` function

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add required imports at the top of `electron/main/index.ts`**

Check the imports at the top of `electron/main/index.ts`. Ensure these Node.js built-ins are imported. They are likely already present — add any that are missing:

```typescript
import { createWriteStream, existsSync, mkdirSync, copyFileSync, readdirSync, chmodSync, rmSync, statSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import { spawnSync } from 'node:child_process'
```

(The file likely already imports `existsSync`, `spawnSync` — just verify and add `createWriteStream`, `mkdirSync`, `copyFileSync`, `readdirSync`, `chmodSync`, `rmSync`, `statSync` if not present.)

- [ ] **Step 2: Add `installLlamaBinary()` function**

Add this function directly after `detectLlamaBinaryBackend()`:

```typescript
/**
 * Download and extract the llama-server binary for the current platform.
 * Broadcasts BinaryInstallProgress updates throughout. Returns the resolved
 * executable path on success, or throws with a human-readable message on failure.
 *
 * @returns Resolved absolute path to the installed llama-server executable.
 */
async function installLlamaBinary(): Promise<string> {
  const { key, display } = detectLlamaBinaryBackend()
  const asset = LLAMA_CPP_ASSETS[key] ?? LLAMA_CPP_ASSETS[`${process.platform}-cpu`]
  if (!asset) {
    throw new Error(`No llama.cpp asset available for platform '${process.platform}'.`)
  }

  // Determine destination directory
  const destination = app.isPackaged
    ? join(dirname(app.getPath('exe')), 'llama.cpp')
    : join(app.getAppPath(), 'llama.cpp')

  const fileName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const destBinary = join(destination, fileName)

  const tempDir = app.getPath('temp')
  const archivePath = join(tempDir, `llama-cpp-${LLAMA_CPP_RELEASE}.zip`)
  const extractDir = join(tempDir, `llama-cpp-extract-${LLAMA_CPP_RELEASE}`)

  const cleanupTemp = (): void => {
    try { if (existsSync(archivePath)) rmSync(archivePath) } catch { /* ignore */ }
    try { if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  const broadcast = (status: BinaryInstallProgress['status'], percent: number | null, message: string): void => {
    const progress: BinaryInstallProgress = { status, percent, message, backend: status === 'detecting' ? null : display }
    broadcastToAllWindows('llama:binary:install:progress', progress)
  }

  try {
    // Step 0: detecting
    broadcast('detecting', null, 'Detecting platform and backend…')

    const url = `https://github.com/ggerganov/llama.cpp/releases/download/${LLAMA_CPP_RELEASE}/${asset.fileName}`

    // Step 1: ensure destination exists
    mkdirSync(destination, { recursive: true })

    // Step 2: download
    broadcast('downloading', 0, `Downloading llama-server (${display})…`)

    await new Promise<void>((resolve, reject) => {
      const follow = (redirectUrl: string): void => {
        httpsGet(redirectUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} downloading llama-server binary.`))
            return
          }
          const total = res.headers['content-length'] ? parseInt(res.headers['content-length'], 10) : null
          let downloaded = 0
          const out = createWriteStream(archivePath)
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            const percent = total ? Math.round((downloaded / total) * 100) : null
            broadcast('downloading', percent, `Downloading llama-server (${display})… ${percent != null ? `${percent}%` : ''}`)
          })
          res.pipe(out)
          out.on('finish', resolve)
          out.on('error', reject)
          res.on('error', reject)
        }).on('error', reject)
      }
      follow(url)
    })

    // Step 3: extract
    broadcast('extracting', null, 'Extracting…')
    mkdirSync(extractDir, { recursive: true })

    const extractResult = process.platform === 'win32'
      ? spawnSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
        ], { encoding: 'utf-8', windowsHide: true, timeout: 120_000 })
      : spawnSync('unzip', ['-o', archivePath, '-d', extractDir],
          { encoding: 'utf-8', timeout: 120_000 })

    if (extractResult.status !== 0) {
      throw new Error(`Extraction failed: ${(extractResult.stderr ?? '').trim() || 'unknown error'}`)
    }

    // Step 4: locate source root (handle nested subdirectory in zip)
    let sourceRoot = extractDir
    const topLevel = readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory())
    if (topLevel.length === 1) {
      sourceRoot = join(extractDir, topLevel[0].name)
    }

    // Step 5: copy binary (and DLLs on Windows)
    const sourceBinary = join(sourceRoot, fileName)
    if (!existsSync(sourceBinary)) {
      throw new Error(`llama-server binary not found in extracted archive at '${sourceBinary}'.`)
    }
    copyFileSync(sourceBinary, destBinary)

    if (process.platform === 'win32') {
      // Copy all DLLs from source root
      readdirSync(sourceRoot)
        .filter((f) => f.toLowerCase().endsWith('.dll'))
        .forEach((dll) => copyFileSync(join(sourceRoot, dll), join(destination, dll)))
    } else {
      // Ensure binary is executable on macOS/Linux
      chmodSync(destBinary, 0o755)
    }

    // Step 6: cleanup
    cleanupTemp()

    broadcast('complete', 100, 'llama-server installed successfully.')
    return destBinary

  } catch (err) {
    cleanupTemp()
    const message = err instanceof Error ? err.message : String(err)
    broadcast('error', null, message)
    throw err
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat: add installLlamaBinary() download and extraction function"
```

---

## Task 4: Main process — IPC handlers for check and install

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Add `llama:binary:check` IPC handler**

Find the section with other `llama:*` IPC handlers (around line 3001 — look for `ipcMain.handle('llama:pick-models-directory'`). Add the two new handlers alongside them:

```typescript
/** Local llama.cpp: check whether the llama-server binary is present and detect backend. */
ipcMain.handle('llama:binary:check', async (_event, serverId: string): Promise<{
  found: boolean
  path: string | null
  detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  estimatedSizeMb: number
}> => {
  // loadSettings() is synchronous — do NOT use await
  const settings = loadSettings({ syncLocalModels: false })
  const server = settings.servers.find((s) => s.id === serverId) ?? null
  const resolved = server ? resolveLlamaExecutablePath(server) : null
  const { display, sizeMb } = detectLlamaBinaryBackend()
  return {
    found: resolved !== null,
    path: resolved,
    detectedBackend: display,
    estimatedSizeMb: sizeMb,
  }
})
```

- [ ] **Step 2: Add `llama:binary:install` IPC handler**

Add directly after the check handler:

```typescript
/** Local llama.cpp: download and install the llama-server binary. */
ipcMain.handle('llama:binary:install', async (_event, serverId: string): Promise<{
  success: boolean
  executablePath: string | null
  error?: string
}> => {
  if (isBinaryInstalling) {
    return { success: false, executablePath: null, error: 'Install already in progress.' }
  }
  isBinaryInstalling = true
  try {
    const executablePath = await installLlamaBinary()
    return { success: true, executablePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, executablePath: null, error: message }
  } finally {
    isBinaryInstalling = false
  }
})
```

- [ ] **Step 3: Verify `BinaryInstallProgress` type is imported/available in main process**

`BinaryInstallProgress` is defined in `src/types/index.ts`. Check the import at the top of `electron/main/index.ts` — it should already import types from `../../src/types`. Add `BinaryInstallProgress` to that import if not already present.

- [ ] **Step 4: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat: add llama:binary:check and llama:binary:install IPC handlers"
```

---

## Task 5: Preload — expose new API methods to renderer

**Files:**
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Add `BinaryInstallProgress` to the import list**

Open `electron/preload/index.ts`. Find the type imports from `../../src/types`. Add `BinaryInstallProgress` to the list.

- [ ] **Step 2: Expose the three new methods in the `contextBridge.exposeInMainWorld` call**

Find the `onLocalRuntimeStatus` method in the exposed API (around line 340 in preload). Add these three methods directly after it:

```typescript
  /**
   * Check whether a usable llama-server binary exists for a local server profile.
   * @param serverId - Local llama.cpp server profile id.
   */
  checkLlamaBinary: (serverId: string) =>
    ipcRenderer.invoke('llama:binary:check', serverId),

  /**
   * Download and install the llama-server binary for a local server profile.
   * Progress is broadcast via onBinaryInstallProgress during the operation.
   * @param serverId - Local llama.cpp server profile id.
   */
  installLlamaBinary: (serverId: string) =>
    ipcRenderer.invoke('llama:binary:install', serverId),

  /**
   * Subscribe to binary install progress updates from the main process.
   * @param listener - Called whenever install progress changes.
   * @returns Cleanup function to remove the listener.
   */
  onBinaryInstallProgress(listener: (progress: BinaryInstallProgress) => void) {
    function onProgress(_: IpcRendererEvent, progress: BinaryInstallProgress) {
      listener(progress)
    }
    ipcRenderer.on('llama:binary:install:progress', onProgress)
    return () => { ipcRenderer.off('llama:binary:install:progress', onProgress) }
  },
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload/index.ts
git commit -m "feat: expose checkLlamaBinary, installLlamaBinary, onBinaryInstallProgress in preload"
```

---

## Task 6: App.tsx — subscribe to binary install progress

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `binaryInstallProgress` state**

Open `src/App.tsx`. Find the existing state declarations near the top of the `App` component. Add:

```typescript
const [binaryInstallProgress, setBinaryInstallProgress] = useState<BinaryInstallProgress | null>(null)
```

Also add `BinaryInstallProgress` to the type imports from `../types` (or `./types`).

- [ ] **Step 2: Subscribe to the broadcast in the IPC listener `useEffect`**

Find the `useEffect` that sets up IPC listeners (around line 515). Inside it, alongside the existing `onLocalRuntimeStatus` and `onModelDownloadProgress` subscriptions, add:

```typescript
const disposeBinaryInstallListener = window.api.onBinaryInstallProgress((progress) => {
  setBinaryInstallProgress(progress)
  if (progress.status === 'complete' || progress.status === 'error') {
    // Keep the final status visible briefly, then clear after a short delay
    // so modals can react to the completion event before state is wiped
  }
})
```

Add the cleanup in the return function:

```typescript
disposeBinaryInstallListener()
```

- [ ] **Step 3: Pass `binaryInstallProgress` as a prop to `SettingsModal` and `ModelLoaderModal`**

Find where `<SettingsModal>` is rendered (search for `<SettingsModal`). Add the prop:

```tsx
binaryInstallProgress={binaryInstallProgress}
```

Find where `<ModelLoaderModal>` is rendered. Add the same prop:

```tsx
binaryInstallProgress={binaryInstallProgress}
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: subscribe to binary install progress in App.tsx and pass to modals"
```

---

## Task 7: Create `LlamaBinaryBanner` component and styles

**Files:**
- Create: `src/components/LlamaBinaryBanner.tsx`
- Create: `src/styles/binary-install.css`

- [ ] **Step 1: Create `src/styles/binary-install.css`**

```css
/**
 * src/styles/binary-install.css
 * Styles for the LlamaBinaryBanner component shown when the llama-server binary
 * is missing. Used by SettingsModal and ModelLoaderModal.
 */

.binary-banner {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--surface-bg);
  margin-bottom: var(--space-3);
}

.binary-banner--error {
  border-color: var(--status-error-border, var(--border-color));
}

.binary-banner__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.binary-banner__title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.binary-banner__subtitle {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.binary-banner__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.binary-banner__message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.binary-banner__message--error {
  color: var(--status-error, var(--text-secondary));
}

/* Progress bar track */
.binary-install-progress {
  height: 4px;
  border-radius: var(--radius-sm);
  background: var(--surface-bg-emphasis);
  overflow: hidden;
}

/* Progress bar fill */
.binary-install-progress__bar {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-bg-accent);
  transition: width 0.2s ease;
}
```

- [ ] **Step 2: Create `src/components/LlamaBinaryBanner.tsx`**

```tsx
/**
 * src/components/LlamaBinaryBanner.tsx
 * Shared banner component displayed when the llama-server binary is missing.
 * Shows a prompt to auto-download, live progress during install, and error/retry
 * state on failure. Used in SettingsModal and ModelLoaderModal.
 */

import React from 'react'
import type { BinaryInstallProgress } from '../types'
import '../styles/binary-install.css'

/** Props for LlamaBinaryBanner. */
interface LlamaBinaryBannerProps {
  /** Detected backend display name (e.g. 'CUDA', 'Metal'). */
  detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  /** Estimated download size in MB. */
  estimatedSizeMb: number
  /** Current install progress from the main process, or null if not installing. */
  progress: BinaryInstallProgress | null
  /** Called when the user clicks Download or Retry. */
  onInstall: () => void
}

/**
 * Banner shown when llama-server binary is absent or being installed.
 * Renders prompt, progress bar, or error state depending on `progress.status`.
 */
export function LlamaBinaryBanner({ detectedBackend, estimatedSizeMb, progress, onInstall }: LlamaBinaryBannerProps): React.ReactElement {
  const isInstalling = progress !== null &&
    (progress.status === 'detecting' || progress.status === 'downloading' || progress.status === 'extracting')

  const isError = progress?.status === 'error'
  const percent = progress?.percent ?? null

  if (isInstalling) {
    const label = progress.status === 'extracting'
      ? 'Extracting…'
      : progress.status === 'detecting'
        ? 'Detecting platform…'
        : `Downloading llama-server (${progress.backend ?? detectedBackend})…${percent != null ? `  ${percent}%` : ''}`

    return (
      <div className="binary-banner">
        <div className="binary-banner__message">{label}</div>
        <div className="binary-install-progress">
          <div
            className="binary-install-progress__bar"
            style={{ width: percent != null ? `${percent}%` : '0%' }}
          />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="binary-banner binary-banner--error">
        <div className="binary-banner__header">
          <span className="binary-banner__title">Download failed</span>
        </div>
        <div className="binary-banner__message binary-banner__message--error">
          {progress.message}
        </div>
        <div className="binary-banner__actions">
          <button className="btn btn--secondary btn--sm" onClick={onInstall}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Default: prompt state
  return (
    <div className="binary-banner">
      <div className="binary-banner__header">
        <span className="binary-banner__title">llama-server not found</span>
      </div>
      <div className="binary-banner__subtitle">
        Auto-download the {detectedBackend} build? (~{estimatedSizeMb} MB)
      </div>
      <div className="binary-banner__actions">
        <button className="btn btn--primary btn--sm" onClick={onInstall}>
          Download llama-server
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/LlamaBinaryBanner.tsx src/styles/binary-install.css
git commit -m "feat: add LlamaBinaryBanner component and binary-install.css styles"
```

---

## Task 8: SettingsModal — binary check and banner integration

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add `binaryInstallProgress` to `SettingsModalProps`**

Open `src/components/SettingsModal.tsx`. Find the `SettingsModalProps` interface. Add:

```typescript
  /** Current llama-server binary install progress, or null. */
  binaryInstallProgress: BinaryInstallProgress | null
```

Also add `BinaryInstallProgress` to the type imports.

- [ ] **Step 2: Add binary check state**

Inside the `SettingsModal` component, add new state:

```typescript
const [binaryCheckResult, setBinaryCheckResult] = useState<{
  found: boolean
  path: string | null
  detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  estimatedSizeMb: number
} | null>(null)
```

- [ ] **Step 3: Run binary check when a llama.cpp server is active**

Find the `useEffect` that runs when the modal opens or the active server changes (there will likely be one that loads models or settings). Add a new `useEffect`:

```typescript
useEffect(() => {
  const activeServer = servers.find((s) => s.id === activeServerId)
  if (activeServer?.kind !== 'llama.cpp') {
    setBinaryCheckResult(null)
    return
  }
  window.api.checkLlamaBinary(activeServer.id).then(setBinaryCheckResult).catch(() => {
    setBinaryCheckResult(null)
  })
}, [activeServerId, servers])
```

Also re-run the check when install completes:

```typescript
useEffect(() => {
  if (binaryInstallProgress?.status !== 'complete') return
  const activeServer = servers.find((s) => s.id === activeServerId)
  if (activeServer?.kind !== 'llama.cpp') return
  window.api.checkLlamaBinary(activeServer.id).then(setBinaryCheckResult).catch(() => {})
}, [binaryInstallProgress?.status, activeServerId, servers])
```

- [ ] **Step 4: Import and render `LlamaBinaryBanner`**

Add the import at the top of the file:

```typescript
import { LlamaBinaryBanner } from './LlamaBinaryBanner'
```

Find the section in the JSX where the llama.cpp-specific fields are rendered (look for `server.kind === 'llama.cpp'` conditions, near the executable path input). Add the banner above the executable path field, inside the llama.cpp block:

```tsx
{binaryCheckResult && !binaryCheckResult.found && (
  <LlamaBinaryBanner
    detectedBackend={binaryCheckResult.detectedBackend}
    estimatedSizeMb={binaryCheckResult.estimatedSizeMb}
    progress={binaryInstallProgress}
    onInstall={() => {
      const activeServer = servers.find((s) => s.id === activeServerId)
      if (activeServer) window.api.installLlamaBinary(activeServer.id)
    }}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat: integrate LlamaBinaryBanner into SettingsModal"
```

---

## Task 9: ModelLoaderModal — intercept missing-binary error and show banner

**Files:**
- Modify: `src/components/ModelLoaderModal.tsx`

- [ ] **Step 1: Add `binaryInstallProgress` and `onInstallBinary` to `ModelLoaderModalProps`**

Open `src/components/ModelLoaderModal.tsx`. Find `ModelLoaderModalProps`. Add:

```typescript
  /** Current llama-server binary install progress, or null. */
  binaryInstallProgress: BinaryInstallProgress | null
  /** Called when the user requests a binary install from within this modal. */
  onInstallBinary: () => void
  /** Binary check result for the active server — used to show the banner. */
  binaryCheckResult: {
    found: boolean
    detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
    estimatedSizeMb: number
  } | null
```

Add `BinaryInstallProgress` to type imports.

- [ ] **Step 2: Import `LlamaBinaryBanner`**

```typescript
import { LlamaBinaryBanner } from './LlamaBinaryBanner'
```

- [ ] **Step 3: Track missing-binary error state**

Inside the component, add:

```typescript
const [showBinaryBanner, setShowBinaryBanner] = useState(false)
```

- [ ] **Step 4: Intercept missing-binary error in the load handler**

Find where `onLoadModel` is called (the handler that triggers `llama:runtime:load`). Wrap it in a `useCallback` so it can safely be referenced in effects:

```typescript
const handleLoad = useCallback(async () => {
  setShowBinaryBanner(false)
  try {
    await onLoadModel(selectedSlug, contextWindow, temperature)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Could not find llama-server')) {
      setShowBinaryBanner(true)
    }
    // Other errors propagate to the existing statusMessage/statusKind flow in App.tsx
  }
}, [onLoadModel, selectedSlug, contextWindow, temperature])
```

Make sure `useCallback` is imported from React at the top of the file.

Note: Look at how `onLoadModel` is already wired — in `App.tsx` it likely already sets `statusMessage` and `statusKind`. The intercept here is specifically to show the binary banner instead of a raw error string.

- [ ] **Step 5: Auto-retry when install completes**

Add a `useEffect` that watches for install completion and auto-retries the load:

```typescript
useEffect(() => {
  if (binaryInstallProgress?.status !== 'complete') return
  if (!showBinaryBanner) return
  setShowBinaryBanner(false)
  handleLoad()
}, [binaryInstallProgress?.status, showBinaryBanner, handleLoad])
```

- [ ] **Step 6: Render the banner above the Load button**

Find the JSX area just above the Load/Cancel buttons. Add:

```tsx
{showBinaryBanner && binaryCheckResult && (
  <LlamaBinaryBanner
    detectedBackend={binaryCheckResult.detectedBackend}
    estimatedSizeMb={binaryCheckResult.estimatedSizeMb}
    progress={binaryInstallProgress}
    onInstall={onInstallBinary}
  />
)}
```

- [ ] **Step 7: Disable Load button during install**

Find the Load button. Add to its `disabled` condition:

```tsx
disabled={isBusy || (showBinaryBanner && binaryInstallProgress?.status !== 'complete')}
```

- [ ] **Step 8: Wire up new props in App.tsx**

Open `src/App.tsx`.

**A) Add `modelLoaderBinaryCheck` state** alongside the existing state declarations:

```typescript
const [modelLoaderBinaryCheck, setModelLoaderBinaryCheck] = useState<{
  found: boolean
  detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  estimatedSizeMb: number
} | null>(null)
```

**B) Populate it when the ModelLoaderModal opens.** Search for the place in App.tsx where the model loader modal is opened (look for `setIsModelLoaderOpen(true)` or whatever boolean controls ModelLoaderModal visibility). Right next to that call, add:

```typescript
// Check binary availability for the active local llama.cpp server
const activeServer = settings.servers.find((s) => s.id === settings.activeServerId)
if (activeServer?.kind === 'llama.cpp') {
  window.api.checkLlamaBinary(activeServer.id)
    .then((result) => setModelLoaderBinaryCheck(result))
    .catch(() => setModelLoaderBinaryCheck(null))
} else {
  setModelLoaderBinaryCheck(null)
}
```

**C) Re-check after install completes.** Inside the `onBinaryInstallProgress` listener added in Task 6 Step 2, add:

```typescript
if (progress.status === 'complete') {
  const server = settings.servers.find((s) => s.id === settings.activeServerId)
  if (server?.kind === 'llama.cpp') {
    window.api.checkLlamaBinary(server.id)
      .then((result) => setModelLoaderBinaryCheck(result))
      .catch(() => {})
  }
}
```

**D) Pass all new props to `<ModelLoaderModal>`:**

```tsx
binaryInstallProgress={binaryInstallProgress}
binaryCheckResult={modelLoaderBinaryCheck}
onInstallBinary={() => {
  const server = settings.servers.find((s) => s.id === settings.activeServerId)
  if (server?.kind === 'llama.cpp') window.api.installLlamaBinary(server.id)
}}
```

- [ ] **Step 9: Commit**

```bash
git add src/components/ModelLoaderModal.tsx src/App.tsx
git commit -m "feat: integrate LlamaBinaryBanner into ModelLoaderModal with auto-retry"
```

---

## Task 10: Manual smoke test checklist

Since this feature requires a real binary download and extraction, automated tests are not practical. Perform this manual checklist:

- [ ] **Windows CUDA/Vulkan/CPU path:** With no `llama-server.exe` on PATH or configured:
  1. Open Settings → select local llama.cpp server → binary banner appears with correct backend name and size
  2. Click Download → progress bar animates → Extracting → Done → banner disappears → executable path field populates
  3. Open Load Model → banner does not appear (binary now found)

- [ ] **Error path:** Disconnect network mid-download → error banner appears with message → Retry button restarts download

- [ ] **Already installing guard:** Click Download twice quickly → second click is a no-op (no second download starts)

- [ ] **ModelLoaderModal path:** With binary missing, open Load Model, click Load → binary banner appears (not raw error string) → Download → completes → load auto-retries

- [ ] **Dev mode:** In `npm run dev`, binary installs to `<appPath>/llama.cpp/llama-server.exe` and is found on next check

- [ ] **Final commit (if any fixups were needed after testing)**

```bash
git add -p
git commit -m "fix: smoke test fixups for llama binary auto-download"
```

---

## Notes for Implementer

1. **`loadSettings()` is synchronous** — do NOT use `await`. The correct call pattern used throughout the file is `loadSettings({ syncLocalModels: false })`. The `{ syncLocalModels: false }` option skips the file-system scan overhead, which is correct for a lightweight binary-check handler.
2. **`broadcastToAllWindows` helper** — already exists in `electron/main/index.ts`; use it as shown.
3. **Button class names** — check `src/styles/global.css` or existing modal JSX for the actual button class names used (`btn`, `btn--primary`, `btn--secondary`, `btn--sm` or similar) and match them exactly.
4. **CSS error colour variables** — `--status-error` and `--status-error-border` may not exist under those exact names. Check `global.css` and use the actual variable names found there; fall back to `var(--text-secondary)` and `var(--border-color)` if not defined.
