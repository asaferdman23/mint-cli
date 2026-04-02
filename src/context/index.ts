/**
 * Context Engine — public API.
 *
 * Orchestrates indexing, search, compression, and project rules
 * to produce optimized context for LLM calls.
 */
export { indexProject, loadIndex, isIndexStale, type ProjectIndex, type FileIndex } from './indexer.js';
export { DependencyGraph } from './graph.js';
export { searchRelevantFiles, extractKeywords, type SearchResult, type SearchOptions } from './search.js';
export { loadProjectRules, formatProjectRulesForPrompt, generateProjectRules, generateStarterSkills, type ProjectRules } from './project-rules.js';
export { compressContext, compressToolOutput, type FileEntry, type CompressedContext } from './compress.js';
export { estimateTokens, truncateToTokens } from './budget.js';
export { loadAgentMd, formatAgentMdForPrompt } from './agentmd.js';
export { loadSkills, getSkillsForSpecialist, type Skill } from './skills.js';
