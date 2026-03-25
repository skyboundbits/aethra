# Aethra — AI-Powered Roleplay Application

**Aethra** is an Electron-based desktop application for interactive AI-assisted storytelling and roleplay. Create campaigns with multiple characters and scenes, interact with AI-controlled characters, and manage an entire roleplay narrative with persistent campaign data.

## At a Glance

- **Platform**: Electron 40 (cross-platform: Windows, macOS, Linux)
- **UI Framework**: React 18 + TypeScript 5 (strict mode)
- **Styling**: Custom CSS only (no frameworks)
- **AI Integration**: OpenAI-compatible APIs (local or remote)
- **Local AI Runtime**: Integrated llama.cpp server with auto-binary installation
- **Data Storage**: JSON-based persistent campaign files + settings

## Core Concepts

### Campaign
A top-level project containing multiple scenes and character profiles. Campaigns are stored as JSON files in the app's data directory, making them portable and shareable. Each campaign has:
- **Scenes**: Separate conversation threads within the campaign
- **Characters**: Custom character profiles with descriptions, personalities, and avatars
- **Settings**: Campaign-specific AI configuration

### Scene
A single conversation thread within a campaign. Scenes contain:
- **Messages**: A transcript of user/AI exchanges
- **Rolling Summary**: An automatic recap of older messages to keep context under control
- **Character Context**: Optional snapshots of which character was "speaking"

### Character Profile
A detailed profile for any entity in the roleplay. Includes:
- **Identity**: Name, role, gender, pronouns
- **Details**: Physical description, personality, speaking style, goals
- **Avatar**: Optional circular-cropped profile image
- **Controller**: Either AI-controlled or user-controlled

### AI Server
The backend service providing language model completions. Aethra supports:
- **LM Studio**: Local UI for model management
- **llama.cpp**: Command-line local inference with Aethra's integrated binary management
- **Ollama**: Container-based local model runtime
- **OpenAI-compatible APIs**: Any service exposing the OpenAI chat endpoint

## Getting Started

1. **Launch**: Run `npm run dev` to start the development server or use the packaged application
2. **Create Campaign**: Click "New Campaign" on the startup screen
3. **Configure AI**: Open Settings and add an AI server (local llama.cpp or remote)
4. **Add Characters**: Create character profiles in the Characters modal
5. **Start Chatting**: Send messages to interact with AI-controlled characters

For detailed setup instructions, see [Getting Started](./01-getting-started.md).

## Key Files & Navigation

| Section | Purpose |
|---------|---------|
| [Getting Started](./01-getting-started.md) | How to install, launch, and create your first campaign |
| [User Guide](./02-user-guide.md) | Features, UI layout, and how to use each component |
| [Campaigns & Scenes](./03-campaigns-and-scenes.md) | Creating campaigns, managing scenes, using rolling summaries |
| [Characters](./04-characters.md) | Creating character profiles, uploading avatars, managing roles |
| [AI & Models](./05-ai-and-models.md) | Configuring AI servers, managing models, model parameters |
| [Settings](./06-settings.md) | System prompts, themes, text sizes, debugging |
| [Architecture](./07-architecture.md) | Tech stack, file structure, IPC channels (for developers) |

## Default Settings

When you first launch Aethra, it comes pre-configured with:
- **Default Servers**: LM Studio and Ollama profiles (not auto-started)
- **Default Models**: Common open-source models (Llama 3.2, Mistral, etc.)
- **System Prompt**: Generic roleplay instruction
- **Theme**: Dark theme with semantic color variables
- **Rolling Summaries**: Disabled by default (optional feature)

You can import your own themes, add custom servers, and adjust all settings in the Settings modal.

## Platform-Specific Notes

### Windows
- **llama.cpp binary**: CUDA 12.4, Vulkan, or CPU backends auto-downloaded on demand
- **Storage location**: `%APPDATA%\Aethra\` (or path set by Electron)
- **Terminal**: Uses Bash (Git Bash or WSL recommended if not present)

### macOS
- **llama.cpp binary**: Metal acceleration for Apple Silicon (arm64) or x64
- **Storage location**: `~/Library/Application Support/Aethra/`
- **Requirements**: May need Xcode command-line tools for native modules

### Linux
- **llama.cpp binary**: Vulkan or CPU backends (CUDA not available in prebuilt)
- **Storage location**: `~/.config/Aethra/` or `$XDG_CONFIG_HOME/Aethra/`
- **Requirements**: Standard development tools for native modules

## Support & Troubleshooting

For detailed troubleshooting, see the relevant guide:
- **Chat not working?** → [AI & Models](./05-ai-and-models.md#troubleshooting)
- **Settings not saving?** → [Settings](./06-settings.md#troubleshooting)
- **Character avatars broken?** → [Characters](./04-characters.md#avatar-troubleshooting)
- **Performance issues?** → [Settings](./06-settings.md#optimization)

---

**Next step**: Read [Getting Started](./01-getting-started.md) to set up your first campaign.
