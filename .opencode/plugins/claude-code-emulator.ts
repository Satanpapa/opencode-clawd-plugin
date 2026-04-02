import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

type ToolReliability = "high" | "medium" | "low"

type ModelProfile = {
  provider: string
  providerLabel: string
  modelName: string
  contextWindowTokens: number
  toolCallingReliability: ToolReliability
  requiresExplicitStepByStep: boolean
  aggressiveCompactionThreshold: number
  supportsSystemPromptInjection: boolean
}

type TodoStatus = "todo" | "in_progress" | "blocked" | "done"
type TodoPriority = "low" | "medium" | "high" | "critical"

type TodoItem = {
  id: string
  title: string
  status: TodoStatus
  priority: TodoPriority
  notes?: string
  updatedAt: string
}

type TodoStore = {
  version: 1
  updatedAt: string
  items: TodoItem[]
}

type ShellLike = {
  nothrow: () => {
    quiet: () => {
      text: () => Promise<string>
    }
  }
}

type PluginCtx = {
  directory: string
  worktree?: string
  project?: { root?: string }
  client?: {
    app?: {
      log?: (input: { body: { service: string; level: "debug" | "info" | "warn" | "error"; message: string; extra?: Record<string, unknown> } }) => Promise<void>
    }
  }
  $?: (...parts: TemplateStringsArray[]) => ShellLike
}

const SERVICE = "claude-code-emulator"
const SESSION_FILE = ".opencode/session-state.json"
const TASKS_FILE = ".opencode/todos.json"
const CLAUDE_FILE = "CLAUDE.md"
const OPECONFIG = "opencode.json"

const BLOCKED_PATH_PATTERNS = [
  /(^|\/|\\)\.env(\..+)?$/i,
  /(^|\/|\\)id_rsa(\.pub)?$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.secret$/i,
  /(^|\/|\\)secrets?(\/|\\|$)/i,
  /(^|\/|\\)session-state\.json$/i,
]

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bcurl\b[^\n]*\|[^\n]*\bbash\b/i,
  /\bwget\b[^\n]*\|[^\n]*\bsh\b/i,
  /\bchmod\s+777\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=\/dev\/zero\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
]

function nowIso(): string {
  return new Date().toISOString()
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

async function safeWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, "utf8")
}

function rootPath(ctx: PluginCtx): string {
  return resolve(ctx.worktree || ctx.project?.root || ctx.directory || process.cwd())
}

function parseModelHint(raw: string): { provider: string; model: string } {
  const value = (raw || "").trim().toLowerCase()
  if (!value) return { provider: "unknown", model: "unknown" }
  const slash = value.indexOf("/")
  if (slash > 0) return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
  return { provider: "unknown", model: value }
}

function buildProviderProfiles(): Record<string, ModelProfile> {
  return {
    "opencode/opencode-zen": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "OpenCode Zen",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 14000,
      supportsSystemPromptInjection: true,
    },
    "opencode/big-pickle": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "Big Pickle",
      contextWindowTokens: 24576,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 10000,
      supportsSystemPromptInjection: true,
    },
    "opencode/gpt-5-nano": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "GPT-5 Nano",
      contextWindowTokens: 65536,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 26000,
      supportsSystemPromptInjection: true,
    },
    "opencode/mimo-v2-omni-free": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "MiMo V2 Omni Free",
      contextWindowTokens: 16384,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 6500,
      supportsSystemPromptInjection: true,
    },
    "opencode/mimo-v2-pro-free": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "MiMo V2 Pro Free",
      contextWindowTokens: 16384,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 6500,
      supportsSystemPromptInjection: true,
    },
    "opencode/minimax-m2.5-free": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "MiniMax M2.5 Free",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 13000,
      supportsSystemPromptInjection: true,
    },
    "opencode/nemotron-3-super-free": {
      provider: "opencode",
      providerLabel: "OpenCode",
      modelName: "Nemotron 3 Super Free",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 13000,
      supportsSystemPromptInjection: true,
    },
    "groq/*": {
      provider: "groq",
      providerLabel: "Groq",
      modelName: "Groq Generic",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 12000,
      supportsSystemPromptInjection: true,
    },
    "deepseek/*": {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      modelName: "DeepSeek Generic",
      contextWindowTokens: 65536,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 22000,
      supportsSystemPromptInjection: true,
    },
    "ollama/*": {
      provider: "ollama",
      providerLabel: "Ollama",
      modelName: "Ollama Local",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 3000,
      supportsSystemPromptInjection: true,
    },
    "openrouter/*": {
      provider: "openrouter",
      providerLabel: "OpenRouter",
      modelName: "OpenRouter Free Tier",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 12000,
      supportsSystemPromptInjection: true,
    },
    "cloudflare/*": {
      provider: "cloudflare",
      providerLabel: "Cloudflare Workers AI",
      modelName: "Cloudflare Workers AI",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 3000,
      supportsSystemPromptInjection: true,
    },
    "github-copilot/*": {
      provider: "github-copilot",
      providerLabel: "GitHub Copilot",
      modelName: "GitHub Copilot",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 12000,
      supportsSystemPromptInjection: true,
    },
    "fallback/*": {
      provider: "fallback",
      providerLabel: "Fallback",
      modelName: "Unknown Model",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 3000,
      supportsSystemPromptInjection: true,
    },
  }
}

