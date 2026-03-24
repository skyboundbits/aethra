# App Characters & Avatars System Design

**Date:** 2026-03-24
**Status:** Approved for implementation
**Scope:** Add pre-made, read-only app characters and avatars that users can copy into their campaigns

---

## Overview

Aethra will ship with a library of pre-authored app characters and avatars. These are templates that users cannot edit directly, but can copy ("use") into their own campaigns, where they become fully editable character profiles.

**Goals:**
- Provide users with starter content so they don't begin from scratch
- Establish a scaffold for developers to easily add more characters
- Keep implementation simple: manual JSON editing for authoring

---

## Architecture

### Storage

App characters and avatars are stored as JSON files bundled with the Electron app:

```
electron/resources/app-content/
  ├─ app-avatars.json
  └─ app-characters.json
```

These files survive app updates and can be manually edited by users if desired.

### File Schemas

#### app-avatars.json

```json
{
  "avatars": [
    {
      "id": "avatar-001",
      "name": "Avatar Name",
      "imageData": "data:image/png;base64,...",
      "crop": {
        "x": 0,
        "y": 0,
        "scale": 1
      }
    }
  ]
}
```

**Fields:**
- `id`: Unique identifier (string, required)
- `name`: Display name shown in the modal (string, required)
- `imageData`: Image as data URL (string, required)
- `crop`: Avatar crop/framing state matching `CharacterAvatarCrop` type (object, required)

#### app-characters.json

```json
{
  "characters": [
    {
      "id": "app-char-001",
      "name": "Character Name",
      "role": "Warrior",
      "gender": "male",
      "pronouns": "he/him",
      "description": "Physical description...",
      "personality": "Personality traits...",
      "speakingStyle": "How they speak...",
      "goals": "Current objectives...",
      "avatarImageData": "data:image/png;base64,...",
      "avatarCrop": {
        "x": 0,
        "y": 0,
        "scale": 1
      }
    }
  ]
}
```

**Fields:**
- `id`: Unique identifier (string, required)
- `name`: Character name (string, required)
- `role`: Character archetype/role (string, required)
- `gender`: "male" | "female" | "non-specific" (string, required)
- `pronouns`: "he/him" | "she/her" | "they/them" (string, required)
- `description`: Physical appearance and presentation (string, required)
- `personality`: Personality traits and temperament (string, required)
- `speakingStyle`: Guidance for speech patterns (string, required)
- `goals`: Current objectives and motivations (string, required)
- `avatarImageData`: Avatar image embedded directly as data URL (string, required)
- `avatarCrop`: Avatar framing state (object, required)

**Note:** Avatar data is embedded directly in each character, not referenced by ID. This keeps character definitions self-contained.

### Runtime Loading

**Main Process (electron/main/index.ts):**
1. Load both JSON files from `electron/resources/app-content/` at app startup
2. Expose via IPC channel `appContent:get` (invoke) that returns `{ avatars, characters }`
3. Cache in memory; no writes to these files from the app

**Renderer (App.tsx):**
1. Fetch app content on mount via `window.api.getAppContent()`
2. Store in React state (e.g., `appCharacters`, `appAvatars`)
3. Pass to CharactersModal for display

### UI Integration

**CharactersModal Changes:**

Add a new "App Content" section/tab that displays:

1. **App Avatars Sub-section:**
   - Grid gallery of app avatars (read-only)
   - Clicking an avatar shows preview and "Copy Avatar" button
   - Copied avatar becomes a `ReusableAvatar` in the user's avatar library

2. **App Characters Sub-section:**
   - List of app characters (read-only, no edit button)
   - Each character shows name, role, avatar, and summary
   - "Use This Character" button on each
   - Clicking uses the copy-on-use workflow (see below)

Styling can reuse existing CSS classes from `characters.css` (gallery, cards, etc.).

### Copy-on-Use Workflow

When user clicks "Use This Character" on an app character:

1. **Create a new `CharacterProfile`:**
   - Copy all fields from the app character
   - Generate new `id` (UUID)
   - Set `reusableCharacterId: 'app-char-001'` to track origin
   - Set `createdAt` and `updatedAt` to current timestamp
   - Set `controlledBy: 'ai'` (or user's preference)

2. **Save to Campaign:**
   - Write the new profile to `<campaign>/characters/<id>/profile.json`
   - Sync to App state

3. **Display:**
   - Character now appears in the campaign's character list (editable like any other)
   - User can modify personality, goals, avatar, etc. as desired

### Author Workflow (For Developers)

To create/edit app characters and avatars:

1. **Edit JSON files directly** in `electron/resources/app-content/`
   - Use any JSON editor or text editor
   - Ensure valid JSON syntax

2. **For avatar images:**
   - Convert PNG/JPG to base64 data URL
   - Use online tools: https://www.base64-image.de/ or similar
   - Paste into `imageData` field

3. **For character avatars:**
   - Same base64 conversion
   - Paste into `avatarImageData` field

4. **Test:**
   - Run `npm run dev`
   - Open CharactersModal
   - Verify characters and avatars appear in "App Content" section

5. **Scaffolding Strategy:**
   - Start with 2 well-formed example characters
   - Verify loading and UI integration work
   - Add 3 more by copying/modifying the examples
   - Total: 5 app characters at initial completion

---

## Type Definitions

### New Types (if any)

No new types are needed. The app content conforms to existing types:
- App avatars → `ReusableAvatar` structure
- App characters → `CharacterProfile` structure (without id/createdAt, added during copy)

A utility function `createCharacterFromAppTemplate(appChar)` will handle the conversion.

---

## IPC Channels

**New Channel: `appContent:get` (invoke)**

**Request:** `{}`
**Response:**
```typescript
{
  avatars: Array<{ id, name, imageData, crop }>
  characters: Array<{ id, name, role, gender, pronouns, description, personality, speakingStyle, goals, avatarImageData, avatarCrop }>
}
```

---

## Error Handling

- If `app-avatars.json` or `app-characters.json` is missing: log warning, return empty arrays
- If files are malformed JSON: log error, return empty arrays (app continues normally)
- If image data URLs are invalid: gracefully degrade (show placeholder in UI)

---

## Testing Considerations

1. **Manual:** Load app, open CharactersModal, verify "App Content" section loads and displays
2. **Copy workflow:** Click "Use This Character," verify new character created in campaign
3. **Persistence:** Copied character should persist across app restarts
4. **Editability:** Copied character should be fully editable in the character editor

---

## Future Considerations

- Categories/tags for app characters (e.g., "Fantasy," "SciFi")
- Search/filter in app content section
- Ability to export user characters as app characters
- Community character library (remote URL loading)

---

## Success Criteria

✅ App content loads at startup without errors
✅ CharactersModal displays "App Content" section with avatars and characters
✅ "Use This Character" creates an editable copy in the campaign
✅ Copied character is persisted to disk
✅ Developer can manually edit JSON to add/modify app characters
✅ Initial scaffold works with 2 examples, easily extended to 5
