// ============================================================================
// CLAUDE CODE EMULATOR PLUGIN FOR OPENCODE.AI
// Production-ready implementation with 5-layer adaptive architecture
// Supports all free-tier models: Groq, DeepSeek, Ollama, OpenRouter, Cloudflare, etc.
// ============================================================================

import { exec } from "bun";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ModelProfile {
  provider: string;
  providerLabel: string;
  modelName: string;
  contextWindowTokens: number;
  toolCallingReliability: "high" | "medium" | "low" | "unreliable";
  requiresExplicitStepByStep: boolean;
  aggressiveCompactionThreshold: number;
  supportsSystemPromptInjection: boolean;
  isLocalModel: boolean;
}

interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: "critical" | "high" | "medium" | "low";
  details?: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionState {
  currentModelProfile: ModelProfile | null;
  lastDetectedModel: string | null;
  sessionStartTime: string;
  totalToolCalls: number;
  blockedOperations: Array<{ path: string; reason: string; timestamp: string }>;
}

interface ContextFileResult {
  found: boolean;
  path: string | null;
  content: string | null;
  tokenCount: number;
}

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const SENSITIVE_PATTERNS = [
  /\.env(\..*)?$/,
  /\.pem$/,
  /\.key$/,
  /\.secret$/,
  /id_rsa$/,
  /id_dsa$/,
  /id_ecdsa$/,
  /id_ed25519$/,
  /\.ssh\//,
  /credentials$/,
  /\.aws\/credentials$/,
  /\.npmrc$/,
  /\.pypirc$/,
  /secrets\./,
  /\.gpg$/,
  /\.pgp$/,
];

const DESTRUCTIVE_COMMANDS = [
  /^rm\s+-rf/,
  /^rm\s+--no-preserve-root/,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  /chmod\s+777/,
  /chmod\s+a\+rwx/,
  /^dd\s+if=/,
  /mkfs\./,
  /^fdisk/,
  /^parted/,
  /:\(\)\{\s*:\|:\s*&\s*\};:/,  // fork bomb
  /^\s*>/i,  // redirect to file (potential wipe)
  /^\s*>>\s*\/dev\/null\s*&&\s*rm/,
];

const CONTEXT_FILE_PATHS = [
  "CLAUDE.md",
  "CLAW.md",
  ".claude/CLAUDE.md",
  ".opencode/CONTEXT.md",
  "CONTEXT.md",
  ".cursor/rules.md",
  ".github/CONTRIBUTING.md",
];

const TODO_FILE_PATH = ".opencode/todos.json";
const SESSION_STATE_PATH = ".opencode/session-state.json";
const OPENCODE_CONFIG_PATH = "opencode.json";

// ============================================================================
// MODEL PROFILES DATABASE
// ============================================================================

