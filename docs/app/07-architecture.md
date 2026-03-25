# Architecture

This guide describes the technical structure of Aethra for developers and contributors.

## Tech Stack

- **Electron 40**: Cross-platform desktop application framework
- **React 18**: UI component framework (renderer process)
- **TypeScript 5 (strict)**: Language with strict type checking
- **Vite 6**: Module bundler and dev server
- **Custom CSS**: No CSS frameworks; variables in `src/styles/global.css`
- **Node.js**: Main process runtime for file I/O and AI integration

## Process Architecture

Aethra follows Electron's multi-process model:

```
┌─────────────────────────────────────────────────────┐
│              Main Process (Node.js)                 │
│  - Window management (Electron)                     │
│  - File I/O (campaigns, settings, avatars)          │
│  - IPC handlers                                     │
│  - AI SSE streaming (net/https)                     │
│  - Local llama.cpp server management                │
│  - Hardware detection                               │
└─────────────────────────────────────────────────────┘
              ↕ IPC + contextBridge
┌─────────────────────────────────────────────────────┐
│             Preload Process (Node.js)               │
│  - Context bridge: exposes `window.api` to renderer │
│  - Secure IPC channel wrapper                       │
└─────────────────────────────────────────────────────┘
              ↕ `window.api`
┌─────────────────────────────────────────────────────┐
│          Renderer Process (React/Browser)           │
│  - React components and state                       │
│  - User interface                                   │
│  - Calls `window.api.*()` for OS/file access        │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
aethra/
├── electron/
│   ├── main/
│   │   ├── index.ts                    # Main process: windows, IPC, AI streaming
│   │   ├── defaults/
│   │   │   ├── servers.json            # Default server profiles
│   │   │   └── models.json             # Default model presets
│   │   └── ...
│   ├── preload/
│   │   └── index.ts                    # Context bridge: `window.api`
│   └── ...
├── src/
│   ├── index.html                      # Renderer entry HTML
│   ├── main.tsx                        # React app entry
│   ├── App.tsx                         # Root component
│   ├── types/
│   │   └── index.ts                    # Shared type definitions
│   ├── types/
│   │   └── electron.d.ts               # `window.api` TypeScript types
│   ├── components/
│   │   ├── RibbonBar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ChatArea.tsx
│   │   ├── InputBar.tsx
│   │   ├── DetailsPanel.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── CampaignLauncher.tsx
│   │   ├── CampaignModal.tsx
│   │   ├── CharactersModal.tsx
│   │   ├── ModelLoaderModal.tsx
│   │   ├── Modal.tsx                   # Reusable modal dialog
│   │   ├── ModalLayouts.tsx            # Shared modal layout variants
│   │   └── ...
│   ├── services/
│   │   ├── aiService.ts                # Wrapper around `window.api.streamCompletion()`
│   │   ├── themeService.ts             # Theme loading and application
│   │   └── ...
│   ├── prompts/
│   │   └── campaignPrompts.ts          # System prompt builders
│   ├── styles/
│   │   ├── global.css                  # CSS variables, reset, dark theme
│   │   ├── layout.css                  # Three-column layout
│   │   ├── modal.css
│   │   ├── campaign-launcher.css
│   │   └── ...
│   ├── vite-env.d.ts                   # Vite client types
│   └── App.tsx                         # Root component
├── .env.example                         # Environment variable template
├── electron.vite.config.ts              # Electron + Vite config
├── package.json
├── tsconfig.json
└── ...
```

## Key Files

### electron/main/index.ts

The main process entry point. Responsibilities:

1. **Window Management**
   - Create and manage the BrowserWindow
   - Handle window events (close, maximize, etc.)
   - Expose `window.api` via context bridge

2. **IPC Handlers**
   - `settings:get` → Return AppSettings
   - `settings:set` → Save AppSettings to disk
   - `ai:stream` → Start AI streaming (see below)
   - Campaign/character file I/O handlers
   - Model discovery and downloading

3. **AI Streaming**
   - Listen for `ai:stream` IPC messages from renderer
   - Fetch from AI server using SSE (Server-Sent Events)
   - Stream tokens back to renderer via `ai:chunk` IPC
   - Send completion via `ai:done` or error via `ai:error`