function chooseProfile(hint: { provider: string; model: string }): ModelProfile {
  const profiles = buildProviderProfiles()
  const fullKey = `${hint.provider}/${hint.model}`
  if (profiles[fullKey]) return profiles[fullKey]
  const wildcard = `${hint.provider}/*`
  if (profiles[wildcard]) {
    const base = profiles[wildcard]
    return { ...base, modelName: hint.model || base.modelName }
  }
  return { ...profiles["fallback/*"], modelName: hint.model || "unknown" }
}

async function detectModelProfile(ctx: PluginCtx): Promise<ModelProfile> {
  const root = rootPath(ctx)
  const opencodeEnv = process.env.OPENCODE_MODEL || process.env.OPENCODE_DEFAULT_MODEL
  if (opencodeEnv) return chooseProfile(parseModelHint(opencodeEnv))

  const cfgRaw = await safeRead(join(root, OPECONFIG))
  if (cfgRaw) {
    try {
      const cfg = JSON.parse(cfgRaw) as Record<string, unknown>
      const candidate = (cfg.model || cfg.defaultModel || cfg.agentModel || "") as string
      if (candidate) return chooseProfile(parseModelHint(candidate))
    } catch {
      // fallthrough
    }
  }

  if (process.env.OLLAMA_HOST) return chooseProfile({ provider: "ollama", model: "local" })

  const runtimeModel = process.env.OPENCODE_RUNTIME_MODEL || ""
  if (runtimeModel) return chooseProfile(parseModelHint(runtimeModel))

  return chooseProfile({ provider: "fallback", model: "unknown" })
}

async function loadModelProfile(root: string): Promise<ModelProfile> {
  const fallback = chooseProfile({ provider: "fallback", model: "unknown" })
  const raw = await safeRead(join(root, SESSION_FILE))
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as { modelProfile?: ModelProfile }
    return parsed.modelProfile || fallback
  } catch {
    return fallback
  }
}

function truncateForModel(text: string, profile: ModelProfile, kind: "context" | "summary" = "context"): string {
  const hardLimit =
    profile.contextWindowTokens < 16384
      ? kind === "summary"
        ? 1400
        : 3200
      : profile.contextWindowTokens < 32768
      ? kind === "summary"
        ? 2600
        : 6800
      : kind === "summary"
      ? 4600
      : 13000

  if (text.length <= hardLimit) return text
  return `${text.slice(0, hardLimit)}\n\n[truncated:${text.length - hardLimit}]`
}

function findContextFile(root: string): string | null {
  const candidates = [
    join(root, "CLAUDE.md"),
    join(root, "CLAW.md"),
    join(root, ".claude", "CLAUDE.md"),
    join(root, ".opencode", "CONTEXT.md"),
  ]
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return null
}

