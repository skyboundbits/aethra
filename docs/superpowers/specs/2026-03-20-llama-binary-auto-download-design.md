# Llama-Server Binary Auto-Download — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Aethra — Electron + React roleplay app

---

## Problem

Users who select the local llama.cpp provider get a runtime error:
> "Could not find llama-server. Configure its executable path in Settings or add it to PATH."

There is no in-app mechanism to obtain the binary. Users must manually download llama.cpp, extract it, and configure the path — a significant friction point.

---

## Goal

When `llama-server` is missing, the app detects this and offers a one-click automatic download of the correct pre-built binary from the official llama.cpp GitHub releases. After download and extraction, the binary is placed where `resolveLlamaExecutablePath` already searches, requiring no further user action.

---

## Scope

- **In scope:** Windows, macOS, Linux; CUDA / Vulkan / Metal / CPU-only backends; auto-detection of best backend; download + extraction; progress UI in Settings Modal and Model Loader Modal.
- **Out of scope:** Auto-updating the binary after installation; manual backend selection UI; bundling the binary inside the installer.

---

## Architecture

### 1. Platform + Backend Detection

Runs in the **main process** using existing `hardwareInfo` (already populated at startup). `hardwareInfo.recommendedBackend` uses lowercase values (`'cuda' | 'vulkan' | 'metal' | 'cpu'`). `detectLlamaBinaryBackend()` reads this value directly and maps it to a display string for the UI:

| `recommendedBackend` value | Display string | Asset backend segment |
|---------------------------|---------------|----------------------|
| `'cuda'`                  | `'CUDA'`      | `cuda-cu12.x.x`      |
| `'vulkan'`                | `'Vulkan'`    | `vulkan`             |
| `'metal'`                 | `'Metal'`     | _(macOS build includes Metal)_ |
| `'cpu'`                   | `'CPU'`       | `noavx` or `avx2`   |

`BinaryInstallProgress.backend` carries the **display string** (`'CUDA'`, `'Vulkan'`, `'Metal'`, `'CPU'`). The raw `recommendedBackend` value is used internally only.

Priority matrix (mirrors `HardwareInfo.recommendedBackend` logic):

| Platform | GPU detected | `recommendedBackend` |
|----------|-------------|----------------------|
| Windows  | NVIDIA       | `'cuda'`             |
| Windows  | Any other    | `'vulkan'`           |
| Windows  | None         | `'cpu'`              |
| macOS    | Any          | `'metal'`            |
| Linux    | NVIDIA       | `'cuda'`             |
| Linux    | Any other    | `'vulkan'`           |
| Linux    | None         | `'cpu'`              |

A pinned release tag constant `LLAMA_CPP_RELEASE = 'b5616'` in `electron/main/index.ts` determines which GitHub release to download. Updated manually when bumping the bundled version.

Asset URL format:
```
https://github.com/ggerganov/llama.cpp/releases/download/{tag}/{asset-name}.zip
```

Asset name is constructed from platform + backend + architecture using a static lookup table (no network call needed). Example entries:
- Windows CUDA: `llama-b5616-bin-win-cuda-cu12.2.0-x64.zip`
- Windows Vulkan: `llama-b5616-bin-win-vulkan-x64.zip`
- Windows CPU: `llama-b5616-bin-win-noavx-x64.zip`
- macOS: `llama-b5616-bin-macos-arm64.zip`
- Linux CUDA: `llama-b5616-bin-ubuntu-cuda-12.4-x64.zip`

The lookup table also stores the estimated download size in MB per asset (static, no HEAD request). `estimatedSizeMb` in `llama:binary:check` response is sourced from this table — no network call on check.

### 2. Binary Check IPC

**Channel:** `llama:binary:check` (invoke)
**Payload:** `{ serverId: string }`
**Returns:** `{ found: boolean; path: string | null; detectedBackend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'; estimatedSizeMb: number }`

- `found` and `path` are determined by calling `resolveLlamaExecutablePath(server)` — the full ordered search (explicit path → app dir → bin dir → exe dir → exe/llama.cpp dir → PATH). `path` is the first found path, which may not be the auto-download destination. The `serverId` is required so the handler can look up `server.executablePath` for the first candidate in the search.
- `detectedBackend` is the display string from `detectLlamaBinaryBackend()`.
- `estimatedSizeMb` comes from the static lookup table, no network required.

Called by the renderer when:
- SettingsModal opens and `server.kind === 'llama.cpp'`
- ModelLoaderModal receives a "Could not find llama-server" error

