# App Characters & Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship pre-made app characters and avatars that users can copy into their campaigns.

**Architecture:** App content (JSON files) is loaded by Electron main process at startup and exposed via IPC. React renderer fetches it, caches in state, and passes to CharactersModal. When user clicks "Use This Character," a helper function converts the app template into a campaign-scoped CharacterProfile. Copy-on-use keeps app templates immutable while allowing users to edit copies.

**Tech Stack:** Electron (main/preload/renderer), React 18, TypeScript, custom CSS

**Scope:** Scaffold with 2 example app characters + avatars; extend to 5 total with manual JSON editing.

---

## Task 1: Create Example App Avatars

**Files:**
- Create: `electron/resources/app-content/app-avatars.json`

- [ ] **Step 1: Create the directory structure**

Run:
```bash
mkdir -p electron/resources/app-content
```

Expected: Directory created.

- [ ] **Step 2: Create app-avatars.json with 2 example avatars**

Create file `electron/resources/app-content/app-avatars.json`:

```json
{
  "avatars": [
    {
      "id": "avatar-001",
      "name": "Noble Knight",
      "imageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "crop": {
        "x": 0,
        "y": 0,
        "scale": 1
      }
    },
    {
      "id": "avatar-002",
      "name": "Mysterious Sage",
      "imageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "crop": {
        "x": 0,
        "y": 0,
        "scale": 1
      }
    }
  ]
}
```

**Note:** Use 1x1 transparent PNG for now (`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`). You'll replace with real images later.

Expected: File created with valid JSON.

- [ ] **Step 3: Verify JSON is valid**

Run:
```bash
cat electron/resources/app-content/app-avatars.json | jq .
```

Expected: Formatted JSON output (no parse errors).

- [ ] **Step 4: Commit**

```bash
git add electron/resources/app-content/app-avatars.json
git commit -m "feat: add example app avatars (scaffolding)"
```

---

## Task 2: Create Example App Characters

**Files:**
- Create: `electron/resources/app-content/app-characters.json`

- [ ] **Step 1: Create app-characters.json with 2 example characters**

Create file `electron/resources/app-content/app-characters.json`:

```json
{
  "characters": [
    {
      "id": "app-char-001",
      "name": "Sir Aldric",
      "role": "Knight",
      "gender": "male",
      "pronouns": "he/him",
      "description": "A seasoned knight with silver-streaked hair and a weathered face. Stands tall in ceremonial armor, bearing the crest of a forgotten order.",
      "personality": "Honorable and stoic. Speaks with measured deliberation. Values duty above all else, though hints of weariness suggest years of moral compromise.",
      "speakingStyle": "Formal and measured. Uses archaic phrasing. Addresses others with titles unless told otherwise. Rarely raises his voice.",
      "goals": "Restore honor to his order. Protect those who cannot protect themselves. Uncover the truth behind the kingdom's decline.",
      "avatarImageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "avatarCrop": {
        "x": 0,
        "y": 0,
        "scale": 1
      }
    },
    {
      "id": "app-char-002",
      "name": "Lyra the Archivist",
      "role": "Sage",
      "gender": "female",
      "pronouns": "she/her",
      "description": "A scholar with sharp, intelligent eyes and ink-stained fingers. Her robes are adorned with symbols of forgotten languages. Despite her academic appearance, she moves with unexpected grace.",
      "personality": "Curious, enigmatic, and playfully evasive. Speaks in riddles and references obscure texts. Hides deep sadness beneath a veneer of intellectual detachment.",
      "speakingStyle": "Poetic and metaphorical. Uses metaphors drawn from history and nature. Often quotes texts, sometimes incorrectly on purpose. Laughs often, rarely genuinely.",
      "goals": "Recover lost knowledge before it's forgotten forever. Mentor a worthy student. Discover what truly lies beneath the world's oldest libraries.",
      "avatarImageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "avatarCrop": {
        "x": 0,
        "y": 0,
        "scale": 1
      }
    }
  ]
}
```

Expected: File created with valid JSON.

- [ ] **Step 2: Verify JSON is valid**

Run:
```bash
cat electron/resources/app-content/app-characters.json | jq .
```

Expected: Formatted JSON output (no parse errors).

- [ ] **Step 3: Commit**

```bash
git add electron/resources/app-content/app-characters.json
git commit -m "feat: add example app characters (scaffolding)"
```

