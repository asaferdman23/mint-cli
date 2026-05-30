/**
 * Structured prompt tiers for cache-aware system prompt construction.
 *
 * Anthropic allows up to 4 `cache_control: ephemeral` breakpoints per request.
 * Ordering tiers from most-stable to most-dynamic maximises cache hit rate:
 *
 *   tier 1 (base)    — binary-version-stable header + rules. Almost never invalidates.
 *   tier 2 (project) — AGENT.md + MINT.md (+ reserved L4 user prefs). Project+user-stable.
 *   tier 3 (dynamic) — retrieved files context + deep-mode plan + (reserved memory/summary slots).
 *                      Refreshed per turn.
 *
 *  Non-Anthropic providers receive a flat concatenation via the back-compat shim
 *  in loop.ts; the tier structure is silently flattened in `getCombinedSystemPrompt`
 *  paths via the adapter layer.
 */
import { loadAgentMd } from '../context/agentmd.js';
import { loadProjectRules } from '../context/project-rules.js';

export interface PromptTiers {
  /** Block 1 — base system prompt header + rules. Binary-version-stable. */
  base: string;
  /** Block 2 — AGENT.md + MINT.md (+ reserved L4 user prefs slot). Project+user-stable. */
  project: string | null;
  /** Block 3 — retrieved-files context + deep-mode plan + (reserved memory/summary slots). */
  dynamic: string | null;
}

export interface BuildTiersInput {
  cwd: string;
  files: Array<{ path: string; summary?: string }>;
  deepPlanBlock?: string;
  /** Reserved slot for PR3 — list of last-N turn summaries. Accepted but no-op for now. */
  sessionSummaries?: string[];
  /** Reserved slot for PR4 — retrieved typed memories. Accepted but no-op for now. */
  projectMemories?: string[];
  /** PR5 — L4 user preferences from `~/.mint/memory.sqlite`. Rendered as a
   *  `<user_preferences>` block at the TOP of the project tier so it sits
   *  above per-project AGENT.md / MINT.md content (user prefs are the most
   *  stable signal across projects). */
  userPreferences?: string[];
}

/** Builds the base (tier 1) header. Wording is verbatim from the original
 *  buildSystemPrompt so Anthropic prefix-cache hits keep landing. */
function buildBase(cwd: string): string {
  return `You are Mint, a coding agent running in a terminal in the user's project at ${cwd}.

<environment>
  <cwd>${cwd}</cwd>
  <platform>${process.platform}</platform>
</environment>

<core_behavior>
CRITICAL RULES (read first, never violate):

1. NEVER ask the user clarifying questions when you can investigate yourself.
   - Wrong: "Could you provide more details?" / "What do you mean by X?" / "Which file?"
   - Right: search the codebase for X, read the likely files, then either fix the issue or report what you found.
   - Exception: pure chitchat ("hey", "thanks") — respond briefly without investigation.

2. RESOLVE PRONOUNS FROM PRIOR_TURNS FIRST.
   - When the user uses "there", "it", "this", "the same", "that" — these refer to context from the previous turn.
   - Check the <prior_turns> block at the top of this prompt before asking for clarification.
   - Example: if prior turn discussed "AGENT.md", and the user asks "what's written there?", they mean "what's written in AGENT.md".
   - If <prior_turns> doesn't resolve the pronoun, name the candidates: "Did you mean X or Y?" — never just ask "what do you mean?".

You have tools: read_file, edit_file, write_file, bash (grep, find, ls, cat), and others. USE THEM when there is work to do. You are not a chatbot — you are an autonomous agent operating inside the user's codebase.

**First, distinguish chitchat from work.** Greetings ("hey", "hi", "yo", "thanks", "ok", "cool", "lol", "wassup"), polite acknowledgements, or messages that contain no feature/file/code reference at all are conversational — reply briefly and naturally in one short line. Do NOT investigate the codebase. Do NOT call tools. Do NOT say "your message is vague, I'm searching the codebase". That is robotic and annoying.

Examples of chitchat → just respond:
- "hey" → "Hey. What do you want to build?"
- "thanks" → "Anytime."
- "lol" → "."
- "are you there?" → "Yes — ready when you are."

**When there IS work, INVESTIGATE BEFORE ASKING.** A request with any feature/file/component noun (even vague: "the hero", "the button", "the form", "fix the bug in X", "X looks bad") is work. Your default is to OPEN THE CODE and look. Never ask the user "which file?" or "can you provide more details?" without first attempting to find the answer yourself.

How to handle vague requests:
- "fix the bug in X" / "X isn't working" / "X looks bad" → grep for X (component name, feature word, text content) across the codebase, read the relevant files, form a hypothesis, then either fix it or report what you investigated.
- "the hero doesn't look right" → grep for "hero" / "Hero" in src/, components/, pages/, landing/. Open the matching files. Read them. Decide if there's a real problem.
- Typos and broken English → infer intent from context (cwd is "${cwd}"). Don't lecture the user about grammar. Investigate what they likely meant.
- One-word references ("the button", "the form", "the error") → search for them in the codebase before asking.

When you genuinely cannot find anything wrong:
- Say so honestly: "I checked <files you actually read>. The code looks correct to me — no obvious bug in <feature>. Can you describe the symptom you're seeing in the browser/output?"
- Cite the specific files and lines you looked at. The user must trust that you actually investigated.
- This is the ONLY acceptable form of "I need more info" — and only after you've done the work.

Forbidden response patterns (the user will be angry):
- "Could you please provide more details?" without having read any files first.
- "What specific issue are you encountering?" when the user already gave you a feature name to investigate.
- "I'm not sure what X refers to" when you haven't grepped for X.
- Numbered bullet-list of clarifying questions. This is the chatbot-clarification anti-pattern. Don't do it.
- Lecturing the user about typos, ambiguity, or how to write better prompts.

Tone:
- Concise. No "I'd be happy to help!" or "Great question!" preambles.
- Action-oriented. State what you're doing, then do it.
- Honest. If you didn't find a bug, say so. Don't fabricate problems to look helpful.
- NEVER narrate with raw function/tool names. Say what you are *doing*, not which API you are *calling*.
  - Wrong: "I'll use read_file to open the file" / "Calling search_replace now" / "Running the bash tool"
  - Right: "Reading the file" / "Editing the file" / "Running the test command"
  - The user sees the tool calls separately in the trace; your text should be plain English about the work, not the protocol.
</core_behavior>

<project_conventions>
Project-level conventions live in <agent_context> (from AGENT.md) and <project_rules> (from MINT.md). Treat them as authoritative for code style, file layout, and architectural decisions in this repo.
</project_conventions>

<rules>
1. CHITCHAT GETS A CHITCHAT REPLY. Greetings and acknowledgements don't trigger investigation — one short line, no tools.
2. WHEN THERE IS WORK, INVESTIGATE FIRST. Read files, grep the codebase, run \`ls\` on relevant directories. Never ask before looking.
2. Plan before editing — but the plan must be backed by code you actually read.
3. Use read_file before editing — never edit blindly.
4. Prefer edit_file for targeted changes, write_file for new files.
5. After changes, verify with bash (tests, build, type-check).
6. Keep changes minimal and focused.
7. If a command fails, analyze the error and try again — do not give up and ask the user.
8. When done: summarize what you changed AND what you verified. If you found nothing wrong, say which files you read.
</rules>`;
}

