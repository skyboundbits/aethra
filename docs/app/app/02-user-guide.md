# User Guide — Features & UI

This guide covers the core features and how to use each part of the Aethra interface.

## Main Interface Components

### Ribbon Bar (Top)
The top bar contains global navigation and actions:

- **Logo/Title**: Shows "Aethra" and the current campaign name
- **Menu (≡)**: Opens the campaign menu:
  - New Campaign
  - Open Campaign from File
  - Edit Campaign (rename/description)
  - Export Campaign (save a copy)
  - Close Campaign (return to launcher)
- **Tab Navigation**:
  - **Campaign**: Main chat view (default)
  - **Debug Console**: AI request/response logs (for troubleshooting)
  - **Settings**: Server, model, and UI configuration

### Sidebar (Left, 260px)

The sidebar contains:

#### Sessions List
- **Current session** is highlighted in bold
- Click any session to switch to it
- Sessions are ordered by most-recent activity
- Each session shows:
  - Session title (auto-named or custom)
  - Last updated timestamp
  - Message count badge

#### Session Actions
- **+ New Session**: Create a fresh conversation thread
- Right-click a session for options:
  - Rename session
  - Delete session
  - Export session as JSON

#### Settings & Tools
- **⚙️ Settings**: Open the Settings modal (server, models, theme, system prompt)
- **📋 Characters**: Open the Characters manager
- **🧠 AI Debug**: View detailed AI server logs

### Chat Area (Center)

The central panel displays the conversation:

#### Message Display
Each message shows:
- **Avatar**: Character's profile image (circular)
- **Name & Role**: Character name and role
- **Timestamp**: When the message was sent
- **Content**: The message text, with line breaks preserved
- **Styling**: User messages have different background than AI messages

#### Message Interactions
- **Hover over a message**:
  - Copy icon (📋): Copy message text to clipboard
  - Delete icon (🗑️): Remove message (permanent for current session)
- **User messages**: Light blue/gray background with character avatar on left
- **Assistant messages**: Darker background, appearing from the AI perspective

#### Composer (Bottom)
The text input area where you write your roleplay message:

- **Character selector** (optional dropdown): Choose which character is "speaking"
- **Text field**: Multi-line input (Shift+Enter for line breaks)
- **Send button** (→): Submit the message (or press Enter)
- **Auto-save**: Messages are saved immediately upon send

#### Status Indicator
Below the composer:
- **🟢 Connected**: Server is ready
- **🔴 Disconnected**: Server is unreachable
- **⏳ Generating...**: AI is producing a response

### Details Panel (Right, 280px)

The right panel shows context for the current session:

#### Character Avatar
- **Large circular crop** of the selected character's avatar image
- Click to open the character editor
- Shows a placeholder if no avatar is set

#### Character Info Card
- **Name**: Character name
- **Role**: Character title/archetype
- **Gender & Pronouns**: Used in AI context
- **Description**: Physical appearance and presentation
- **Personality**: Traits and temperament
- **Speaking Style**: How the character talks
- **Goals**: Current objectives and motivations

#### Session Info
- **Session Title**: Name of the current conversation
- **Messages Count**: Total messages in the session
- **Created**: Date the session was created

#### Model/Server Status
- **Current Model**: Name of the active AI model
- **Server**: Which AI server is being used
- **Connection Status**: Green = ready, Red = not available

## Key Features

### Creating & Managing Campaigns

#### New Campaign
1. From the Campaign Launcher, click **New Campaign**
2. Fill in:
   - **Name**: Campaign title
   - **Description**: Brief summary
3. Click **Create**
4. Campaign is immediately available and ready to use

#### Reopening a Campaign
From the Campaign Launcher:
- **Recent Campaigns List**: Click a campaign to open it
- **Open from File**: Browse for a campaign JSON file anywhere on disk
- **Edit Campaign**: Rename or update description

#### Exporting a Campaign
1. Click **Menu (≡)** > **Export Campaign**
2. Choose a location to save the JSON file
3. The file can be shared, backed up, or moved to another system

### Creating & Managing Sessions

A session is a separate conversation thread within a campaign.

#### New Session
1. Click **+ New Session** in the sidebar
2. Or use **Menu (≡)** > **New Session**
3. A new conversation thread is created and becomes active
4. Give it a title by right-clicking and selecting "Rename"