4. **Local llama.cpp Management**
   - Auto-detect hardware (GPU/CPU)
   - Download appropriate binary version
   - Spawn and manage child process
   - Monitor health and restart if needed

### electron/preload/index.ts

Context bridge that exposes secure API to renderer:

```typescript
const api = {
  streamCompletion: (options) => ipcRenderer.invoke('ai:stream', options),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  // ... file I/O, campaign management, etc.
}

contextBridge.exposeInMainWorld('api', api)
```

This allows the renderer to call main process functions safely without exposing the full Node.js API.

### src/App.tsx

Root React component. Owns all top-level state:

- **scenes**: Array of Scene objects
- **activeSession**: Currently displayed scene
- **campaigns**: Loaded campaign data
- **inputValue**: Text in the message composer
- **isStreaming**: Whether AI response is in-flight
- **activeTab**: Current ribbon tab (Campaign / Debug / Settings)
- **settings**: User preferences and AI configuration

Key functions:
- `handleSend()`: Send a message and stream AI response
- `handleNewSession()`: Create a scene
- `handleDeleteSession()`: Remove a scene
- `handleStreamChunk()`: Receive token from AI (via IPC)
- `handleStreamComplete()`: Finalize AI response

### Modal Architecture

Modal UI is split into a low-level shell plus shared layout variants:

- **`src/components/Modal.tsx`**: Base dialog shell. Owns the overlay, title bar, close button, portal rendering, Escape handling, and size variants.
- **`src/components/ModalLayouts.tsx`**: Shared higher-level modal layouts.
  - `ModalWorkspaceLayout`: two-column navigation + panel layout for management surfaces.
  - `ModalFormLayout`: single-column form layout with a shared footer row.
  - `ModalPopupLayout`: compact popup layout for inspectors and short dialogs.
  - `ModalFooter`: shared footer row with left status content and right action group.

Current usage:

- **Workspace modals**: Settings, Campaign, Characters
- **Form modals**: Create Campaign, Model Loader, Model Parameters, New Scene
- **Popup modals**: AI Debug, Raw Message Inspector, Summary Viewer

### src/types/index.ts

Central type definitions used across app and main process:

- **Message, Scene, Campaign**: Chat data structures
- **CharacterProfile, CharacterAvatarCrop**: Character definitions
- **ServerProfile, ModelPreset, AvailableModel**: AI configuration
- **AppSettings**: Persisted user preferences
- **Theme-related types**: ThemeDefinition, ThemeTokenName
- **Hardware/GPU types**: HardwareInfo, HardwareGpuInfo
- **IPC types**: BinaryInstallProgress, ModelDownloadProgress

## State Management

Aethra uses **React hooks only** — no external state libraries (Redux, Zustand, etc.).

State is managed in `App.tsx`:

```typescript
// Scenes
const [scenes, setSessions] = useState<Scene[]>([])
const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

// Campaign
const [campaign, setCampaign] = useState<Campaign | null>(null)
const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])

// Chat state
const [inputValue, setInputValue] = useState('')
const [isStreaming, setIsStreaming] = useState(false)
const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)

// UI state
const [activeTab, setActiveTab] = useState('campaign')
const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

// Modals
const [showCharactersModal, setShowCharactersModal] = useState(false)
const [showSettingsModal, setShowSettingsModal] = useState(false)
```

Props are passed down to components. Callbacks update state in `App.tsx`.

## IPC Channels

Communication between main and renderer processes uses Electron IPC:

### Invoke Handlers (Renderer → Main, awaits response)

| Channel | Payload | Returns | Purpose |
|---------|---------|---------|---------|
| `settings:get` | — | AppSettings | Load persisted settings |
| `settings:set` | AppSettings | void | Save settings to disk |
| `campaign:create` | {name, description} | CampaignFileHandle | Create new campaign file |
| `campaign:open` | path | CampaignFileHandle | Load campaign from file |
| `campaign:save` | Campaign | void | Save campaign to disk |
| `file:selectFile` | {properties} | string | File picker dialog |
| `file:selectDirectory` | — | string | Directory picker dialog |

