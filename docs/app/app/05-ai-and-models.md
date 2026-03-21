# AI & Models

This guide covers configuring AI servers, selecting models, and tuning model parameters for optimal roleplay responses.

## AI Server Overview

An **AI server** is the backend service that generates chat completions. Aethra supports:

| Server Type | Best For | Setup Effort |
|-------------|----------|--------------|
| **LM Studio** | Windows/Mac users, UI-friendly | Low — download app, load model |
| **Ollama** | Linux, containerized workflows | Medium — Docker or native install |
| **llama.cpp** | Advanced users, maximum control | High — manual setup, or auto-install in Aethra |
| **OpenAI API** | Cloud-based, powerful models | Medium — API key required |
| **OpenAI-compatible** | Self-hosted or third-party services | Medium — custom URL + API key |

## Setting Up Your AI Server

### 1. Open Settings

Click the **Settings** icon (⚙️) in the ribbon bar, then go to the **Servers** tab.

### 2. Choose a Server Profile

Pre-configured profiles:
- **LM Studio (default)**
  - URL: `http://localhost:1234/v1`
  - Best for: Windows/Mac users

- **Ollama**
  - URL: `http://localhost:11434/v1`
  - Best for: Container-based deployment

- **Local (llama.cpp)**
  - Auto-managed by Aethra
  - Best for: Advanced users who want full control

### 3. Configure a Custom Server (Optional)

To add a custom server:
1. Click **+ Add Server**
2. Fill in:
   - **Name**: Display name (e.g., "My Remote API")
   - **Type**: `openai-compatible`
   - **Base URL**: The API endpoint (e.g., `http://example.com/v1`)
   - **API Key**: Your API key (often "dummy" for local servers)
3. Click **Save**

### Verifying Connection

After adding a server:
1. The **Status** indicator (top right) should show 🟢 **Connected**
2. The **Models** tab should list available models
3. If **🔴 Disconnected**, check:
   - The server is running
   - The URL is correct
   - Firewall isn't blocking the connection
   - API key is correct (if required)

## Selecting a Model

A **model** is the AI engine that generates responses. Common models:

| Model | Size | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| **Llama 3.2 1B** | 1B params | ⚡ Fast | Basic | Testing, low-power devices |
| **Phi 3.5 Mini** | 3.8B | ⚡ Fast | Good | Fast responses, consumer hardware |
| **Mistral 7B** | 7B | ⚡ Good | Excellent | Balanced speed/quality |
| **Llama 3.2 8B** | 8B | ⚡ Good | Excellent | Best for most users |
| **Llama 3.2 70B** | 70B | 🐢 Slow | Outstanding | Expert-level responses, expensive |

### Selecting an Active Model

1. In the **Models** tab of Settings:
2. Click a model name to select it as the default
3. A checkmark (✓) indicates the active model
4. Click **Save Settings**

### Downloading a New Model

To download a model from Hugging Face:

1. Go to the **Models** tab
2. Click **Download Model**
3. Search for a model (e.g., "Llama 3.2 8B")
4. Select a specific file (GGUF format)
5. Click **Download**
6. Progress bar shows download status
7. Once complete, the model is available for selection

**Recommended models**:
- `meta-llama/Llama-3.2-8B-Instruct-GGUF`
- `mistralai/Mistral-7B-Instruct-v0.2-GGUF`
- `microsoft/Phi-3.5-mini-instruct-GGUF`

### Using a Local GGUF File

If you have a `.gguf` file on disk:

1. In the **Models** tab, click **Add Local Model**
2. Browse for your `.gguf` file
3. Fill in optional fields (parameter count, quantization, context window)
4. Click **Add**
5. The model is now available for selection

## Model Parameters

Fine-tune how the AI generates responses using model parameters.

### Opening Model Parameters

1. In Settings > **Models** tab
2. Click a model name to select/edit it
3. Click **Edit Parameters** (gear icon)
4. A modal appears with all available parameters

### Parameter Reference