function createDefaultClaudeMd(): string {
  return `# CLAUDE.md

## Objective
Keep execution deterministic, concise, and safe on weak or noisy models.

## Protocol
1. Read files first.
2. Plan with explicit ordered steps.
3. Execute minimal scoped edits.
4. Validate with concrete checks.
5. Report exact changed files and outcomes.

## Guardrails
- Never invent paths or files.
- Never perform destructive shell operations.
- Prefer small iterative changes over rewrites.
- Keep responses compact and implementation-focused.
`
}

async function readTodos(root: string): Promise<TodoStore> {
  const path = join(root, TASKS_FILE)
  const raw = await safeRead(path)
  if (!raw) {
    return { version: 1, updatedAt: nowIso(), items: [] }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TodoStore>
    const items = Array.isArray(parsed.items) ? parsed.items : []
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      items: items
        .filter(Boolean)
        .map((x) => ({
          id: String(x.id || crypto.randomUUID()),
          title: String(x.title || "Untitled"),
          status: (x.status as TodoStatus) || "todo",
          priority: (x.priority as TodoPriority) || "medium",
          notes: x.notes ? String(x.notes) : undefined,
          updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : nowIso(),
        })),
    }
  } catch {
    return { version: 1, updatedAt: nowIso(), items: [] }
  }
}

async function writeTodos(root: string, store: TodoStore): Promise<void> {
  const path = join(root, TASKS_FILE)
  const normalized: TodoStore = {
    version: 1,
    updatedAt: nowIso(),
    items: store.items.map((t) => ({ ...t, updatedAt: nowIso() })),
  }
  await safeWrite(path, `${JSON.stringify(normalized, null, 2)}\n`)
}

function isSensitivePath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, "/")
  return BLOCKED_PATH_PATTERNS.some((rx) => rx.test(normalized))
}

function isDestructiveCommand(command: string): boolean {
  return BLOCKED_COMMAND_PATTERNS.some((rx) => rx.test(command))
}

function buildAgentSystemPrompt(profile: ModelProfile, contextBlock: string, todosBlock: string): string {
  const strictMode = profile.requiresExplicitStepByStep
    ? `\n## Mandatory Execution Order\n1) Read relevant files only.\n2) Produce a short plan with ordered steps.\n3) Execute exactly one step at a time.\n4) Verify after each change.\n5) Summarize progress in 3-5 bullets.\n`
    : ""

  const compactness = profile.contextWindowTokens < 16384
    ? "Keep output terse. Avoid long prose."
    : "Use concise but complete output."

  return truncateForModel(
    `You are Claude Code Emulator.\n\n${compactness}\n\n## Tool Discipline\n- Never call tools with guessed paths.\n- Never mass rewrite unless explicitly required.\n- Re-check command safety before execution.\n- Keep state synchronized with todo list.\n${strictMode}\n## Project Context\n${contextBlock}\n\n## Active Todos\n${todosBlock}`,
    profile,
    "context",
  )
}

async function ensureGitignoreProtection(root: string): Promise<void> {
  const path = join(root, ".gitignore")
  const raw = (await safeRead(path)) ?? ""
  const lines = new Set(raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))
  const required = [".opencode/session-state.json", ".opencode/todos.json"]
  let changed = false
  for (const item of required) {
    if (!lines.has(item)) {
      lines.add(item)
      changed = true
    }
  }
  if (changed || !raw) {
    const output = [...lines].sort().join("\n")
    await safeWrite(path, `${output}\n`)
  }
}

async function ensureSelfRegistration(root: string): Promise<void> {
  const path = join(root, OPECONFIG)
  const initial = {
    $schema: "https://opencode.ai/config.json",
    plugin: ["./.opencode/plugins/claude-code-emulator.ts"],
  }
  const raw = await safeRead(path)
  if (!raw) {
    await safeWrite(path, `${JSON.stringify(initial, null, 2)}\n`)
    return
  }
  try {
    const cfg = JSON.parse(raw) as Record<string, unknown>
    const arr = Array.isArray(cfg.plugin) ? [...cfg.plugin] : []
    if (!arr.includes("./.opencode/plugins/claude-code-emulator.ts")) {
      arr.push("./.opencode/plugins/claude-code-emulator.ts")
      cfg.plugin = arr
      if (!cfg.$schema) cfg.$schema = "https://opencode.ai/config.json"
      await safeWrite(path, `${JSON.stringify(cfg, null, 2)}\n`)
    }
  } catch {
    await safeWrite(path, `${JSON.stringify(initial, null, 2)}\n`)
  }
}

