export type SpecialistType = 'frontend' | 'backend' | 'database' | 'testing' | 'devops' | 'docs' | 'general';

export interface SpecialistConfig {
  type: SpecialistType;
  systemPrompt: string;
  allowedTools: string[];
  extraContextGlobs: string[];
}
