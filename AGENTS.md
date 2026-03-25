# Aethra — Agent & Developer Reference

> Comprehensive technical documentation for the Aethra Electron desktop application.
>
> **User & Developer Docs**: See `docs/app/` for complete guides (getting started, user guide, architecture, etc.)
>
> **Quick Start**: See `CLAUDE.md` for the development quick-start summary.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [Architecture](#4-architecture)
5. [IPC Channels](#5-ipc-channels)
6. [State Management](#6-state-management)
7. [Styling System](#7-styling-system)
8. [AI Integration](#8-ai-integration)
9. [File Storage](#9-file-storage)
10. [Coding Conventions](#10-coding-conventions)
11. [Key Services](#11-key-services)
12. [Contributing](#12-contributing)

---

## 1. Project Overview

**Aethra** is a cross-platform desktop application (Electron) for interactive AI-assisted roleplay and storytelling.

Key features:
- **Campaigns**: Top-level projects containing multiple scenes and character profiles
- **Scenes**: Separate conversation threads with full message history and rolling summaries
- **Characters**: Custom profiles with descriptions, avatars, and control type (AI or user)
- **Multi-server support**: Works with LM Studio, Ollama, llama.cpp, OpenAI-compatible APIs, or cloud services
- **Local AI runtime**: Integrated llama.cpp with automatic binary download and GPU detection
- **Persistent storage**: JSON-based campaign files stored locally with automatic settings backup
- **Themes**: Customizable dark/light themes with semantic color tokens
- **Rolling summaries**: Automatic compression of old messages to manage context windows

Users create campaigns, add characters, create scenes, and chat with AI. All data is persisted locally.

---

## 2. Tech Stack

| Layer       | Technology                            |
|-------------|---------------------------------------|
| Desktop     | Electron 40 (cross-platform)          |
| UI Framework | React 18 (with hooks)                |
| Build tool  | Vite 6 + electron-vite 5              |
| Language    | TypeScript 5 (strict mode)            |
| Styling     | Custom CSS (CSS variables, no framework) |
| Main Process | Node.js (file I/O, IPC, AI streaming) |
| Preload     | Context bridge for secure API access  |
| AI API      | OpenAI-compatible REST (LM Studio, Ollama, llama.cpp, OpenAI, etc.) |
| Streaming   | Server-Sent Events (SSE) from AI server |
| Storage     | JSON files in app userData directory   |

---

## 3. Directory Structure

```
aethra/
├── electron/
│   ├── main/
│   │   ├── index.ts                     # Main process: windows, IPC, AI streaming
│   │   └── defaults/
│   │       ├── servers.json             # Default server profiles
│   │       └── models.json              # Default model presets
│   ├── preload/
│   │   └── index.ts                     # Context bridge: exposes window.api
│   └── ...
├── src/
│   ├── index.html                       # Renderer entry (moved from root)
│   ├── main.tsx                         # React app entry
│   ├── App.tsx                          # Root component & state
│   ├── types/
│   │   ├── index.ts                     # Shared types: Message, Scene, Campaign, etc.
│   │   ├── electron.d.ts                # TypeScript for window.api
│   │   └── vite-env.d.ts                # Vite client types
│   ├── components/
│   │   ├── RibbonBar.tsx                # Top navigation and tabs
│   │   ├── TitleBar.tsx                 # Window chrome
│   │   ├── Sidebar.tsx                  # Left panel: scene list
│   │   ├── ChatArea.tsx                 # Centre: message feed
│   │   ├── InputBar.tsx                 # Centre: composer
│   │   ├── DetailsPanel.tsx             # Right panel: character info
│   │   ├── CampaignLauncher.tsx         # Startup screen
│   │   ├── CampaignModal.tsx            # Campaign editor
│   │   ├── CharactersModal.tsx          # Character manager
│   │   ├── SettingsModal.tsx            # Settings (servers, models, theme)
│   │   ├── ModelLoaderModal.tsx         # Model download UI
│   │   ├── AiDebugModal.tsx             # AI request/response logs
│   │   ├── Modal.tsx                    # Reusable modal component
│   │   ├── ModalLayouts.tsx             # Shared workspace/form/popup modal layouts
│   │   ├── LlamaBinaryBanner.tsx        # llama.cpp install status
│   │   └── icons.tsx                    # SVG icon components
│   ├── services/
│   │   ├── aiService.ts                 # Wrapper around window.api.streamCompletion()
│   │   ├── themeService.ts              # Theme loading and application
│   │   └── modelFitService.ts           # Hardware detection and model fit estimation
│   ├── prompts/
│   │   └── campaignPrompts.ts           # System prompt builders
│   └── styles/
│       ├── global.css                   # CSS variables, reset, dark theme
│       ├── layout.css                   # Three-column grid layout
│       ├── modal.css                    # Modal dialogs
│       ├── campaign-launcher.css        # Startup screen
│       └── ...                          # Component-specific styles
├── docs/app/                            # User & developer documentation
├── .env.example                         # Environment variable template
├── electron.vite.config.ts              # Electron + Vite config
├── CLAUDE.md                            # Quick-start for developers
├── AGENTS.md                            # This file
└── package.json
```

---

## 4. Architecture

### Process Model

Aethra follows Electron's multi-process architecture:

```
┌──────────────────────────────────┐
│      Main Process (Node.js)      │
│  - Window management             │
│  - File I/O (campaigns, avatars) │
│  - AI SSE streaming              │
│  - llama.cpp process management  │
│  - Hardware detection            │
│  - IPC handlers                  │
└──────────────────────────────────┘
         ↕ IPC + contextBridge
┌──────────────────────────────────┐
│    Preload (Node.js context)     │
│  - Secure API bridge             │
│  - window.api exposure           │
└──────────────────────────────────┘
         ↕ window.api
┌──────────────────────────────────┐
│  Renderer (React + Browser)      │
│  - UI components                 │
│  - User interactions             │
│  - Calls window.api methods      │
└──────────────────────────────────┘
```

**Key insight**: The renderer cannot access Node.js directly. All OS access goes through `window.api` (preload bridge) to the main process via IPC.

### UI Layout

The main app uses a **three-column grid** layout:

```
┌──────────────────────────────────────────────────┐
│  RibbonBar (tabs, menus)                         │
├────────────┬────────────────────────┬────────────┤
│ Sidebar    │ ChatArea               │ Details    │
│ (260px)    │ (flex: 1)              │ (280px)    │
│            │  ┌────────────────┐    │            │
│ Scenes   │  │ Message feed   │    │ Character  │
│ list       │  │ (scrollable)   │    │ Avatar     │
│            │  └────────────────┘    │            │
│            │  ┌────────────────┐    │ Info &     │
│            │  │ InputBar       │    │ Status     │
│            │  └────────────────┘    │            │
└────────────┴────────────────────────┴────────────┘
```

### Modal Layout System

The renderer uses a shared modal shell plus three higher-level layout variants:

- **`Modal`** (`src/components/Modal.tsx`) handles the overlay, title bar, close button, focus semantics, and size variant (`workspace`, `form`, `popup`).
- **`ModalWorkspaceLayout`** (`src/components/ModalLayouts.tsx`) is the standard two-column management layout with left navigation/list, right detail panel, and shared footer row. Used by Settings, Campaign, and Characters.
- **`ModalFormLayout`** is the standard single-column layout for focused forms with a shared footer action row. Used by Create Campaign, Model Loader, and Model Parameters.
- **`ModalPopupLayout`** is the compact popup layout for short-lived inspectors and utility dialogs. Used by AI Debug and future confirmation/info popups.

Shared footer buttons and alignment live in `src/styles/modal-layouts.css`. Modal-specific styles should only cover domain UI inside the content area, not reimplement the shell, footer, or responsive split layout.

### State Management

State is managed with **React hooks** in `App.tsx`. Key state:

| State | Type | Description |
|-------|------|-------------|
| `campaign` | `Campaign \| null` | Current campaign |
| `scenes` | `Scene[]` | All scenes in campaign |
| `activeSessionId` | `string \| null` | Current scene |
| `inputValue` | `string` | Composer text |
| `isStreaming` | `boolean` | AI response in progress |
| `selectedCharacterId` | `string \| null` | Active character |
| `settings` | `AppSettings` | User preferences |
| `activeTab` | `'campaign' \| 'debug' \| 'settings'` | Current ribbon tab |

Derived values (e.g., `activeSession = scenes.find(...)`) are computed inline.

---

## 5. IPC Channels

Communication between main and renderer processes uses Electron IPC.

### Invoke Handlers (Renderer → Main, awaits response)

| Channel | Payload | Returns | Purpose |
|---------|---------|---------|---------|
| `settings:get` | — | `AppSettings` | Load user preferences |
| `settings:set` | `AppSettings` | `void` | Save settings to disk |
| `campaign:create` | `{name, description}` | `CampaignFileHandle` | Create new campaign |
| `campaign:open` | `path` | `CampaignFileHandle` | Load campaign from file |
| `campaign:save` | `Campaign` | `void` | Save campaign to disk |
| `file:selectFile` | `{properties}` | `string` | File picker dialog |
| `llama:binary:install` | — | `void` | Start binary download |

### Send Handlers (Main → Renderer, one-way)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `ai:chunk` | `(id: string, text: string)` | Token from AI server |
| `ai:done` | `(id: string)` | AI response complete |
| `ai:error` | `(id: string, message: string)` | Error during streaming |
| `llama:binary:install:progress` | `BinaryInstallProgress` | Binary DL/extract progress |
| `server:status` | `LocalRuntimeStatus` | Status of local llama.cpp |

### Usage Example

```typescript
// Renderer: invoke main process
const settings = await window.api.invoke('settings:get')

// Main: listen for renderer request
ipcMain.handle('settings:get', async () => {
  return loadSettingsFromDisk()
})

// Main: send to renderer
mainWindow.webContents.send('ai:chunk', messageId, 'token text')
```

## 6. State Management

### App.tsx Top-Level State

All critical state is managed in `App.tsx` with `useState`:

```typescript
// Campaign & scenes
const [campaign, setCampaign] = useState<Campaign | null>(null)
const [scenes, setSessions] = useState<Scene[]>([])
const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

// Chat
const [inputValue, setInputValue] = useState('')
const [isStreaming, setIsStreaming] = useState(false)
const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)

// UI
const [activeTab, setActiveTab] = useState('campaign')
const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

// Modals
const [showCharactersModal, setShowCharactersModal] = useState(false)
const [showSettingsModal, setShowSettingsModal] = useState(false)
```

### Persisted State

- **Campaigns**: Stored as JSON files in `<userData>/campaigns/`
- **Settings**: Stored as JSON in `<userData>/settings.json`
- **Characters**: Stored in `<userData>/campaigns/{id}/characters/`
- **Scenes**: Stored in `<userData>/campaigns/{id}/scenes/`

---

## 7. Styling System

All styles are **plain CSS** with **semantic tokens** — no CSS framework or preprocessor.

### CSS Variables (defined in `src/styles/global.css`)

Semantic color tokens:

| Token | Default (Dark) | Purpose |
|-------|----------------|---------|
| `--app-bg` | `#0d0f14` | Main background |
| `--panel-bg` | `#1a1d24` | Sidebar/details bg |
| `--surface-bg` | `#25292f` | Message bubbles |
| `--surface-bg-emphasis` | `#32373f` | Hover state |
| `--surface-bg-user-message` | `#1e3a5a` | User bubble |
| `--surface-bg-accent` | `#6b5b95` | Accent backgrounds |
| `--border-color` | `#404854` | Borders |
| `--text-color-primary` | `#e8eaed` | Body text |
| `--text-color-secondary` | `#a0a0a0` | Labels |
| `--text-color-muted` | `#707070` | Timestamps |

Layout tokens:

| Variable | Value | Purpose |
|----------|-------|---------|
| `--sidebar-width` | `260px` | Left panel width |
| `--details-width` | `280px` | Right panel width |
| `--column-gap` | `16px` | Gap between panels |
| `--border-radius` | `8px` | Standard border-radius |

### Themes

Themes override CSS variables. Built-in dark theme is default. Custom themes can be imported as JSON files.

**Theme token override example**:
```json
{
  "id": "custom",
  "name": "My Theme",
  "mode": "dark",
  "tokens": {
    "app-bg": "#1a1a2e",
    "surface-bg-accent": "#0f3460",
    "text-color-brand": "#e94560"
  }
}
```

### Adding New Styles

1. Create a new file under `src/styles/` named after the component.
2. Import it at the top of the relevant component.
3. Use CSS variables for all colors and spacing.
4. Follow BEM naming: `.component__element--modifier`.
5. For new dialogs, start from the shared modal variants before adding modal-specific shell CSS. Prefer `ModalWorkspaceLayout`, `ModalFormLayout`, or `ModalPopupLayout` over bespoke modal scaffolding.

---

## 8. AI Integration

AI is fully integrated with streaming support. The main process handles SSE (Server-Sent Events) streaming from OpenAI-compatible APIs.

### Streaming Flow

1. **Renderer sends message** via IPC:
   ```typescript
   const response = await window.api.streamCompletion({
     id: 'message-uuid',
     messages: [...chatMessages],
     serverId: 'server-uuid',
     modelSlug: 'llama3.2-8b'
   })
   ```

2. **Main process** (`electron/main/index.ts`):
   - Constructs OpenAI-compatible request payload
   - Opens HTTPS/HTTP connection with `stream: true`
   - Reads response stream line-by-line (SSE format)
   - Parses JSON chunks: `data: {"choices":[{"delta":{"content":"token"}}]}`

3. **Tokens stream back** to renderer:
   - Main sends: `renderer.send('ai:chunk', messageId, 'token')`
   - Renderer appends token to message in real-time
   - User sees response appear as it's generated

4. **Stream completes**:
   - Main sends: `renderer.send('ai:done', messageId)`
   - Renderer saves message to campaign file
   - Chat is ready for next message

### Supported AI Services

- **LM Studio**: `http://localhost:1234/v1`
- **Ollama**: `http://localhost:11434/v1`
- **llama.cpp**: `http://localhost:3939/v1` (server mode)
- **OpenAI**: `https://api.openai.com/v1` (API key required)
- **Custom**: Any OpenAI-compatible endpoint

### Error Handling

If the server times out or returns an error:
- Main sends: `renderer.send('ai:error', messageId, 'error message')`
- Renderer displays error message in chat
- Scene remains editable; user can retry or continue

### Model Context Window

The renderer controls which messages are included in the prompt:
- **Without rolling summaries**: All messages in the scene
- **With rolling summaries**: Old messages → auto-generated summary + recent messages (last 10)

---

## 9. File Storage

All user data is stored locally in the app's userData directory.

### Directory Structure

```
<userData>/
├── settings.json                        # User preferences, servers, models, themes
├── campaigns/
│   ├── {campaign-id}/
│   │   ├── campaign.json                # Campaign metadata + scenes array
│   │   ├── scenes/
│   │   │   ├── {scene-id}.json        # Individual scene transcripts
│   │   │   └── ...
│   │   └── characters/
│   │       ├── {character-id}/
│   │       │   ├── character.json       # Character profile
│   │       │   └── avatar.png           # Avatar image (optional)
│   │       └── ...
│   └── ...
└── llama-cpp/                           # Auto-managed local binary (if enabled)
    └── ...
```

### Storage Locations

- **Windows**: `%APPDATA%\Aethra\`
- **macOS**: `~/Library/Application Support/Aethra/`
- **Linux**: `~/.config/Aethra/` or `$XDG_CONFIG_HOME/Aethra/`

### JSON Formats

See `src/types/index.ts` for complete type definitions. Key types:

- **`Campaign`**: `{id, name, description, scenes[], createdAt, updatedAt}`
- **`Scene`**: `{id, title, messages[], rollingSummary, summarizedMessageCount, createdAt, updatedAt}`
- **`Message`**: `{id, role, content, characterId?, characterName?, characterAvatarImageData?, timestamp}`
- **`CharacterProfile`**: `{id, name, role, gender, pronouns, description, personality, speakingStyle, goals, avatarImageData?, avatarCrop?, controlledBy, createdAt, updatedAt}`
- **`AppSettings`**: `{servers[], models[], activeServerId?, activeModelSlug?, systemPrompt, enableRollingSummaries, chatTextSize, activeThemeId, customThemes[]}`

---

## 10. Coding Conventions

- **TypeScript strict mode** — no implicit `any`, exhaustive null checks.
- **Header comments**: All files start with a JSDoc comment describing purpose and responsibilities.
- **Function documentation**: All functions have JSDoc comments with `@param`, `@returns`, etc.
- **Component documentation**: Component files have header comments; prop interfaces are annotated.
- **CSS variables**: All colors, spacing, and sizing use variables from `global.css`. No magic numbers.
- **No external state libraries**: React hooks only — no Redux, Zustand, etc.
- **Named exports**: Components use named exports (except the default `App` export).
- **BEM naming**: CSS classes follow BEM pattern: `.component__element--modifier`
- **Commit messages**: Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, etc.).
- **IPC handlers**: All main process handlers in `electron/main/index.ts` are named consistently (`ai:*`, `settings:*`, etc.).

---

## 11. Key Services

### aiService.ts

Renderer-side wrapper around `window.api.streamCompletion()`:

```typescript
export async function streamCompletion(
  messages: ChatMessage[],
  serverId: string,
  modelSlug: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void
)
```

Handles token streaming and callbacks. Used by `App.tsx → handleSend()`.

### themeService.ts

Theme import, parsing, and application:

```typescript
export function applyTheme(themeId: string)       // Apply a theme by ID
export function parseImportedTheme(file: File)    // Parse imported JSON
export function upsertCustomTheme(theme: ThemeDefinition) // Save custom theme
```

### modelFitService.ts

Hardware detection and model sizing estimates:

```typescript
export function estimateLocalModelFit(
  model: ModelPreset,
  hardware: HardwareInfo
): ModelFitEstimate
```

Provides warnings if a model is likely too large for the detected GPU.

---

## 12. Contributing

### Setting Up Development

```bash
git clone <repo>
cd aethra
npm install
npm run dev
```

### Running Tests (if applicable)

```bash
npm run test
```

### Build for Distribution

```bash
npm run build
```

### Key Areas

- **Main process (`electron/main/index.ts`)**: Window management, IPC, AI streaming, file I/O
- **Renderer (`src/App.tsx`)**: State management, routing, component orchestration
- **Components (`src/components/`)**: UI logic and presentation
- **Services (`src/services/`)**: Business logic (AI, themes, etc.)
- **Styles (`src/styles/`)**: CSS with semantic variables
- **Types (`src/types/index.ts`)**: Shared type definitions

### Before Submitting a PR

1. Run `npm run build` to ensure build succeeds
2. Check TypeScript: `npx tsc --noEmit`
3. Follow coding conventions (header comments, JSDoc, etc.)
4. Update `AGENTS.md` if architecture changes
5. Keep commits focused and descriptive

---

## Resources

- **User Documentation**: See `docs/app/` for comprehensive guides
- **CLAUDE.md**: Quick-start for developers
- **Type Definitions**: `src/types/index.ts`
- **Electron Docs**: https://www.electronjs.org/docs
- **React Docs**: https://react.dev/
- **TypeScript Docs**: https://www.typescriptlang.org/docs/