async function ensureAutoBootstrap(root: string): Promise<void> {
  await mkdir(join(root, ".opencode", "plugins"), { recursive: true })

  const pkg = join(root, ".opencode", "package.json")
  if (!existsSync(pkg)) {
    await safeWrite(
      pkg,
      `${JSON.stringify({
        name: "opencode-local-plugins",
        private: true,
        type: "module",
        dependencies: {
          "@opencode-ai/plugin": "latest",
        },
      }, null, 2)}\n`,
    )
  }

  const claude = join(root, CLAUDE_FILE)
  if (!existsSync(claude)) {
    await safeWrite(claude, createDefaultClaudeMd())
  }

  await ensureSelfRegistration(root)
  await ensureGitignoreProtection(root)
}

async function persistSessionState(root: string, profile: ModelProfile): Promise<void> {
  const path = join(root, SESSION_FILE)
  const currentRaw = await safeRead(path)
  let payload: Record<string, unknown> = {}
  if (currentRaw) {
    try {
      payload = JSON.parse(currentRaw)
    } catch {
      payload = {}
    }
  }
  payload.modelProfile = profile
  payload.updatedAt = nowIso()
  await safeWrite(path, `${JSON.stringify(payload, null, 2)}\n`)
}

async function readGitStatusCompact($: PluginCtx["$"], root: string): Promise<string> {
  if (!$) return "git: unavailable"
  try {
    const out = await $`git -C ${root} status --short`.nothrow().quiet().text()
    return truncateForModel(out.trim() || "git: clean", chooseProfile({ provider: "fallback", model: "unknown" }), "summary")
  } catch {
    return "git: unavailable"
  }
}

async function safeLog(ctx: PluginCtx, level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): Promise<void> {
  try {
    await ctx.client?.app?.log?.({
      body: {
        service: SERVICE,
        level,
        message,
        extra,
      },
    })
  } catch {
    // no-op
  }
}