**Development mode note:** When `!app.isPackaged`, `dirname(app.getPath('exe'))` points to the Electron binary inside `node_modules` — not a writable user location. In dev mode, `llama:binary:install` redirects the destination to `path.join(app.getAppPath(), 'llama.cpp')`. To ensure this is found, `resolveLlamaExecutablePath` must have `join(app.getAppPath(), 'llama.cpp', fileName)` added as a candidate (after the existing `app.getAppPath()/bin/` candidate). This is a small addition to the existing resolver. For packaged builds, the destination `dirname(app.getPath('exe'))/llama.cpp/llama-server[.exe]` already matches candidate #5 in the existing resolver — no change needed there.

### 3. Download & Extraction IPC

**Channel:** `llama:binary:install` (invoke)
**Payload:** `{ serverId: string }`
**Returns:** `{ success: boolean; executablePath: string | null; error?: string }`

**Singleton lock:** The main process maintains an `isBinaryInstalling: boolean` flag. If `llama:binary:install` is invoked while already in progress, it returns immediately with `{ success: false, error: 'Install already in progress' }`. The renderer should instead subscribe to `llama:binary:install:progress` broadcasts to track the ongoing install. The flag is always reset to `false` before broadcasting `status: 'error'` as well as after `status: 'complete'`.

**Asset format note:** Before the final implementation is locked, confirm the actual archive format for each platform against the pinned release tag. macOS releases may ship as `.tar.gz` rather than `.zip`. If so, update the asset name lookup table and replace the `unzip` extraction command for macOS with `tar -xzf '<archive>' -C '<tmp-extract-dir>'`.

Main process steps:
0. Broadcast `status: 'detecting'` — detecting platform + backend
1. Detect platform + backend → build asset URL from static lookup table
2. `mkdirSync(destination, { recursive: true })` — ensure destination directory exists
3. Broadcast `status: 'downloading'`, `percent: 0`
4. Download zip/archive to `app.getPath('temp')/llama-cpp-{tag}.zip`, broadcasting `percent` updates per chunk
5. Broadcast `status: 'extracting'`
6. Extract archive to a temp subdirectory `app.getPath('temp')/llama-cpp-extract-{tag}/`:
   - **Windows:** `powershell.exe -NoProfile -Command "Expand-Archive -Path '<zip>' -DestinationPath '<tmp-extract-dir>' -Force"`
   - **macOS (if .zip):** `unzip -o '<zip>' -d '<tmp-extract-dir>'`
   - **macOS (if .tar.gz):** `tar -xzf '<archive>' -C '<tmp-extract-dir>'`
   - **Linux:** `unzip -o '<zip>' -d '<tmp-extract-dir>'` or `tar -xzf` as appropriate
7. Locate source root within extracted directory:
   - llama.cpp release archives often contain a single named subdirectory. After extraction, enumerate the first-level children of `<tmp-extract-dir>`. If exactly one subdirectory exists, that is the source root. Otherwise treat `<tmp-extract-dir>` itself as the source root.
8. Copy files from source root to `<destination>`:
   - Copy `llama-server[.exe]` → `<destination>/llama-server[.exe]`
   - On Windows: copy all `*.dll` files → `<destination>/`
   - On macOS/Linux: `fs.chmodSync(destBinary, 0o755)` to ensure the binary is executable
9. Delete temp archive and temp extract directory
10. Broadcast `status: 'complete'`
11. Set `isBinaryInstalling = false`; return `{ success: true, executablePath: <resolved path> }`

On any thrown error between steps 0 and 11:
- Clean up temp files if they exist
- Set `isBinaryInstalling = false`
- Broadcast `status: 'error'` with the error message
- Return `{ success: false, error: <message> }`

**Destination:**
- Packaged: `path.join(path.dirname(app.getPath('exe')), 'llama.cpp')` — matches candidate #5 in `resolveLlamaExecutablePath`
- Dev (unpackaged): `path.join(app.getAppPath(), 'llama.cpp')` — requires adding this as a new candidate to `resolveLlamaExecutablePath` (see Section 2)

### 4. Progress Broadcast

**Channel:** `llama:binary:install:progress` (main → renderer)
**Payload:**
```typescript
interface BinaryInstallProgress {
  status: 'detecting' | 'downloading' | 'extracting' | 'complete' | 'error'
  percent: number | null        // 0-100 during download; null during other phases
  message: string               // Human-readable status line
  backend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU' | null  // null during 'detecting'
}
```

---

## UI

### Shared Banner Component — `LlamaBinaryBanner`

