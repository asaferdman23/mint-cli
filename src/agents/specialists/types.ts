export type SpecialistType = 'frontend' | 'backend' | 'database' | 'testing' | 'devops' | 'docs' | 'general' | 'mobile' | 'ai' | 'fullstack' | 'debugging';

export interface SpecialistConfig {
  type: SpecialistType;
  systemPrompt: string;
  allowedTools: string[];
  extraContextGlobs: string[];
}