### Send/On Handlers (Main → Renderer, one-way)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `ai:stream` | {id, messages, serverId, modelSlug} | Initiate AI response streaming |
| `ai:chunk` | (id, text) | New token from AI server |
| `ai:done` | (id) | AI response complete |
| `ai:error` | (id, message) | Error during AI streaming |
| `llama:binary:install:progress` | BinaryInstallProgress | Binary download/extract progress |
| `model:download:progress` | ModelDownloadProgress | Hugging Face model DL progress |
| `server:status` | LocalRuntimeStatus | Status of local llama.cpp server |

## AI Streaming Architecture

### Flow

1. **User sends message** in React:
   ```typescript
   const response = await window.api.streamCompletion({
     id: 'msg-uuid',
     messages: [{ role: 'user', content: 'Hello...' }],
     serverId: 'server-uuid',
     modelSlug: 'llama3.2-8b'
   })
   ```

2. **Main process receives `ai:stream`** IPC:
   - Constructs OpenAI-compatible request payload
   - Calls `https.get()` with `stream: true` to AI server
   - Reads response line-by-line (SSE format)

3. **Stream chunks arrive**:
   - Main parses each SSE event: `data: {"choices":[{"delta":{"content":"token"}}]}`
   - Sends chunk back via: `renderer.send('ai:chunk', id, 'token')`
   - Appends to message in React state

4. **Stream ends**:
   - Main sends: `renderer.send('ai:done', id)`
   - React saves message to campaign file
   - Ready for next message

### Error Handling

If the server times out or errors:
- Main sends: `renderer.send('ai:error', id, 'error message')`
- React displays error in chat
- Scene remains editable; user can retry

## Campaign File Storage

Campaigns are persisted as JSON files:

```
<userData>/campaigns/
├── {campaign-id}/
│   ├── campaign.json
│   ├── scenes/
│   │   ├── {scene-id}.json
│   │   └── ...
│   └── characters/
│       ├── {character-id}/
│       │   ├── character.json
│       │   └── avatar.png
│       └── ...
```

### Campaign Loading/Saving

1. **On load**: Main reads `campaign.json`, then all scenes and characters
2. **On save**: Each component that modifies state calls the save handler
3. **Auto-save**: Messages are saved immediately when sent (no manual save button)

## CSS Architecture

### global.css

Defines CSS custom properties (variables) for the entire app:

```css
:root {
  /* Colors */
  --app-bg: #0d0f14;
  --panel-bg: #1a1d24;
  --text-color-primary: #e8eaed;
  --border-color: #404854;

  /* Typography */
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...;
  --font-size-base: 14px;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;

  /* Z-index */
  --z-modal: 1000;
  --z-tooltip: 999;
}

.dark {
  /* Dark theme overrides */
}

.light {
  /* Light theme overrides */
}
```

### layout.css

Three-column layout using CSS Grid:

```css
body {
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  grid-template-rows: auto 1fr;
  height: 100vh;
}

.sidebar { grid-column: 1; grid-row: 2; }
.chat-area { grid-column: 2; grid-row: 2; }
.details-panel { grid-column: 3; grid-row: 2; }
```

### Component-specific CSS

Each component has its own CSS file (e.g., `ChatArea.css`) with scoped class names:

```css
.chat-area { ... }
.chat-area__message { ... }
.chat-area__message--user { ... }
.chat-area__message--assistant { ... }
```

Modal shell and layout styles are centralized:

- `src/styles/modal.css`: overlay, card chrome, title bar, and size variants
- `src/styles/modal-layouts.css`: shared workspace/form/popup layout structure and shared footer buttons

Component-specific modal styles should only define content inside those shared shells.

## Theme System

### Theme Tokens

Aethra uses semantic tokens that map to CSS variables:

```typescript
type ThemeTokenName =
  | 'app-bg'
  | 'panel-bg'
  | 'surface-bg'
  | 'text-color-primary'
  | ... // 25 total tokens
```

### Theme Definition

```typescript
interface ThemeDefinition {
  id: string
  name: string
  mode: 'dark' | 'light'
  tokens: Partial<Record<ThemeTokenName, string>>
}
```

### Applying a Theme

When user selects a theme:

```typescript
function applyTheme(themeId: string) {
  const theme = findThemeById(themeId)
  const root = document.documentElement

  // Set each token as a CSS variable
  Object.entries(theme.tokens).forEach(([name, value]) => {
    root.style.setProperty(`--${name}`, value)
  })
}
```