const buildProviderProfiles = (): Record<string, ModelProfile> => {
  return {
    // === GROQ MODELS ===
    "groq/llama-3.3-70b-versatile": {
      provider: "groq",
      providerLabel: "Groq",
      modelName: "llama-3.3-70b-versatile",
      contextWindowTokens: 128000,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 80000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "groq/llama-3.1-8b-instant": {
      provider: "groq",
      providerLabel: "Groq",
      modelName: "llama-3.1-8b-instant",
      contextWindowTokens: 128000,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 60000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "groq/mixtral-8x7b-32768": {
      provider: "groq",
      providerLabel: "Groq",
      modelName: "mixtral-8x7b-32768",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 20000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "groq/gemma2-9b-it": {
      provider: "groq",
      providerLabel: "Groq",
      modelName: "gemma2-9b-it",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },

    // === DEEPSEEK MODELS ===
    "deepseek/deepseek-chat": {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      modelName: "deepseek-chat",
      contextWindowTokens: 128000,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 80000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "deepseek/deepseek-reasoner": {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      modelName: "deepseek-reasoner",
      contextWindowTokens: 128000,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 80000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },

    // === OLLAMA LOCAL MODELS ===
    "ollama/*": {
      provider: "ollama",
      providerLabel: "Ollama (Local)",
      modelName: "ollama-local",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: false,
      isLocalModel: true,
    },
    "ollama/llama3.2": {
      provider: "ollama",
      providerLabel: "Ollama (Local)",
      modelName: "llama3.2",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: false,
      isLocalModel: true,
    },
    "ollama/codellama": {
      provider: "ollama",
      providerLabel: "Ollama (Local)",
      modelName: "codellama",
      contextWindowTokens: 16384,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 8000,
      supportsSystemPromptInjection: false,
      isLocalModel: true,
    },
    "ollama/mistral": {
      provider: "ollama",
      providerLabel: "Ollama (Local)",
      modelName: "mistral",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: false,
      isLocalModel: true,
    },

    // === OPENROUTER FREE TIER ===
    "openrouter/meta-llama/llama-3-8b-instruct:free": {
      provider: "openrouter",
      providerLabel: "OpenRouter Free",
      modelName: "llama-3-8b-instruct",
      contextWindowTokens: 8192,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "openrouter/google/gemma-7b-it:free": {
      provider: "openrouter",
      providerLabel: "OpenRouter Free",
      modelName: "gemma-7b-it",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "openrouter/mistralai/mistral-7b-instruct:free": {
      provider: "openrouter",
      providerLabel: "OpenRouter Free",
      modelName: "mistral-7b-instruct",
      contextWindowTokens: 8192,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },

    // === CLOUDFLARE WORKERS AI ===
    "cloudflare/@cf/meta/llama-3-8b-instruct": {
      provider: "cloudflare",
      providerLabel: "Cloudflare Workers AI",
      modelName: "llama-3-8b-instruct",
      contextWindowTokens: 8192,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "cloudflare/@cf/mistral/mistral-7b-instruct-v0.1": {
      provider: "cloudflare",
      providerLabel: "Cloudflare Workers AI",
      modelName: "mistral-7b-instruct",
      contextWindowTokens: 8192,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },

    // === OPENCODE NATIVE MODELS ===
    "opencode/zen": {
      provider: "opencode",
      providerLabel: "OpenCode Zen",
      modelName: "zen",
      contextWindowTokens: 32768,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 20000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "opencode/big-pickle": {
      provider: "opencode",
      providerLabel: "OpenCode Big Pickle",
      modelName: "big-pickle",
      contextWindowTokens: 65536,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 40000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },

    // === OTHER FREE MODELS FROM UI ===
    "gpt-5-nano": {
      provider: "openai",
      providerLabel: "OpenAI (Nano)",
      modelName: "gpt-5-nano",
      contextWindowTokens: 16384,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 10000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "mimo-v2-omni-free": {
      provider: "mimo",
      providerLabel: "MiMo Omni Free",
      modelName: "mimo-v2-omni",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 16000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "mimo-v2-pro-free": {
      provider: "mimo",
      providerLabel: "MiMo Pro Free",
      modelName: "mimo-v2-pro",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 16000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "minimax-m2.5-free": {
      provider: "minimax",
      providerLabel: "MiniMax Free",
      modelName: "m2.5",
      contextWindowTokens: 32768,
      toolCallingReliability: "medium",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 16000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },
    "nemotron-3-super-free": {
      provider: "nvidia",
      providerLabel: "NVIDIA Nemotron",
      modelName: "nemotron-3-super",
      contextWindowTokens: 32768,
      toolCallingReliability: "high",
      requiresExplicitStepByStep: false,
      aggressiveCompactionThreshold: 20000,
      supportsSystemPromptInjection: true,
      isLocalModel: false,
    },

    // === FALLBACK PROFILE ===
    "fallback": {
      provider: "unknown",
      providerLabel: "Unknown Model",
      modelName: "unknown",
      contextWindowTokens: 8192,
      toolCallingReliability: "low",
      requiresExplicitStepByStep: true,
      aggressiveCompactionThreshold: 4000,
      supportsSystemPromptInjection: false,
      isLocalModel: false,
    },
  };
};

// ============================================================================
// LAYER 1: MODEL DETECTOR
// ============================================================================

const detectModelProfile = async (): Promise<ModelProfile> => {
  const profiles = buildProviderProfiles();
  
  // Step 1: Check environment variable
  const envModel = process.env.OPENCODE_MODEL || process.env.MODEL_NAME || process.env.LLM_MODEL;
  if (envModel) {
    const normalizedModel = envModel.toLowerCase().trim();
    
    // Direct match
    if (profiles[normalizedModel]) {
      return profiles[normalizedModel];
    }
    
    // Wildcard match for ollama
    if (normalizedModel.startsWith("ollama/")) {
      return profiles["ollama/*"];
    }
    
    // Partial match
    for (const [key, profile] of Object.entries(profiles)) {
      if (key !== "fallback" && key !== "ollama/*") {
        if (normalizedModel.includes(profile.modelName) || profile.modelName.includes(normalizedModel.split("/").pop() || "")) {
          return profile;
        }
      }
    }
  }

  // Step 2: Check opencode.json config
  try {
    const configContent = await Bun.file(OPENCODE_CONFIG_PATH).text();
    const config = JSON.parse(configContent);
    
    if (config.model) {
      const normalizedModel = config.model.toLowerCase().trim();
      if (profiles[normalizedModel]) {
        return profiles[normalizedModel];
      }
      if (normalizedModel.startsWith("ollama/")) {
        return profiles["ollama/*"];
      }
    }
  } catch {
    // Config doesn't exist or is invalid, continue
  }

  // Step 3: Check for local provider indicators
  if (process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL) {
    return profiles["ollama/*"];
  }

  // Step 4: Try to detect from runtime info (if available via stdin/env)
  const runtimeModel = process.env.OPENCODE_RUNTIME_MODEL;
  if (runtimeModel) {
    const normalizedModel = runtimeModel.toLowerCase().trim();
    if (profiles[normalizedModel]) {
      return profiles[normalizedModel];
    }
    if (normalizedModel.startsWith("ollama/")) {
      return profiles["ollama/*"];
    }
  }

  // Step 5: Fallback to safe conservative profile
  return profiles["fallback"];
};

const loadModelProfile = async (): Promise<ModelProfile> => {
  let profile: ModelProfile;
  
  try {
    const stateContent = await Bun.file(SESSION_STATE_PATH).text();
    const state: SessionState = JSON.parse(stateContent);
    
    if (state.currentModelProfile) {
      profile = state.currentModelProfile;
      
      // Verify it's still valid by re-detecting
      const detectedProfile = await detectModelProfile();
      if (detectedProfile.modelName !== profile.modelName) {
        // Model changed, update profile
        profile = detectedProfile;
        await saveSessionState({ ...state, currentModelProfile: profile, lastDetectedModel: detectedProfile.modelName });
      }
      
      return profile;
    }
  } catch {
    // No session state, create fresh detection
  }
  
  // Fresh detection
  profile = await detectModelProfile();
  
  const initialState: SessionState = {
    currentModelProfile: profile,
    lastDetectedModel: profile.modelName,
    sessionStartTime: new Date().toISOString(),
    totalToolCalls: 0,
    blockedOperations: [],
  };
  
  await saveSessionState(initialState);
  return profile;
};

const saveSessionState = async (state: SessionState): Promise<void> => {
  await Bun.write(SESSION_STATE_PATH, JSON.stringify(state, null, 2));
};

// ============================================================================
// LAYER 2: CONTEXT INJECTOR
// ============================================================================

const findContextFile = async (): Promise<ContextFileResult> => {
  for (const path of CONTEXT_FILE_PATHS) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        const content = await file.text();
        return {
          found: true,
          path,
          content,
          tokenCount: estimateTokenCount(content),
        };
      }
    } catch {
      continue;
    }
  }
  
  return {
    found: false,
    path: null,
    content: null,
    tokenCount: 0,
  };
};

const estimateTokenCount = (text: string): number => {
  // Rough estimation: ~4 chars per token for English code/text
  return Math.ceil(text.length / 4);
};

const truncateForModel = (content: string, modelProfile: ModelProfile): string => {
  const maxTokens = modelProfile.aggressiveCompactionThreshold;
  const currentTokens = estimateTokenCount(content);
  
  if (currentTokens <= maxTokens) {
    return content;
  }
  
  // Aggressive truncation strategy
  const lines = content.split("\n");
  const targetLines = Math.floor((maxTokens / currentTokens) * lines.length);
  
  // Keep first 30% and last 70% (preserve conclusions and recent info)
  const firstPartEnd = Math.floor(targetLines * 0.3);
  const secondPartStart = targetLines - Math.floor(targetLines * 0.7);
  
  const truncatedLines = [
    ...lines.slice(0, firstPartEnd),
    "\n... [truncated for context window] ...\n",
    ...lines.slice(secondPartStart),
  ];
  
  return truncatedLines.join("\n");
};

const readTodos = async (): Promise<TodoItem[]> => {
  try {
    const file = Bun.file(TODO_FILE_PATH);
    if (await file.exists()) {
      const content = await file.text();
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    }
  } catch {
    // File corrupted or doesn't exist
  }
  return [];
};

const writeTodos = async (todos: TodoItem[]): Promise<void> => {
  await Bun.write(TODO_FILE_PATH, JSON.stringify(todos, null, 2));
};

const getActiveTodos = async (modelProfile: ModelProfile): Promise<string> => {
  const todos = await readTodos();
  const activeTodos = todos.filter(t => t.status !== "completed");
  
  if (activeTodos.length === 0) {
    return "";
  }
  
  // For small context windows, only show critical/high priority
  if (modelProfile.contextWindowTokens < 16384) {
    const importantTodos = activeTodos.filter(t => t.priority === "critical" || t.priority === "high");
    if (importantTodos.length > 0) {
      return formatTodosForContext(importantTodos, 5);
    }
  }
  
  return formatTodosForContext(activeTodos, 15);
};

const formatTodosForContext = (todos: TodoItem[], maxItems: number): string => {
  const limitedTodos = todos.slice(0, maxItems);
  
  const formatted = limitedTodos.map(t => {
    const statusIcon = {
      pending: "⏳",
      in_progress: "🔄",
      completed: "✅",
      blocked: "🚫",
    }[t.status];
    
    const priorityIcon = {
      critical: "🔴",
      high: "🟠",
      medium: "🟡",
      low: "🟢",
    }[t.priority];
    
    return `  ${statusIcon}${priorityIcon} [${t.id}] ${t.title}`;
  }).join("\n");
  
  return `\n=== ACTIVE TASKS ===\n${formatted}\n=====================\n`;
};

// ============================================================================
// LAYER 3: TOOL GUARDRAILS
// ============================================================================

const isSensitivePath = (path: string): boolean => {
  const normalizedPath = path.toLowerCase().replace(/\\/g, "/");
  
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return true;
    }
  }
  
  // Additional heuristic checks
  const sensitiveKeywords = ["password", "secret", "token", "api_key", "apikey", "credential", "private"];
  for (const keyword of sensitiveKeywords) {
    if (normalizedPath.includes(keyword)) {
      return true;
    }
  }
  
  return false;
};

const isDestructiveCommand = (command: string): boolean => {
  const normalizedCommand = command.toLowerCase().trim();
  
  for (const pattern of DESTRUCTIVE_COMMANDS) {
    if (pattern.test(normalizedCommand)) {
      return true;
    }
  }
  
  return false;
};

const logBlockedOperation = async (path: string, reason: string): Promise<void> => {
  try {
    let state: SessionState;
    
    try {
      const stateContent = await Bun.file(SESSION_STATE_PATH).text();
      state = JSON.parse(stateContent);
    } catch {
      state = {
        currentModelProfile: null,
        lastDetectedModel: null,
        sessionStartTime: new Date().toISOString(),
        totalToolCalls: 0,
        blockedOperations: [],
      };
    }
    
    state.blockedOperations.push({
      path,
      reason,
      timestamp: new Date().toISOString(),
    });
    
    // Keep only last 100 blocked operations
    state.blockedOperations = state.blockedOperations.slice(-100);
    
    await saveSessionState(state);
  } catch {
    // Silently fail - don't break execution for logging
  }
};

const validateToolCall = async (toolName: string, args: Record<string, unknown>): Promise<{ allowed: boolean; reason?: string }> => {
  // Check file operations
  if (toolName === "read_file" || toolName === "write_file" || toolName === "edit_file") {
    const filePath = args.path as string || args.file_path as string;
    if (filePath && isSensitivePath(filePath)) {
      await logBlockedOperation(filePath, `Sensitive file access blocked for tool: ${toolName}`);
      return { allowed: false, reason: `Access to sensitive file '${filePath}' is blocked for security` };
    }
  }
  
  // Check shell commands
  if (toolName === "shell" || toolName === "run_command" || toolName === "exec") {
    const command = args.command as string || args.cmd as string;
    if (command && isDestructiveCommand(command)) {
      await logBlockedOperation(command, `Destructive command blocked`);
      return { allowed: false, reason: `Destructive command '${command}' is blocked for safety` };
    }
  }
  
  return { allowed: true };
};

// ============================================================================
// LAYER 4: PROMPT AMPLIFIER
// ============================================================================

const buildAgentSystemPrompt = async (modelProfile: ModelProfile): Promise<string> => {
  const contextResult = await findContextFile();
  const activeTodos = await getActiveTodos(modelProfile);
  
  const baseInstructions = `
You are Claude Code Emulator - an expert software engineering assistant.
Your goal is to help users with coding tasks efficiently and accurately.
`.trim();

  const stepByStepProtocol = `
=== CRITICAL WORK PROTOCOL ===
You MUST follow this exact sequence for EVERY task:

1. **READ FIRST**: Always read existing files before modifying them
   - Use read_file to understand current state
   - NEVER assume file contents or structure
   
2. **PLAN EXPLICITLY**: Before any action, state your plan:
   - What files you will read
   - What changes you will make
   - What the expected outcome is
   
3. **EXECUTE INCREMENTALLY**: Make changes one at a time
   - Complete one file operation before starting the next
   - Wait for confirmation after each tool call
   
4. **VERIFY**: After changes, verify they worked:
   - Read modified files to confirm changes
   - Run tests if applicable
   - Report success or issues clearly

5. **NEVER HALLUCINATE**:
   - Do NOT invent file paths that don't exist
   - Do NOT assume directory structures
   - Do NOT claim to have done something you haven't
   - If unsure, ask the user or read the file first
`.trim();

  const weakModelInstructions = `
=== ADDITIONAL INSTRUCTIONS FOR YOUR CAPABILITIES ===
- Keep responses SHORT and PRECISE
- After each tool call, briefly state what you did and what's next
- If a tool call fails, explain why and propose an alternative
- Do NOT attempt multiple complex changes at once
- Focus on ONE file at a time
- Always confirm file paths exist before writing
`.trim();

  const strongModelOptimization = `
=== OPTIMIZATION NOTES ===
- You have strong tool calling capabilities
- You can handle longer contexts efficiently
- Still prefer incremental changes over mass edits
- Self-verify when possible
`.trim();

  let contextSection = "";
  if (contextResult.found && contextResult.content) {
    const adaptedContext = truncateForModel(contextResult.content, modelProfile);
    contextSection = `
=== PROJECT CONTEXT (from ${contextResult.path}) ===
${adaptedContext}
========================================
`.trim();
  }

  const todoSection = activeTodos ? `\n${activeTodos}\n` : "";

  // Build final prompt based on model capability
  let systemPrompt = baseInstructions;
  
  if (modelProfile.requiresExplicitStepByStep) {
    systemPrompt += "\n\n" + stepByStepProtocol;
    systemPrompt += "\n\n" + weakModelInstructions;
  } else {
    systemPrompt += "\n\n" + strongModelOptimization;
  }
  
  if (todoSection) {
    systemPrompt += "\n\n" + todoSection;
  }
  
  if (contextSection) {
    systemPrompt += "\n\n" + contextSection;
  }
  
  // Add anti-hallucination warning for all models
  systemPrompt += `

=== ANTI-HALLUCINATION RULES ===
- NEVER claim a file exists without reading it first
- NEVER write to a file in a directory that doesn't exist
- NEVER invent import paths, package names, or dependencies
- If you need to know something, READ it - don't guess
- When in doubt, ask the user for clarification
`.trim();

  return systemPrompt;
};

// ============================================================================
// LAYER 5: SMART COMPACTION
// ============================================================================

const buildSessionContinuation = async (modelProfile: ModelProfile, conversationHistory: Array<{ role: string; content: string }>): Promise<string> => {
  const maxContextTokens = modelProfile.contextWindowTokens;
  const compactionThreshold = modelProfile.aggressiveCompactionThreshold;
  
  // Estimate current context usage
  let totalTokens = 0;
  for (const msg of conversationHistory) {
    totalTokens += estimateTokenCount(msg.content);
  }
  
  if (totalTokens < compactionThreshold) {
    // No compaction needed
    return "";
  }
  
  // Build compact summary
  const todos = await readTodos();
  const activeTodos = todos.filter(t => t.status !== "completed").slice(0, 5);
  
  // Extract key information from recent messages
  const recentMessages = conversationHistory.slice(-10);
  const keyDecisions: string[] = [];
  
  for (const msg of recentMessages) {
    if (msg.role === "assistant") {
      // Extract decisions and actions
      const decisionMatch = msg.content.match(/(?:decided|will|going to|plan to)\s+(.+?)(?:\.|$)/gi);
      if (decisionMatch) {
        keyDecisions.push(...decisionMatch.slice(0, 3));
      }
    }
  }
  
  const summaryParts: string[] = [];
  
  if (activeTodos.length > 0) {
    summaryParts.push(`Active tasks: ${activeTodoSummary(activeTodos)}`);
  }
  
  if (keyDecisions.length > 0) {
    summaryParts.push(`Recent decisions: ${keyDecisions.slice(0, 5).join("; ")}`);
  }
  
  // Add git status if relevant (for larger context windows)
  if (modelProfile.contextWindowTokens >= 16384) {
    try {
      const gitStatus = await getGitStatusBrief();
      if (gitStatus) {
        summaryParts.push(`Git: ${gitStatus}`);
      }
    } catch {
      // Git not available or error
    }
  }
  
  if (summaryParts.length === 0) {
    return "";
  }
  
  return `\n=== SESSION SUMMARY ===\n${summaryParts.join("\n")}\n=======================\n`;
};

const activeTodoSummary = (todos: TodoItem[]): string => {
  return todos.map(t => `${t.title} (${t.status})`).join(", ");
};

const getGitStatusBrief = async (): Promise<string> => {
  try {
    const result = await exec("git status --short").text();
    if (!result.trim()) {
      return "clean";
    }
    
    const lines = result.trim().split("\n");
    const modifiedCount = lines.filter(l => l.startsWith(" M") || l.startsWith("M ")).length;
    const addedCount = lines.filter(l => l.startsWith(" A") || l.startsWith("A ")).length;
    const deletedCount = lines.filter(l => l.startsWith(" D") || l.startsWith("D ")).length;
    
    const parts: string[] = [];
    if (modifiedCount > 0) parts.push(`${modifiedCount} modified`);
    if (addedCount > 0) parts.push(`${addedCount} added`);
    if (deletedCount > 0) parts.push(`${deletedCount} deleted`);
    
    return parts.join(", ");
  } catch {
    return "";
  }
};

const compactConversationHistory = (
  history: Array<{ role: string; content: string }>,
  modelProfile: ModelProfile
): Array<{ role: string; content: string }> => {
  const maxTokens = modelProfile.contextWindowTokens * 0.7; // Leave room for system prompt and response
  let totalTokens = 0;
  
  // Start from the end (most recent messages are most important)
  const compacted: Array<{ role: string; content: string }> = [];
  
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgTokens = estimateTokenCount(msg.content);
    
    if (totalTokens + msgTokens > maxTokens) {
      // Truncate this message or skip
      if (totalTokens < maxTokens) {
        const remainingTokens = maxTokens - totalTokens;
        const truncatedContent = msg.content.slice(0, remainingTokens * 4);
        compacted.unshift({
          role: msg.role,
          content: `[truncated] ${truncatedContent}...`,
        });
      }
      break;
    }
    
    compacted.unshift(msg);
    totalTokens += msgTokens;
  }
  
  // Always keep at least the last 3 exchanges
  if (compacted.length < 6 && history.length >= 6) {
    return history.slice(-6);
  }
  
  return compacted;
};

// ============================================================================
// AUTO-BOOTSTRAP & SELF-REGISTRATION
// ============================================================================

const ensureAutoBootstrap = async (): Promise<void> => {
  const directories = [".opencode", ".opencode/plugins", ".claude"];
  
  for (const dir of directories) {
    try {
      await Bun.$`mkdir -p ${dir}`;
    } catch {
      // Directory might already exist
    }
  }
  
  // Ensure .opencode/package.json exists
  const packageJsonPath = ".opencode/package.json";
  try {
    const pkgFile = Bun.file(packageJsonPath);
    if (!(await pkgFile.exists())) {
      await Bun.write(packageJsonPath, JSON.stringify({
        name: "opencode-claude-code-emulator",
        version: "1.0.0",
        type: "module",
        private: true,
      }, null, 2));
    }
  } catch {
    // Ignore errors
  }
};

const ensureSelfRegistration = async (): Promise<void> => {
  try {
    let config: Record<string, unknown> = {};
    let configExists = false;
    
    try {
      const configFile = Bun.file(OPENCODE_CONFIG_PATH);
      if (await configFile.exists()) {
        const content = await configFile.text();
        config = JSON.parse(content);
        configExists = true;
      }
    } catch {
      // Config doesn't exist or is invalid
    }
    
    // Ensure plugins array exists
    if (!config.plugins) {
      config.plugins = [];
    }
    
    if (!Array.isArray(config.plugins)) {
      config.plugins = [];
    }
    
    // Check if our plugin is already registered
    const pluginName = "claude-code-emulator";
    const isRegistered = config.plugins.some((p: unknown) => {
      if (typeof p === "string") {
        return p.includes(pluginName);
      }
      if (typeof p === "object" && p !== null) {
        const pObj = p as Record<string, unknown>;
        return pObj.name === pluginName || (pObj.path as string)?.includes(pluginName);
      }
      return false;
    });
    
    if (!isRegistered) {
      // Register the plugin
      config.plugins.push({
        name: pluginName,
        path: "./.opencode/plugins/claude-code-emulator.ts",
        enabled: true,
      });
      
      // Write updated config
      await Bun.write(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2));
    }
  } catch {
    // Registration failed, but don't crash
  }
};

const ensureGitignoreProtection = async (): Promise<void> => {
  const gitignorePath = ".gitignore";
  const entriesToAdd = [
    ".opencode/session-state.json",
    ".opencode/todos.json",
    ".opencode/cache/",
    ".env.local",
    ".env.*.local",
  ];
  
  try {
    let gitignoreContent = "";
    const gitignoreFile = Bun.file(gitignorePath);
    
    if (await gitignoreFile.exists()) {
      gitignoreContent = await gitignoreFile.text();
    }
    
    const existingLines = gitignoreContent.split("\n").map(l => l.trim()).filter(l => l);
    
    const missingEntries = entriesToAdd.filter(entry => 
      !existingLines.some(line => line === entry || line === entry.replace(/^\./, "") || line.includes(entry))
    );
    
    if (missingEntries.length > 0) {
      const newContent = gitignoreContent.trim() + (gitignoreContent.trim() ? "\n" : "") + 
        "# Claude Code Emulator Plugin - Auto-generated protection\n" +
        missingEntries.join("\n") + "\n";
      
      await Bun.write(gitignorePath, newContent);
    }
  } catch {
    // Gitignore handling failed, but don't crash
  }
};

const createDefaultClaudeMd = async (): Promise<void> => {
  const claudeMdPath = "CLAUDE.md";
  
  try {
    const file = Bun.file(claudeMdPath);
    if (!(await file.exists())) {
      const defaultContent = `# Project Guidelines

This file provides context for the Claude Code Emulator plugin.

## How to use this file

- Add project-specific conventions here
- Document architecture decisions
- List important constraints or requirements
- Include testing strategies
- Note deployment procedures

## Quick Start

The Claude Code Emulator plugin will automatically read this file and use it to understand your project better.

## Sections to consider adding

### Tech Stack
- Framework: 
- Language: 
- Database: 
- Testing: 

### Code Style
- Formatting: 
- Linting: 
- Import order: 

### Architecture
- Pattern: 
- Key directories: 

### Commands
- Install: \`npm install\`
- Dev: \`npm run dev\`
- Test: \`npm test\`
- Build: \`npm run build\`
`;
      
      await Bun.write(claudeMdPath, defaultContent);
    }
  } catch {
    // Creation failed, but don't crash
  }
};

// ============================================================================
// MAIN PLUGIN ENTRY POINT
// ============================================================================

const initializePlugin = async (): Promise<void> => {
  // Auto-bootstrap: create necessary directories and files
  await ensureAutoBootstrap();
  
  // Self-registration: add plugin to opencode.json
  await ensureSelfRegistration();
  
  // Protect sensitive files from git
  await ensureGitignoreProtection();
  
  // Create default CLAUDE.md if missing
  await createDefaultClaudeMd();
  
  // Load and detect model profile
  const modelProfile = await loadModelProfile();
  
  console.error(`[ClaudeCodeEmulator] Initialized with model: ${modelProfile.providerLabel} / ${modelProfile.modelName}`);
  console.error(`[ClaudeCodeEmulator] Context window: ${modelProfile.contextWindowTokens} tokens`);
  console.error(`[ClaudeCodeEmulator] Tool reliability: ${modelProfile.toolCallingReliability}`);
};

// Export for OpenCode plugin system
export {
  // Types
  type ModelProfile,
  type TodoItem,
  type SessionState,
  type ContextFileResult,
  
  // Layer 1: Model Detector
  detectModelProfile,
  loadModelProfile,
  buildProviderProfiles,
  
  // Layer 2: Context Injector
  findContextFile,
  readTodos,
  writeTodos,
  getActiveTodos,
  truncateForModel,
  estimateTokenCount,
  
  // Layer 3: Tool Guardrails
  isSensitivePath,
  isDestructiveCommand,
  validateToolCall,
  logBlockedOperation,
  
  // Layer 4: Prompt Amplifier
  buildAgentSystemPrompt,
  
  // Layer 5: Smart Compaction
  buildSessionContinuation,
  compactConversationHistory,
  activeTodoSummary,
  getGitStatusBrief,
  
  // Auto-bootstrap
  ensureAutoBootstrap,
  ensureSelfRegistration,
  ensureGitignoreProtection,
  createDefaultClaudeMd,
  
  // Main entry point
  initializePlugin,
};

// Auto-initialize on import
await initializePlugin();
