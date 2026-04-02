# Claude Code Emulator Plugin for OpenCode

## Auto-install / Zero-setup
1. Copy these files into your project:
   - `.opencode/plugins/claude-code-emulator.ts`
   - `.opencode/package.json`
   - `opencode.json`
   - `CLAUDE.md`
2. Start OpenCode.
3. Plugin auto-loads from `.opencode/plugins/`.

No manual post-copy steps are required.

## Self-healing behavior
On startup the plugin automatically restores missing essentials:
- `.opencode/`
- `.opencode/plugins/`
- `.opencode/package.json`
- `CLAUDE.md`
- `opencode.json`
- `.gitignore` protections for `.opencode/session-state.json` and `.opencode/todos.json`

If files are missing or config is broken, they are recreated safely.

## Adaptive architecture layers
- Model Detector
- Context Injector (`CLAUDE.md` + todos)
- Tool Guardrails
- Prompt Amplifier
- Smart Compaction

## Supported free/local model families
- Groq (all available models)
- DeepSeek (chat + reasoner)
- Ollama (`ollama/*` local models)
- OpenRouter free tier (`openrouter/*`)
- Cloudflare Workers AI (`cloudflare/*`)
- GitHub Copilot / built-in OpenCode models
- OpenCode Zen / OpenCode UI free models

Includes tuned profiles for:
- OpenCode Zen
- Big Pickle
- GPT-5 Nano
- MiMo V2 Omni Free
- MiMo V2 Pro Free
- MiniMax M2.5 Free
- Nemotron 3 Super Free

## Quick verification
- OpenCode starts without plugin errors.
- `.opencode/session-state.json` appears after session start.
- `todo_read` and `todo_write` tools are available.
- Sensitive file reads and destructive shell patterns are blocked.
