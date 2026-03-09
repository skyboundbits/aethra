# Aethra — Agent & Developer Reference

> Comprehensive documentation for the Aethra AI-assisted roleplay web application.
> See `CLAUDE.md` for the quick-start summary.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Directory Structure](#3-directory-structure)
4. [Architecture](#4-architecture)
5. [Component Reference](#5-component-reference)
6. [Type Reference](#6-type-reference)
7. [Styling System](#7-styling-system)
8. [AI Integration](#8-ai-integration)
9. [Environment Variables](#9-environment-variables)
10. [Coding Conventions](#10-coding-conventions)
11. [Roadmap](#11-roadmap)

---

## 1. Project Overview

**Aethra** is a browser-based roleplay application that pairs a clean chat-style UI
with an external LLM backend (e.g. [LM Studio](https://lmstudio.ai/) or text-generation-webui).
Users create and manage multiple roleplay *sessions*, each containing a full message
history that is sent as context with every AI request.

---

## 2. Tech Stack

| Layer       | Technology                            |
|-------------|---------------------------------------|
| Framework   | React 18 (with hooks)                 |
| Build tool  | Vite 6                                |
| Language    | TypeScript 5 (strict mode)            |
| Styling     | Custom CSS (CSS variables, no framework) |
| LLM API     | OpenAI-compatible REST (LM Studio, text-generation-webui, Ollama, etc.) |

---

## 3. Directory Structure

```
aethra/
├── index.html               # HTML shell; Vite entry point
├── vite.config.ts           # Vite + React plugin config
├── tsconfig.json            # TypeScript project references root
├── tsconfig.app.json        # TS config for src/
├── tsconfig.node.json       # TS config for vite.config.ts
├── .env.example             # Template for environment variables
├── CLAUDE.md                # Quick-reference for Claude Code
├── AGENTS.md                # This file
└── src/
    ├── main.tsx             # React root mount
    ├── App.tsx              # Root component & top-level state
    ├── types/
    │   └── index.ts         # Shared TypeScript interfaces & enums
    ├── components/
    │   ├── Sidebar.tsx      # Left panel: session list
    │   ├── ChatArea.tsx     # Centre panel: message feed
    │   ├── InputBar.tsx     # Centre panel: message composer
    │   └── DetailsPanel.tsx # Right panel: character/scene info
    └── styles/
        ├── global.css       # Reset, CSS variables, base styles
        ├── layout.css       # Three-column floating panel layout
        ├── sidebar.css      # Sidebar-specific styles
        ├── chat.css         # ChatArea & InputBar styles
        └── details.css      # DetailsPanel styles
```

---

## 4. Architecture

### Layout

The UI uses a **three floating-column** layout driven by CSS flexbox:

```
┌──────────────────────────────────────────────────────────────────┐
│  app-layout  (flex row, gap, padding)                            │
│                                                                  │
│  ┌────────────┐  ┌──────────────────────────┐  ┌─────────────┐  │
│  │  Sidebar   │  │       ChatArea           │  │DetailsPanel │  │
│  │  260 px    │  │     (flex: 1)            │  │   280 px    │  │
│  │            │  │  ┌────────────────────┐  │  │             │  │
│  │  Sessions  │  │  │   message feed     │  │  │  Character  │  │
│  │  list      │  │  │   (scrollable)     │  │  │  Scene      │  │
│  │            │  │  └────────────────────┘  │  │  Model info │  │
│  │            │  │  ┌────────────────────┐  │  │             │  │
│  │            │  │  │     InputBar       │  │  │             │  │
│  │            │  │  └────────────────────┘  │  │             │  │
│  └────────────┘  └──────────────────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### State Management

State is managed with **React hooks** in `App.tsx`:

| State          | Type        | Description                              |
|----------------|-------------|------------------------------------------|
| `sessions`     | `Session[]` | All roleplay sessions                    |
| `activeSessionId` | `string \| null` | ID of the open session          |
| `inputValue`   | `string`    | Controlled composer textarea value       |

Derived values (`activeSession`, `messages`) are computed inline — no selectors needed at this scale.

---

## 5. Component Reference

### `<Sidebar>`

**File:** `src/components/Sidebar.tsx`
**Panel:** Left (260 px fixed width)

| Prop | Type | Description |
|------|------|-------------|
| `sessions` | `Session[]` | All sessions to display |
| `activeSessionId` | `string \| null` | Highlighted session |
| `onSelectSession` | `(id: string) => void` | Switch active session |
| `onNewSession` | `() => void` | Create a new session |

---

### `<ChatArea>`

**File:** `src/components/ChatArea.tsx`
**Panel:** Centre (flex: 1), scrollable

| Prop | Type | Description |
|------|------|-------------|
| `messages` | `Message[]` | Messages to render |

Auto-scrolls to the latest message via a `useEffect` + `scrollIntoView`.

---

### `<InputBar>`

**File:** `src/components/InputBar.tsx`
**Panel:** Centre, pinned to bottom

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string` | Controlled textarea value |
| `onChange` | `(v: string) => void` | Value change handler |
| `onSend` | `() => void` | Submit handler |
| `disabled` | `boolean` | Blocks input while AI generates |

**Keyboard:** `Enter` → send; `Shift+Enter` → newline.

---

### `<DetailsPanel>`

**File:** `src/components/DetailsPanel.tsx`
**Panel:** Right (280 px fixed width)

| Prop | Type | Description |
|------|------|-------------|
| `activeSession` | `Session \| null` | Session whose details are shown |

Placeholder for character sheets, scene notes, and model configuration.

---

## 6. Type Reference

Defined in `src/types/index.ts`.

### `MessageRole`
```ts
type MessageRole = 'user' | 'assistant' | 'system'
```

### `Message`
| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `role` | `MessageRole` | Author of the message |
| `content` | `string` | Text body |
| `timestamp` | `number` | Unix ms |

### `Session`
| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `title` | `string` | Display name |
| `messages` | `Message[]` | Ordered history |
| `createdAt` | `number` | Unix ms |
| `updatedAt` | `number` | Unix ms |

### `LLMConfig`
| Field | Type | Description |
|-------|------|-------------|
| `baseUrl` | `string` | API base URL |
| `apiKey` | `string` | Auth token |
| `model` | `string` | Model identifier |

---

## 7. Styling System

All styles are **plain CSS** — no framework or preprocessor.

### CSS Variables (defined in `global.css` `:root`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `--color-bg-base` | `#0d0f14` | Page background |
| `--color-bg-panel` | `#13161e` | Floating panels |
| `--color-bg-surface` | `#1b1f2b` | Bubbles, inputs |
| `--color-bg-hover` | `#22273a` | List item hover |
| `--color-border` | `#2a2f45` | Panel & element borders |
| `--color-text-primary` | `#e2e6f0` | Body text |
| `--color-text-secondary` | `#7a82a0` | Labels, headings |
| `--color-text-muted` | `#4a5068` | Timestamps, hints |
| `--color-accent` | `#5b7cf6` | Buttons, active border |
| `--color-accent-hover` | `#7b96ff` | Hover accent |
| `--color-user-bubble` | `#1e2d5a` | User message bubble |
| `--sidebar-width` | `260px` | Left panel width |
| `--details-width` | `280px` | Right panel width |
| `--column-gap` | `16px` | Gap between panels |
| `--column-radius` | `12px` | Panel border-radius |

### Adding New Styles

1. Create a new file under `src/styles/` named after the component.
2. Import it at the top of the relevant component file.
3. Use CSS variables for all colours and spacing to stay theme-consistent.

---

## 8. AI Integration

The AI service is **not yet implemented**. The placeholder hook in `App.tsx → handleSend()` marks where the call will be dispatched.

### Planned implementation

1. **Install the OpenAI SDK:**
   ```bash
   npm install openai
   ```

2. **Create `src/services/aiService.ts`:**
   ```ts
   import OpenAI from 'openai'

   const client = new OpenAI({
     baseURL: import.meta.env.VITE_LLM_BASE_URL,
     apiKey:  import.meta.env.VITE_LLM_API_KEY,
     dangerouslyAllowBrowser: true,   // acceptable for local dev
   })

   export async function sendMessages(messages: ChatCompletionMessageParam[]) {
     return client.chat.completions.create({
       model:    import.meta.env.VITE_LLM_MODEL,
       messages,
       stream:   true,
     })
   }
   ```

3. **Wire up in `App.tsx`** inside `handleSend()` after the user message is appended.

4. **Streaming:** Append a temporary assistant message and update its `content` chunk-by-chunk for a real-time feel.

---

## 9. Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Description |
|----------|-------------|
| `VITE_LLM_BASE_URL` | Base URL of the OpenAI-compatible server |
| `VITE_LLM_API_KEY` | API key (any string for local servers) |
| `VITE_LLM_MODEL` | Model slug to request |

---

## 10. Coding Conventions

- **TypeScript strict mode** — no implicit `any`, exhaustive null checks.
- **All files** must have a header comment describing their purpose.
- **All functions** must have a JSDoc comment (`/** ... */`).
- **Component props** interfaces must be documented with inline comments.
- **CSS** — use variables from `global.css`; avoid magic numbers.
- **No external state libraries** at this stage — React hooks only.
- **No default exports for components** — named exports only (except `App`).
- Commit messages follow **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.).

---

## 11. Roadmap

- [ ] AI service integration (`src/services/aiService.ts`)
- [ ] Streaming token-by-token response display
- [ ] Session persistence (localStorage or IndexedDB)
- [ ] Character sheet editor in DetailsPanel
- [ ] System prompt / persona configuration per session
- [ ] Markdown rendering in message bubbles
- [ ] Model selector UI
- [ ] Export session to text/JSON