#### Sampling Parameters

**Temperature** (0.0–2.0, default 0.7)
- **Low (0.1–0.5)**: Focused, deterministic responses (good for facts)
- **High (0.8–1.5)**: Creative, varied responses (good for roleplay)
- **Use for RP**: 0.8–1.0 for natural variety

**Top P (Nucleus Sampling)** (0.0–1.0, default 0.95)
- Probability threshold for token selection
- **Lower**: More focused responses
- **Higher**: More diverse responses
- **Use for RP**: 0.95–0.99 (almost always leave at default)

**Top K** (0–100, default 40)
- Keep only top-K most likely tokens
- **Lower**: More focused
- **Higher**: More creative
- **Use for RP**: 40–50 is a good default

#### Output Control

**Max Output Tokens** (1–32000, default 512)
- Maximum length of a single response
- **For RP**: 256–512 tokens (roughly 1–2 paragraphs)
- Longer = more expensive and slower
- Too short = AI cuts off mid-sentence

**Repetition Penalty** (1.0–2.0, default 1.1)
- How much to penalize repeated phrases
- **Lower (1.0)**: Allow repetition
- **Higher (1.5–2.0)**: Avoid repetition
- **For RP**: 1.1–1.3 to reduce "umm, err" quirks

#### Advanced Parameters

**Seed** (optional)
- Set a fixed seed for reproducible outputs
- Useful for testing, but breaks variety in roleplay

**Presence Penalty** (0.0–2.0)
- Penalizes tokens that have already appeared
- Similar to repetition penalty but simpler

**Frequency Penalty** (0.0–2.0)
- Penalizes tokens by how often they've appeared
- Smoother variant of presence penalty

### Recommended Settings for Roleplay

```
Temperature:         0.85
Top P:              0.95
Top K:              50
Max Output Tokens:  512
Repetition Penalty: 1.15
Seed:               (not set)
```

These settings balance creativity and coherence for natural roleplay.

### Saving Parameters

Changes to a model's parameters are saved to the model preset:

1. Edit a model's parameters in the **Edit Parameters** modal
2. Changes are stored immediately
3. Next time you use that model, the custom parameters apply

To reset a model to defaults, manually set each parameter back.

## System Prompts

A **system prompt** is the hidden instruction given to the AI before your message. It sets the tone and rules for responses.

### Default System Prompt

```
You are a roleplaying agent responding naturally to the user.
```

This is generic and works, but a custom prompt greatly improves responses.

### Customizing the System Prompt

1. Open **Settings** (⚙️)
2. Go to the **System Prompt** tab
3. Edit the text area
4. Click **Save Settings**

The new prompt is used for all future messages.

### Writing Effective System Prompts

#### Generic (Okay)
```
You are a roleplaying agent responding naturally to the user.
```

#### Specific (Better)
```
You are a fantasy world narrator in the style of a D&D dungeon master.
Describe the scene vividly, introduce challenges and NPCs naturally,
and respond to the party's actions with creative consequences.
Stay in character. Avoid breaking the fourth wall.
Encourage immersion through sensory details and emotional stakes.
```

#### With Character Instructions (Best)
```
You are a fantasy world narrator in the style of a D&D dungeon master.

Key NPCs and their traits:
- Merlin (the Sage): Mysterious, speaks in riddles and metaphors, cryptic
- Grok (the Orc): Crude, loyal, uses simple language, speaks in short sentences
- Lysandra (the Rogue): Witty, sarcastic, clever, uses dark humor

Rules:
- Describe the scene vividly
- Introduce challenges and NPCs naturally
- Respond to the party's actions with creative consequences
- Switch between NPCs as appropriate
- Stay in character, avoid breaking the fourth wall
- Encourage immersion through sensory details and emotional stakes
```

### System Prompt Tips

1. **Be specific**: More detail = better responses
2. **Define character voices**: If you have recurring NPCs, describe them
3. **Set tone**: Serious vs. humorous, gothic vs. whimsical
4. **State constraints**: E.g., "don't write more than 3 paragraphs"
5. **Test iteratively**: Try a prompt, see what the AI does, refine

