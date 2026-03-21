# Characters

This guide covers creating, editing, and managing character profiles in Aethra.

## Character Overview

A **character** is a profile for any entity in your roleplay—heroes, NPCs, antagonists, or even abstract forces. Each character has:
- **Identity**: Name, role, gender, pronouns
- **Narrative Details**: Physical description, personality, speaking style, goals
- **Avatar**: Optional circular profile image
- **Control**: Either AI-controlled or user-controlled

Characters are stored per campaign and can appear across multiple sessions.

## Character JSON Format

```json
{
  "id": "unique-uuid",
  "name": "Brave Knight",
  "folderName": "brave-knight",
  "role": "Warrior",
  "gender": "male",
  "pronouns": "he/him",
  "description": "A tall warrior with scarred armor and piercing blue eyes.",
  "personality": "Honorable, determined, sometimes reckless.",
  "speakingStyle": "Direct and bold, uses military terminology.",
  "goals": "Rescue the princess from the dragon's tower.",
  "avatarImageData": "data:image/png;base64,...",
  "avatarCrop": { "x": 0, "y": 0, "scale": 1 },
  "controlledBy": "user",
  "createdAt": 1705000000000,
  "updatedAt": 1705000000000
}
```

**Fields**:
- `id`: Unique identifier
- `name`: Display name in UI
- `folderName`: Filesystem folder name (auto-derived from name)
- `role`: Character title/archetype (e.g., "Warrior", "Sage", "Merchant")
- `gender`: `"male"`, `"female"`, or `"non-specific"`
- `pronouns`: `"he/him"`, `"she/her"`, or `"they/them"`
- `description`: Physical appearance and presentation
- `personality`: Character traits and temperament
- `speakingStyle`: How the character talks and communicates
- `goals`: Current objectives and motivations
- `avatarImageData`: Avatar image (as base64 data URL)
- `avatarCrop`: Avatar framing (x, y position; scale multiplier)
- `controlledBy`: `"user"` or `"ai"`
- `createdAt`, `updatedAt`: Unix timestamps

## Creating a Character

1. Click the **Characters** icon (📋) in the ribbon bar
2. Click **+ New Character**
3. Fill in the character details:
   - **Name**: Required
   - **Role**: Character title or archetype
   - **Gender** & **Pronouns**: Used in system prompts
   - **Description**: Physical appearance
   - **Personality**: Traits and temperament
   - **Speaking Style**: How they talk (e.g., "uses formal language", "speaks in riddles")
   - **Goals**: Current objectives
4. (Optional) Upload an avatar image
5. Click **Save Character**

The character is now available to "speak as" in the chat.

## Editing a Character

1. Open the **Characters** modal (📋)
2. Click a character name to edit it
3. Modify any field
4. Click **Save Character**

**Note**: Changes only affect new messages. Existing messages keep their character snapshots.

## Avatar Images

An **avatar** is a circular profile image displayed next to the character in messages.

### Uploading an Avatar

1. Open the **Characters** modal
2. Click a character to edit
3. Click **Upload Avatar** or drag-and-drop an image
4. Supported formats: PNG, JPG, GIF, WebP (recommended: square images, 256×256px)
5. The image is converted to base64 and stored in the campaign file

### Avatar Cropping

Once an image is uploaded, you can frame it:

1. An avatar editor appears showing the image in a circular viewport
2. **Drag to move**: Reposition the image within the circle
3. **Scroll to zoom**: Scale the image up or down (for tight crops)
4. Click **Apply Crop** to save the framing

The crop settings are stored and applied to all messages from that character.

### Avatar Tips

- **Use square images**: Easier to frame into a circle
- **High contrast**: Makes the avatar visible in the UI
- **Avoid text**: Text becomes unreadable when cropped to a circle
- **File size**: Keep under 500 KB for smooth app performance

### Avatar Troubleshooting

**Avatar not showing in chat**:
- Ensure the image was uploaded and saved
- Check that the character is selected when you send a message
- Avatars only appear when the character is explicitly selected

**Avatar looks pixelated**:
- The original image may be too small
- Try re-uploading a higher-resolution version

**Can't upload an image**:
- Ensure the file is a supported format (PNG, JPG, GIF, WebP)
- Try reducing the file size
- Check that you have write permissions in the app's data directory

## Using Characters in Chat

### Selecting a Character

In the **composer** (bottom of chat area):
1. Open the **character selector** dropdown
2. Click a character name
3. The avatar and details update in the right panel
4. Type your message and press Enter

The message will be tagged with that character and use their avatar.

### Character-Based AI Responses

The system prompt can instruct the AI to respond as a specific character:

> "You are Wise Sage. Respond in their voice. You are mysterious, speaks in metaphors."

Example response:
```
Sage: "Ah, you seek knowledge. Like water flowing downhill, truth always finds a path..."
```

### Multiple Characters Per User

