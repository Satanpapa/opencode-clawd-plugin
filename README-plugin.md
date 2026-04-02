# Claude Code Emulator Plugin for OpenCode.ai

## Zero-Setup Installation

This plugin is designed for **automatic installation** with zero manual configuration.

### How to Install

1. **Copy the files** into your project root:
   - `.opencode/plugins/claude-code-emulator.ts`
   - `.opencode/package.json`
   - `opencode.json` (or merge with existing)
   - `CLAUDE.md` (optional, auto-created if missing)

2. **Launch OpenCode** - that's it!

The plugin will automatically:
- Create missing directories (`.opencode/`, `.opencode/plugins/`)
- Register itself in `opencode.json`
- Add gitignore entries for sensitive files
- Create default `CLAUDE.md` if not present
- Detect and adapt to your current LLM model

## Supported Free Models

The plugin includes optimized profiles for all major free-tier models:

### Cloud Providers (Free Tier)
- **Groq**: llama-3.3-70b, llama-3.1-8b, mixtral-8x7b, gemma2-9b
- **DeepSeek**: deepseek-chat, deepseek-reasoner
- **OpenRouter Free**: llama-3-8b-instruct:free, gemma-7b-it:free, mistral-7b-instruct:free
- **Cloudflare Workers AI**: @cf/meta/llama-3-8b-instruct, @cf/mistral/mistral-7b-instruct
- **NVIDIA**: nemotron-3-super-free

### OpenCode Native
- OpenCode Zen
- OpenCode Big Pickle

### Other Free Models
- GPT-5 Nano
- MiMo V2 Omni Free
- MiMo V2 Pro Free
- MiniMax M2.5 Free

### Local Models (Ollama)
- Automatic detection for any `ollama/*` model
- Optimized for: llama3.2, codellama, mistral

## Verification

After launching OpenCode, check for these indicators:

1. **Console output** should show:
   ```
   [ClaudeCodeEmulator] Initialized with model: <provider> / <model>
   [ClaudeCodeEmulator] Context window: <tokens> tokens
   [ClaudeCodeEmulator] Tool reliability: <high|medium|low>
   ```

2. **Check `opencode.json`** - plugin should be registered:
   ```json
   {
     "plugins": [
       {
         "name": "claude-code-emulator",
         "path": "./.opencode/plugins/claude-code-emulator.ts",
         "enabled": true
       }
     ]
   }
   ```

3. **Check `.gitignore`** - should contain:
   ```
   .opencode/session-state.json
   .opencode/todos.json
   ```

## Architecture

The plugin uses a 5-layer adaptive architecture to compensate for weak/free models:

| Layer | Purpose |
|-------|---------|
| **Model Detector** | Auto-detects model capabilities and adapts behavior |
| **Context Injector** | Loads CLAUDE.md, todos; truncates for small context windows |
| **Tool Guardrails** | Blocks sensitive files (.env, keys) and destructive commands |
| **Prompt Amplifier** | Adds step-by-step protocols for unreliable models |
| **Smart Compaction** | Compresses conversation history to fit context limits |

## Features

### Todo Management
- Tasks stored in `.opencode/todos.json`
- Priority-based filtering for small context windows
- Status tracking: pending, in_progress, completed, blocked

### Security
- Blocks access to `.env`, `*.pem`, `id_rsa`, `*.secret`, etc.
- Blocks destructive commands: `rm -rf`, `curl | bash`, `chmod 777`
- All blocked operations logged to session state

### Self-Healing
- Recreates missing directories on startup
- Repairs corrupted config files
- Restores default CLAUDE.md if deleted

## Model-Specific Adaptations

### Weak Models (toolCallingReliability: low)
- Enforced step-by-step protocol
- Short, precise responses
- One file operation at a time
- Explicit verification after each action

### Strong Models (toolCallingReliability: high)
- Optimized for efficiency
- Can handle longer contexts
- Still prefers incremental changes

### Local Models (Ollama)
- Conservative context usage
- No system prompt injection (unsupported)
- Maximum compaction

## Troubleshooting

### Plugin not loading?
1. Check that `.opencode/plugins/claude-code-emulator.ts` exists
2. Verify `opencode.json` has the plugin entry
3. Look for errors in OpenCode console output

### Model not detected correctly?
Set environment variable:
```bash
export OPENCODE_MODEL=groq/llama-3.3-70b-versatile
```

Or edit `opencode.json`:
```json
{
  "model": "groq/llama-3.3-70b-versatile"
}
```

### Need more aggressive context management?
Edit `CLAUDE.md` to be shorter, or the plugin will auto-truncate based on detected model.
