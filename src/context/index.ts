/**
 * Context Engine — public API (slimmed for the brain architecture).
 *
 * The legacy classifier / search / compress / budget / extractor /
 * prompt-builder modules moved into the brain. What remains here is the
 * authoritative indexer + dependency graph + skills + examples — everything
 * the brain's retriever builds on top of.
 */
export { indexProject, loadIndex, isIndexStale, type ProjectIndex, type FileIndex, type SymbolInfo } from './indexer.js';
export { DependencyGraph } from './graph.js';
export {
  loadProjectRules,
  formatProjectRulesForPrompt,
  generateProjectRules,
  generateStarterSkills,
  type ProjectRules,
} from './project-rules.js';
export { loadAgentMd, formatAgentMdForPrompt } from './agentmd.js';
export { loadSkills, getSkillsForSpecialist, formatSkillsForPrompt, type Skill } from './skills.js';
export {
  loadExamples,
  generateExamples,
  getRelevantExample,
  type ExampleEntry,
  type ExamplesIndex,
} from './examples.js';
