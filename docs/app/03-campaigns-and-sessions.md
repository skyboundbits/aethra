# Campaigns & Sessions

This guide covers campaign structure, session management, and rolling summaries in detail.

## Campaign Structure

A **campaign** is the top-level container for your roleplay narrative. It includes:
- Multiple **sessions** (conversation threads)
- **Characters** (profiles for any entity)
- Metadata (name, description, creation date)

### Campaign Storage

Campaigns are stored as JSON files in the app's user data directory:

```
<userData>/campaigns/
├── my-campaign-uuid/
│   ├── campaign.json          # Main campaign file
│   ├── sessions/
│   │   ├── session-uuid-1.json
│   │   ├── session-uuid-2.json
│   │   └── ...
│   └── characters/
│       ├── character-uuid-1/
│       │   ├── character.json
│       │   └── avatar.png (optional)
│       └── ...
```

### Campaign JSON Format

```json
{
  "id": "unique-uuid",
  "name": "Dragon's Quest",
  "description": "A party of adventurers seeks an ancient artifact.",
  "sessions": [ {...}, {...} ],
  "createdAt": 1705000000000,
  "updatedAt": 1705100000000
}
```

**Fields**:
- `id`: Unique identifier (auto-generated)
- `name`: Display name in UI
- `description`: Short summary
- `sessions`: Array of Session objects
- `createdAt`, `updatedAt`: Unix timestamps (milliseconds)

## Sessions

A **session** is a single conversation thread. You can have multiple sessions per campaign to represent:
- Different scenes or chapters
- Alternate timelines or "what-if" branches
- Different groups of characters
- Separate narrative arcs

### Session JSON Format

```json
{
  "id": "unique-uuid",
  "title": "The Dragon's Lair",
  "messages": [ {...}, {...} ],
  "rollingSummary": "The party arrived at the mountain...",
  "summarizedMessageCount": 15,
  "createdAt": 1705000000000,
  "updatedAt": 1705100000000
}
```

**Fields**:
- `id`: Unique identifier
- `title`: Display name (shown in sidebar)
- `messages`: Array of Message objects (see below)
- `rollingSummary`: Auto-generated recap of archived messages
- `summarizedMessageCount`: How many messages have been compressed into the summary
- `createdAt`, `updatedAt`: Unix timestamps

### Creating Sessions

#### In the UI
1. Click **+ New Session** in the sidebar
2. A new session is created with an auto-generated title
3. Start typing to send the first message
4. Right-click to rename the session

#### Via Menu
1. Click **Menu (≡)** at the top
2. Select **New Session**
3. Same as above

### Message Structure

Each message in a session has this structure:

```json
{
  "id": "unique-uuid",
  "role": "user",
  "content": "I draw my sword and look around.",
  "characterId": "char-uuid",
  "characterName": "Brave Knight",
  "characterAvatarImageData": "data:image/png;base64,...",
  "characterAvatarCrop": { "x": 0, "y": 0, "scale": 1 },
  "timestamp": 1705000010000
}
```

**Fields**:
- `id`: Message identifier
- `role`: `"user"` (you) or `"assistant"` (AI)
- `content`: The message text
- `characterId`: Which character profile this came from (optional)
- `characterName`: Snapshot of character name at send time
- `characterAvatarImageData`: Snapshot of avatar (as data URL)
- `characterAvatarCrop`: Avatar framing settings
- `timestamp`: When sent (Unix ms)

**Note**: Character snapshots are frozen at send time, so changing a character profile doesn't affect past messages.

## Managing Sessions

### Renaming a Session
1. Right-click a session in the sidebar
2. Select **Rename**
3. Type the new title
4. Press Enter

### Deleting a Session
1. Right-click a session
2. Select **Delete Session**
3. Confirm ⚠️ (deletion is permanent)

### Exporting a Session
1. Right-click a session
2. Select **Export Session**
3. Choose a location to save the JSON file
4. The session can be imported into another campaign (not yet supported in UI)

### Viewing Session Info
In the **Details Panel** (right side), you see:
- Session title
- Message count
- Creation date
- Current character

## Rolling Summaries

A **rolling summary** automatically compresses older messages to keep the AI context window manageable for long campaigns.

### How Rolling Summaries Work

When you have many messages in a session (>20), Aethra periodically:

1. **Identifies summarizable messages**: The oldest unsummarized messages
2. **Generates a recap**: Sends those messages to the AI with a prompt like:
   > "Summarize the following conversation in 2–3 sentences, preserving key character actions and plot developments."
3. **Archives the recap**: The summary is stored in the `rollingSummary` field
4. **Hides old messages**: They're preserved in JSON but excluded from future AI prompts

