# Getting Started with Aethra

## Installation & Setup

### Prerequisites
- **Node.js** 18+ and npm (for development builds)
- **Git** (recommended for cloning the repository)

### Development Installation

```bash
# Clone the repository
git clone <repository-url>
cd aethra

# Install dependencies (first time only)
npm install

# Start the development server
npm run dev
```

The Electron app will launch immediately. Development mode includes hot-reloading for UI changes.

### Production Build

```bash
# Build for your current platform
npm run build
```

The compiled application will be available in the `dist/` directory.

## First Launch

When you launch Aethra for the first time, you'll see the **Campaign Launcher** screen:

```
┌──────────────────────────────────────────┐
│  Aethra                                  │
│                                          │
│  Start with a campaign                   │
│                                          │
│  Create a new campaign with a name and   │
│  description, or reopen one stored in    │
│  the app data directory.                 │
│                                          │
│  [New Campaign]  [Open from File]        │
│                                          │
│  Recent Campaigns:                       │
│  (none)                                  │
└──────────────────────────────────────────┘
```

### Creating Your First Campaign

1. Click **New Campaign**
2. Fill in the campaign details:
   - **Name**: A title for your roleplay campaign (e.g., "Dragon's Quest")
   - **Description**: A brief summary (e.g., "A party of adventurers seeks a legendary artifact")
3. Click **Create** — the campaign is now saved and ready to use
4. You'll be taken directly to the main chat interface

### Configuring Your AI Server (Required Before Chatting)

Before you can send messages, you need to configure an AI server:

1. Click the **Settings** icon (⚙️) in the top ribbon bar
2. Navigate to the **Servers** tab
3. Either:
   - **Use a pre-configured server** (LM Studio or Ollama) if it's already running
   - **Add a new server** with a custom URL
   - **Set up local llama.cpp** (see below)
4. Click **Save Settings**

### Setting Up Local AI (llama.cpp)

Aethra can automatically download and manage a local AI runtime for you:

1. In Settings, go to the **Servers** tab
2. Ensure you have the **"Local (llama.cpp)"** server profile selected
3. Go to the **Models** tab and click **Install Binary**
4. The app will:
   - Detect your GPU/CPU capabilities
   - Download the appropriate llama.cpp binary (~10–250 MB depending on backend)
   - Extract it to the app's local directory
5. Select a model to download (optional; you can also use models already on disk)
6. Once a model is loaded, the status indicator shows **"Ready"**

> **Note**: The first binary download may take a few minutes depending on your internet speed. Subsequent model loads are much faster.

## Main Interface Overview

Once a campaign is loaded, you'll see the main interface:

```
┌─────────────────────────────────────────────────────────┐
│  [Aethra] ≡  [Campaign] [Settings] [Help]              │  Ribbon Bar
├─────────┬──────────────────────────────┬────────────────┤
│         │                              │                │
│ Sidebar │    Chat Area                │ Details Panel  │
│ (260px) │    (flex)                    │  (280px)       │
│         │                              │                │
│         │    Messages transcript       │  Character     │
│         │                              │  Avatar & Role │
│         │    ┌──────────────────────┐  │                │
│         │    │ Type message...      │  │  System Info   │
│         │    └──────────────────────┘  │                │
└─────────┴──────────────────────────────┴────────────────┘
```

### Left Panel — Sidebar
- **Scenes List**: Click to switch between conversations within the campaign
- **+ New Scene**: Create a new conversation thread
- **Settings** (⚙️): Configure servers, models, system prompt, and theme

### Center Panel — Chat Area & Input
- **Message Transcript**: Scroll to see the conversation history
- **Composer**: Type your roleplay message at the bottom
- **Characters Dropdown**: Select which character is "speaking" (if using character-based responses)

### Right Panel — Details
- **Character Avatar**: Circular profile image of the current character
- **Character Info**: Role, gender, pronouns, description
- **Current Scene**: Scene title and message count
- **AI Status**: Whether the server is connected and ready

## Sending Your First Message

1. **Select a Character** (optional):
   - Open the **Characters** modal (📋 icon in the ribbon bar)
   - Create a new character or select an existing one
   - Click to "speak as" that character

2. **Type in the Composer**:
   - Write your action or dialogue at the bottom of the chat area
   - Example: `"I draw my sword and look around for the dragon."`

3. **Press Enter** to send
   - Your message appears in the chat with your selected character's avatar
   - The AI generates a response (which may take 5–30 seconds depending on model size and hardware)
   - The AI response appears from the perspective of the next character

4. **Continue the Conversation**:
   - Keep typing to build the narrative
   - Messages are saved automatically to your campaign file

## Understanding the UI Status Indicators

### Top Right Corner
- **🟢 Green dot**: AI server is connected and a model is loaded
- **🔴 Red dot**: AI server is not connected or model is not loaded
- **⏳ Hourglass**: Waiting for an AI response to complete

### Sidebar Scene Items
- **Bold text**: Currently active scene
- **Timestamp**: Shows when the scene was last updated
- **Message count**: Number of messages in that scene

## Next Steps

Now that you've created a campaign and sent your first message, explore:
- **[Characters](./04-characters.md)** — Add character avatars and profiles
- **[AI & Models](./05-ai-and-models.md)** — Fine-tune model parameters and prompts
- **[Settings](./06-settings.md)** — Customize themes and system behavior

## Common Issues on First Launch

### "Could not reach the AI server"
- Make sure your AI server (LM Studio, Ollama, or local llama.cpp) is running
- Verify the server URL in Settings (default: `http://localhost:1234/v1` for LM Studio)
- Check that a model is loaded in the server

### "No models available"
- Your AI server is running but no models are loaded
- Load a model in your AI server software, then return to Aethra
- Or, use the Models tab in Settings to download a model automatically

### "Campaign won't load"
- Ensure you have write permissions to the app's data directory
- Try creating a new campaign in a different location
- Check that the campaign file isn't corrupted (open it in a text editor)

### App crashes on startup
- Delete or rename the `settings.json` file in the app data directory (usually `%APPDATA%\Aethra`)
- Restart Aethra; it will recreate default settings

For more troubleshooting, see [AI & Models](./05-ai-and-models.md#troubleshooting).
