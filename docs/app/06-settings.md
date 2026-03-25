# Settings

This guide covers user preferences, themes, debugging, and optimization options.

## Opening Settings

Click the **Settings** icon (⚙️) in the ribbon bar to open the Settings modal.

The Settings modal has multiple tabs:
- **Servers**: AI server configuration (see [AI & Models](./05-ai-and-models.md))
- **Models**: Model selection and parameters
- **System Prompt**: AI instruction text
- **Chat**: Messaging preferences
- **Theme**: Visual appearance
- **Debug**: AI logs and troubleshooting

## Chat Settings

The **Chat** tab controls messaging behavior.

### Chat Bubble Text Size

Select your preferred text size for message bubbles:
- **Small**: Compact, fits more messages on screen
- **Medium**: Default, balanced
- **Large**: Easier to read, fewer messages visible
- **Extra Large**: Maximum readability

Changes apply immediately to all messages.

### Enable Rolling Summaries

Toggle to enable/disable automatic message compression:
- **On**: Long scenes use rolling summaries (see [Campaigns & Scenes](./03-campaigns-and-scenes.md#rolling-summaries))
- **Off**: All messages stay in the prompt (slower for 100+ message scenes)

**Best for rolling summaries**: Campaigns with 300+ messages per scene
**Best without**: Short campaigns or narrative-critical text that mustn't be oversimplified

## Theme Settings

The **Theme** tab controls visual appearance.

### Selecting a Built-in Theme

Built-in themes are always available:
- **Default Dark**: Dark background with semantic color variables
- **Default Light** (if available): Light variant

Click any theme to apply it immediately.

### Importing a Custom Theme

To use a custom color scheme:

1. Create a JSON file with theme token overrides (see below)
2. In Settings > **Theme** tab, click **Import Theme**
3. Select your JSON file
4. The theme appears in the list and can be selected

### Theme Token Reference

Available color tokens in custom themes:

```json
{
  "id": "my-theme",
  "name": "My Custom Theme",
  "mode": "dark",
  "tokens": {
    "app-bg": "#0d0f14",
    "panel-bg": "#1a1d24",
    "surface-bg": "#25292f",
    "surface-bg-emphasis": "#32373f",
    "surface-bg-selected": "#3d434d",
    "surface-bg-user-message": "#1e3a5a",
    "surface-bg-accent": "#6b5b95",
    "surface-bg-accent-hover": "#8b7bb5",
    "surface-bg-overlay": "rgba(0,0,0,0.5)",
    "border-color": "#404854",
    "border-color-accent": "#8b7bb5",
    "text-color-primary": "#e8eaed",
    "text-color-secondary": "#a0a0a0",
    "text-color-muted": "#707070",
    "text-color-on-accent": "#ffffff",
    "text-color-brand": "#4a9eff",
    "scrollbar-thumb": "#505866",
    "scrollbar-thumb-hover": "#6b7a8f",
    "shadow-panel": "0 8px 32px rgba(0,0,0,0.3)",
    "shadow-modal": "0 16px 64px rgba(0,0,0,0.4)"
  }
}
```

### Creating a Custom Theme

1. Copy the template above
2. Edit the `id`, `name`, and `mode` fields
3. Override any color tokens you want to change
4. You don't need to include all tokens—only the ones you want to override
5. Save as `my-theme.json`
6. Import using the **Import Theme** button

### Example Custom Theme

```json
{
  "id": "cyberpunk",
  "name": "Cyberpunk",
  "mode": "dark",
  "tokens": {
    "app-bg": "#0a0e27",
    "panel-bg": "#1a1f3a",
    "surface-bg": "#2a2f4a",
    "surface-bg-accent": "#ff00ff",
    "surface-bg-accent-hover": "#ff33ff",
    "text-color-primary": "#00ff88",
    "text-color-brand": "#00ffff",
    "border-color-accent": "#00ffff"
  }
}
```

### Theme Tips

- **Test contrast**: Ensure text is readable against backgrounds
- **Use semantic names**: Token names indicate their purpose
- **Keep consistency**: Use a limited color palette
- **Preview before saving**: Test the theme in a real scene before committing

## System Prompt

See [AI & Models — System Prompts](./05-ai-and-models.md#system-prompts) for detailed guidance on writing system prompts.

## Debug Console

The **Debug** tab shows detailed logs of AI server communication for troubleshooting.

### Viewing Debug Logs

1. Click the **Debug** tab in Settings (or click **🧠** in the ribbon)
2. A list of recent AI events appears:
   - **Request**: Message you sent to the AI
   - **Response**: First token of the AI's reply
   - **Token**: Individual tokens as they stream in
   - **Done**: Completion of a response
   - **Error**: Any errors that occurred

### Using Debug Logs to Troubleshoot

**Example: Response is too short**
1. Open the Debug console
2. Find the "Done" event for that response
3. Click it to see the full response and token count
4. If token count hits **Max Output Tokens**, increase it in model settings

**Example: AI is making errors**
1. Find the "Request" event for that message
2. Click to see the full prompt sent to the AI
3. Check if context is correct, character names are clear, etc.
4. Adjust system prompt or scene context if needed

**Example: Server connection failed**
1. Find the most recent "Error" event
2. Click to see the full error message
3. Match against the troubleshooting guide in [AI & Models](./05-ai-and-models.md#troubleshooting)

### Debug Log Limits

The debug log keeps the last 200 events to prevent excessive memory usage. Older events are discarded.

## Persisted Settings

Settings are automatically saved to:
- **Windows**: `%APPDATA%\Aethra\settings.json`
- **macOS**: `~/Library/Application Support/Aethra/settings.json`
- **Linux**: `~/.config/Aethra/settings.json`

### Settings JSON Format

```json
{
  "servers": [
    {
      "id": "server-uuid",
      "name": "LM Studio",
      "kind": "lmstudio",
      "baseUrl": "http://localhost:1234/v1",
      "apiKey": "lm-studio"
    }
  ],
  "models": [
    {
      "id": "model-uuid",
      "serverId": "server-uuid",
      "name": "Llama 3.2 8B",
      "slug": "llama3.2-8b",
      "temperature": 0.85,
      "topP": 0.95,
      "maxOutputTokens": 512
    }
  ],
  "activeServerId": "server-uuid",
  "activeModelSlug": "llama3.2-8b",
  "systemPrompt": "You are a roleplay agent...",
  "enableRollingSummaries": false,
  "chatTextSize": "medium",
  "activeThemeId": "default",
  "customThemes": []
}
```

### Exporting Settings

To back up your settings:
1. Copy the `settings.json` file from the app's data directory
2. Store it somewhere safe
3. To restore, copy it back (app must be closed)

## Optimization Tips

### For Performance

1. **Close unused campaigns**: Free up app memory
2. **Use rolling summaries**: Reduces AI processing time for long scenes
3. **Lower text size to Small**: Reduces rendering overhead
4. **Use a smaller model**: 8B instead of 70B parameters
5. **Reduce Max Output Tokens**: 256 instead of 512

### For Better Responses

1. **Use a larger model**: 8B or larger
2. **Increase Max Output Tokens**: 512–1024
3. **Write detailed system prompts**: More specific = better results
4. **Keep recent messages in context**: Use rolling summaries for very old messages
5. **Use character profiles**: Detailed descriptions help the AI portray them

### For GPU Utilization

If responses are slow despite having a good GPU:

1. Check the **llama.cpp binary** supports your GPU
2. Verify the detected backend in Settings (CUDA, Vulkan, Metal, or CPU)
3. If CPU, reinstall the binary to get the right GPU version
4. Use **Max Output Tokens** to test (lower = faster)
5. Check GPU power settings in OS (gaming mode, etc.)

## Troubleshooting Settings

### Settings won't save
- Close the Settings modal and reopen it
- Check that you clicked **Save Settings** (not just closed)
- Ensure write permissions in the app's data directory
- Restart the app

### Theme doesn't apply
- Ensure the JSON file is valid (use an online JSON validator)
- Check that all required fields exist (`id`, `name`, `mode`)
- Try selecting a built-in theme first, then your custom theme

### Model parameters reset
- Parameters are saved per model preset
- If you select a different model, previous parameters don't carry over
- To preserve parameters, edit each model separately

### Can't import a theme file
- Ensure the file is valid JSON
- Confirm the file ends with `.json`
- Try using a built-in theme as a template and modifying it

## Settings Best Practices

1. **Back up settings regularly**: Export `settings.json` periodically
2. **Test changes in isolation**: Change one setting at a time to see the effect
3. **Document custom themes**: Add comments (or notes elsewhere) explaining color choices
4. **Keep system prompts in a file**: Easier to version control and backup
5. **Monitor debug logs**: Check for errors that might indicate misconfiguration

---

**Next**: See [Architecture](./07-architecture.md) for technical details about how Aethra works (for developers).