### Benefits
- **Token efficiency**: Long campaigns don't blow past the AI's context limit
- **Automatic**: No manual effort required
- **Preserves history**: Messages are still in the JSON file, just not in the active prompt

### Costs
- **Slight delays**: Summary generation adds 1–2 seconds of idle processing
- **Context loss**: Very old plot points may be oversimplified in the summary
- **Not ideal for short campaigns**: Unnecessary overhead for <100 message sessions

### Enabling/Disabling

1. Open **Settings** (⚙️)
2. Go to the **Chat** tab
3. Toggle **Enable Rolling Summaries**
4. Save

Once enabled, summaries are generated automatically in the background.

### Rolling Summary Behavior

**Summarization triggers when**:
- The session is idle for >1.5 seconds
- There are >20 unsummarized messages
- The recent message window hasn't been fully summarized yet

**Recent messages are always kept verbatim**:
- The last 10 messages always stay in the prompt word-for-word
- This ensures the AI has immediate context

**Summary grows over time**:
- First summary: "The party defeated goblins..." (messages 1–15)
- Later: "The party defeated goblins, crossed a bridge, and encountered a sphinx..." (messages 1–50)
- The summary keeps appending, like a chapter recap

### Example Rolling Summary Lifecycle

**Session with 50 messages**:

```
Session start:
  - Messages 1–50 all in prompt
  - rollingSummary: "" (empty)
  - summarizedMessageCount: 0

After 5 minutes (>20 messages, idle >1.5s):
  - AI generates summary of messages 1–15
  - rollingSummary: "The party arrived at the mountain base and defeated goblin scouts."
  - summarizedMessageCount: 15
  - Messages 1–15 no longer in prompt
  - Messages 16–50 still in prompt

After 10 minutes (>20 unsummarized):
  - AI generates summary of messages 16–35
  - rollingSummary: "The party arrived at the mountain base and defeated goblin scouts. They crossed a rope bridge and encountered a sphinx."
  - summarizedMessageCount: 35
  - Messages 1–35 no longer in prompt
  - Messages 36–50 still in prompt
```

### Manual Summary Control

You cannot manually trigger a summary in the current UI, but you can:
- **View the summary** in the session JSON (open the campaign file in a text editor)
- **Clear the summary** by editing the campaign JSON directly
- **Disable summaries** in Settings if they're too aggressive

## Exporting & Backing Up

### Export a Campaign
1. Click **Menu (≡)** > **Export Campaign**
2. Choose a destination folder
3. A copy of the entire campaign (with all sessions and characters) is saved as JSON
4. Perfect for backup or sharing

### Import a Campaign
From the Campaign Launcher:
1. Click **Open from File**
2. Select a campaign JSON file anywhere on disk
3. The campaign is loaded (no copy; it's used from its current location)

> **Tip**: For safety, always keep a backup copy of important campaigns. Use **Export Campaign** regularly to create copies.

## Best Practices

### Campaign Organization
1. **One campaign per narrative arc**: Keep related sessions together
2. **Use clear names**: "Dragon Quest Act 1" is better than "Campaign 1"
3. **Write descriptions**: Helps you remember what a campaign is about

### Session Naming
1. **Name by scene or chapter**: "The Dragon's Lair", "City of Shadows", "Return Home"
2. **Use timestamps if episodic**: "Session 1 - 2025-03", "Session 2 - 2025-04"
3. **Rename as you play**: Update the title to reflect what actually happened

### Backups
1. **Export your campaign** after each major session
2. **Store exports in cloud storage** (Google Drive, Dropbox, OneDrive)
3. **Keep local copies** on your machine

### Performance
1. **Archive old sessions** by exporting and deleting them if a campaign gets huge (1000+ messages)
2. **Use rolling summaries** for campaigns >200 messages per session
3. **Close unused campaigns** to free app memory

## Troubleshooting

### Session won't save
- Check that you have write permissions in the app's data directory
- Try exporting the campaign and re-importing it
- Check available disk space

### Rolling summary not generating
- Ensure **Enable Rolling Summaries** is ON in Settings
- Wait 1.5+ seconds of idle time
- Have >20 unsummarized messages

### Campaign file corrupted
- Open the campaign JSON in a text editor
- Look for syntax errors (missing commas, unclosed braces)
- Use an online JSON validator to identify issues
- Try restoring from a backup export

### Can't open a campaign from file
- Ensure the file is valid JSON (open in text editor to check)
- Confirm the file hasn't been moved or deleted
- Check that you have read permissions
- Try copying the file to the app's default campaign directory

---

**Next**: Learn about [Characters](./04-characters.md) to create detailed character profiles.