export const ClaudeCodeEmulatorPlugin = async (ctx: PluginCtx) => {
  const root = rootPath(ctx)
  await ensureAutoBootstrap(root)

  let profile = await detectModelProfile(ctx)
  await persistSessionState(root, profile)

  return {
    tool: {
      todo_read: {
        description: "Read project todos from .opencode/todos.json",
        args: {},
        async execute() {
          const store = await readTodos(root)
          return store
        },
      },
      todo_write: {
        description: "Create or update todo items with status and priority",
        args: {},
        async execute(args: {
          action: "upsert" | "remove" | "replace"
          item?: Partial<Pick<TodoItem, "id" | "title" | "status" | "priority" | "notes">>
          id?: string
          items?: Array<Pick<TodoItem, "title" | "status" | "priority"> & Partial<Pick<TodoItem, "id" | "notes">>>
        }) {
          const store = await readTodos(root)
          if (args.action === "replace") {
            store.items = (args.items || []).map((x) => ({
              id: x.id || crypto.randomUUID(),
              title: x.title,
              status: x.status,
              priority: x.priority,
              notes: x.notes,
              updatedAt: nowIso(),
            }))
          } else if (args.action === "remove") {
            if (!args.id) throw new Error("id is required for remove")
            store.items = store.items.filter((x) => x.id !== args.id)
          } else {
            const input = args.item
            if (!input?.title && !input?.id) throw new Error("item.title or item.id is required")
            const id = input.id || crypto.randomUUID()
            const found = store.items.find((x) => x.id === id)
            if (found) {
              found.title = input.title ?? found.title
              found.status = (input.status as TodoStatus) ?? found.status
              found.priority = (input.priority as TodoPriority) ?? found.priority
              found.notes = input.notes ?? found.notes
              found.updatedAt = nowIso()
            } else {
              store.items.push({
                id,
                title: input.title || "Untitled",
                status: (input.status as TodoStatus) || "todo",
                priority: (input.priority as TodoPriority) || "medium",
                notes: input.notes,
                updatedAt: nowIso(),
              })
            }
          }
          await writeTodos(root, store)
          return store
        },
      },
    },

    "session.created": async () => {
      await ensureAutoBootstrap(root)
      profile = await detectModelProfile(ctx)
      await persistSessionState(root, profile)
      await safeLog(ctx, "info", "session bootstrap complete", { provider: profile.provider, model: profile.modelName })
    },

    "session.updated": async () => {
      const fresh = await detectModelProfile(ctx)
      if (`${fresh.provider}/${fresh.modelName}` !== `${profile.provider}/${profile.modelName}`) {
        profile = fresh
        await persistSessionState(root, profile)
        await safeLog(ctx, "info", "model profile updated", { provider: profile.provider, model: profile.modelName })
      }
    },

    "tui.prompt.append": async (_input: unknown, output: { prompt: string }) => {
      const contextPath = findContextFile(root)
      const contextRaw = contextPath ? (await safeRead(contextPath)) || "" : ""
      const todos = await readTodos(root)
      const activeTodos = todos.items.filter((x) => x.status !== "done")
      const todoBlock = activeTodos.length
        ? activeTodos
            .map((x) => `- [${x.status}] (${x.priority}) ${x.title}${x.notes ? ` — ${x.notes}` : ""}`)
            .join("\n")
        : "- no active todos"

      const systemPrompt = buildAgentSystemPrompt(
        profile,
        truncateForModel(contextRaw || "No project context file found.", profile, "context"),
        truncateForModel(todoBlock, profile, "summary"),
      )

      output.prompt = `${output.prompt || ""}\n\n${systemPrompt}`
    },

    "tool.execute.before": async (
      input: { tool: string; args?: Record<string, unknown> },
      output: { args: Record<string, unknown> },
    ) => {
      const args = output.args || {}
      const pathCandidate = String(args.filePath || args.path || "")
      if (pathCandidate && isSensitivePath(pathCandidate)) {
        await safeLog(ctx, "warn", "blocked sensitive path", { tool: input.tool, path: pathCandidate })
        throw new Error(`Blocked sensitive path: ${basename(pathCandidate)}`)
      }

      if (input.tool === "bash" || input.tool === "shell") {
        const cmd = String(args.command || "")
        if (isDestructiveCommand(cmd)) {
          await safeLog(ctx, "warn", "blocked destructive command", { command: cmd })
          throw new Error("Blocked destructive command pattern")
        }
      }
    },

    "tool.execute.after": async (input: { tool: string }) => {
      if (input.tool === "todo_write") {
        const todos = await readTodos(root)
        await safeLog(ctx, "info", "todo list updated", { count: todos.items.length })
      }
    },

    "experimental.session.compacting": async (
      _input: unknown,
      output: { context: string[]; prompt?: string },
    ) => {
      const storedProfile = await loadModelProfile(root)
      const todos = await readTodos(root)
      const recentTodos = todos.items
        .slice(-12)
        .map((x) => `- ${x.title} [${x.status}/${x.priority}]`)
        .join("\n")

      const git = await readGitStatusCompact(ctx.$, root)
      const summary = truncateForModel(
        `Model: ${storedProfile.providerLabel} / ${storedProfile.modelName}\nThreshold: ${storedProfile.aggressiveCompactionThreshold}\n\nTodos:\n${recentTodos || "- empty"}\n\nGit:\n${git}\n\nCurrent step: keep strict read->plan->execute->verify loop and avoid path hallucinations.`,
        storedProfile,
        "summary",
      )

      if (!Array.isArray(output.context)) output.context = []
      output.context.push(summary)
      if (storedProfile.contextWindowTokens < 16384) {
        output.prompt = `Create a minimal continuation state:\n1) active objective\n2) exact files touched\n3) next safe command\n4) blocker if any\n5) done criteria\nKeep under 140 words.`
      }
    },
  }
}

export default ClaudeCodeEmulatorPlugin