### Prompt Template

```
You are [description of the AI's role].

You follow these rules:
1. [Rule 1]
2. [Rule 2]
3. [Rule 3]

You know these characters:
- [Name]: [brief description]
- [Name]: [brief description]

Your goal is to [overall objective].
```

## Local AI Runtime (llama.cpp)

Aethra can automatically manage a local llama.cpp server for you, with binary auto-installation.

### Prerequisites

- Windows, macOS, or Linux
- Disk space: 2–10 GB (depending on model size)
- RAM: 4 GB minimum (8+ GB recommended)
- GPU (optional): NVIDIA (CUDA), AMD (Vulkan), or Apple Silicon (Metal)

### Auto-Installing the Binary

1. Go to Settings > **Servers** tab
2. Select **Local (llama.cpp)**
3. Click **Install Binary**
4. Aethra will:
   - Detect your hardware (GPU/CPU)
   - Download the appropriate binary (~10–250 MB)
   - Extract it to the app's data directory
   - Display progress and detected backend (CUDA, Vulkan, Metal, or CPU)

### Manual Configuration (Advanced)

If you already have llama.cpp installed:

1. Create a **Local (llama.cpp)** server profile
2. Set these fields:
   - **Executable Path**: Path to your `llama-server` binary
   - **Models Directory**: Folder containing your `.gguf` files
   - **Host**: Usually `127.0.0.1`
   - **Port**: Usually `3939`
3. Aethra will use your installed version instead of auto-downloading

## Troubleshooting

### "Could not reach the AI server"

**Check**:
1. Is the AI server running?
   - LM Studio: See the model is loaded in the UI
   - Ollama: Run `ollama serve` in terminal
   - llama.cpp: Check the status in Settings
2. Is the URL correct?
   - LM Studio: Usually `http://localhost:1234/v1`
   - Ollama: Usually `http://localhost:11434/v1`
   - Custom: Double-check the address you entered
3. Is the API key correct?
   - Most local servers accept any non-empty key
   - OpenAI API requires a valid key (starts with `sk-`)

### "No models available"

**Possible causes**:
1. The server is running but no model is loaded
   - Load a model in your AI server software
   - Return to Aethra and try again
2. The Models tab is empty
   - Click **Refresh Models** to reload the list
   - Ensure the server is connected (🟢 indicator)
3. No models on disk
   - Download a model using Aethra's **Download Model** button
   - Or manually place a `.gguf` file in your server's models directory

### Response is too short or cuts off

- Increase **Max Output Tokens** in model parameters
- Try 512–1024 for longer responses
- Be aware: longer outputs = slower generation

### Response is repetitive or "umm"y

- Increase **Repetition Penalty** to 1.3–1.5
- Lower **Temperature** slightly (0.7–0.8)
- Update your system prompt to discourage repetition

### Model is slow / AI takes forever to respond

**Causes**:
1. Model is too large for your hardware
   - Try a smaller model (8B instead of 70B)
   - Reduce **Max Output Tokens** temporarily
2. GPU is not being used
   - Check that the llama.cpp binary supports your GPU
   - Go to Settings and verify the detected backend (CUDA, Vulkan, Metal, or CPU)
3. System is under other load
   - Close other applications
   - Restart the AI server

### Binary installation fails

**Troubleshooting**:
1. Check your internet connection
2. Ensure you have ~500 MB free disk space
3. Check the debug console (Settings > Debug) for error messages
4. Try downloading the binary manually from [llama.cpp GitHub releases](https://github.com/ggerganov/llama.cpp/releases/)

### Settings don't save

- Ensure you're clicking **Save Settings**, not just closing the modal
- Check that you have write permissions in the app's data directory
- Try restarting the app and opening Settings again

---

**Next**: Learn about [Settings](./06-settings.md) for themes, keyboard shortcuts, and optimization.