Defined once in `src/components/LlamaBinaryBanner.tsx`. Used in both SettingsModal and ModelLoaderModal. Styles live in `src/styles/binary-install.css` (new file), imported by both modals.

Banner states:

**`prompt`** — binary not found:
```
┌─────────────────────────────────────────────────────┐
│ ⚠  llama-server not found                           │
│ Auto-download the CUDA build? (~80 MB)              │
│                          [Download llama-server]    │
└─────────────────────────────────────────────────────┘
```

**`detecting` / `downloading` / `extracting`** — in progress:
```
┌─────────────────────────────────────────────────────┐
│ Downloading llama-server (CUDA)...  42%             │
│ [=============>                    ]                │
└─────────────────────────────────────────────────────┘
```

**`complete`** — banner disappears; no state shown.

**`error`** — error message with Retry button:
```
┌─────────────────────────────────────────────────────┐
│ ✕  Download failed: <message>                       │
│                                        [Retry]      │
└─────────────────────────────────────────────────────┘
```

Progress bar uses existing CSS variables:
```css
.binary-install-progress__bar {
  background: var(--surface-bg-accent);
  border-radius: var(--radius-sm);
}
.binary-install-progress {
  background: var(--surface-bg-emphasis);
  border-radius: var(--radius-sm);
}
```

### Settings Modal Integration

On open (when `server.kind === 'llama.cpp'`): call `llama:binary:check`. If `found: false`, render `<LlamaBinaryBanner>` above the executable path field.

On install `complete`: re-call `llama:binary:check` and populate the executable path field with the resolved path.

### Model Loader Modal Integration

If `llama:runtime:load` rejects with the string `"Could not find llama-server"`:
- Suppress the raw error
- Render `<LlamaBinaryBanner>` above the Load button
- Disable the Load button while `status !== 'complete'`
- On `complete`: automatically re-invoke `llama:runtime:load`. If this retry fails for a different reason (e.g. model path invalid, port in use), follow the same normal error display path as a user-initiated load — do not re-show the binary banner.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No internet | Error status with message; Retry button |
| GitHub 404 / rate limit | Error with message; suggest configuring path manually |
| PowerShell / unzip not found | Error; fallback message to configure path manually |
| Destination not writable | Error; suggest running as admin or configuring path |
| Download interrupted / process killed | Temp files deleted on next attempt; error status; Retry available |
| Already installing | Invoke returns `{ success: false, error: 'Install already in progress' }` |

---

## Files Changed

| File | Change |
|------|--------|
| `electron/main/index.ts` | Add `LLAMA_CPP_RELEASE` constant + asset lookup table; `detectLlamaBinaryBackend()`; `installLlamaBinary()`; `isBinaryInstalling` flag; `llama:binary:check` handler; `llama:binary:install` handler; broadcast `llama:binary:install:progress`; add `join(app.getAppPath(), 'llama.cpp', fileName)` candidate to `resolveLlamaExecutablePath` (dev-mode support) |
| `electron/preload/index.ts` | Expose `checkLlamaBinary()`, `installLlamaBinary()`, `onBinaryInstallProgress()` on `window.api` |
| `src/types/electron.d.ts` | Add type declarations for new API methods |
| `src/types/index.ts` | Add `BinaryInstallProgress` interface |
| `src/App.tsx` | Subscribe to `llama:binary:install:progress`; pass `binaryInstallProgress` state to modals |
| `src/components/LlamaBinaryBanner.tsx` | New shared banner component (prompt / progress / error states) |
| `src/components/SettingsModal.tsx` | Call `checkLlamaBinary` on open; render `<LlamaBinaryBanner>` when not found |
| `src/components/ModelLoaderModal.tsx` | Intercept missing-binary error; render `<LlamaBinaryBanner>`; auto-retry on complete |
| `src/styles/binary-install.css` | Banner + progress bar styles (shared, imported by both modals) |

---

## Success Criteria

1. User with no llama.cpp installed sees a clear prompt in Settings when selecting the local provider.
2. User who tries to load a model without the binary installed sees the same prompt instead of a raw error.
3. Download + extraction completes without manual steps on Windows (CUDA/Vulkan/CPU), macOS (Metal), and Linux (CUDA/Vulkan/CPU).
4. After installation, the binary is found automatically by `resolveLlamaExecutablePath` with no settings changes required.
5. All error scenarios surface a human-readable message with a retry option.
6. No new npm dependencies introduced.
7. Dev mode installs to `app.getAppPath()/llama.cpp/` rather than a non-writable electron binary directory.