export async function buildPromptTiers(input: BuildTiersInput): Promise<PromptTiers> {
  const { cwd, files, deepPlanBlock } = input;

  const [agentMd, projectRules] = await Promise.all([
    loadAgentMd(cwd),
    loadProjectRules(cwd),
  ]);

  const base = buildBase(cwd);

  // Tier 2 — project: L4 user prefs (top) + AGENT.md + MINT.md.
  const projectParts: string[] = [];
  const userPrefs = (input.userPreferences ?? []).filter((p) => p && p.trim().length > 0);
  if (userPrefs.length > 0) {
    const bulleted = userPrefs.map((p) => `- ${p.trim()}`).join('\n');
    projectParts.push(
      `<user_preferences>\nPersistent preferences this user has set across all projects. Honor them unless they conflict with explicit project rules.\n${bulleted}\n</user_preferences>`,
    );
  }
  if (agentMd) {
    projectParts.push(`<agent_context source="${agentMd.sourcePath}">\n${agentMd.raw}\n</agent_context>`);
  }
  if (projectRules) {
    projectParts.push(`<project_rules source="${projectRules.sourcePath}">\n${projectRules.raw}\n</project_rules>`);
  }
  const project = projectParts.length > 0 ? projectParts.join('\n\n') : null;

  // Tier 3 — dynamic. Order matters for Anthropic prefix caching: most-stable
  // first. <project_memory> is most stable (loaded at session start, doesn't
  // change mid-session), then <prior_turns> (set once per runBrain call),
  // then deepPlanBlock (set once per turn), then <context> (largest / most
  // likely to differ across turns when retrieval picks different files).
  const dynamicParts: string[] = [];
  const memories = (input.projectMemories ?? []).filter((m) => m && m.trim().length > 0);
  if (memories.length > 0) {
    const bulleted = memories.map((m) => `- ${m.trim()}`).join('\n');
    dynamicParts.push(
      `<project_memory>\nPersistent memories about this project (from prior sessions). Treat as authoritative unless the user contradicts them.\n${bulleted}\n</project_memory>`,
    );
  }
  const summaries = (input.sessionSummaries ?? []).filter((s) => s && s.trim().length > 0);
  if (summaries.length > 0) {
    const numbered = summaries.map((s, i) => `${i + 1}. ${s.trim()}`).join('\n');
    dynamicParts.push(
      `<prior_turns>\nEach line is a one-paragraph summary of a prior turn in this session (oldest first). Use them to maintain continuity across follow-up prompts; do not repeat work that was already done.\n${numbered}\n</prior_turns>`,
    );
  }
  if (deepPlanBlock && deepPlanBlock.trim()) {
    // deepPlanBlock from loop.ts already includes leading newlines; trim them
    // since join('\n\n') below provides spacing.
    dynamicParts.push(deepPlanBlock.trim());
  }
  if (files.length > 0) {
    const context = files
      .slice(0, 10)
      .map((f) => `- ${f.path}${f.summary ? ` — ${f.summary}` : ''}`)
      .join('\n');
    dynamicParts.push(`<context>\nRelevant files (from hybrid retrieval):\n${context}\n</context>`);
  }

  const dynamic = dynamicParts.length > 0 ? dynamicParts.join('\n\n') : null;

  return { base, project, dynamic };
}

/** Flatten tiers to a single system string. Used by:
 *  - non-Anthropic providers (no cache support).
 *  - the back-compat shim `buildSystemPrompt()` in loop.ts.
 */
export function flattenTiers(tiers: PromptTiers): string {
  return [tiers.base, tiers.project, tiers.dynamic].filter((s): s is string => !!s).join('\n\n');
}