#### Switching Sessions
- Click any session in the sidebar to view its transcript
- The Details panel updates to show the new session's character and info

#### Deleting a Session
1. Right-click a session in the sidebar
2. Select **Delete Session**
3. Confirm deletion (⚠️ this is permanent)

#### Renaming a Session
1. Right-click a session
2. Select **Rename**
3. Enter a new title
4. Press Enter to save

### Streaming Responses

When you send a message, Aethra fetches a response from the AI server:

1. **Request is sent** with:
   - Your message
   - Recent message history (or rolling summary if enabled)
   - System prompt and character context

2. **Response streams in** token-by-token
   - Text appears in real-time (like ChatGPT's streaming)
   - You can read as it's being generated
   - ⏳ indicator shows progress

3. **Response completes**
   - Message is finalized and saved
   - Ready for your next input

> **Note**: If the AI server times out or crashes, an error message appears and the session remains editable. You can retry or move on.

### Rolling Summaries (Optional)

A **rolling summary** automatically compresses older messages to keep the AI context window under control:

#### How it Works
1. When you have >20 messages in a session, the background job starts
2. Every 1.5 seconds of idle time, the oldest messages are:
   - Summarized into a recap paragraph
   - Hidden from the chat (but preserved in the JSON)
   - Removed from the AI prompt to save tokens
3. Recent messages (last 10) always stay verbatim
4. New summaries append to the rolling summary field

#### Enabling/Disabling
1. Open **Settings** (⚙️)
2. Go to the **Chat** tab
3. Toggle **Enable Rolling Summaries**
4. Save settings

> **Best for**: Long campaigns with 100+ messages per session
> **Best against**: Short campaigns (summaries can oversimplify context)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Enter** | Send message (from composer) |
| **Shift+Enter** | Line break (from composer) |
| **Ctrl+N** / **Cmd+N** | New Session |
| **Escape** | Close modal or clear focus |

## UI Themes & Customization

Aethra comes with a built-in dark theme and supports custom themes.

### Changing the Theme
1. Open **Settings** (⚙️)
2. Go to the **Theme** tab
3. Select a built-in theme or custom theme
4. Changes apply immediately
5. Save settings

### Creating a Custom Theme
1. Open **Settings** > **Theme**
2. Click **Import Theme**
3. Select a JSON file with custom color tokens
4. Theme is imported and appears in the list

#### Theme Token Reference
Available tokens for custom themes:
- **`app-bg`**: Main background color
- **`panel-bg`**: Sidebar/details panel background
- **`surface-bg`**: Message bubbles
- **`surface-bg-user-message`**: User message bubble background
- **`text-color-primary`**: Main text color
- **`text-color-secondary`**: Secondary text (labels)
- **`border-color`**: UI borders
- **`shadow-panel`**: Panel drop shadows
- [See full token list in Architecture docs](./07-architecture.md#theme-tokens)

### Adjusting Text Size
1. Open **Settings** > **Chat**
2. Select **Chat Bubble Text Size**:
   - Small, Medium, Large, Extra Large
3. Changes apply immediately to all messages

## Accessibility & Navigation

### Screen Reader Support
- All buttons and interactive elements have aria-labels
- Modal dialogs announce their purpose
- Chat messages include role information (user/assistant)

### Keyboard Navigation
- Tab through buttons and form fields
- Enter to activate buttons
- Arrow keys to navigate lists (sessions, models)

### High Contrast
- All text meets WCAG AA contrast ratios
- Custom themes support high-contrast mode

## Tips & Best Practices

### For Immersive Roleplay
1. **Create detailed character profiles** before starting
2. **Keep system prompts concise** (3–4 sentences)
3. **Use rolling summaries** for long campaigns to maintain context
4. **Export campaigns regularly** for backup

### For Narrative Continuity
1. **Save character snapshots** in messages (use character selector)
2. **Use distinct speaking styles** per character in system prompt
3. **Pause and summarize** manually if AI loses direction
4. **Use separate sessions** for different scenes or time periods

### For Performance
1. **Close unused sessions** to reduce app memory
2. **Export and delete old campaigns** after completion
3. **Keep models under 30B parameters** for fast responses on consumer hardware
4. **Monitor hardware** in Settings > Debug Console

---

Next: Learn about [Campaigns & Sessions](./03-campaigns-and-sessions.md) in detail, or jump to [Characters](./04-characters.md) to set up character profiles.
