# Aethra Documentation

Welcome to the complete documentation for **Aethra**, an AI-powered desktop application for interactive roleplay and storytelling.

## Documentation Index

Start with the section that matches your needs:

### 👤 For End Users

1. **[Overview](./00-overview.md)** — What is Aethra? Core concepts and key files
2. **[Getting Started](./01-getting-started.md)** — Installation, setup, and creating your first campaign
3. **[User Guide](./02-user-guide.md)** — UI layout, features, and how to use each part
4. **[Campaigns & Sessions](./03-campaigns-and-sessions.md)** — Managing campaigns, sessions, and rolling summaries
5. **[Characters](./04-characters.md)** — Creating character profiles, avatars, and personality traits
6. **[AI & Models](./05-ai-and-models.md)** — Configuring AI servers, selecting models, fine-tuning parameters
7. **[Settings](./06-settings.md)** — User preferences, themes, debugging, and optimization

### 👨‍💻 For Developers

8. **[Architecture](./07-architecture.md)** — Tech stack, file structure, state management, IPC, and internal design

---

## Quick Links

### Common Tasks

- **First time here?** → [Getting Started](./01-getting-started.md)
- **How do I use the app?** → [User Guide](./02-user-guide.md)
- **How do I set up AI?** → [AI & Models](./05-ai-and-models.md)
- **Where does my data go?** → [Campaigns & Sessions](./03-campaigns-and-sessions.md#campaign-storage)
- **How do I customize the look?** → [Settings — Themes](./06-settings.md#theme-settings)
- **What's under the hood?** → [Architecture](./07-architecture.md)

### Troubleshooting

- **AI server won't connect** → [AI & Models — Troubleshooting](./05-ai-and-models.md#troubleshooting)
- **Campaign won't load** → [Campaigns — Troubleshooting](./03-campaigns-and-sessions.md#troubleshooting)
- **Settings won't save** → [Settings — Troubleshooting](./06-settings.md#troubleshooting-settings)
- **Avatar issues** → [Characters — Avatar Troubleshooting](./04-characters.md#avatar-troubleshooting)

### Reference

- **Component overview** → [Architecture — Component Hierarchy](./07-architecture.md#component-hierarchy)
- **IPC channels** → [Architecture — IPC Channels](./07-architecture.md#ipc-channels)
- **CSS variables** → [Architecture — CSS Architecture](./07-architecture.md#css-architecture)
- **Type definitions** → [Architecture — src/types/index.ts](./07-architecture.md#srcindex-ts)

---

## Key Concepts

### Campaign
A top-level project containing multiple sessions and character profiles. Campaigns are stored as JSON files and are portable.

### Session
A single conversation thread within a campaign. Contain messages, rolling summaries, and character context.

### Character Profile
A detailed entity profile (hero, NPC, etc.) with identity, personality, avatar, and control type.

### AI Server
The backend service providing language model completions (local llama.cpp or remote API).

### Model
The language model AI engine (e.g., Llama 3.2 8B, Mistral 7B).

For detailed explanations, see [Overview — Core Concepts](./00-overview.md#core-concepts).

---

## Getting Help

### In-App Help
- Click **Settings** (⚙️) to access configuration and debug logs
- Click **🧠 AI Debug** to view detailed server logs for troubleshooting

### In Documentation
Use the **Common Tasks** or **Troubleshooting** links above to find answers to specific questions.

### For Bugs or Feature Requests
Refer to the project's GitHub repository (if applicable).

---

## Document Structure

Each guide follows a consistent format:

1. **Overview** — What the feature is and why you'd use it
2. **Step-by-step instructions** — How to accomplish common tasks
3. **Reference** — Detailed field descriptions, JSON formats, configuration options
4. **Troubleshooting** — Common issues and solutions
5. **Best practices** — Tips for optimal use

---

## Platform Notes

Aethra runs on Windows, macOS, and Linux. Platform-specific notes are included in:
- [Getting Started — Platform-Specific Notes](./01-getting-started.md#platform-specific-notes)
- [AI & Models — Local AI Runtime](./05-ai-and-models.md#local-ai-runtime-llamacpp)

---

## Data Storage

Your data is stored locally:

- **Windows**: `%APPDATA%\Aethra\`
- **macOS**: `~/Library/Application Support/Aethra/`
- **Linux**: `~/.config/Aethra/` or `$XDG_CONFIG_HOME/Aethra/`

### Contents
```
<userData>/
├── settings.json              # User preferences, servers, models, themes
├── campaigns/
│   ├── {campaign-id}/
│   │   ├── campaign.json      # Campaign metadata and sessions
│   │   ├── sessions/
│   │   │   └── *.json         # Individual session transcripts
│   │   └── characters/
│   │       └── {char-id}/     # Character profiles and avatars
│   └── ...
```

For details, see [Campaigns — Campaign Storage](./03-campaigns-and-sessions.md#campaign-storage).

---

## Tips for Getting the Most Out of Aethra

1. **Create detailed character profiles** — Better descriptions = better AI responses
2. **Write custom system prompts** — Specific instructions produce more immersive roleplay
3. **Use rolling summaries for long campaigns** — Keeps AI context under control
4. **Export campaigns regularly** — Automatic backups prevent data loss
5. **Start with a smaller model** — 8B parameters is a good sweet spot; scale up if you have GPU

See [User Guide — Tips & Best Practices](./02-user-guide.md#tips--best-practices) for more.

---

## Version & Changelog

Current documentation version: **1.0**

This documentation covers the **current stable version** of Aethra with Electron-based architecture, React UI, and integrated llama.cpp support.

For version-specific changes, see your app's About dialog (if available) or check the repository's release notes.

---

## Questions or Feedback?

If you find errors, outdated information, or have suggestions for the documentation, please open an issue in the project repository.

Happy roleplaying! 🎭