You can create multiple characters all controlled by "user" and switch between them in the composer:

- Brave Knight (user-controlled)
- Rogue Scout (user-controlled)
- Holy Priest (user-controlled)

Switch in the composer dropdown to speak as any of them.

## AI-Controlled Characters

AI-controlled characters are spoken for by the AI in responses.

### Creating an AI Character

1. Create a character as usual (see "Creating a Character" above)
2. Set **Controlled By** to `"AI"`
3. Write a detailed **Speaking Style** and **Personality** so the AI knows how to portray them

### AI Behavior

When you send a message:
1. The AI sees the system prompt (which may list AI characters and their traits)
2. The AI generates a response from the perspective of an AI-controlled character
3. The response appears with that character's avatar (if set)

Example system prompt:
> "You are a roleplay narrator. There are two AI characters: the Wise Sage (mysterious, metaphorical) and the Goblin King (crude, ambitious). Respond as whichever character is most appropriate for the next narrative beat."

## Character Best Practices

### Detailed Profiles Lead to Better RP
1. **Write 2–3 sentences per field**: Brief but evocative
2. **Use specific traits**: Instead of "angry", say "quick-tempered, but respects honor"
3. **Think about voice**: Different characters have different speaking patterns
4. **Define goals**: Gives the AI direction for the character's actions

### Example: A Well-Defined Character

```
Name: Raven Nightwhisper
Role: Rogue Assassin
Gender: Female
Pronouns: she/her

Description:
  Lithe and dark-haired, with silver eyes that seem to catch the light.
  Favors black leather armor and twin daggers. A faint scar runs along
  her left cheekbone.

Personality:
  Pragmatic and cynical, but with a hidden code of honor. Trusts few,
  questions everything. Hides deep loneliness beneath a sardonic exterior.

Speaking Style:
  Dry, witty, uses dark humor. Speaks in clipped sentences. Often asks
  pointed questions. Uses criminal slang and underworld references.

Goals:
  Escape her past as a contract killer. Find redemption, if such a thing exists.
  Protect those she's come to care about, even if it costs her life.
```

### Generic Character Profiles Are Vague
Avoid:
```
Name: Fighter
Role: Warrior
Description: Tall and strong
Personality: Brave
Speaking Style: Talks like a fighter
Goals: Fight
```

Instead, give the AI something to work with.

### Character Archetypes

Some common archetypes to get you started:

**The Hero**: Noble, determined, faces challenges head-on
**The Sage**: Mysterious, speaks in wisdom and riddles, guides others
**The Rogue**: Clever, morally grey, motivated by personal gain
**The Healer**: Compassionate, self-sacrificing, driven by duty
**The Brute**: Crude, loyal, solves problems with force
**The Schemer**: Intelligent, manipulative, always has a plan

Mix and match traits to create unique characters.

## Character Snapshots in Messages

When you send a message as a character, Aethra **snapshots** their profile data:

```json
{
  "characterId": "char-uuid",
  "characterName": "Brave Knight",
  "characterAvatarImageData": "data:image/png;base64,...",
  "characterAvatarCrop": { "x": 0, "y": 0, "scale": 1 }
}
```

**Why snapshots?**
- If you change a character's name later, old messages still show the original name
- Avatar changes don't affect past messages
- The message history remains consistent and canonical

**Editing a snapshot**:
- Currently, you can't edit a message's character snapshot in the UI
- To change it, manually edit the campaign JSON file

## Deleting a Character

1. Open the **Characters** modal
2. Click a character name to edit
3. Click **Delete Character**
4. Confirm ⚠️ (deletion is permanent)

**Note**: Existing messages with this character's snapshot remain in chat. The character profile is removed, but the messages are preserved.

## Exporting & Backing Up Characters

Characters are included when you export a campaign:

1. Click **Menu (≡)** > **Export Campaign**
2. All characters, avatars, and sessions are exported as JSON

You can also manually extract a character's data by:
1. Opening the campaign JSON in a text editor
2. Copying the character object from the `characters/` folder
3. Pasting into another campaign's `characters/` folder (requires manual file editing)

## Troubleshooting

### Character avatar not saving
- Ensure the image file is supported (PNG, JPG, GIF, WebP)
- Check that the file size is under 500 KB
- Try re-uploading the image

### Can't delete a character
- The character may be in use in an active message
- Try closing and reopening the Characters modal
- If the issue persists, edit the campaign JSON directly

### Character details not appearing in AI responses
- Ensure the character is selected in the composer when you send
- Check the system prompt includes character instructions
- The AI model may need explicit character cues in prompts

### Avatar crop looks wrong
- Re-open the character and adjust the crop
- Try a different crop position or zoom level
- Avatar crops are saved only when you click **Apply**

---

**Next**: Learn about [AI & Models](./05-ai-and-models.md) to configure language models and fine-tune responses.