---

## Task 3: Add IPC Handler in Main Process

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Read the main process file to understand structure**

(Already done in planning phase)

- [ ] **Step 2: Add imports for fs and path at the top of electron/main/index.ts**

Add near the top with other imports:

```typescript
import * as fs from 'fs'
import * as path from 'path'
```

- [ ] **Step 3: Add IPC handler for appContent:get**

Find the section where IPC handlers are registered (look for `ipcMain.handle(...)` patterns). Add this handler:

```typescript
/**
 * Fetch app-provided characters and avatars from the bundled JSON files.
 * Returns an object with { avatars, characters } arrays.
 * If files don't exist or are malformed, returns empty arrays.
 */
ipcMain.handle('appContent:get', async () => {
  try {
    const resourcesPath = path.join(__dirname, '..', 'resources', 'app-content')

    let avatars: unknown[] = []
    let characters: unknown[] = []

    // Load avatars
    const avatarsPath = path.join(resourcesPath, 'app-avatars.json')
    if (fs.existsSync(avatarsPath)) {
      const avatarsData = JSON.parse(fs.readFileSync(avatarsPath, 'utf-8'))
      avatars = avatarsData.avatars || []
    }

    // Load characters
    const charactersPath = path.join(resourcesPath, 'app-characters.json')
    if (fs.existsSync(charactersPath)) {
      const charactersData = JSON.parse(fs.readFileSync(charactersPath, 'utf-8'))
      characters = charactersData.characters || []
    }

    return { avatars, characters }
  } catch (error) {
    console.error('Error loading app content:', error)
    return { avatars: [], characters: [] }
  }
})
```

Expected: No build errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat: add IPC handler for appContent:get"
```

---

## Task 4: Add Type Definitions for Window API

**Files:**
- Modify: `src/types/electron.d.ts`

- [ ] **Step 1: Read electron.d.ts to understand the structure**

(Note: This file already exists and defines the window.api context bridge)

- [ ] **Step 2: Add getAppContent method to the api interface**

Find the interface that defines `window.api` methods. Add:

```typescript
/**
 * Fetch pre-authored app characters and avatars.
 * Returns object with { avatars, characters } arrays.
 */
getAppContent(): Promise<{
  avatars: Array<{
    id: string
    name: string
    imageData: string
    crop: { x: number; y: number; scale: number }
  }>
  characters: Array<{
    id: string
    name: string
    role: string
    gender: 'male' | 'female' | 'non-specific'
    pronouns: 'he/him' | 'she/her' | 'they/them'
    description: string
    personality: string
    speakingStyle: string
    goals: string
    avatarImageData: string
    avatarCrop: { x: number; y: number; scale: number }
  }>
}>
```

Expected: TypeScript compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/electron.d.ts
git commit -m "feat: add getAppContent type definition"
```

---

## Task 5: Update Preload Script

**Files:**
- Modify: `electron/preload/index.ts`

- [ ] **Step 1: Read preload/index.ts to understand the context bridge setup**

(Already done in planning)

- [ ] **Step 2: Add getAppContent to the context bridge**

Find the section where context bridge exposes API methods. Add:

```typescript
getAppContent: () => ipcRenderer.invoke('appContent:get'),
```

This should go in the same object that contains other API methods like `streamCompletion`, `settings:get`, etc.

Expected: No build errors.

- [ ] **Step 3: Commit**

```bash
git add electron/preload/index.ts
git commit -m "feat: expose getAppContent via context bridge"
```

---

## Task 6: Create App Content Utility

**Files:**
- Create: `src/utils/appContentUtils.ts`

- [ ] **Step 1: Create the utility file**

Create file `src/utils/appContentUtils.ts`:

```typescript
/**
 * src/utils/appContentUtils.ts
 * Utilities for working with pre-authored app characters and avatars.
 */

import type { CharacterProfile, CharacterAvatarCrop } from '../types'

/**
 * Convert an app character template into a campaign-scoped CharacterProfile.
 * Creates a new instance with a fresh ID, timestamps, and controlledBy set to 'ai'.
 * Tracks the source via reusableCharacterId.
 */
export function createCharacterFromAppTemplate(appCharacter: {
  id: string
  name: string
  role: string
  gender: 'male' | 'female' | 'non-specific'
  pronouns: 'he/him' | 'she/her' | 'they/them'
  description: string
  personality: string
  speakingStyle: string
  goals: string
  avatarImageData: string
  avatarCrop: CharacterAvatarCrop
}): Omit<CharacterProfile, 'id' | 'folderName'> {
  const now = Date.now()

  return {
    name: appCharacter.name,
    role: appCharacter.role,
    gender: appCharacter.gender,
    pronouns: appCharacter.pronouns,
    description: appCharacter.description,
    personality: appCharacter.personality,
    speakingStyle: appCharacter.speakingStyle,
    goals: appCharacter.goals,
    avatarImageData: appCharacter.avatarImageData,
    avatarCrop: appCharacter.avatarCrop,
    reusableCharacterId: appCharacter.id,
    controlledBy: 'ai',
    avatarSourceId: undefined,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Convert an app avatar into a ReusableAvatar.
 * Creates a new instance with a fresh ID and timestamps.
 */
export function createReusableAvatarFromAppTemplate(appAvatar: {
  id: string
  name: string
  imageData: string
  crop: CharacterAvatarCrop
}) {
  const now = Date.now()

  return {
    id: `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: appAvatar.name,
    imageData: appAvatar.imageData,
    crop: appAvatar.crop,
    createdAt: now,
    updatedAt: now,
  }
}
```

Expected: File created with valid TypeScript.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npm run build 2>&1 | head -50
```

Expected: No errors related to appContentUtils.

- [ ] **Step 3: Commit**

```bash
git add src/utils/appContentUtils.ts
git commit -m "feat: add app content utility functions"
```

---

## Task 7: Fetch App Content in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add state for app content**

In the useState section of App.tsx, add:

```typescript
const [appCharacters, setAppCharacters] = useState<typeof appCharacters>([])
const [appAvatars, setAppAvatars] = useState<typeof appAvatars>([])
```

**Better way (type-safe):** Add imports for app content types, then:

```typescript
const [appCharacters, setAppCharacters] = useState<Array<{
  id: string
  name: string
  role: string
  gender: 'male' | 'female' | 'non-specific'
  pronouns: 'he/him' | 'she/her' | 'they/them'
  description: string
  personality: string
  speakingStyle: string
  goals: string
  avatarImageData: string
  avatarCrop: { x: number; y: number; scale: number }
}>>([])

const [appAvatars, setAppAvatars] = useState<Array<{
  id: string
  name: string
  imageData: string
  crop: { x: number; y: number; scale: number }
}>>([])
```

- [ ] **Step 2: Add useEffect to fetch app content on mount**

Add a new useEffect hook:

```typescript
useEffect(() => {
  window.api.getAppContent().then(content => {
    setAppCharacters(content.characters)
    setAppAvatars(content.avatars)
  }).catch(error => {
    console.error('Failed to load app content:', error)
  })
}, [])
```

Expected: No TypeScript errors.

- [ ] **Step 3: Pass app content to CharactersModal**

Find where `<CharactersModal ... />` is rendered. Add props:

```tsx
<CharactersModal
  // ... existing props ...
  appCharacters={appCharacters}
  appAvatars={appAvatars}
/>
```

- [ ] **Step 4: Verify no build errors**

Run:
```bash
npm run build 2>&1 | head -50
```

Expected: No errors (may have TS warnings about unused props).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: fetch and pass app content to CharactersModal"
```

---

## Task 8: Add App Content Tab to CharactersModal

**Files:**
- Modify: `src/components/CharactersModal.tsx`

- [ ] **Step 1: Read CharactersModal to understand structure**

(Already done in planning; note the modal likely has tabs/nav and a main panel)

- [ ] **Step 2: Update component props to accept appCharacters and appAvatars**

Find the interface/type for CharactersModal props. Add:

```typescript
appCharacters?: Array<{
  id: string
  name: string
  role: string
  gender: 'male' | 'female' | 'non-specific'
  pronouns: 'he/him' | 'she/her' | 'they/them'
  description: string
  personality: string
  speakingStyle: string
  goals: string
  avatarImageData: string
  avatarCrop: { x: number; y: number; scale: number }
}>
appAvatars?: Array<{
  id: string
  name: string
  imageData: string
  crop: { x: number; y: number; scale: number }
}>
```

- [ ] **Step 3: Add state for tracking selected tab**

The modal likely already has a tab state (e.g., `activeTab`). Ensure "app-content" is a valid tab option.

If not already present, add a tab option:

```typescript
const [activeTab, setActiveTab] = useState<'library' | 'editor' | 'app-content'>('app-content')
```

(Adjust based on existing tab names)

- [ ] **Step 4: Add App Content tab button to nav**

Find the nav/tab buttons section in the render. Add:

```tsx
<button
  className={`characters-modal__tab ${activeTab === 'app-content' ? 'characters-modal__tab--active' : ''}`}
  onClick={() => setActiveTab('app-content')}