## Services

### aiService.ts

Thin wrapper around `window.api.streamCompletion()`:

```typescript
export async function streamCompletion(
  messages: ChatMessage[],
  serverId: string,
  modelSlug: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void
) {
  const id = uid()

  window.api.on(`ai:chunk-${id}`, (chunk) => onChunk(chunk))
  window.api.on(`ai:done-${id}`, () => onDone())
  window.api.on(`ai:error-${id}`, (err) => onError(err))

  await window.api.streamCompletion({
    id, messages, serverId, modelSlug
  })
}
```

### themeService.ts

Theme import, parsing, and application:

```typescript
export function applyTheme(themeId: string) { ... }
export function parseImportedTheme(file: File) { ... }
export function upsertCustomTheme(theme: ThemeDefinition) { ... }
```

### modelFitService.ts

Hardware detection and model fit estimation:

```typescript
export function estimateLocalModelFit(
  model: ModelPreset,
  hardware: HardwareInfo
): ModelFitEstimate { ... }
```

## Component Hierarchy

```
App
├── TitleBar
├── RibbonBar
│   ├── Tabs (Campaign / Debug / Settings)
│   └── CampaignMenu
├── When tab = "Campaign":
│   ├── Sidebar
│   │   ├── SessionsList
│   │   └── SidebarButtons
│   ├── ChatArea
│   │   └── MessageList
│   ├── InputBar
│   │   ├── CharacterSelector
│   │   └── MessageComposer
│   └── DetailsPanel
│       ├── CharacterAvatar
│       ├── CharacterInfo
│       └── SessionInfo
├── SettingsModal
│   └── ModalWorkspaceLayout
├── CampaignLauncher (if no campaign loaded)
├── CampaignModal
│   └── ModalWorkspaceLayout
├── CharactersModal
│   └── ModalWorkspaceLayout
├── ModelLoaderModal
│   └── ModalFormLayout
├── ModelParametersModal
│   └── ModalFormLayout
├── CreateCampaignModal
│   └── ModalFormLayout
└── AiDebugModal
    └── ModalPopupLayout
```

## Adding a New Feature

### Example: Add a "Pin Message" Feature

1. **Add to types** (`src/types/index.ts`):
   ```typescript
   interface Message {
     // ... existing fields
     isPinned?: boolean
   }
   ```

2. **Add to App state** (`src/App.tsx`):
   ```typescript
   const togglePinMessage = (messageId: string) => {
     const scene = activeSession
     const msg = scene.messages.find(m => m.id === messageId)
     if (msg) msg.isPinned = !msg.isPinned
     // Save campaign
   }
   ```

3. **Add UI** (`src/components/ChatArea.tsx`):
   ```typescript
   <button onClick={() => togglePinMessage(msg.id)}>
     {msg.isPinned ? '📌 Pinned' : '📌 Pin'}
   </button>
   ```

4. **Pass callback via props**:
   ```typescript
   <ChatArea onTogglePin={togglePinMessage} ... />
   ```

5. **Test and save campaign**

## Performance Considerations

### Message Rendering

- Messages use React keys to prevent unnecessary re-renders
- Long transcripts (1000+ messages) may slow down scrolling
- Consider virtualization if list becomes too long

### Avatar Images

- Avatars are stored as base64 data URLs in campaign JSON
- Reduces external file dependencies but inflates JSON size
- Large avatars (>1 MB base64) can slow down campaign loading

### AI Streaming

- Tokens arrive asynchronously; state updates per token
- High-frequency updates (10+ per second) are normal
- Browser handles well up to ~10 concurrent streams (rare)

### Theme Application

- Theme changes apply via CSS variable mutation (instant)
- No component re-renders needed

## Building & Bundling

### Development

```bash
npm run dev
# Runs Vite dev server + Electron with hot-reload
```

### Production Build

```bash
npm run build
# Outputs: dist/main/, dist/preload/, dist/renderer/
# Electron Builder packages into installers
```

### Build Configuration

See `electron.vite.config.ts`:
- Main process: Node.js target
- Preload: Node.js context bridge
- Renderer: Browser target with React/TypeScript

---

**For more details**, see the [Getting Started](./01-getting-started.md) or [User Guide](./02-user-guide.md).