>
  <span>📚 App Content</span>
</button>
```

Expected: Button appears in the modal nav.

- [ ] **Step 5: Add App Content panel to render**

Find where panels are conditionally rendered (e.g., `activeTab === 'library' && <LibraryPanel />`). Add:

```tsx
{activeTab === 'app-content' && (
  <div className="characters-modal__panel">
    {/* Avatars section */}
    {(appAvatars?.length ?? 0) > 0 && (
      <div>
        <h3 className="characters-modal__heading--section">App Avatars</h3>
        <div className="characters-modal__gallery">
          {appAvatars?.map(avatar => (
            <div key={avatar.id} className="characters-modal__gallery-item">
              <div
                className="characters-modal__gallery-avatar"
                style={{ backgroundImage: `url(${avatar.imageData})` }}
              />
              <div className="characters-modal__gallery-name">{avatar.name}</div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Characters section */}
    {(appCharacters?.length ?? 0) > 0 && (
      <div>
        <h3 className="characters-modal__heading--section">App Characters</h3>
        {appCharacters?.map(character => (
          <div key={character.id} className="characters-modal__relationship-card">
            <div className="characters-modal__relationship-summary">
              <div
                className="characters-modal__relationship-avatar characters-modal__relationship-avatar--image"
                style={{ backgroundImage: `url(${character.avatarImageData})` }}
              />
              <div>
                <div className="characters-modal__relationship-name">{character.name}</div>
                <div className="characters-modal__relationship-subheading">{character.role}</div>
              </div>
            </div>
            <button
              className="characters-modal__footer-btn characters-modal__footer-btn--primary"
              onClick={() => {
                // TODO: Implement copy-on-use (next task)
              }}
            >
              Use This Character
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: Verify no errors and modal renders**

Run:
```bash
npm run build 2>&1 | head -50
```

Expected: No errors (may have TS warnings about onClick handlers).

- [ ] **Step 7: Commit**

```bash
git add src/components/CharactersModal.tsx
git commit -m "feat: add App Content tab to CharactersModal"
```

---

## Task 9: Implement Copy-on-Use Workflow

**Files:**
- Modify: `src/components/CharactersModal.tsx`
- Modify: `src/App.tsx` (pass handler to modal)

- [ ] **Step 1: Create callback function in App.tsx**

Add this function in App.tsx (near other event handlers):

```typescript
/**
 * Copy an app character template into the active campaign.
 */
const handleUseAppCharacter = async (appCharacter: typeof appCharacters[0]) => {
  if (!activeCampaign) {
    console.warn('No active campaign; cannot copy character')
    return
  }

  // Use the utility to convert app template
  const { createCharacterFromAppTemplate } = await import('./utils/appContentUtils')
  const newCharProfile = createCharacterFromAppTemplate(appCharacter)

  // Generate ID and folder name
  const characterId = `char-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const folderName = appCharacter.name.toLowerCase().replace(/\s+/g, '-')

  // Create the full CharacterProfile with required fields
  const character: CharacterProfile = {
    id: characterId,
    folderName: folderName,
    ...newCharProfile,
  }

  // Save via IPC (assuming there's a campaign:saveCharacter handler)
  // This may need adjustment based on existing save logic
  await window.api.invoke('campaign:saveCharacter', {
    campaignId: activeCampaign.id,
    character,
  })

  // Refresh characters list (reload campaign or update state)
  // TODO: Implement based on existing refetch pattern
}
```

**Note:** Adjust IPC handler name and signature based on existing campaign saving logic.

- [ ] **Step 2: Pass handler to CharactersModal**

Update the CharactersModal JSX:

```tsx
<CharactersModal
  // ... existing props ...
  appCharacters={appCharacters}
  appAvatars={appAvatars}
  onUseAppCharacter={handleUseAppCharacter}
/>
```

- [ ] **Step 3: Accept handler in CharactersModal props**

Add to the props interface:

```typescript
onUseAppCharacter?: (character: typeof appCharacters[0]) => Promise<void>
```

- [ ] **Step 4: Wire up the button onClick**

Update the "Use This Character" button in the App Content panel:

```tsx
<button
  className="characters-modal__footer-btn characters-modal__footer-btn--primary"
  onClick={() => onUseAppCharacter?.(character)}
>
  Use This Character
</button>
```

- [ ] **Step 5: Verify no build errors**

Run:
```bash
npm run build 2>&1 | head -50
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/CharactersModal.tsx
git commit -m "feat: implement copy-on-use for app characters"
```

---

## Task 10: Manual Testing

**Files:**
- Test: App running in dev mode

- [ ] **Step 1: Start dev server**

Run:
```bash
npm run dev
```

Expected: App starts without errors. Check terminal for logs.

- [ ] **Step 2: Open a campaign**

- Open the app launcher
- Create or load an existing campaign
- Verify the campaign loads

- [ ] **Step 3: Open CharactersModal**

Click the Characters button/menu in the UI.

Expected: Modal opens.

- [ ] **Step 4: Verify App Content tab appears**

Check that "📚 App Content" tab is visible in the modal nav.

Click the tab.

Expected: App Content panel loads, showing app avatars and characters.

- [ ] **Step 5: Test copy-on-use**

Click "Use This Character" on one of the app characters.

Expected:
- Modal closes (or stays open)
- New character appears in the campaign's character list
- Character is editable in the character editor
- Character retains the app template's data (name, personality, avatar, etc.)

- [ ] **Step 6: Verify persistence**

Close and reopen the campaign.

Expected: Copied character persists and is still listed.

- [ ] **Step 7: Commit test results**

No code commit needed, but document any issues found.

---

## Task 11: Extend with 3 More App Characters

**Files:**
- Modify: `electron/resources/app-content/app-characters.json`
- Modify: `electron/resources/app-content/app-avatars.json` (optional)

- [ ] **Step 1: Create 3 additional app characters**

Edit `electron/resources/app-content/app-characters.json`. Append 3 new characters to the `characters` array.

Example structure (repeat 3 times with different names/descriptions):

```json
{
  "id": "app-char-003",
  "name": "Character Name",
  "role": "Role",
  "gender": "male",
  "pronouns": "he/him",
  "description": "...",
  "personality": "...",
  "speakingStyle": "...",
  "goals": "...",
  "avatarImageData": "data:image/png;base64,...",
  "avatarCrop": { "x": 0, "y": 0, "scale": 1 }
}
```

Scaffold ideas:
- A rogue/thief character
- A cleric/healer character
- A barbarian/warrior character
- (Adjust as desired)

Expected: Valid JSON with 5 total characters.

- [ ] **Step 2: Verify JSON is valid**

Run:
```bash
cat electron/resources/app-content/app-characters.json | jq '.characters | length'
```

Expected: Output `5`.

- [ ] **Step 3: Optionally add 3 more avatars**

Edit `electron/resources/app-content/app-avatars.json` and add 3 more avatars to match the new characters.

(Use placeholder base64 PNG for now; replace with real images later.)

- [ ] **Step 4: Test in dev**

Run `npm run dev` and verify all 5 characters appear in the App Content tab.

- [ ] **Step 5: Commit**

```bash
git add electron/resources/app-content/app-characters.json electron/resources/app-content/app-avatars.json
git commit -m "feat: add 3 additional app characters (total 5)"
```

---

## Summary

**Deliverables:**
✅ App characters and avatars defined in bundled JSON files
✅ IPC handler loads and exposes app content
✅ React state caches app content
✅ CharactersModal displays App Content tab with gallery and character list
✅ Copy-on-use workflow creates campaign-scoped copies
✅ Scaffold with 5 example characters (2 initial + 3 additional)
✅ All changes committed

**Testing:**
✅ App starts and loads app content
✅ CharactersModal displays App Content tab
✅ Clicking "Use This Character" creates a campaign copy
✅ Copied characters persist across app restart

**Next Steps (future):**
- Replace placeholder avatars with real images
- Add search/filter to App Content
- Add categories/tags to app characters
- Consider batch import/export for app content
